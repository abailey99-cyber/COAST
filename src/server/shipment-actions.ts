"use server";

import { revalidatePath } from "next/cache";
import { DuplicateError, getOrder, updateLineStage } from "@/lib/data/orders";
import {
  createShipment,
  getShipment,
  handStatusBackToCarrier,
  insertTrackingEvents,
  listCarrierActivity,
  listShipmentLines,
  reserveCarrierCalls,
  saveClaimWindow,
  setCustomsByHand,
  setShipmentStatusByHand,
  updateShipmentTracking,
} from "@/lib/data/shipments";
import { NO_ACTIVITY, getCarrier, hasLiveAdapter, isCarrierKey, selectableCarriers, trackableCarriers } from "@/lib/logic/carriers";
import { hasPermission } from "@/lib/logic/permissions";
import {
  SHIPMENT_STATUS_LABELS,
  carrierNeedsTrackingNumber,
  eventKey,
  isCustomsStatus,
  isInternational,
  isShipmentStatus,
  lineStageForShipment,
  normaliseTrackingNumber,
  validateNewShipment,
  type ShipmentErrors,
} from "@/lib/logic/shipments";
import { canCheckNow } from "@/lib/logic/tracking-poll";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, requirePermission } from "./session";
import { pollShipment } from "./tracking-poll";
import { refreshPredictionsLater } from "./predictions";
import { notifyCustomerLater } from "./notifications";
import { topicForShipmentStatus } from "@/lib/logic/notifications";

