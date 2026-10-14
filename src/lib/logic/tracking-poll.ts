/**
 * When to check each shipment with its carrier, and which ones get the
 * limited calls (docs/integrations/carrier-tracking.md: one poll run covers
 * every carrier; DHL allows 250 calls a day, one per 5 seconds). Pure: the
 * current time is passed in.
 */

import type { CarrierKey, Pacing } from "./carriers";
import type { ShipmentStatus } from "./shipments";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long to wait before the next routine check, by what the shipment is doing. */
const INTERVAL_BY_STATUS: Record<ShipmentStatus, number> = {
  out_for_delivery: 30 * MINUTE,
  exception: 1 * HOUR,
  in_transit: 2 * HOUR,
  pre_transit: 4 * HOUR,
  unknown: 4 * HOUR,
  delivered: 0,
};

/** The schedule runs every 30 minutes (B12 says 15–30). */
export const POLL_RUN_EVERY_MINUTES = 30;

export const MAX_BACKOFF_MS = 24 * HOUR;

/**
 * When to check next. Delivered shipments stop (null). After failures the
 * wait doubles from 30 minutes up to a day — "sensible back-off if a
 * carrier's API is erroring" (spec §5.2). A shipment the carrier can't find
 * yet is usually just too new, so it's retried on the normal schedule.
 */
export function nextPollAt(status: ShipmentStatus, failures: number, now: Date): Date | null {
  if (status === "delivered") return null;
  const wait = failures > 0 ? Math.min(MAX_BACKOFF_MS, 30 * MINUTE * 2 ** (failures - 1)) : INTERVAL_BY_STATUS[status];
  return new Date(now.getTime() + wait);
}

export interface PollCandidate {
  id: string;
  carrier: CarrierKey;
  status: ShipmentStatus;
  lastPolledAt: string | null;
}

const PRIORITY: Record<ShipmentStatus, number> = {
  out_for_delivery: 0,
  exception: 1,
  in_transit: 2,
  pre_transit: 3,
  unknown: 4,
  delivered: 9,
};

/**
 * Which due shipments to check this run, per carrier, within each carrier's
 * allowance. Live movement first (out for delivery, problems, in transit),
 * then whichever was checked longest ago; never-checked ones first of all.
 */
export function planPollRun(due: readonly PollCandidate[], allowance: Partial<Record<CarrierKey, number>>): Partial<Record<CarrierKey, string[]>> {
  const sorted = [...due]
    .filter((c) => c.status !== "delivered")
    .sort((a, b) => {
      if (!a.lastPolledAt !== !b.lastPolledAt) return a.lastPolledAt ? 1 : -1;
      if (PRIORITY[a.status] !== PRIORITY[b.status]) return PRIORITY[a.status] - PRIORITY[b.status];
      return (a.lastPolledAt ?? "").localeCompare(b.lastPolledAt ?? "");
    });
  const plan: Partial<Record<CarrierKey, string[]>> = {};
  for (const c of sorted) {
    const cap = allowance[c.carrier] ?? 0;
    const list = (plan[c.carrier] ??= []);
    if (list.length < cap) list.push(c.id);
  }
  for (const key of Object.keys(plan) as CarrierKey[]) if (plan[key]!.length === 0) delete plan[key];
  return plan;
}

/** Share of a daily limit kept back for "Check now" from the shipment screen. */
export const MANUAL_SHARE = 0.1;

/** Scheduled runs left today (UTC day, which is how carriers count), including this one. */
export function runsLeftToday(now: Date, everyMinutes: number = POLL_RUN_EVERY_MINUTES): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((end - now.getTime()) / (everyMinutes * MINUTE)));
}

/**
 * How many calls this run may make for one carrier. With a daily limit the
 * remaining calls (less the share kept for manual checks) are spread over
 * the runs left today, so the morning can't use up the whole day.
 */
export function runAllowance(pacing: Pacing, callsToday: number, runsLeft: number): number {
  if (pacing.maxPerRun <= 0) return 0;
  if (pacing.dailyLimit === null) return pacing.maxPerRun;
  const scheduledLimit = Math.floor(pacing.dailyLimit * (1 - MANUAL_SHARE));
  const remaining = scheduledLimit - callsToday;
  if (remaining <= 0) return 0;
  return Math.min(pacing.maxPerRun, remaining, Math.max(1, Math.ceil(remaining / Math.max(1, runsLeft))));
}

/** A "Check now" press: allowed while the carrier has any of today's calls left. */
export function canCheckNow(pacing: Pacing, callsToday: number): boolean {
  if (pacing.maxPerRun <= 0) return false;
  return pacing.dailyLimit === null || callsToday < pacing.dailyLimit;
}
