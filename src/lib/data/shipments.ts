import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCarrierKey, type CarrierActivity, type CarrierErrorKind, type CarrierKey } from "@/lib/logic/carriers";
import { isFulfilmentRoute, isLineStage, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import {
  isCustomsStatus,
  isShipmentLeg,
  isShipmentStatus,
  type CustomsStatus,
  type ShipmentLeg,
  type ShipmentStatus,
  type SnapshotPatch,
  type TrackingEventInput,
  type ValidShipment,
  type ValueSource,
} from "@/lib/logic/shipments";
import { DuplicateError } from "./orders";

/**
 * Shipments, tracking events, poll state, carrier settings and activity,
 * and the scheduled-job log. Reads and writes only. Staff calls pass the
 * signed-in client (RLS applies); the poll job passes the service-role
 * client.
 */

export interface ShipmentRow {
  id: string;
  orgId: string;
  salesOrderId: string;
  soNumber: string;
  customerName: string;
  leg: ShipmentLeg;
  carrier: CarrierKey;
  trackingNumber: string | null;
  status: ShipmentStatus;
  statusSource: ValueSource;
  statusText: string | null;
  estimatedFrom: string | null;
  estimatedTo: string | null;
  deliveredAt: string | null;
  isInternational: boolean;
  /** A person has confirmed whether customs applies (spec §5.3). */
  customsConfirmed: boolean;
  customsStatus: CustomsStatus;
  customsSource: ValueSource;
  deliveryCountry: string;
  deliveryPostcode: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  lineIds: string[];
  poll: { nextPollAt: string | null; lastPolledAt: string | null; failures: number; lastError: string | null };
}

interface RawShipment {
  id: string;
  org_id: string;
  sales_order_id: string;
  leg: string;
  carrier: string;
  tracking_number: string | null;
  status: string;
  status_source: string;
  status_text: string | null;
  estimated_from: string | null;
  estimated_to: string | null;
  delivered_at: string | null;
  is_international: boolean;
  customs_confirmed: boolean;
  customs_status: string;
  customs_source: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  shipment_lines: { order_line_id: string }[] | null;
  shipment_poll_state: PollRaw | PollRaw[] | null;
  sales_orders: { so_number: string; delivery_country: string; delivery_postcode: string; customers: { name: string } | null } | null;
}

interface PollRaw {
  next_poll_at: string | null;
  last_polled_at: string | null;
  failures: number;
  last_error: string | null;
}

const SHIPMENT_COLUMNS = `id, org_id, sales_order_id, leg, carrier, tracking_number, status, status_source, status_text,
  estimated_from, estimated_to, delivered_at, is_international, customs_confirmed, customs_status, customs_source, note, created_by, created_at,
  shipment_lines(order_line_id), shipment_poll_state(next_poll_at, last_polled_at, failures, last_error),
  sales_orders(so_number, delivery_country, delivery_postcode, customers(name))`;

function toShipment(r: RawShipment): ShipmentRow | null {
  if (!isShipmentLeg(r.leg) || !isCarrierKey(r.carrier) || !isShipmentStatus(r.status) || !isCustomsStatus(r.customs_status)) return null;
  const poll = Array.isArray(r.shipment_poll_state) ? r.shipment_poll_state[0] : r.shipment_poll_state;
  return {
    id: r.id,
    orgId: r.org_id,
    salesOrderId: r.sales_order_id,
    soNumber: r.sales_orders?.so_number ?? "",
    customerName: r.sales_orders?.customers?.name ?? "",
    leg: r.leg,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    status: r.status,
    statusSource: r.status_source === "manual" ? "manual" : "carrier",
    statusText: r.status_text,
    estimatedFrom: r.estimated_from,
    estimatedTo: r.estimated_to,
    deliveredAt: r.delivered_at,
    isInternational: r.is_international,
    customsConfirmed: r.customs_confirmed,
    customsStatus: r.customs_status,
    customsSource: r.customs_source === "manual" ? "manual" : "carrier",
    deliveryCountry: r.sales_orders?.delivery_country ?? "",
    deliveryPostcode: r.sales_orders?.delivery_postcode ?? "",
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lineIds: (r.shipment_lines ?? []).map((l) => l.order_line_id),
    poll: {
      nextPollAt: poll?.next_poll_at ?? null,
      lastPolledAt: poll?.last_polled_at ?? null,
      failures: poll?.failures ?? 0,
      lastError: poll?.last_error ?? null,
    },
  };
}

export const SHIPMENT_LIST_LIMIT = 500;

export async function listShipments(client: SupabaseClient, filter: { orderId?: string; ids?: string[] } = {}): Promise<ShipmentRow[]> {
  let q = client.from("shipments").select(SHIPMENT_COLUMNS).order("created_at", { ascending: false }).limit(SHIPMENT_LIST_LIMIT);
  if (filter.orderId) q = q.eq("sales_order_id", filter.orderId);
  if (filter.ids) q = q.in("id", filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q.returns<RawShipment[]>();
  if (error) throw new Error(`Couldn't load shipments: ${error.message}`);
  return (data ?? []).flatMap((r) => toShipment(r) ?? []);
}

export async function getShipment(client: SupabaseClient, id: string): Promise<ShipmentRow | null> {
  const { data, error } = await client.from("shipments").select(SHIPMENT_COLUMNS).eq("id", id).maybeSingle<RawShipment>();
  if (error) throw new Error(`Couldn't load shipment: ${error.message}`);
  return data ? toShipment(data) : null;
}

export async function createShipment(
  client: SupabaseClient,
  orderId: string,
  s: ValidShipment,
  extra: { isInternational: boolean; customsStatus: CustomsStatus },
): Promise<string> {
  const { data, error } = await client.rpc("create_shipment", {
    p: {
      sales_order_id: orderId,
      leg: s.leg,
      carrier: s.carrier,
      tracking_number: s.trackingNumber ?? "",
      is_international: extra.isInternational,
      customs_status: extra.customsStatus,
      note: s.note ?? "",
      line_ids: s.lineIds,
    },
  });
  if (error) {
    if (error.code === "23505") throw new DuplicateError("That tracking number is already on this order.");
    throw new Error(`Couldn't add shipment: ${error.message}`);
  }
  return data as string;
}

/** Lines on a shipment with their route and stage, for moving them along. */
export interface ShipmentLine {
  id: string;
  lineNo: number;
  description: string;
  route: FulfilmentRoute;
  stage: LineStage;
}

export async function listShipmentLines(client: SupabaseClient, shipmentId: string): Promise<ShipmentLine[]> {
  const { data, error } = await client
    .from("shipment_lines")
    .select("order_lines(id, line_no, description, route, stage)")
    .eq("shipment_id", shipmentId)
    .returns<{ order_lines: { id: string; line_no: number; description: string; route: string; stage: string } | null }[]>();
  if (error) throw new Error(`Couldn't load shipment lines: ${error.message}`);
  return (data ?? [])
    .flatMap((r) => {
      const l = r.order_lines;
      return l && isFulfilmentRoute(l.route) && isLineStage(l.stage) ? [{ id: l.id, lineNo: l.line_no, description: l.description, route: l.route, stage: l.stage }] : [];
    })
    .sort((a, b) => a.lineNo - b.lineNo);
}

// ── Tracking events ─────────────────────────────────────────────────────────
export interface TrackingEventRow {
  id: number;
  key: string;
  occurredAt: string;
  status: ShipmentStatus;
  description: string;
  location: string | null;
  source: ValueSource;
  createdBy: string | null;
}

export async function listTrackingEvents(client: SupabaseClient, shipmentId: string): Promise<TrackingEventRow[]> {
  const { data, error } = await client
    .from("tracking_events")
    .select("id, event_key, occurred_at, status, description, location, source, created_by")
    .eq("shipment_id", shipmentId)
    .order("occurred_at", { ascending: false })
    .limit(500)
    .returns<{ id: number; event_key: string; occurred_at: string; status: string; description: string; location: string | null; source: string; created_by: string | null }[]>();
  if (error) throw new Error(`Couldn't load tracking events: ${error.message}`);
  return (data ?? []).map((e) => ({
    id: e.id,
    key: e.event_key,
    occurredAt: e.occurred_at,
    status: isShipmentStatus(e.status) ? e.status : "unknown",
    description: e.description,
    location: e.location,
    source: e.source === "manual" ? "manual" : "carrier",
    createdBy: e.created_by,
  }));
}

export async function insertTrackingEvents(client: SupabaseClient, shipmentId: string, events: (TrackingEventInput & { key: string })[], source: ValueSource): Promise<void> {
  if (events.length === 0) return;
  const rows = events.map((e) => ({
    shipment_id: shipmentId,
    event_key: e.key,
    occurred_at: e.occurredAt,
    status: e.status,
    description: e.description,
    location: e.location,
    source,
  }));
  const { error } = await client.from("tracking_events").upsert(rows, { onConflict: "shipment_id,event_key", ignoreDuplicates: true });
  if (error) throw new Error(`Couldn't save tracking events: ${error.message}`);
}

// ── Manual changes (staff) ──────────────────────────────────────────────────
export async function setShipmentStatusByHand(client: SupabaseClient, id: string, status: ShipmentStatus, note: string | null): Promise<boolean> {
  const { data, error } = await client
    .from("shipments")
    .update({ status, status_source: "manual", status_text: note, delivered_at: status === "delivered" ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Couldn't change shipment: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function handStatusBackToCarrier(client: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from("shipments").update({ status_source: "carrier" }).eq("id", id).select("id");
  if (error) throw new Error(`Couldn't change shipment: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function setCustomsByHand(client: SupabaseClient, id: string, customs: CustomsStatus | null): Promise<boolean> {
  const patch = customs === null ? { customs_source: "carrier" } : { customs_status: customs, customs_source: "manual" };
  const { data, error } = await client.from("shipments").update(patch).eq("id", id).select("id");
  if (error) throw new Error(`Couldn't change customs status: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function updateShipmentTracking(client: SupabaseClient, id: string, carrier: CarrierKey, trackingNumber: string | null): Promise<boolean> {
  const { data, error } = await client.from("shipments").update({ carrier, tracking_number: trackingNumber }).eq("id", id).select("id");
  if (error) {
    if (error.code === "23505") throw new DuplicateError("That tracking number is already on this order.");
    throw new Error(`Couldn't change shipment: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

// ── The poll job (service role) ─────────────────────────────────────────────
export interface DueShipment {
  id: string;
  orgId: string;
  carrier: CarrierKey;
  trackingNumber: string;
  status: ShipmentStatus;
  createdAt: string;
  lastPolledAt: string | null;
  failures: number;
}

export async function listDueShipments(admin: SupabaseClient, now: Date, limit = 2000): Promise<DueShipment[]> {
  const { data, error } = await admin
    .from("shipment_poll_state")
    .select("shipment_id, carrier, last_polled_at, failures, shipments!inner(org_id, tracking_number, status, created_at)")
    .lte("next_poll_at", now.toISOString())
    .order("next_poll_at", { ascending: true })
    .limit(limit)
    .returns<{ shipment_id: string; carrier: string; last_polled_at: string | null; failures: number; shipments: { org_id: string; tracking_number: string | null; status: string; created_at: string } | null }[]>();
  if (error) throw new Error(`Couldn't load due shipments: ${error.message}`);
  return (data ?? []).flatMap((r) =>
    r.shipments?.tracking_number && isCarrierKey(r.carrier) && isShipmentStatus(r.shipments.status)
      ? [{ id: r.shipment_id, orgId: r.shipments.org_id, carrier: r.carrier, trackingNumber: r.shipments.tracking_number, status: r.shipments.status, createdAt: r.shipments.created_at, lastPolledAt: r.last_polled_at, failures: r.failures }]
      : [],
  );
}

export async function saveSnapshot(admin: SupabaseClient, id: string, patch: SnapshotPatch): Promise<void> {
  const { error } = await admin
    .from("shipments")
    .update({
      status: patch.status,
      status_text: patch.statusText,
      estimated_from: patch.estimatedFrom,
      estimated_to: patch.estimatedTo,
      delivered_at: patch.deliveredAt,
      customs_status: patch.customsStatus,
    })
    .eq("id", id);
  if (error) throw new Error(`Couldn't save tracking: ${error.message}`);
}

export async function savePollState(admin: SupabaseClient, id: string, state: { nextPollAt: Date | null; polledAt: Date; failures: number; error: string | null }): Promise<void> {
  const { error } = await admin
    .from("shipment_poll_state")
    .update({ next_poll_at: state.nextPollAt?.toISOString() ?? null, last_polled_at: state.polledAt.toISOString(), failures: state.failures, last_error: state.error })
    .eq("shipment_id", id);
  if (error) throw new Error(`Couldn't save poll state: ${error.message}`);
}

/** How many of `wanted` calls this organisation's daily limit for a carrier still allows; reserves them. */
export async function reserveCarrierCalls(admin: SupabaseClient, orgId: string, carrier: CarrierKey, dailyLimit: number | null, wanted: number): Promise<number> {
  const { data, error } = await admin.rpc("reserve_carrier_calls", { p_org: orgId, p_carrier: carrier, p_limit: dailyLimit, p_wanted: wanted });
  if (error) throw new Error(`Couldn't reserve carrier calls: ${error.message}`);
  return Number(data) || 0;
}

export async function recordCarrierOutcome(admin: SupabaseClient, orgId: string, carrier: CarrierKey, errorKind: CarrierErrorKind | null): Promise<void> {
  const { error } = await admin.rpc("record_carrier_outcome", { p_org: orgId, p_carrier: carrier, p_error: errorKind });
  if (error) throw new Error(`Couldn't record carrier outcome: ${error.message}`);
}

/** One organisation's carrier activity. Staff pass their own client (RLS scopes it); the poll job passes the service role and the organisation. */
export async function listCarrierActivity(client: SupabaseClient, today: string, orgId?: string): Promise<Partial<Record<CarrierKey, CarrierActivity>>> {
  let q = client.from("carrier_activity").select("carrier, usage_day, calls_today, last_success_at, last_error_at, last_error_kind, consecutive_failures");
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q
    .returns<{ carrier: string; usage_day: string; calls_today: number; last_success_at: string | null; last_error_at: string | null; last_error_kind: CarrierErrorKind | null; consecutive_failures: number }[]>();
  if (error) throw new Error(`Couldn't load carrier activity: ${error.message}`);
  const out: Partial<Record<CarrierKey, CarrierActivity>> = {};
  for (const r of data ?? []) {
    if (!isCarrierKey(r.carrier)) continue;
    out[r.carrier] = {
      lastSuccessAt: r.last_success_at,
      lastErrorAt: r.last_error_at,
      lastErrorKind: r.last_error_kind,
      consecutiveFailures: r.consecutive_failures,
      callsToday: r.usage_day === today ? r.calls_today : 0,
    };
  }
  return out;
}

// ── Carrier settings (per organisation) ─────────────────────────────────────
export async function listCarrierSettings(client: SupabaseClient): Promise<Partial<Record<CarrierKey, { claimWindowDays: number | null }>>> {
  const { data, error } = await client.from("carrier_settings").select("carrier, claim_window_days").returns<{ carrier: string; claim_window_days: number | null }[]>();
  if (error) throw new Error(`Couldn't load carrier settings: ${error.message}`);
  const out: Partial<Record<CarrierKey, { claimWindowDays: number | null }>> = {};
  for (const r of data ?? []) if (isCarrierKey(r.carrier)) out[r.carrier] = { claimWindowDays: r.claim_window_days };
  return out;
}

export async function saveClaimWindow(client: SupabaseClient, orgId: string, userId: string, carrier: CarrierKey, days: number | null): Promise<void> {
  const { data, error } = await client.from("carrier_settings").update({ claim_window_days: days, updated_by: userId }).eq("org_id", orgId).eq("carrier", carrier).select("carrier");
  if (error) throw new Error(`Couldn't save claim window: ${error.message}`);
  if ((data?.length ?? 0) > 0) return;
  const { error: insertError } = await client.from("carrier_settings").insert({ org_id: orgId, carrier, claim_window_days: days, updated_by: userId });
  if (insertError) throw new Error(`Couldn't save claim window: ${insertError.message}`);
}

