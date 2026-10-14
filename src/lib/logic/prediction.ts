/**
 * Delivery-date prediction, the at-risk flag and the lead-time ticker
 * (spec §4 steps 3 and 9, §5.1; Phase 4). Pure: "today" is passed in.
 *
 * Each line's date comes from the most reliable source it has right now:
 *   delivered → the carrier's ETA once it's on its way to the customer →
 *   the supplier's confirmed date → the line's lead time (set by hand,
 *   then availability data, then the supplier's typical lead time) →
 *   "not known yet".
 * The order arrives when its last line does. A date set by hand for the
 * order beats all of them and is never replaced (non-negotiable 3).
 * Anything worked out rather than confirmed is a range, never a single
 * date dressed up as certain (non-negotiable 4).
 */

import { formatIsoDate } from "./format";
import { ROUTE_STAGES, type FulfilmentRoute, type LineStage } from "./orders";
import type { ShipmentLeg, ShipmentStatus } from "./shipments";

// ── Calendar dates and working days ─────────────────────────────────────────
const DAY_MS = 86_400_000;

/** Today's date in the UK as "YYYY-MM-DD". */
export function ukToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The UK calendar date of a timestamp. */
export function ukDateOf(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : ukToday(new Date(t));
}

function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isWorkingDay(ms: number, holidays: ReadonlySet<string>): boolean {
  const d = new Date(ms).getUTCDay();
  return d !== 0 && d !== 6 && !holidays.has(fromUtc(ms));
}

/**
 * `n` working days after a date (weekends, and any holidays given, don't
 * count). 0 gives the date itself, moved on to a working day if it isn't one.
 */
export function addWorkingDays(iso: string, n: number, holidays: readonly string[] = []): string {
  const hol = new Set(holidays);
  let ms = toUtc(iso);
  while (!isWorkingDay(ms, hol)) ms += DAY_MS;
  for (let left = Math.max(0, Math.round(n)); left > 0; ) {
    ms += DAY_MS;
    if (isWorkingDay(ms, hol)) left--;
  }
  return fromUtc(ms);
}

/** Working days from one date to a later one (0 if the second isn't later). */
export function workingDaysBetween(fromIso: string, toIso: string, holidays: readonly string[] = []): number {
  const hol = new Set(holidays);
  let n = 0;
  for (let ms = toUtc(fromIso) + DAY_MS; ms <= toUtc(toIso); ms += DAY_MS) if (isWorkingDay(ms, hol)) n++;
  return n;
}

const later = (a: string, b: string) => (a >= b ? a : b);

// ── Settings ────────────────────────────────────────────────────────────────
export interface PredictionSettings {
  /** Working days from goods arriving at the warehouse to leaving it. */
  handlingDays: number;
  /** Working days for our own delivery to reach the customer once it leaves. */
  deliveryDays: number;
  /** How wide an estimate is: the "to" end is this many working days after the "from" end. */
  spreadDays: number;
}

/** DEFAULT — CONFIRM: one day to turn goods round, two to deliver, estimates two days wide. */
export const DEFAULT_PREDICTION_SETTINGS: PredictionSettings = { handlingDays: 1, deliveryDays: 2, spreadDays: 2 };

export function predictionSettingsProblem(s: PredictionSettings): string | null {
  for (const [label, v] of [["Turnaround", s.handlingDays], ["Delivery", s.deliveryDays], ["Estimate width", s.spreadDays]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 30) return `${label} must be a whole number of days from 0 to 30.`;
  }
  return null;
}

// ── Lead time ───────────────────────────────────────────────────────────────
export type LeadTimeSource = "manual" | "availability" | "supplier";

export const LEAD_TIME_SOURCE_LABELS: Record<LeadTimeSource, string> = {
  manual: "set by hand",
  availability: "from availability",
  supplier: "supplier's typical",
};

export interface LeadTime {
  days: number;
  source: LeadTimeSource;
}

