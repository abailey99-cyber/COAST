/**
 * A supplier's answer to a PO — from the confirmation link, a pasted email,
 * or (Phase 8) the shared mailbox — checked against what was ordered
 * (spec §5.1 "Discrepancy detection"). Pure.
 */

import type { Currency } from "./format";
import { parseIsoDate, parseMoneyToMinor, parseQuantity, type FieldErrors } from "./orders";
import type { Confidence } from "./email-reading";

export type ResponseSource = "link" | "paste" | "inbound";

export interface PoLineForCheck {
  poLineId: string;
  lineLabel: string;
  quantity: number;
  requestedDate: string | null;
  unitCostMinor: number | null;
}

export interface ResponseLine {
  poLineId: string;
  available: boolean;
  quantity: number | null;
  date: string | null;
  unitCostMinor: number | null;
}

export interface SupplierAnswer {
  currency: Currency | null;
  lines: ResponseLine[];
}

export type DiscrepancyField = "unavailable" | "quantity" | "price" | "currency" | "date" | "missing_date" | "missing_line";

export interface Discrepancy {
  poLineId: string | null;
  field: DiscrepancyField;
  message: string;
}

const money = (minor: number) => (minor / 100).toFixed(2);

/** Everything that doesn't match what was ordered, in plain English. */
export function detectDiscrepancies(po: { currency: Currency; lines: readonly PoLineForCheck[] }, answer: SupplierAnswer): Discrepancy[] {
  const out: Discrepancy[] = [];
  if (answer.currency && answer.currency !== po.currency) {
    out.push({ poLineId: null, field: "currency", message: `Priced in ${answer.currency}; the PO is in ${po.currency}.` });
  }
  const byId = new Map(answer.lines.map((l) => [l.poLineId, l]));
  for (const line of po.lines) {
    const a = byId.get(line.poLineId);
    if (!a) {
      out.push({ poLineId: line.poLineId, field: "missing_line", message: `${line.lineLabel}: no answer.` });
      continue;
    }
    if (!a.available) {
      out.push({ poLineId: line.poLineId, field: "unavailable", message: `${line.lineLabel}: the supplier can't supply it.` });
      continue;
    }
    if (a.quantity !== null && a.quantity !== line.quantity) {
      out.push({ poLineId: line.poLineId, field: "quantity", message: `${line.lineLabel}: ${a.quantity} confirmed, ${line.quantity} ordered.` });
    }
    if (a.unitCostMinor !== null && line.unitCostMinor !== null && a.unitCostMinor !== line.unitCostMinor) {
      out.push({ poLineId: line.poLineId, field: "price", message: `${line.lineLabel}: ${money(a.unitCostMinor)} each confirmed, ${money(line.unitCostMinor)} expected.` });
    }
    if (!a.date) {
      out.push({ poLineId: line.poLineId, field: "missing_date", message: `${line.lineLabel}: no date given.` });
    } else if (line.requestedDate && a.date > line.requestedDate) {
      out.push({ poLineId: line.poLineId, field: "date", message: `${line.lineLabel}: ${a.date} confirmed, ${line.requestedDate} requested.` });
    }
  }
  return out;
}

export type Decision = { action: "apply" } | { action: "review"; reasons: string[] };

/**
 * Apply automatically only when the answer is certain and matches exactly.
 * Link answers are structured, so they're certain; email reads must also be
 * high confidence. Anything else goes to a person (spec §2: "I don't know"
 * beats a guess).
 */
export function decide(source: ResponseSource, confidence: Confidence, discrepancies: readonly Discrepancy[], extraReasons: readonly string[] = []): Decision {
  const reasons = [...extraReasons, ...discrepancies.map((d) => d.message)];
  if (source !== "link" && confidence !== "high" && extraReasons.length === 0) reasons.unshift("COAST isn't sure it read the email correctly.");
  if (reasons.length === 0 && (source === "link" || confidence === "high")) return { action: "apply" };
  return { action: "review", reasons };
}

// ── The supplier's form on the confirmation link ────────────────────────────
export interface LinkLineInput {
  poLineId: string;
  available: boolean;
  quantity: string;
  date: string;
  unitPrice: string;
}

export function validateLinkAnswer(
  lines: readonly LinkLineInput[],
  po: { lines: readonly PoLineForCheck[] },
): { ok: true; answer: SupplierAnswer } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const known = new Map(po.lines.map((l) => [l.poLineId, l]));
  const out: ResponseLine[] = [];
  for (const l of lines) {
    const line = known.get(l.poLineId);
    if (!line) continue;
    if (!l.available) {
      out.push({ poLineId: l.poLineId, available: false, quantity: null, date: null, unitCostMinor: null });
      continue;
    }
    const quantity = parseQuantity(l.quantity);
    if (quantity === null) errors[`${l.poLineId}.quantity`] = `${line.lineLabel}: enter the quantity you can supply.`;
    const date = parseIsoDate(l.date.trim());
    if (!date) errors[`${l.poLineId}.date`] = `${line.lineLabel}: enter the delivery date.`;
    const unitCostMinor = l.unitPrice.trim() ? parseMoneyToMinor(l.unitPrice) : null;
    if (l.unitPrice.trim() && unitCostMinor === null) errors[`${l.poLineId}.unitPrice`] = `${line.lineLabel}: enter a price like 12.50.`;
    out.push({ poLineId: l.poLineId, available: true, quantity, date, unitCostMinor });
  }
  for (const l of po.lines) if (!lines.some((x) => x.poLineId === l.poLineId)) errors[`${l.poLineId}.missing`] = `${l.lineLabel}: please answer this line.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, answer: { currency: null, lines: out } };
}

/** What an accepted answer sets on each PO line. Unavailable lines aren't confirmed. */
export interface ConfirmedLine {
  poLineId: string;
  confirmedDate: string;
  confirmedQuantity: number;
  confirmedUnitCostMinor: number | null;
}

export function confirmedLines(answer: SupplierAnswer, po: { lines: readonly PoLineForCheck[] }): ConfirmedLine[] {
  const byId = new Map(po.lines.map((l) => [l.poLineId, l]));
  return answer.lines.flatMap((a) => {
    const line = byId.get(a.poLineId);
    if (!line || !a.available || !a.date) return [];
    return [{ poLineId: a.poLineId, confirmedDate: a.date, confirmedQuantity: a.quantity ?? line.quantity, confirmedUnitCostMinor: a.unitCostMinor }];
  });
}

/** A PO is confirmed only when every line has a confirmed answer. */
export function isFullyConfirmed(confirmed: readonly ConfirmedLine[], po: { lines: readonly PoLineForCheck[] }): boolean {
  return po.lines.length > 0 && po.lines.every((l) => confirmed.some((c) => c.poLineId === l.poLineId));
}
