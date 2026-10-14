"use server";

import { revalidatePath } from "next/cache";
import { getOrder } from "@/lib/data/orders";
import { deleteAvailability, listOrdersWithSkus, saveAvailability, setLineLeadTime, setPredictionOverride, updatePredictionSettings } from "@/lib/data/predictions";
import { parseIsoDate } from "@/lib/logic/orders";
import { parseAvailability, predictionSettingsProblem } from "@/lib/logic/prediction";
import { hasPermission } from "@/lib/logic/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refreshOrganisation, refreshPredictions } from "./predictions";
import { NotAllowedError, requirePermission, requireStaffForAction } from "./session";

export interface PredictionResult {
  ok: boolean;
  error?: string;
  message?: string;
  problems?: string[];
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): PredictionResult {
  if (e instanceof NotAllowedError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

function revalidateOrder(orderId: string) {
  revalidatePath(`/app/orders/${orderId}`);
  revalidatePath("/app/orders");
}

// ── A delivery date set by hand (sticky) ────────────────────────────────────
export async function setDeliveryDateByHand(orderId: string, _prev: PredictionResult, formData: FormData): Promise<PredictionResult> {
  try {
    const staff = await requirePermission("orders.edit");
    const from = parseIsoDate(String(formData.get("from") ?? ""));
    const toText = String(formData.get("to") ?? "").trim();
    const to = toText ? parseIsoDate(toText) : null;
    const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
    if (!from) return { ok: false, error: "Choose the date." };
    if (toText && !to) return { ok: false, error: "That end date isn't a date." };
    if (to && to < from) return { ok: false, error: "The end of the range can't be before the start." };
    const supabase = await client();
    if (!(await getOrder(supabase, orderId))) return { ok: false, error: "That order isn't available." };
    if (!(await setPredictionOverride(supabase, orderId, staff.id, { from, to: to === from ? null : to, note }))) return { ok: false, error: "That order isn't available." };
    await refreshPredictions([orderId]);
    revalidateOrder(orderId);
    return { ok: true, message: "Saved. COAST won't change this date until you hand it back." };
  } catch (e) {
    return failure(e, "The date couldn't be saved. Try again.");
  }
}

export async function clearDeliveryDate(orderId: string): Promise<PredictionResult> {
  try {
    const staff = await requirePermission("orders.edit");
    const supabase = await client();
    if (!(await setPredictionOverride(supabase, orderId, staff.id, null))) return { ok: false, error: "That order isn't available." };
    await refreshPredictions([orderId]);
    revalidateOrder(orderId);
    return { ok: true, message: "COAST will work the date out again." };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

// ── A line's lead time set by hand (sticky) ─────────────────────────────────
export async function setLeadTimeByHand(lineId: string, days: string): Promise<PredictionResult> {
  try {
    const staff = await requireStaffForAction();
    if (!hasPermission(staff.permissions, "procurement.manage")) throw new NotAllowedError();
    const text = days.trim();
    const n = text === "" ? null : Number(text);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 365)) return { ok: false, error: "Use a whole number of working days from 0 to 365, or leave it blank." };
    const orderId = await setLineLeadTime(await client(), lineId, staff.id, n);
    if (!orderId) return { ok: false, error: "That line isn't available." };
    await refreshPredictions([orderId]);
    revalidateOrder(orderId);
    return { ok: true, message: n === null ? "Back to the automatic lead time." : "Saved." };
  } catch (e) {
    return failure(e, "The lead time couldn't be saved. Try again.");
  }
}

// ── Availability by product code (decision C2) ──────────────────────────────
export async function importAvailability(_prev: PredictionResult, formData: FormData): Promise<PredictionResult> {
  try {
    const staff = await requirePermission("procurement.manage");
    const text = String(formData.get("availability") ?? "").slice(0, 500_000);
    const source = formData.get("source") === "csv" ? "csv" : "manual";
    const parsed = parseAvailability(text);
    if (parsed.rows.length === 0) return { ok: false, error: "Nothing to save: add one product code and number of days per line.", problems: parsed.problems };
    await saveAvailability(await client(), staff.orgId, parsed.rows, source);
    const admin = createSupabaseAdminClient();
    if (admin) await refreshPredictions(await listOrdersWithSkus(admin, staff.orgId, parsed.rows.map((r) => r.sku)));
    revalidatePath("/app/suppliers");
    revalidatePath("/app/orders", "layout");
    const n = parsed.rows.length;
    return { ok: true, message: `Saved ${n} product ${n === 1 ? "code" : "codes"}.${parsed.problems.length ? ` ${parsed.problems.length} ${parsed.problems.length === 1 ? "row was" : "rows were"} left out.` : ""}`, problems: parsed.problems };
  } catch (e) {
    return failure(e, "The availability couldn't be saved. Try again.");
  }
}

export async function removeAvailability(sku: string): Promise<PredictionResult> {
  try {
    const staff = await requirePermission("procurement.manage");
    const done = await deleteAvailability(await client(), staff.orgId, sku);
    const admin = createSupabaseAdminClient();
    if (done && admin) await refreshPredictions(await listOrdersWithSkus(admin, staff.orgId, [sku]));
    revalidatePath("/app/suppliers");
    return done ? { ok: true } : { ok: false, error: "That product code isn't listed." };
  } catch (e) {
    return failure(e, "That couldn't be removed. Try again.");
  }
}

// ── Settings ────────────────────────────────────────────────────────────────
export async function savePredictionSettings(_prev: PredictionResult, formData: FormData): Promise<PredictionResult> {
  try {
    const staff = await requirePermission("settings.edit");
    const n = (k: string) => Number(String(formData.get(k) ?? "").trim());
    const s = { handlingDays: n("handlingDays"), deliveryDays: n("deliveryDays"), spreadDays: n("spreadDays") };
    const problem = predictionSettingsProblem(s);
    if (problem) return { ok: false, error: problem };
    await updatePredictionSettings(await client(), staff.orgId, staff.id, s);
    await refreshOrganisation(staff.orgId);
    revalidatePath("/app", "layout");
    return { ok: true, message: "Saved. Open orders have been worked out again." };
  } catch (e) {
    return failure(e, "The settings couldn't be saved. Try again.");
  }
}