/** A line's lead time: set by hand → availability for its product code → the supplier's typical lead time → none. */
export function resolveLeadTime(i: { manualDays: number | null; availabilityDays: number | null; supplierDays: number | null }): LeadTime | null {
  const ok = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= 365;
  if (ok(i.manualDays)) return { days: i.manualDays, source: "manual" };
  if (ok(i.availabilityDays)) return { days: i.availabilityDays, source: "availability" };
  if (ok(i.supplierDays)) return { days: i.supplierDays, source: "supplier" };
  return null;
}

export interface LeadTimeTicker {
  /** "Day 3 of 5", "Starts when the PO is sent" … */
  label: string;
  elapsed: number | null;
  days: number;
  overdue: boolean;
}

/** Stages where a line is still waiting for its supplier. */
const WAITING_ON_SUPPLIER: readonly LineStage[] = ["ordered", "po_sent", "confirmed", "inbound"];

/**
 * The internal lead-time ticker: how far through its lead time a line is,
 * counted in working days from when its PO went out. Null when the line
 * isn't waiting on a supplier (or has no lead time to measure against).
 */
export function leadTimeTicker(route: FulfilmentRoute, stage: LineStage, lead: LeadTime | null, poSentDate: string | null, today: string): LeadTimeTicker | null {
  if (route === "from_stock" || !lead || !WAITING_ON_SUPPLIER.includes(stage)) return null;
  if (!poSentDate) return { label: `${lead.days} working days · starts when the PO is sent`, elapsed: null, days: lead.days, overdue: false };
  const elapsed = workingDaysBetween(poSentDate, today);
  const overdue = elapsed > lead.days;
  return {
    label: overdue ? `${elapsed - lead.days} working ${elapsed - lead.days === 1 ? "day" : "days"} over its ${lead.days}-day lead time` : `Day ${elapsed} of ${lead.days}`,
    elapsed,
    days: lead.days,
    overdue,
  };
}

// ── Prediction ──────────────────────────────────────────────────────────────
export type PredictionSource = "delivered" | "manual" | "carrier" | "supplier_confirmed" | "lead_time" | "stock" | "in_transit" | "unknown";

export function isPredictionSource(v: unknown): v is PredictionSource {
  return typeof v === "string" && v in PREDICTION_SOURCE_LABELS;
}

export const PREDICTION_SOURCE_LABELS: Record<PredictionSource, string> = {
  delivered: "delivered",
  manual: "set by hand",
  carrier: "carrier's estimate",
  supplier_confirmed: "supplier's confirmed date",
  lead_time: "worked out from the lead time",
  stock: "from stock",
  in_transit: "on its way",
  unknown: "not known yet",
};

export interface ShipmentForPrediction {
  leg: ShipmentLeg;
  status: ShipmentStatus;
  etaFrom: string | null;
  etaTo: string | null;
  deliveredAt: string | null;
}

export interface LineForPrediction {
  id: string;
  lineNo: number;
  route: FulfilmentRoute;
  stage: LineStage;
  /** From the line's live purchase order, if it has one. */
  supplierConfirmedDate: string | null;
  poSentDate: string | null;
  leadTime: LeadTime | null;
  shipments: readonly ShipmentForPrediction[];
}

export interface LinePrediction {
  lineId: string;
  lineNo: number;
  /** Delivered or cancelled: it doesn't hold the order up. */
  done: boolean;
  from: string | null;
  to: string | null;
  source: PredictionSource;
  /** Plain English, e.g. "Supplier's date (Fri 16 Oct) has passed". Never names a supplier. */
  note: string | null;
}

type Range = { from: string; to: string };

const stageIndex = (route: FulfilmentRoute, stage: LineStage) => ROUTE_STAGES[route].indexOf(stage);
const atOrAfter = (route: FulfilmentRoute, stage: LineStage, than: LineStage) => stageIndex(route, stage) >= stageIndex(route, than);

function spread(from: string, s: PredictionSettings): Range {
  return { from, to: addWorkingDays(from, s.spreadDays) };
}

