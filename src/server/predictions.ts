import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  availabilityFor,
  getPrediction,
  getPredictionSettings,
  listOrdersToRefresh,
  loadPredictionInput,
  savePrediction,
  type PredictionInput,
} from "@/lib/data/predictions";
import {
  leadTimeTicker,
  predictOrder,
  resolveLeadTime,
  ukDateOf,
  ukToday,
  type LeadTime,
  type LeadTimeTicker,
  type OrderPrediction,
} from "@/lib/logic/prediction";
import { getPurchaseOrder } from "@/lib/data/procurement";
import { getCustomerPageSettings } from "@/lib/data/customer-portal";
import { topicForPredictionChange } from "@/lib/logic/notifications";
import { notifyCustomer } from "./notifications";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Recalculating predictions — the one place COAST works out an order's
 * delivery date (spec §9.3), so customer notifications about dates start here too.
 * It's COAST's own work, so it runs with the service-role client, and only
 * for order ids that came from something the caller was allowed to touch.
 * It never throws: a failed recalculation must not undo the change that
 * prompted it — the next sweep catches up.
 */

export interface LineLeadTime {
  lineId: string;
  lead: LeadTime | null;
  ticker: LeadTimeTicker | null;
}

export interface Computed {
  prediction: OrderPrediction;
  leadTimes: LineLeadTime[];
  override: PredictionInput["override"];
  orgId: string;
  promisedDate: string | null;
}

async function compute(admin: SupabaseClient, orderId: string, now: Date): Promise<Computed | null> {
  const input = await loadPredictionInput(admin, orderId);
  if (!input) return null;
  const [settings, availability] = await Promise.all([
    getPredictionSettings(admin, input.orgId),
    availabilityFor(admin, input.orgId, input.lines.flatMap((l) => (l.sku ? [l.sku] : []))),
  ]);
  const today = ukToday(now);
  const leadTimes: LineLeadTime[] = [];
  const lines = input.lines.map((l) => {
    const po = l.pos.find((p) => p.confirmedDate) ?? l.pos[0];
    const lead = resolveLeadTime({
      manualDays: l.leadTimeOverrideDays,
      availabilityDays: l.sku ? (availability.get(l.sku.toUpperCase()) ?? null) : null,
      supplierDays: po?.supplierLeadTimeDays ?? null,
    });
    const poSentDate = po?.sentAt ? ukDateOf(po.sentAt) : null;
    leadTimes.push({ lineId: l.id, lead, ticker: leadTimeTicker(l.route, l.stage, lead, poSentDate, today) });
    return {
      id: l.id,
      lineNo: l.lineNo,
      route: l.route,
      stage: l.stage,
      supplierConfirmedDate: po?.confirmedDate ?? null,
      poSentDate,
      leadTime: lead,
      shipments: l.shipments,
    };
  });
  const prediction = predictOrder({ promisedDate: input.promisedDate, override: input.override, lines }, settings, today);
  return { prediction, leadTimes, override: input.override, orgId: input.orgId, promisedDate: input.promisedDate };
}

async function refreshOne(admin: SupabaseClient, orderId: string, now: Date): Promise<Computed | null> {
  const [computed, before] = await Promise.all([compute(admin, orderId, now), getPrediction(admin, orderId)]);
  if (!computed) return null;
  const p = computed.prediction;
  await savePrediction(admin, orderId, { from: p.from, to: p.to, source: p.source, confidence: p.confidence, atRisk: p.atRisk, reason: p.reason, lines: p.lines });
  // The one place a delivery date is recalculated, so the one place customers hear about it (spec §9.3).
  const settings = await getCustomerPageSettings(admin, computed.orgId);
  const topic = topicForPredictionChange(before, p, computed.promisedDate, { minGapHours: settings.minGapHours, dateShiftDays: settings.dateShiftDays });
  if (topic) await notifyCustomer(orderId, topic, { now });
  return computed;
}

/** Recalculate these orders now. Safe to call after any change; never throws. */
export async function refreshPredictions(orderIds: readonly (string | null | undefined)[], now: Date = new Date()): Promise<void> {
  const ids = [...new Set(orderIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  for (const id of ids) {
    try {
      await refreshOne(admin, id, now);
    } catch (e) {
      console.warn("[predictions] couldn't recalculate an order", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * For the order page: a fresh prediction plus each line's lead time. Called
 * only after the page's own (RLS) read proved the person can see the order.
 */
export async function predictionForOrderPage(orderId: string, now: Date = new Date()): Promise<Computed | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  try {
    return await refreshOne(admin, orderId, now);
  } catch (e) {
    console.warn("[predictions] couldn't recalculate an order", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Dates drift as days pass: keep every open order's prediction fresh. Used by the scheduled job. */
export async function sweepPredictions(
  admin: SupabaseClient,
  now: Date = new Date(),
  options: { limit?: number; orgId?: string; staleBefore?: Date } = {},
): Promise<number> {
  const ids = await listOrdersToRefresh(admin, options.staleBefore ?? new Date(now.getTime() - 6 * 3_600_000), options.limit ?? 300, options.orgId);
  let done = 0;
  for (const id of ids) {
    try {
      await refreshOne(admin, id, now);
      done++;
    } catch (e) {
      console.warn("[predictions] couldn't recalculate an order", e instanceof Error ? e.message : e);
    }
  }
  return done;
}

/** After a company-wide change (settings, availability): refresh every open order there now. */
export async function refreshOrganisation(orgId: string, now: Date = new Date()): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  try {
    await sweepPredictions(admin, now, { limit: 500, orgId, staleBefore: new Date(now.getTime() + 60_000) });
  } catch (e) {
    console.warn("[predictions] couldn't refresh the organisation", e instanceof Error ? e.message : e);
  }
}


/** Recalculate every order a purchase order covers. `client` must be one that can see the PO. */
export async function refreshPredictionsForPo(client: SupabaseClient, poId: string): Promise<void> {
  try {
    const po = await getPurchaseOrder(client, poId);
    if (po) await refreshPredictions(po.lines.map((l) => l.orderId));
  } catch (e) {
    console.warn("[predictions] couldn't find the orders for a PO", e instanceof Error ? e.message : e);
  }
}

/**
 * The same, but after the response has gone back, so a person's action
 * isn't slowed down by the recalculation. The order page recalculates
 * whenever it's opened, so it never shows a stale date.
 */
export function refreshPredictionsLater(orderIds: readonly (string | null | undefined)[]): void {
  after(() => refreshPredictions(orderIds));
}

export function refreshPredictionsForPoLater(client: SupabaseClient, poId: string): void {
  after(() => refreshPredictionsForPo(client, poId));
}
