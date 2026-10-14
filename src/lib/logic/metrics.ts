/**
 * Metrics and reporting (spec §5.6). Pure: every figure is worked out from
 * rows passed in, so each one can be checked by hand. Where there isn't
 * enough data to say, the answer is null ("not enough data yet"), never 0%.
 */

import { workingHoursBetween, type WorkingCalendar } from "./working-time";
import { workingDaysBetween } from "./prediction";

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Whole-number percentage, or null with nothing to measure. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

// ── Orders ──────────────────────────────────────────────────────────────────
export interface OrderFact {
  status: "open" | "delivered" | "cancelled";
  promisedDate: string | null;
  /** UK date the last line was delivered. */
  deliveredDate: string | null;
  atRisk: boolean | null;
}

export interface OrderFigures {
  open: number;
  atRisk: number;
  delivered: number;
  /** Delivered orders that had a promised date, and how many arrived by it. */
  onTime: { onTime: number; measured: number; percent: number | null };
}

export function orderFigures(orders: readonly OrderFact[]): OrderFigures {
  let open = 0;
  let atRisk = 0;
  let delivered = 0;
  let onTime = 0;
  let measured = 0;
  for (const o of orders) {
    if (o.status === "open") {
      open++;
      if (o.atRisk === true) atRisk++;
    } else if (o.status === "delivered") {
      delivered++;
      if (o.promisedDate && o.deliveredDate) {
        measured++;
        if (o.deliveredDate <= o.promisedDate) onTime++;
      }
    }
  }
  return { open, atRisk, delivered, onTime: { onTime, measured, percent: percent(onTime, measured) } };
}

// ── Suppliers ───────────────────────────────────────────────────────────────
export interface PoFact {
  supplierId: string;
  supplierName: string;
  sentAt: string | null;
  firstResponseAt: string | null;
}

export interface LineArrivalFact {
  supplierId: string;
  supplierName: string;
  poSentDate: string | null;
  confirmedDate: string | null;
  /** When the goods actually arrived (checked in, or delivered direct). */
  arrivedDate: string | null;
  typicalLeadDays: number | null;
}

export interface SupplierFigures {
  supplierId: string;
  supplierName: string;
  pos: number;
  /** Of POs sent, how many got any answer. */
  respondedPercent: number | null;
  /** Typical working hours from sending a PO to the first answer. */
  medianResponseHours: number | null;
  /** Of lines with a confirmed date that have arrived, how many by that date. */
  onTimePercent: number | null;
  arrivalsMeasured: number;
  /** Actual working days from PO sent to arrival, against what the supplier says. */
  medianActualLeadDays: number | null;
  typicalLeadDays: number | null;
}

export function supplierFigures(pos: readonly PoFact[], arrivals: readonly LineArrivalFact[], cal: WorkingCalendar): SupplierFigures[] {
  const ids = new Map<string, string>();
  for (const p of pos) ids.set(p.supplierId, p.supplierName);
  for (const a of arrivals) ids.set(a.supplierId, a.supplierName);
  return [...ids.entries()]
    .map(([supplierId, supplierName]) => {
      const mine = pos.filter((p) => p.supplierId === supplierId);
      const sent = mine.filter((p) => p.sentAt);
      const answered = sent.filter((p) => p.firstResponseAt && p.firstResponseAt >= p.sentAt!);
      const lines = arrivals.filter((a) => a.supplierId === supplierId && a.arrivedDate);
      const dated = lines.filter((a) => a.confirmedDate);
      const leads = lines.filter((a) => a.poSentDate).map((a) => workingDaysBetween(a.poSentDate!, a.arrivedDate!));
      const typical = arrivals.find((a) => a.supplierId === supplierId && a.typicalLeadDays !== null)?.typicalLeadDays ?? null;
      return {
        supplierId,
        supplierName,
        pos: mine.length,
        respondedPercent: percent(answered.length, sent.length),
        medianResponseHours: median(answered.map((p) => workingHoursBetween(new Date(p.sentAt!), new Date(p.firstResponseAt!), cal))),
        onTimePercent: percent(dated.filter((a) => a.arrivedDate! <= a.confirmedDate!).length, dated.length),
        arrivalsMeasured: dated.length,
        medianActualLeadDays: median(leads),
        typicalLeadDays: typical,
      };
    })
    .sort((a, b) => b.pos - a.pos || a.supplierName.localeCompare(b.supplierName));
}

// ── Spend ───────────────────────────────────────────────────────────────────
export interface SpendFact {
  supplierId: string;
  supplierName: string;
  currency: string;
  amountMinor: number;
}

export interface SpendShare {
  currency: string;
  totalMinor: number;
  suppliers: { supplierId: string; supplierName: string; amountMinor: number; percent: number }[];
  /** Share of the biggest supplier — a concentration warning sign. */
  topPercent: number | null;
}

/** Spend by supplier, per currency (amounts in different currencies are never added together). */
export function spendConcentration(rows: readonly SpendFact[]): SpendShare[] {
  const byCurrency = new Map<string, Map<string, { name: string; amount: number }>>();
  for (const r of rows) {
    if (!Number.isFinite(r.amountMinor) || r.amountMinor <= 0) continue;
    const cur = byCurrency.get(r.currency) ?? new Map();
    const s = cur.get(r.supplierId) ?? { name: r.supplierName, amount: 0 };
    s.amount += Math.round(r.amountMinor);
    cur.set(r.supplierId, s);
    byCurrency.set(r.currency, cur);
  }
  return [...byCurrency.entries()]
    .map(([currency, m]) => {
      const total = [...m.values()].reduce((n, s) => n + s.amount, 0);
      const suppliers = [...m.entries()]
        .map(([supplierId, s]) => ({ supplierId, supplierName: s.name, amountMinor: s.amount, percent: percent(s.amount, total) ?? 0 }))
        .sort((a, b) => b.amountMinor - a.amountMinor);
      return { currency, totalMinor: total, suppliers, topPercent: suppliers[0]?.percent ?? null };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

// ── How well the email reading works ────────────────────────────────────────
export interface ResponseFact {
  source: "link" | "paste" | "inbound";
  status: "applied" | "needs_review" | "accepted" | "rejected";
}

export interface ReadingFigures {
  source: "link" | "email";
  total: number;
  automatic: number;
  reviewedAccepted: number;
  notRelevant: number;
  waiting: number;
  automaticPercent: number | null;
}

/** Of supplier answers, how many COAST applied by itself, per channel. */
export function readingFigures(rows: readonly ResponseFact[]): ReadingFigures[] {
  return (["email", "link"] as const).map((source) => {
    const mine = rows.filter((r) => (source === "link" ? r.source === "link" : r.source !== "link"));
    const automatic = mine.filter((r) => r.status === "applied").length;
    return {
      source,
      total: mine.length,
      automatic,
      reviewedAccepted: mine.filter((r) => r.status === "accepted").length,
      notRelevant: mine.filter((r) => r.status === "rejected").length,
      waiting: mine.filter((r) => r.status === "needs_review").length,
      automaticPercent: percent(automatic, mine.length),
    };
  });
}
