import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carrierAdapter, liveCarriers } from "@/lib/carriers/registry";
import { updateLineStage } from "@/lib/data/orders";
import {
  getShipment,
  insertTrackingEvents,
  listCarrierActivity,
  listDueShipments,
  listShipmentLines,
  listTrackingEvents,
  recordCarrierOutcome,
  reserveCarrierCalls,
  savePollState,
  saveSnapshot,
  type DueShipment,
} from "@/lib/data/shipments";
import { getCarrier, NO_ACTIVITY, type CarrierKey } from "@/lib/logic/carriers";
import { applySnapshot, lineStageForShipment } from "@/lib/logic/shipments";
import { nextPollAt, planPollRun, runAllowance, runsLeftToday } from "@/lib/logic/tracking-poll";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { refreshPredictions, sweepPredictions } from "./predictions";
import { flushHeldNotifications, notifyCustomer } from "./notifications";
import { draftCarrierProblem } from "./problems-auto";
import { topicForShipmentStatus } from "@/lib/logic/notifications";

/**
 * Checking shipments with their carriers (spec §5.2). Runs as the system,
 * with the service-role client: from the scheduled job (/api/cron/tracking-poll)
 * or for one shipment after a staff member's "Check now" has passed its own
 * permission check. Never throws for a carrier problem — it records it and
 * backs off.
 */

export type PollOutcome = "updated" | "unchanged" | "not_found" | "failed" | "skipped";

/** A poll run must finish inside the hosting time limit (60 s), with room to spare. */
export const RUN_TIME_BUDGET_MS = 50_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Check one shipment now. The caller has already reserved the carrier call. */
export async function pollShipment(admin: SupabaseClient, due: DueShipment, now: Date): Promise<PollOutcome> {
  const adapter = carrierAdapter(due.carrier);
  if (!adapter) return "skipped";

  const outcome = await adapter.track({ trackingNumber: due.trackingNumber, addedAt: new Date(due.createdAt), now });

  if (!outcome.ok) {
    const failures = due.failures + 1;
    await savePollState(admin, due.id, { nextPollAt: nextPollAt(due.status, failures, now), polledAt: now, failures, error: outcome.message });
    // "Not found yet" means the carrier answered properly; anything else counts against the carrier.
    await recordCarrierOutcome(admin, due.carrier, outcome.kind === "not_found" ? null : outcome.kind);
    return outcome.kind === "not_found" ? "not_found" : "failed";
  }

  const [shipment, events] = await Promise.all([getShipment(admin, due.id), listTrackingEvents(admin, due.id)]);
  if (!shipment) return "skipped";

  const result = applySnapshot(
    {
      status: shipment.status,
      statusSource: shipment.statusSource,
      isInternational: shipment.isInternational,
      customsStatus: shipment.customsStatus,
      customsSource: shipment.customsSource,
      eventKeys: new Set(events.map((e) => e.key)),
      events,
    },
    outcome.snapshot,
  );

  await insertTrackingEvents(admin, due.id, result.newEvents, "carrier");
  await saveSnapshot(admin, due.id, result.patch);

  if (result.statusChange) {
    for (const line of await listShipmentLines(admin, due.id)) {
      const to = lineStageForShipment(line.route, line.stage, shipment.leg, result.patch.status);
      if (to) await updateLineStage(admin, line.id, line.stage, to);
    }
  }

  // A person's "delivered" stops the checks; so does the carrier's.
  const finalStatus = shipment.statusSource === "manual" ? shipment.status : result.patch.status;
  await savePollState(admin, due.id, { nextPollAt: nextPollAt(finalStatus, 0, now), polledAt: now, failures: 0, error: null });
  await recordCarrierOutcome(admin, due.carrier, null);
  const changed = result.statusChange !== null || result.newEvents.length > 0 || result.patch.estimatedFrom !== shipment.estimatedFrom || result.patch.estimatedTo !== shipment.estimatedTo;
  if (changed) await refreshPredictions([shipment.salesOrderId], now);
  if (result.statusChange?.to === "exception") await draftCarrierProblem(admin, due.id, now);
  if (result.statusChange) {
    const topic = topicForShipmentStatus(shipment.leg, result.statusChange.from, result.statusChange.to);
    if (topic) await notifyCustomer(shipment.salesOrderId, topic, { now });
  }
  return changed ? "updated" : "unchanged";
}

export interface PollRunSummary {
  due: number;
  checked: number;
  updated: number;
  notFound: number;
  failed: number;
  carriers: Partial<Record<CarrierKey, { planned: number; granted: number; checked: number }>>;
}

/** One scheduled run: every configured carrier, within each one's limits. */
export async function runTrackingPoll(admin: SupabaseClient, now: Date = new Date()): Promise<PollRunSummary> {
  const started = Date.now();
  const live = liveCarriers();
  const summary: PollRunSummary = { due: 0, checked: 0, updated: 0, notFound: 0, failed: 0, carriers: {} };
  if (live.length === 0) return summary;

  const due = (await listDueShipments(admin, now)).filter((d) => live.includes(d.carrier));
  summary.due = due.length;
  if (due.length === 0) return summary;

  const activity = await listCarrierActivity(admin, now.toISOString().slice(0, 10));
  const runsLeft = runsLeftToday(now);
  const allowance: Partial<Record<CarrierKey, number>> = {};
  for (const key of live) allowance[key] = runAllowance(getCarrier(key).pacing, (activity[key] ?? NO_ACTIVITY).callsToday, runsLeft);

  const plan = planPollRun(due, allowance);
  const byId = new Map(due.map((d) => [d.id, d]));

  // Carriers run side by side; each one's own calls are spaced out.
  await Promise.all(
    (Object.entries(plan) as [CarrierKey, string[]][]).map(async ([carrier, ids]) => {
      const pacing = getCarrier(carrier).pacing;
      const granted = await reserveCarrierCalls(admin, carrier, pacing.dailyLimit, ids.length);
      const stats = { planned: ids.length, granted, checked: 0 };
      summary.carriers[carrier] = stats;
      for (const [i, id] of ids.slice(0, granted).entries()) {
        if (Date.now() - started + pacing.minGapMs > RUN_TIME_BUDGET_MS) break;
        if (i > 0 && pacing.minGapMs > 0) await sleep(pacing.minGapMs);
        const target = byId.get(id);
        if (!target) continue;
        let result: PollOutcome;
        try {
          result = await pollShipment(admin, target, new Date());
        } catch {
          result = "failed";
        }
        stats.checked++;
        summary.checked++;
        if (result === "updated") summary.updated++;
        if (result === "not_found") summary.notFound++;
        if (result === "failed") summary.failed++;
      }
    }),
  );
  return summary;
}

/** The /api/cron/tracking-poll job. */
export async function scheduledTrackingPoll(): Promise<{ outcome: "ok" | "partial" | "error"; predictionsRefreshed?: number; heldUpdatesSent?: number } & Partial<PollRunSummary>> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { outcome: "error" };
  const s = await runTrackingPoll(admin);
  // Delivery dates drift as days pass, so the same run keeps predictions fresh (Phase 4).
  const predictionsRefreshed = await sweepPredictions(admin);
  // Customer updates held back by the spacing rule go out once the gap has passed (Phase 5).
  const heldUpdatesSent = await flushHeldNotifications(admin, "throttle");
  const outcome = s.failed === 0 ? "ok" : s.failed < s.checked ? "partial" : "error";
  return { outcome, ...s, predictionsRefreshed, heldUpdatesSent };
}
