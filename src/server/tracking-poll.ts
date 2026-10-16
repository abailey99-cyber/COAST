import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carrierAdapter, liveCarriers, providerFor, type CarrierCredentials } from "@/lib/carriers/registry";
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
import { getIntegrationCredentials } from "./credentials";
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

/**
 * The shipment's own organisation's credentials for its carrier, or null
 * when it hasn't connected one. Never another organisation's.
 */
export async function credentialsFor(orgId: string, carrier: CarrierKey): Promise<CarrierCredentials | null> {
  const provider = providerFor(carrier);
  if (!provider) return null;
  const c = await getIntegrationCredentials(orgId, provider);
  return c?.secret ? { orgId, secret: c.secret } : null;
}

/**
 * Check one shipment now. The caller has already reserved the carrier call,
 * and passes the shipment's organisation's credentials (or they're fetched).
 */
export async function pollShipment(admin: SupabaseClient, due: DueShipment, now: Date, credentials?: CarrierCredentials | null): Promise<PollOutcome> {
  const adapter = carrierAdapter(due.carrier);
  if (!adapter) return "skipped";
  const creds = credentials === undefined ? (adapter.needsCredentials ? await credentialsFor(due.orgId, due.carrier) : null) : credentials;
  if (adapter.needsCredentials && (!creds || creds.orgId !== due.orgId)) return "skipped";

  const outcome = await adapter.track({ trackingNumber: due.trackingNumber, addedAt: new Date(due.createdAt), now }, creds);

  if (!outcome.ok) {
    const failures = due.failures + 1;
    await savePollState(admin, due.id, { nextPollAt: nextPollAt(due.status, failures, now), polledAt: now, failures, error: outcome.message });
    // "Not found yet" means the carrier answered properly; anything else counts against the carrier.
    await recordCarrierOutcome(admin, due.orgId, due.carrier, outcome.kind === "not_found" ? null : outcome.kind);
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
  await recordCarrierOutcome(admin, due.orgId, due.carrier, null);
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

/**
 * One scheduled run: every organisation's shipments with every carrier it
 * has connected, each within that organisation's own allowance for that
 * carrier. Credentials are fetched once per organisation and carrier, used
 * for that group only, and never shared between organisations.
 */
export async function runTrackingPoll(admin: SupabaseClient, now: Date = new Date()): Promise<PollRunSummary> {
  const started = Date.now();
  const live = liveCarriers();
  const summary: PollRunSummary = { due: 0, checked: 0, updated: 0, notFound: 0, failed: 0, carriers: {} };
  if (live.length === 0) return summary;

  const due = (await listDueShipments(admin, now)).filter((d) => live.includes(d.carrier));
  summary.due = due.length;
  if (due.length === 0) return summary;

  const byOrg = new Map<string, DueShipment[]>();
  for (const d of due) byOrg.set(d.orgId, [...(byOrg.get(d.orgId) ?? []), d]);
  const runsLeft = runsLeftToday(now);
  const today = now.toISOString().slice(0, 10);

  // Organisations, and each one's carriers, run side by side; each carrier's own calls are spaced out.
  await Promise.all(
    [...byOrg].map(async ([orgId, orgDue]) => {
      const activity = await listCarrierActivity(admin, today, orgId);
      const carriers = [...new Set(orgDue.map((d) => d.carrier))];
      const creds = new Map<CarrierKey, CarrierCredentials | null>();
      for (const c of carriers) creds.set(c, carrierAdapter(c)?.needsCredentials ? await credentialsFor(orgId, c) : null);
      // Not connected: nothing to check with, so those shipments wait (shown in the app as "Not connected").
      const usable = orgDue.filter((d) => !carrierAdapter(d.carrier)?.needsCredentials || creds.get(d.carrier));
      const allowance: Partial<Record<CarrierKey, number>> = {};
      for (const key of carriers) allowance[key] = runAllowance(getCarrier(key).pacing, (activity[key] ?? NO_ACTIVITY).callsToday, runsLeft);
      const plan = planPollRun(usable, allowance);
      const byId = new Map(usable.map((d) => [d.id, d]));

      await Promise.all(
        (Object.entries(plan) as [CarrierKey, string[]][]).map(async ([carrier, ids]) => {
          const pacing = getCarrier(carrier).pacing;
          const granted = await reserveCarrierCalls(admin, orgId, carrier, pacing.dailyLimit, ids.length);
          const stats = summary.carriers[carrier] ?? { planned: 0, granted: 0, checked: 0 };
          stats.planned += ids.length;
          stats.granted += granted;
          summary.carriers[carrier] = stats;
          for (const [i, id] of ids.slice(0, granted).entries()) {
            if (Date.now() - started + pacing.minGapMs > RUN_TIME_BUDGET_MS) break;
            if (i > 0 && pacing.minGapMs > 0) await sleep(pacing.minGapMs);
            const target = byId.get(id);
            if (!target) continue;
            let result: PollOutcome;
            try {
              result = await pollShipment(admin, target, new Date(), creds.get(carrier) ?? null);
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
