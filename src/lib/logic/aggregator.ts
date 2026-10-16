/**
 * Tracking through one aggregator (readiness plan Task 4). Pure.
 *
 * The aggregator covers many carriers for a per-shipment price: COAST
 * registers each tracking number once and is told about updates by webhook
 * (or checks adaptively when there's no webhook). Which aggregator is a
 * setting; each provider brings a mapping from its own carrier and status
 * codes to COAST's. Anything not in the mapping is "unknown" — never a guess.
 */

import type { CarrierKey } from "./carriers";
import type { ShipmentStatus, TrackingSnapshot } from "./shipments";

export interface AggregatorEvent {
  /** The provider's id for this event (or one made from its contents). */
  eventId: string;
  trackingNumber: string;
  carrierCode: string | null;
  statusCode: string;
  description: string;
  occurredAt: string;
  location: string | null;
  estimatedFrom?: string | null;
  estimatedTo?: string | null;
}

export interface ProviderMapping {
  carriers: Readonly<Record<string, CarrierKey>>;
  statuses: Readonly<Record<string, ShipmentStatus>>;
}

export function mapCarrier(code: string | null, m: ProviderMapping): CarrierKey {
  if (!code) return "unknown";
  return m.carriers[code.trim().toLowerCase()] ?? "unknown";
}

export function mapStatus(code: string, m: ProviderMapping): ShipmentStatus {
  return m.statuses[code.trim().toLowerCase()] ?? "unknown";
}

/** Only events not seen before (webhooks can repeat). Duplicates within one delivery count once too. */
export function newEvents(incoming: readonly AggregatorEvent[], seenIds: ReadonlySet<string>): AggregatorEvent[] {
  const seen = new Set(seenIds);
  const out: AggregatorEvent[] = [];
  for (const e of incoming) {
    if (!e.eventId || seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    out.push(e);
  }
  return out;
}

/**
 * The shipment's state from every event COAST has for it, however they
 * arrived. Events can arrive out of order, so the status comes from the
 * latest by when it happened — not the last one received.
 */
export function snapshotFromEvents(all: readonly AggregatorEvent[], m: ProviderMapping): TrackingSnapshot {
  const valid = all.filter((e) => !Number.isNaN(Date.parse(e.occurredAt)) && e.description.trim());
  const ordered = [...valid].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const mapped = ordered.map((e) => ({ ...e, status: mapStatus(e.statusCode, m) }));
  // The latest event that actually says something; "unknown" never overrides a real status.
  const latestKnown = [...mapped].reverse().find((e) => e.status !== "unknown");
  const latest = mapped.at(-1);
  const withEta = [...mapped].reverse().find((e) => e.estimatedFrom || e.estimatedTo);
  const delivered = [...mapped].reverse().find((e) => e.status === "delivered");
  return {
    status: latestKnown?.status ?? "unknown",
    statusText: latest?.description ?? null,
    estimatedFrom: withEta?.estimatedFrom ?? withEta?.estimatedTo ?? null,
    estimatedTo: withEta?.estimatedTo ?? withEta?.estimatedFrom ?? null,
    deliveredAt: latestKnown?.status === "delivered" ? (delivered?.occurredAt ?? null) : null,
    events: mapped.map((e) => ({ occurredAt: e.occurredAt, status: e.status, description: e.description, location: e.location })),
  };
}

// ── Checking when there's no webhook ────────────────────────────────────────
const HOUR = 3_600_000;

/**
 * When to check a registered shipment next: often near its predicted
 * delivery date, rarely when it's been quiet, never once it's delivered.
 * With webhooks this is only a safety net (once a day). Near the cost cap,
 * checks slow down (×4) — they never stop.
 */
export function nextAggregatorCheck(i: { status: ShipmentStatus; now: Date; predictedDate: string | null; lastEventAt: string | null; webhooks: boolean; cost: CostLevel["level"] }): Date | null {
  if (i.status === "delivered") return null;
  let gap: number;
  if (i.webhooks) gap = 24 * HOUR;
  else {
    const daysToDate = i.predictedDate ? (Date.parse(`${i.predictedDate}T12:00:00Z`) - i.now.getTime()) / (24 * HOUR) : null;
    const quietDays = i.lastEventAt ? (i.now.getTime() - Date.parse(i.lastEventAt)) / (24 * HOUR) : 0;
    if (i.status === "out_for_delivery" || (daysToDate !== null && daysToDate <= 1)) gap = 2 * HOUR;
    else if (quietDays >= 3) gap = 24 * HOUR;
    else gap = 8 * HOUR;
  }
  if (i.cost === "near" || i.cost === "over") gap *= 4;
  return new Date(i.now.getTime() + gap);
}

// ── Cost cap ────────────────────────────────────────────────────────────────
/** Tracking may cost up to this share of an organisation's monthly plan price. */
export const COST_CAP_PERCENT = 5;
export const NEAR_CAP_PERCENT = 80;

export interface CostLevel {
  level: "ok" | "near" | "over" | "no_plan";
  capMinor: number | null;
  /** Of the cap. */
  percentUsed: number | null;
}

/**
 * Where an organisation is against its monthly tracking budget. Near or
 * over the cap COAST slows checks and tells the founder — it never stops
 * tracking silently. No plan price yet: no cap, but the founder is told.
 */
export function costLevel(spentMinor: number, planPriceMinor: number | null): CostLevel {
  if (planPriceMinor === null || planPriceMinor <= 0) return { level: "no_plan", capMinor: null, percentUsed: null };
  const capMinor = Math.floor((planPriceMinor * COST_CAP_PERCENT) / 100);
  const percentUsed = capMinor > 0 ? Math.round((spentMinor / capMinor) * 100) : 100;
  return { level: percentUsed >= 100 ? "over" : percentUsed >= NEAR_CAP_PERCENT ? "near" : "ok", capMinor, percentUsed };
}

/** Should the founder hear about this organisation now? Once per level per month. */
export function shouldAlert(level: CostLevel["level"], alreadyAlerted: CostLevel["level"] | null): boolean {
  const rank = { ok: 0, no_plan: 1, near: 2, over: 3 } as const;
  return level !== "ok" && (alreadyAlerted === null || rank[level] > rank[alreadyAlerted]);
}

// ── Which way a shipment is tracked ─────────────────────────────────────────
export type TrackingRoute = "direct" | "aggregator" | "manual";

/**
 * The organisation's own carrier account first (it brought one), then the
 * aggregator, otherwise updated by hand. The test carrier is always direct.
 */
export function trackingRoute(i: { carrier: CarrierKey; hasTrackingNumber: boolean; ownAccount: boolean; directAllowed: boolean; aggregatorReady: boolean }): TrackingRoute {
  if (!i.hasTrackingNumber || i.carrier === "other") return "manual";
  if (i.carrier === "mock") return "direct";
  if (i.ownAccount && i.directAllowed) return "direct";
  return i.aggregatorReady ? "aggregator" : "manual";
}
