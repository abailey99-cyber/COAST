/**
 * The one escalation engine (CLAUDE.md non-negotiable 6): amber → red →
 * needs attention, from working hours waited against per-organisation
 * thresholds. Reused unmodified for unconfirmed POs, supplier chases,
 * internal chases and (Phase 7) delivery exceptions. Pure.
 */

import { DEFAULT_CALENDAR, workingHoursBetween, type WorkingCalendar } from "./working-time";

export type EscalationLevel = "none" | "amber" | "red" | "alert";

export interface EscalationThresholds {
  /** Working hours before amber, red and "needs attention". */
  amberHours: number;
  redHours: number;
  alertHours: number;
}

/** One, two and three working days. */
export const DEFAULT_THRESHOLDS: EscalationThresholds = { amberHours: 8, redHours: 16, alertHours: 24 };

export function thresholdsProblem(t: EscalationThresholds): string | null {
  const vals = [t.amberHours, t.redHours, t.alertHours];
  if (vals.some((v) => !Number.isFinite(v) || v <= 0 || v > 2000)) return "Use whole numbers of hours between 1 and 2,000.";
  if (!(t.amberHours < t.redHours && t.redHours < t.alertHours)) return "Amber must come before red, and red before needs attention.";
  return null;
}

export function escalationLevel(waitedHours: number, t: EscalationThresholds): EscalationLevel {
  if (waitedHours >= t.alertHours) return "alert";
  if (waitedHours >= t.redHours) return "red";
  if (waitedHours >= t.amberHours) return "amber";
  return "none";
}

export interface Escalation {
  level: EscalationLevel;
  waitedHours: number;
}

/** How long something has waited since `since`, and how escalated that is, as of `now`. */
export function escalate(since: Date, now: Date, t: EscalationThresholds = DEFAULT_THRESHOLDS, cal: WorkingCalendar = DEFAULT_CALENDAR): Escalation {
  const waitedHours = workingHoursBetween(since, now, cal);
  return { level: escalationLevel(waitedHours, t), waitedHours };
}

export const ESCALATION_LABELS: Record<EscalationLevel, string> = {
  none: "Waiting",
  amber: "Overdue",
  red: "Very overdue",
  alert: "Needs attention",
};

/** "3 working hours", "2 working days" — plain English for how long something has waited. */
export function describeWait(hours: number, hoursPerDay = 8): string {
  if (hours < 1) return "under an hour";
  if (hours < hoursPerDay) {
    const h = Math.floor(hours);
    return `${h} working ${h === 1 ? "hour" : "hours"}`;
  }
  const d = Math.floor(hours / hoursPerDay);
  return `${d} working ${d === 1 ? "day" : "days"}`;
}
