/**
 * Customer notifications (spec §5.5, §9.3 "the notification system"). One
 * decision function every trigger goes through: does this customer want to
 * hear about it, and now or later? Pure: the time is passed in.
 *
 * Levels: everything · key milestones (default) · problems only · replies only.
 * Genuine problems and replies always go straight away. Routine updates on
 * one order are spaced out (default 4 hours); anything held back is folded
 * into the next one, never dropped. A date change only counts once it moves
 * far enough (default 2 days) or crosses the promised date.
 */

import { formatRange } from "./prediction";
import type { CustomerOrderView } from "./masking";

export const NOTIFY_LEVELS = ["everything", "milestones", "problems", "replies"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

export const NOTIFY_LEVEL_LABELS: Record<NotifyLevel, string> = {
  everything: "Every update",
  milestones: "Key milestones",
  problems: "Only problems",
  replies: "Only replies to my messages",
};

export function isNotifyLevel(v: unknown): v is NotifyLevel {
  return typeof v === "string" && (NOTIFY_LEVELS as readonly string[]).includes(v);
}

export type Topic = "date_confirmed" | "date_changed" | "dispatched" | "out_for_delivery" | "delivered" | "late" | "delivery_problem" | "problem_update" | "reply";
export type NotificationKind = "milestone" | "date_change" | "problem" | "reply";

export const TOPIC_KIND: Record<Topic, NotificationKind> = {
  date_confirmed: "milestone",
  dispatched: "milestone",
  out_for_delivery: "milestone",
  delivered: "milestone",
  date_changed: "date_change",
  late: "problem",
  delivery_problem: "problem",
  // An answer to something the customer reported: treated like a reply.
  problem_update: "reply",
  reply: "reply",
};

const WANTED: Record<NotifyLevel, readonly Topic[]> = {
  everything: ["date_confirmed", "date_changed", "dispatched", "out_for_delivery", "delivered", "late", "delivery_problem", "problem_update", "reply"],
  milestones: ["date_confirmed", "dispatched", "delivered", "late", "delivery_problem", "problem_update", "reply"],
  problems: ["late", "delivery_problem", "problem_update", "reply"],
  replies: ["problem_update", "reply"],
};

export function wants(level: NotifyLevel, topic: Topic): boolean {
  return WANTED[level].includes(topic);
}

/** Problems and replies skip the spacing and the daily summary. */
export function isUrgent(topic: Topic): boolean {
  return TOPIC_KIND[topic] === "problem" || topic === "reply";
}

export interface NotifySettings {
  minGapHours: number;
  dateShiftDays: number;
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { minGapHours: 4, dateShiftDays: 2 };

export interface Prefs {
  email: string | null;
  level: NotifyLevel;
  dailyDigest: boolean;
}

export type Decision = { action: "send" } | { action: "hold"; reason: string } | { action: "skip"; reason: string };

/** Send now, hold for later (folded into the next one), or skip. */
export function decide(topic: Topic, prefs: Prefs | null, lastRoutineSentAt: string | null, now: Date, s: NotifySettings = DEFAULT_NOTIFY_SETTINGS): Decision {
  if (!prefs?.email) return { action: "skip", reason: "No email address for updates on this order" };
  if (!wants(prefs.level, topic)) return { action: "skip", reason: `Not wanted at "${NOTIFY_LEVEL_LABELS[prefs.level]}"` };
  if (isUrgent(topic)) return { action: "send" };
  if (prefs.dailyDigest) return { action: "hold", reason: "Waiting for the daily summary" };
  if (lastRoutineSentAt && now.getTime() - Date.parse(lastRoutineSentAt) < s.minGapHours * 3_600_000) {
    return { action: "hold", reason: `Held: an update went less than ${s.minGapHours} hours ago` };
  }
  return { action: "send" };
}

/** Held routine notifications whose wait is over (the throttle, not the daily summary). */
export function heldReadyToSend(lastRoutineSentAt: string | null, now: Date, s: NotifySettings = DEFAULT_NOTIFY_SETTINGS): boolean {
  return !lastRoutineSentAt || now.getTime() - Date.parse(lastRoutineSentAt) >= s.minGapHours * 3_600_000;
}

type Dates = { from: string | null; to: string | null; confidence: "confirmed" | "estimate" | "unknown"; source: string; atRisk: boolean | null };

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * What a prediction change means for the customer, if anything. Only
 * movements a customer would care about count (spec: "minimum meaningful
 * change"); estimates drifting by a day don't.
 */
export function topicForPredictionChange(before: Dates | null, after: Dates, promised: string | null, s: NotifySettings = DEFAULT_NOTIFY_SETTINGS): Topic | null {
  if (!after.from) return null;
  const confirmedNow = after.confidence === "confirmed" && after.from === after.to && (after.source === "supplier_confirmed" || after.source === "manual" || after.source === "carrier");
  const wasConfirmed = before?.confidence === "confirmed";
  const latestBefore = before?.to ?? before?.from ?? null;
  const latestAfter = after.to ?? after.from;
  if (promised && latestAfter > promised && (!latestBefore || latestBefore <= promised)) return "late";
  if (confirmedNow && (!wasConfirmed || before?.from !== after.from)) return "date_confirmed";
  if (!latestBefore) return null;
  if (Math.abs(dayDiff(latestBefore, latestAfter)) >= Math.max(1, s.dateShiftDays)) return "date_changed";
  if (promised && latestBefore > promised && latestAfter <= promised) return "date_changed"; // back within the promise
  return null;
}

/** Shipment status → milestone, for shipments heading to the customer. */
export function topicForShipmentStatus(leg: "inbound" | "outbound" | "direct", from: string | null, to: string): Topic | null {
  if (leg === "inbound" || from === to) return null;
  if (to === "in_transit" && (from === null || from === "unknown" || from === "pre_transit")) return "dispatched";
  if (to === "out_for_delivery") return "out_for_delivery";
  if (to === "delivered") return "delivered";
  if (to === "exception") return "delivery_problem";
  return null;
}

// ── Wording (built from the masked view only) ───────────────────────────────
export interface EmailParts {
  subject: string;
  text: string;
  html: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One short line per topic, for the email and for the record. */
export function topicSummary(topic: Topic, view: CustomerOrderView, replyText?: string): string {
  const when = formatRange(view.headline.from, view.headline.to);
  switch (topic) {
    case "date_confirmed":
      return `Delivery date confirmed: ${when}.`;
    case "date_changed":
      return when ? `New expected delivery: ${when}.` : "Your delivery date has changed.";
    case "dispatched":
      return "Your order has been dispatched.";
    case "out_for_delivery":
      return "Your order is out for delivery today.";
    case "delivered":
      return "Your order has been delivered.";
    case "late":
      return when ? `Your order may arrive later than planned. We now expect it ${when}.` : "Your order may arrive later than planned.";
    case "delivery_problem":
      return "There's a problem with your delivery. We're looking into it and will be in touch.";
    case "problem_update": {
      const p = view.problems[0];
      return p ? `Update on the problem you reported (${p.what.toLowerCase()}): ${p.status}.` : "There's an update on the problem you reported.";
    }
    case "reply":
      return `New reply: “${(replyText ?? "").slice(0, 300)}”`;
  }
}

/**
 * The email. Only ever built from a CustomerOrderView (masked) — so it
 * can't mention a supplier, a PO number or a cost.
 */
export function buildCustomerEmail(view: CustomerOrderView, summaries: readonly string[], links: { track: string; preferences: string }): EmailParts {
  const name = view.branding.displayName;
  const subject = `${view.soNumber}: ${summaries[0]?.replace(/[“”"]/g, "").slice(0, 80) ?? "an update on your order"}`;
  const lines = summaries.length > 1 ? summaries.map((s) => `- ${s}`) : summaries;
  const text = [
    `An update on your order ${view.soNumber}${view.customerReference ? ` (your ref ${view.customerReference})` : ""} from ${name}:`,
    "",
    ...lines,
    "",
    view.latest,
    "",
    `Track it: ${links.track}`,
    "",
    `Change how often you hear from us: ${links.preferences}`,
  ].join("\n");
  const html = `<div style="font-family:Sora,Arial,sans-serif;color:#0E2A3B;max-width:560px">
<p>An update on your order <strong>${esc(view.soNumber)}</strong>${view.customerReference ? ` (your ref ${esc(view.customerReference)})` : ""} from ${esc(name)}:</p>
${summaries.length > 1 ? `<ul>${summaries.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : `<p style="font-size:16px"><strong>${esc(summaries[0] ?? "")}</strong></p>`}
<p>${esc(view.latest)}</p>
<p style="margin:24px 0"><a href="${esc(links.track)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1A7584;color:#FFFFFF;text-decoration:none;font-weight:600">Track your order</a></p>
<p style="color:#5E7884;font-size:13px"><a href="${esc(links.preferences)}" style="color:#1A7584">Change how often you hear from us</a></p>
</div>`;
  return { subject, text, html };
}