/** Never predict the past for something that hasn't happened yet: an estimate that has run out starts again from today. */
function notBefore(r: Range, today: string, s: PredictionSettings): Range {
  if (r.to < today) return spread(today, s);
  return { from: later(r.from, today), to: r.to };
}

function carrierRange(sh: ShipmentForPrediction): Range | null {
  if (!sh.etaFrom && !sh.etaTo) return null;
  const a = sh.etaFrom ?? sh.etaTo!;
  const b = sh.etaTo ?? sh.etaFrom!;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** When goods arrive from the supplier (at the warehouse, or the customer for direct ship). */
function supplierArrival(line: LineForPrediction, leg: ShipmentLeg, s: PredictionSettings, today: string): { range: Range; source: PredictionSource; note: string | null } | null {
  const shipment = line.shipments.find((x) => x.leg === leg && x.status !== "delivered" && carrierRange(x));
  if (shipment) return { range: notBefore(carrierRange(shipment)!, today, s), source: "carrier", note: null };

  if (line.supplierConfirmedDate) {
    if (line.supplierConfirmedDate >= today) return { range: { from: line.supplierConfirmedDate, to: line.supplierConfirmedDate }, source: "supplier_confirmed", note: null };
    return { range: spread(today, s), source: "supplier_confirmed", note: "The supplier's confirmed date has passed" };
  }

  if (line.leadTime) {
    const start = line.poSentDate ?? today;
    const from = addWorkingDays(start, line.leadTime.days);
    const r = notBefore(spread(from, s), today, s);
    return { range: r, source: "lead_time", note: line.poSentDate ? null : "The PO hasn't been sent yet, so this counts from today" };
  }
  return null;
}

/** One line's prediction. */
export function predictLine(line: LineForPrediction, s: PredictionSettings, today: string): LinePrediction {
  const base = { lineId: line.id, lineNo: line.lineNo };
  if (line.stage === "cancelled") return { ...base, done: true, from: null, to: null, source: "unknown", note: "Cancelled" };

  const toCustomer = line.shipments.filter((x) => x.leg === "outbound" || x.leg === "direct");
  const deliveredShipment = toCustomer.find((x) => x.status === "delivered");
  if (line.stage === "delivered" || deliveredShipment) {
    const d = deliveredShipment?.deliveredAt ? ukDateOf(deliveredShipment.deliveredAt) : null;
    return { ...base, done: true, from: d, to: d, source: "delivered", note: null };
  }

  // On its way to the customer with a carrier estimate: that's the best there is.
  const moving = toCustomer.find((x) => carrierRange(x));
  if (moving) {
    const r = notBefore(carrierRange(moving)!, today, s);
    return { ...base, done: false, ...r, source: "carrier", note: null };
  }

  const unknown = (note: string): LinePrediction => ({ ...base, done: false, from: null, to: null, source: "unknown", note });
  const outbound = s.handlingDays + s.deliveryDays;

  switch (line.route) {
    case "from_stock": {
      if (atOrAfter(line.route, line.stage, "dispatched")) return { ...base, done: false, ...spread(addWorkingDays(today, 1), { ...s, spreadDays: Math.max(0, s.deliveryDays - 1) }), source: "in_transit", note: null };
      return { ...base, done: false, ...spread(addWorkingDays(today, outbound), s), source: "stock", note: null };
    }
    case "direct_ship": {
      if (atOrAfter(line.route, line.stage, "dispatched")) return { ...base, done: false, ...spread(addWorkingDays(today, 1), { ...s, spreadDays: Math.max(0, s.deliveryDays - 1) }), source: "in_transit", note: "Dispatched, but the carrier hasn't given a date" };
      const arrival = supplierArrival(line, "direct", s, today);
      if (!arrival) return unknown("No confirmed date or lead time yet");
      return { ...base, done: false, ...arrival.range, source: arrival.source, note: arrival.note };
    }
    case "via_warehouse": {
      if (atOrAfter(line.route, line.stage, "dispatched")) return { ...base, done: false, ...spread(addWorkingDays(today, 1), { ...s, spreadDays: Math.max(0, s.deliveryDays - 1) }), source: "in_transit", note: null };
      if (line.stage === "received") return { ...base, done: false, ...spread(addWorkingDays(today, outbound), s), source: "stock", note: null };
      const arrival = supplierArrival(line, "inbound", s, today);
      if (!arrival) return unknown("No confirmed date or lead time yet");
      return {
        ...base,
        done: false,
        from: addWorkingDays(arrival.range.from, outbound),
        to: addWorkingDays(arrival.range.to, outbound),
        source: arrival.source,
        note: [`Reaches us ${formatRange(arrival.range.from, arrival.range.to)}, then ${outbound} working ${outbound === 1 ? "day" : "days"} to the customer`, arrival.note].filter(Boolean).join(" · "),
      };
    }
  }
}

export type Confidence = "confirmed" | "estimate" | "unknown";

export interface OrderPrediction {
  from: string | null;
  to: string | null;
  source: PredictionSource;
  confidence: Confidence;
  /** null = can't tell (no promised date, or no prediction). */
  atRisk: boolean | null;
  /** One line of plain English for staff. */
  reason: string;
  lines: LinePrediction[];
}

export interface OrderForPrediction {
  promisedDate: string | null;
  override: { from: string; to: string | null } | null;
  lines: readonly LineForPrediction[];
}

const CERTAIN: readonly PredictionSource[] = ["delivered", "manual", "supplier_confirmed", "carrier"];

function atRiskFor(promised: string | null, to: string | null, today: string, allDone: boolean): boolean | null {
  if (allDone) return false;
  if (!promised) return null;
  if (today > promised) return true;
  if (!to) return null;
  return to > promised;
}

/**
 * The order's predicted delivery: its slowest line, or a date set by hand.
 * At risk when the latest likely date is after the promised date (or the
 * promised date has passed without delivery). "Not known yet" when any
 * line can't be predicted — unless a known line is already too late.
 */
export function predictOrder(order: OrderForPrediction, s: PredictionSettings, today: string): OrderPrediction {
  const lines = order.lines.map((l) => predictLine(l, s, today));
  const open = lines.filter((l) => !l.done);
  const allDone = lines.length > 0 && open.length === 0;

  if (order.override) {
    const to = order.override.to && order.override.to >= order.override.from ? order.override.to : order.override.from;
    return {
      from: order.override.from,
      to,
      source: "manual",
      confidence: to === order.override.from ? "confirmed" : "estimate",
      atRisk: atRiskFor(order.promisedDate, to, today, allDone),
      reason: "Set by hand",
      lines,
    };
  }

  if (lines.length === 0) return { from: null, to: null, source: "unknown", confidence: "unknown", atRisk: null, reason: "No lines yet", lines };

  if (allDone) {
    const dates = lines.filter((l) => l.source === "delivered" && l.to).map((l) => l.to!);
    const last = dates.sort().at(-1) ?? null;
    const delivered = lines.some((l) => l.source === "delivered");
    return {
      from: last,
      to: last,
      source: delivered ? "delivered" : "unknown",
      confidence: delivered ? "confirmed" : "unknown",
      atRisk: false,
      reason: delivered ? "Delivered" : "Cancelled",
      lines,
    };
  }

  const unknownLines = open.filter((l) => l.source === "unknown");
  const known = open.filter((l) => l.source !== "unknown");
  const latest = [...known].sort((a, b) => (a.to! === b.to! ? a.from!.localeCompare(b.from!) : a.to!.localeCompare(b.to!))).at(-1);

  if (unknownLines.length > 0) {
    const tooLate = order.promisedDate !== null && (today > order.promisedDate || known.some((l) => l.from! > order.promisedDate!));
    const which = unknownLines.map((l) => `line ${l.lineNo}`).join(", ");
    return {
      from: null,
      to: null,
      source: "unknown",
      confidence: "unknown",
      atRisk: tooLate ? true : null,
      reason: `Not known yet: ${which} ${unknownLines.length === 1 ? "has" : "have"} no confirmed date or lead time`,
      lines,
    };
  }

  const from = known.map((l) => l.from!).sort().at(-1)!;
  const to = known.map((l) => l.to!).sort().at(-1)!;
  const source = latest!.source;
  const certain = from === to && known.every((l) => CERTAIN.includes(l.source) && l.from === l.to);
  return {
    from,
    to,
    source,
    confidence: certain ? "confirmed" : "estimate",
    atRisk: atRiskFor(order.promisedDate, to, today, false),
    reason: `${PREDICTION_SOURCE_LABELS[source].replace(/^./, (c) => c.toUpperCase())}${known.length > 1 ? ` (line ${latest!.lineNo} is the last to arrive)` : ""}${latest!.note ? ` · ${latest!.note}` : ""}`,
    lines,
  };
}

/** Did the prediction change in a way worth recording in the order's history? */
export function predictionChanged(
  before: { from: string | null; to: string | null; atRisk: boolean | null } | null,
  after: { from: string | null; to: string | null; atRisk: boolean | null },
): boolean {
  if (!before) return after.from !== null || after.atRisk === true;
  return before.from !== after.from || before.to !== after.to || before.atRisk !== after.atRisk;
}

// ── Availability (decision C2: pasted or uploaded CSV against product codes) ──
export interface AvailabilityRow {
  sku: string;
  days: number;
}

export interface AvailabilityParse {
  rows: AvailabilityRow[];
  /** "Row 4: 'soon' isn't a number of days" — rows that weren't used, never guessed. */
  problems: string[];
}

const IN_STOCK = /^(in[\s-]?stock|stock|yes|available|now|0)$/i;

/**
 * Reads "product code, days" lines: commas, tabs or semicolons; an optional
 * header row; "in stock" means 0 days. Anything unreadable is listed as a
 * problem and left out — never turned into a number by guesswork.
 */
export function parseAvailability(text: string, maxRows = 5000): AvailabilityParse {
  const rows = new Map<string, AvailabilityRow>();
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, "").trim());
    const [skuCell = "", daysCell = ""] = cells;
    if (i === 0 && /sku|product|code/i.test(skuCell) && !/\d/.test(daysCell)) return; // header
    const sku = skuCell.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,99}$/.test(sku)) {
      problems.push(`Row ${i + 1}: "${skuCell.slice(0, 40)}" isn't a product code`);
      return;
    }
    const daysText = daysCell.replace(/\s*(working\s+)?days?$/i, "").trim();
    const days = IN_STOCK.test(daysText) ? 0 : /^\d{1,3}$/.test(daysText) ? Number(daysText) : NaN;
    if (!Number.isInteger(days) || days > 365) {
      problems.push(`Row ${i + 1}: "${daysCell.slice(0, 40)}" isn't a number of days (0–365)`);
      return;
    }
    if (rows.size >= maxRows && !rows.has(sku)) {
      problems.push(`Row ${i + 1}: more than ${maxRows} product codes — the rest were left out`);
      return;
    }
    rows.set(sku, { sku, days });
  });
  return { rows: [...rows.values()], problems: problems.slice(0, 50) };
}

// ── Wording ─────────────────────────────────────────────────────────────────
/** "Fri 16 Oct", or "Fri 16 – Tue 20 Oct" / "Fri 30 Oct – Tue 3 Nov" for a range; null without a date. */
export function formatRange(from: string | null, to: string | null): string | null {
  if (!from) return null;
  if (!to || to === from) return formatIsoDate(from);
  const a = formatIsoDate(from);
  const b = formatIsoDate(to);
  const [aDay, aNum, aMonth] = a.split(" ");
  const [, , bMonth] = b.split(" ");
  return aMonth === bMonth && from.slice(0, 4) === to.slice(0, 4) ? `${aDay} ${aNum} – ${b}` : `${a} – ${b}`;
}
