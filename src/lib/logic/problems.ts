/**
 * Delivery problems — non-conformance (spec §5.4, decision C3). Pure: the
 * time is passed in. Keep the lists in step with
 * supabase/migrations/0021_problems_and_customs.sql.
 */

import type { EscalationLevel } from "./escalation";

// ── Categories (decision C3) ────────────────────────────────────────────────
export const PROBLEM_CATEGORIES = ["damaged", "short", "wrong_item", "not_received", "late", "faulty", "other"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProblemCategory, string> = {
  damaged: "Damaged",
  short: "Short or missing items",
  wrong_item: "Wrong item",
  not_received: "Not received",
  late: "Late",
  faulty: "Faulty or dead on arrival",
  other: "Something else",
};

export function isCategory(v: unknown): v is ProblemCategory {
  return typeof v === "string" && (PROBLEM_CATEGORIES as readonly string[]).includes(v);
}

// ── Status ──────────────────────────────────────────────────────────────────
export const PROBLEM_STATUSES = ["raised", "triage", "waiting_supplier", "waiting_carrier", "waiting_customer", "resolved", "closed"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const STATUS_LABELS: Record<ProblemStatus, string> = {
  raised: "New",
  triage: "Being looked at",
  waiting_supplier: "Waiting on the supplier",
  waiting_carrier: "Waiting on the carrier",
  waiting_customer: "Waiting on the customer",
  resolved: "Resolved",
  closed: "Closed",
};

export function isProblemStatus(v: unknown): v is ProblemStatus {
  return typeof v === "string" && (PROBLEM_STATUSES as readonly string[]).includes(v);
}

export function isOpen(status: ProblemStatus): boolean {
  return status !== "resolved" && status !== "closed";
}

/** Where a problem can go next. Resolved needs a resolution (handled by the action); closed can reopen. */
export function nextStatuses(current: ProblemStatus): ProblemStatus[] {
  switch (current) {
    case "raised":
      return ["triage", "waiting_supplier", "waiting_carrier", "waiting_customer", "resolved", "closed"];
    case "triage":
    case "waiting_supplier":
    case "waiting_carrier":
    case "waiting_customer":
      return PROBLEM_STATUSES.filter((s) => s !== current && s !== "raised");
    case "resolved":
      return ["closed", "triage"];
    case "closed":
      return ["triage"];
  }
}

/** Who a problem is waiting on, for the Chases screen; null when nobody (finished). */
export function waitingOn(status: ProblemStatus): "supplier" | "carrier" | "customer" | "us" | null {
  switch (status) {
    case "raised":
    case "triage":
      return "us";
    case "waiting_supplier":
      return "supplier";
    case "waiting_carrier":
      return "carrier";
    case "waiting_customer":
      return "customer";
    default:
      return null;
  }
}

/**
 * What a customer is told about their report — never who it's waiting on
 * inside the business (that could reveal there's a supplier), never the
 * cause or the resolution detail (spec §5.4, "customer-safe by design").
 */
export function customerStatus(status: ProblemStatus): string {
  switch (status) {
    case "raised":
    case "triage":
      return "We're looking into it";
    case "waiting_supplier":
    case "waiting_carrier":
      return "We're sorting it out";
    case "waiting_customer":
      return "We need something from you — check your messages";
    case "resolved":
      return "Sorted";
    case "closed":
      return "Closed";
  }
}

// ── Resolutions ─────────────────────────────────────────────────────────────
export const RESOLUTIONS = ["replacement", "credit", "return", "refund", "no_action"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  replacement: "Replacement",
  credit: "Credit",
  return: "Return (RMA)",
  refund: "Refund",
  no_action: "No action needed",
};

export function isResolution(v: unknown): v is Resolution {
  return typeof v === "string" && (RESOLUTIONS as readonly string[]).includes(v);
}

// ── Carrier problems ────────────────────────────────────────────────────────
/**
 * A carrier-reported problem drafts a delivery problem (spec §5.4). The
 * category comes from the carrier's words only when they're unmistakable;
 * otherwise "Something else", for a person to set.
 */
export function categoryFromCarrier(text: string | null): ProblemCategory {
  const t = (text ?? "").toLowerCase();
  if (/\bdamag/.test(t)) return "damaged";
  if (/\b(lost|missing|cannot be located|not found)\b/.test(t)) return "not_received";
  if (/\b(partial|short)\b/.test(t)) return "short";
  return "other";
}

/** Goods-in found something wrong: damaged → Damaged, wrong item → Wrong item, short → Short. */
export function categoryFromCheckIn(condition: string): ProblemCategory | null {
  if (condition === "damaged") return "damaged";
  if (condition === "wrong_item") return "wrong_item";
  if (condition === "short") return "short";
  return null;
}

// ── Claim windows (decision C9) ─────────────────────────────────────────────
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The last day to claim from the carrier, counted from delivery (or from when it was reported if never delivered). Null without a claim window. */
export function claimDeadline(windowDays: number | null, fromDate: string | null): string | null {
  if (windowDays === null || !fromDate || !Number.isInteger(windowDays) || windowDays <= 0) return null;
  return addDays(fromDate, windowDays);
}

export interface ClaimHealth {
  level: EscalationLevel;
  label: string;
}

/**
 * The claim deadline's own red/amber/green health (spec §5.4): fine with
 * more than 5 days left, amber at 5 or fewer, red at 2 or fewer, "needs
 * attention" once it has passed. Submitted claims are fine.
 */
export function claimHealth(deadline: string | null, today: string, submitted: boolean): ClaimHealth | null {
  if (!deadline) return null;
  if (submitted) return { level: "none", label: "Claim submitted" };
  const days = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { level: "alert", label: `Claim window closed ${-days} ${-days === 1 ? "day" : "days"} ago` };
  if (days === 0) return { level: "red", label: "Last day to claim" };
  const label = `${days} ${days === 1 ? "day" : "days"} left to claim`;
  if (days <= 2) return { level: "red", label };
  if (days <= 5) return { level: "amber", label };
  return { level: "none", label };
}

// ── Reporting a problem ─────────────────────────────────────────────────────
export interface ReportInput {
  category: string;
  description: string;
  lineIds: readonly string[];
}

export interface ValidReport {
  category: ProblemCategory;
  description: string | null;
  lineIds: string[];
}

/** A report needs a category and at least one line; "something else" needs a few words. */
export function validateReport(i: ReportInput, orderLineIds: readonly string[]): { ok: true; value: ValidReport } | { ok: false; error: string } {
  if (!isCategory(i.category)) return { ok: false, error: "Choose what's wrong." };
  const ids = [...new Set(i.lineIds)].filter((id) => orderLineIds.includes(id));
  if (ids.length === 0) return { ok: false, error: "Choose which items it's about." };
  const description = i.description.trim().slice(0, 2000) || null;
  if (i.category === "other" && !description) return { ok: false, error: "Tell us a little about what's wrong." };
  return { ok: true, value: { category: i.category, description, lineIds: ids } };
}

// ── Photos ──────────────────────────────────────────────────────────────────
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS = 5;

export type PhotoType = { contentType: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp" };

/**
 * What a file really is, from its first bytes — never trusting the name or
 * the browser's claim. Only JPEG, PNG and WebP photos are accepted.
 */
export function sniffPhoto(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { contentType: "image/png", extension: "png" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  return null;
}

export function photoProblem(size: number, type: PhotoType | null): string | null {
  if (size <= 0) return "That photo is empty.";
  if (size > MAX_PHOTO_BYTES) return "Photos must be 10 MB or smaller.";
  if (!type) return "Photos must be JPEG, PNG or WebP images.";
  return null;
}

/** A tidy file name for display: no folders, no odd characters, at most 100 long. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "photo";
  const clean = base.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  return (clean || "photo").slice(0, 100);
}

// ── Reporting rates ─────────────────────────────────────────────────────────
export interface RateFact {
  key: string;
  name: string;
  /** Lines (or shipments) delivered for this supplier (carrier). */
  delivered: number;
  problems: number;
}

/** Problems per 100 delivered, per supplier or carrier, worst first; "not enough data" under 5 deliveries. */
export function problemRates(rows: readonly RateFact[]): { key: string; name: string; delivered: number; problems: number; ratePercent: number | null }[] {
  return rows
    .map((r) => ({ ...r, ratePercent: r.delivered >= 5 ? Math.round((r.problems / r.delivered) * 100) : null }))
    .sort((a, b) => (b.ratePercent ?? -1) - (a.ratePercent ?? -1) || b.problems - a.problems || a.name.localeCompare(b.name));
}