export interface ShipmentResult {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: ShipmentErrors;
  shipmentId?: string;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): ShipmentResult {
  if (e instanceof NotAllowedError || e instanceof DuplicateError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

async function revalidateShipment(shipmentId: string, orderId: string) {
  refreshPredictionsLater([orderId]);
  revalidatePath(`/app/shipments/${shipmentId}`);
  revalidatePath("/app/shipments");
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/orders");
}

// ── Add a shipment to an order ──────────────────────────────────────────────
export async function addShipment(orderId: string, _prev: ShipmentResult, formData: FormData): Promise<ShipmentResult> {
  try {
    const staff = await requirePermission("shipments.manage");
    const supabase = await client();
    const order = await getOrder(supabase, orderId);
    if (!order) return { ok: false, error: "That order isn't available." };

    const seeSupplierLegs = hasPermission(staff.permissions, "supplier.identity.view");
    const result = validateNewShipment(
      {
        leg: String(formData.get("leg") ?? ""),
        carrier: String(formData.get("carrier") ?? ""),
        trackingNumber: String(formData.get("trackingNumber") ?? ""),
        lineIds: formData.getAll("lineIds").map(String),
        note: String(formData.get("note") ?? ""),
      },
      order.lines.map((l) => ({ id: l.id, route: l.route, stage: l.stage, quantity: l.quantity })),
      { allowedCarriers: selectableCarriers(process.env.COAST_ENV).map((c) => c.key) },
    );
    if (!result.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: result.errors };
    if (result.value.leg !== "outbound" && !seeSupplierLegs) throw new NotAllowedError();

    // A shipment straight to the customer crosses a border if the order's address does; inbound origin isn't recorded yet.
    const international = result.value.leg !== "inbound" && isInternational(order.delivery.country, order.delivery.postcode);
    const id = await createShipment(supabase, orderId, result.value, { isInternational: international, customsStatus: international ? "unknown" : "not_required" });
    await revalidateShipment(id, orderId);
    const live = hasLiveAdapter(result.value.carrier) && result.value.trackingNumber;
    return {
      ok: true,
      shipmentId: id,
      message: live ? "Shipment added. COAST will check it with the carrier on its next run." : "Shipment added. Update its status by hand as it moves.",
    };
  } catch (e) {
    return failure(e, "The shipment couldn't be added. Try again.");
  }
}

// ── Check one shipment with its carrier now ─────────────────────────────────
export async function checkShipmentNow(shipmentId: string): Promise<ShipmentResult> {
  try {
    await requirePermission("shipments.manage");
    const supabase = await client();
    // The person's own client proves they can see this shipment (RLS) before COAST acts as the system.
    const shipment = await getShipment(supabase, shipmentId);
    if (!shipment || !shipment.trackingNumber) return { ok: false, error: "There's no tracking number to check." };
    const def = getCarrier(shipment.carrier);
    if (!hasLiveAdapter(shipment.carrier) || !trackableCarriers(process.env.COAST_ENV).some((c) => c.key === def.key)) {
      return { ok: false, error: `${def.label} can't be checked automatically yet.` };
    }
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "Carrier checks aren't available right now." };
    const activity = await listCarrierActivity(supabase, new Date().toISOString().slice(0, 10));
    if (!canCheckNow(def.pacing, (activity[shipment.carrier] ?? NO_ACTIVITY).callsToday)) {
      return { ok: false, error: `Today's ${def.label} limit is used up. Checks start again tomorrow.` };
    }
    if ((await reserveCarrierCalls(admin, shipment.carrier, def.pacing.dailyLimit, 1)) < 1) {
      return { ok: false, error: `Today's ${def.label} limit is used up. Checks start again tomorrow.` };
    }
    const outcome = await pollShipment(
      admin,
      { id: shipment.id, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, status: shipment.status, createdAt: shipment.createdAt, lastPolledAt: shipment.poll.lastPolledAt, failures: shipment.poll.failures },
      new Date(),
    );
    await revalidateShipment(shipment.id, shipment.salesOrderId);
    switch (outcome) {
      case "updated":
        return { ok: true, message: "Checked: there's news from the carrier." };
      case "unchanged":
        return { ok: true, message: "Checked: nothing new from the carrier." };
      case "not_found":
        return { ok: false, error: "The carrier doesn't know this tracking number yet. New labels can take a few hours to appear." };
      case "skipped":
        return { ok: false, error: `${def.label} isn't connected yet, so COAST can't check it.` };
      default:
        return { ok: false, error: "The carrier didn't answer properly. COAST will try again later." };
    }
  } catch (e) {
    return failure(e, "The check didn't work. Try again.");
  }
}

// ── Set things by hand (sticky until handed back) ───────────────────────────
export async function setShipmentStatus(shipmentId: string, status: string, note: string): Promise<ShipmentResult> {
  try {
    const staff = await requirePermission("shipments.manage");
    if (!isShipmentStatus(status)) return { ok: false, error: "Choose a status." };
    const supabase = await client();
    const shipment = await getShipment(supabase, shipmentId);
    if (!shipment) return { ok: false, error: "That shipment isn't available." };
    const text = note.trim().slice(0, 300) || null;
    if (!(await setShipmentStatusByHand(supabase, shipmentId, status, text))) return { ok: false, error: "That shipment isn't available." };
    const topic = topicForShipmentStatus(shipment.leg, shipment.status, status);
    if (topic) notifyCustomerLater(shipment.salesOrderId, topic);
    const now = new Date().toISOString();
    const description = `${SHIPMENT_STATUS_LABELS[status]} (set by ${staff.fullName})${text ? ` — ${text}` : ""}`;
    await insertTrackingEvents(supabase, shipmentId, [{ occurredAt: now, status, description, location: null, key: eventKey({ occurredAt: now, description }) }], "manual");
    for (const line of await listShipmentLines(supabase, shipmentId)) {
      const to = lineStageForShipment(line.route, line.stage, shipment.leg, status);
      // Needs order or procurement rights as well; without them the line stays put for someone who has them.
      if (to) await updateLineStage(supabase, line.id, line.stage, to).catch(() => false);
    }
    await revalidateShipment(shipmentId, shipment.salesOrderId);
    return { ok: true, message: "Saved. COAST won't overwrite this status until you hand it back to the carrier." };
  } catch (e) {
    return failure(e, "The status couldn't be saved. Try again.");
  }
}

export async function handShipmentBackToCarrier(shipmentId: string): Promise<ShipmentResult> {
  try {
    await requirePermission("shipments.manage");
    const supabase = await client();
    const shipment = await getShipment(supabase, shipmentId);
    if (!shipment) return { ok: false, error: "That shipment isn't available." };
    await handStatusBackToCarrier(supabase, shipmentId);
    await revalidateShipment(shipmentId, shipment.salesOrderId);
    return { ok: true, message: "The carrier's updates will set the status again from the next check." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

export async function setShipmentCustoms(shipmentId: string, value: string): Promise<ShipmentResult> {
  try {
    await requirePermission("shipments.manage");
    const supabase = await client();
    const shipment = await getShipment(supabase, shipmentId);
    if (!shipment || !shipment.isInternational) return { ok: false, error: "That shipment doesn't cross a border." };
    if (value !== "carrier" && !isCustomsStatus(value)) return { ok: false, error: "Choose a customs status." };
    await setCustomsByHand(supabase, shipmentId, value === "carrier" ? null : value);
    await revalidateShipment(shipmentId, shipment.salesOrderId);
    return { ok: true, message: value === "carrier" ? "COAST will read customs from the carrier's updates again." : "Saved. COAST won't change it until you hand it back." };
  } catch (e) {
    return failure(e, "The customs status couldn't be saved. Try again.");
  }
}

export async function changeShipmentTracking(shipmentId: string, _prev: ShipmentResult, formData: FormData): Promise<ShipmentResult> {
  try {
    await requirePermission("shipments.manage");
    const carrier = String(formData.get("carrier") ?? "");
    if (!isCarrierKey(carrier) || !selectableCarriers(process.env.COAST_ENV).some((c) => c.key === carrier)) return { ok: false, fieldErrors: { carrier: "Choose a carrier." } };
    const raw = String(formData.get("trackingNumber") ?? "");
    const trackingNumber = raw.trim() ? normaliseTrackingNumber(raw) : null;
    if (raw.trim() && !trackingNumber) return { ok: false, fieldErrors: { trackingNumber: "That doesn't look like a tracking number: use 4–40 letters, numbers or dashes." } };
    if (!trackingNumber && carrierNeedsTrackingNumber(carrier)) return { ok: false, fieldErrors: { trackingNumber: "Enter the tracking number." } };
    const supabase = await client();
    const shipment = await getShipment(supabase, shipmentId);
    if (!shipment) return { ok: false, error: "That shipment isn't available." };
    await updateShipmentTracking(supabase, shipmentId, carrier, trackingNumber);
    await revalidateShipment(shipmentId, shipment.salesOrderId);
    return { ok: true, message: "Saved. COAST will check the new details on its next run." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

// ── Claim windows per carrier (decision C9) ─────────────────────────────────
export async function saveCarrierClaimWindow(carrier: string, days: string): Promise<ShipmentResult> {
  try {
    const staff = await requirePermission("settings.edit");
    if (!isCarrierKey(carrier)) return { ok: false, error: "Unknown carrier." };
    const text = days.trim();
    const n = text === "" ? null : Number(text);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 365)) return { ok: false, error: "Use a whole number of days from 1 to 365, or leave it blank." };
    await saveClaimWindow(await client(), staff.orgId, staff.id, carrier, n);
    revalidatePath("/app/settings");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}
