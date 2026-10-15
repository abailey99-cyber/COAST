/**
 * The unified Updates feed (spec §5.6) and the "waiting on someone" list
 * behind the Chases screen. Pure: the time is passed in.
 *
 * The feed is assembled at read time from the order history, which the
 * database writes itself on every change — so it can never disagree with
 * the data it summarises.
 */

import { escalate, type EscalationLevel, type EscalationThresholds } from "./escalation";
import type { WorkingCalendar } from "./working-time";

// ── Feed ────────────────────────────────────────────────────────────────────
export const FEED_FILTERS = ["all", "problems", "customers", "suppliers", "shipments", "internal"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export const FEED_FILTER_LABELS: Record<FeedFilter, string> = {
  all: "Everything",
  problems: "Just the problems",
  customers: "Customers",
  suppliers: "Suppliers",
  shipments: "Shipments",
  internal: "Our changes",
};

export function parseFeedFilter(v: string | undefined): FeedFilter {
  return (FEED_FILTERS as readonly string[]).includes(v ?? "") ? (v as FeedFilter) : "all";
}

export type FeedCategory = Exclude<FeedFilter, "all" | "problems">;

const CATEGORY: Record<string, FeedCategory> = {
  order_created: "internal",
  order_updated: "internal",
  line_added: "internal",
  line_updated: "internal",
  line_stage_changed: "internal",
  prediction_changed: "internal",
  po_raised: "suppliers",
  po_status_changed: "suppliers",
  po_emailed: "suppliers",
  supplier_responded: "suppliers",
  chase_opened: "suppliers",
  chase_chased: "suppliers",
  chase_resolved: "suppliers",
  shipment_added: "shipments",
  shipment_status_changed: "shipments",
  goods_received: "shipments",
  problem_raised: "shipments",
  problem_updated: "shipments",
  customer_message: "customers",
  staff_reply: "customers",
  customer_notified: "customers",
};

export function feedCategory(kind: string, detail: Record<string, unknown>): FeedCategory {
  if ((kind === "chase_opened" || kind === "chase_resolved") && detail.chase === "internal") return "internal";
  return CATEGORY[kind] ?? "internal";
}

/** Something someone should look at, not just a record of progress. */
export function isProblem(kind: string, detail: Record<string, unknown>): boolean {
  switch (kind) {
    case "prediction_changed":
      return detail.at_risk === true && detail.was_at_risk !== true;
    case "shipment_status_changed":
      return detail.to === "exception";
    case "supplier_responded":
      return detail.status === "needs_review";
    case "customer_message":
      return true;
    case "goods_received":
      return detail.condition !== "ok";
    case "po_status_changed":
      return detail.to === "cancelled";
    case "chase_chased":
    case "problem_raised":
      return true;
    default:
      return false;
  }
}

export function matchesFeed(filter: FeedFilter, kind: string, detail: Record<string, unknown>): boolean {
  if (filter === "all") return true;
  if (filter === "problems") return isProblem(kind, detail);
  return feedCategory(kind, detail) === filter;
}

// ── Waiting on someone (Chases screen) ──────────────────────────────────────
export const WAITING_ON = ["supplier", "procurement", "us", "carrier", "customer"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export const WAITING_ON_LABELS: Record<WaitingOn, string> = {
  supplier: "A supplier",
  procurement: "Procurement",
  us: "Us (a customer is waiting)",
  carrier: "A carrier",
  customer: "The customer",
};

export interface WaitItemInput {
  id: string;
  waitingOn: WaitingOn;
  /** When the wait started. */
  since: string;
  title: string;
  detail: string | null;
  href: string;
}

export interface WaitItem extends WaitItemInput {
  hours: number;
  level: EscalationLevel;
}

const LEVEL_RANK: Record<EscalationLevel, number> = { alert: 0, red: 1, amber: 2, none: 3 };

/**
 * Everything waiting, worst first: the one escalation engine decides how
 * overdue each is (non-negotiable 6); ties go to whoever has waited longest.
 */
export function rankWaiting(items: readonly WaitItemInput[], now: Date, t: EscalationThresholds, cal: WorkingCalendar): WaitItem[] {
  return items
    .map((i) => {
      const e = escalate(new Date(i.since), now, t, cal);
      return { ...i, hours: e.waitedHours, level: e.level };
    })
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.since.localeCompare(b.since));
}

export function countByWaitingOn(items: readonly WaitItem[]): Record<WaitingOn | "overdue", number> {
  const out = { supplier: 0, procurement: 0, us: 0, carrier: 0, customer: 0, overdue: 0 };
  for (const i of items) {
    out[i.waitingOn]++;
    if (i.level !== "none") out.overdue++;
  }
  return out;
}
