/**
 * Orders, lines, fulfilment routes and stages (spec §4, §5.1; handoff §7.5).
 * Pure: no I/O. The database holds the same enums
 * (supabase/migrations/0007_core_schema.sql).
 */

// ── Fulfilment routes ───────────────────────────────────────────────────────
export const FULFILMENT_ROUTES = ["from_stock", "via_warehouse", "direct_ship"] as const;
export type FulfilmentRoute = (typeof FULFILMENT_ROUTES)[number];

export const ROUTE_LABELS: Record<FulfilmentRoute, string> = {
  from_stock: "From stock",
  via_warehouse: "Via warehouse",
  direct_ship: "Direct ship",
};

export function isFulfilmentRoute(value: unknown): value is FulfilmentRoute {
  return typeof value === "string" && (FULFILMENT_ROUTES as readonly string[]).includes(value);
}

/** Lines on these routes need a purchase order to a supplier. */
export function routeNeedsSupplier(route: FulfilmentRoute): boolean {
  return route !== "from_stock";
}

// ── Line stages ─────────────────────────────────────────────────────────────
export const LINE_STAGES = [
  "ordered",
  "po_sent",
  "confirmed",
  "inbound",
  "received",
  "picked",
  "dispatched",
  "in_transit",
  "delivered",
  "cancelled",
] as const;
export type LineStage = (typeof LINE_STAGES)[number];

export function isLineStage(value: unknown): value is LineStage {
  return typeof value === "string" && (LINE_STAGES as readonly string[]).includes(value);
}

/** Each route's own sequence (handoff §7.5). Cancelled sits outside every sequence. */
export const ROUTE_STAGES: Record<FulfilmentRoute, readonly LineStage[]> = {
  from_stock: ["ordered", "picked", "dispatched", "in_transit", "delivered"],
  via_warehouse: ["ordered", "po_sent", "confirmed", "inbound", "received", "dispatched", "in_transit", "delivered"],
  direct_ship: ["ordered", "po_sent", "confirmed", "dispatched", "in_transit", "delivered"],
};

/** Internal wording (App.dc.html). Customer wording is a separate mapping in Phase 5 (decisions B6). */
export function stageLabel(stage: LineStage, route: FulfilmentRoute): string {
  switch (stage) {
    case "ordered":
      return routeNeedsSupplier(route) ? "Needs PO" : "To pick";
    case "po_sent":
      return "Awaiting supplier";
    case "confirmed":
      return "Supplier confirmed";
    case "inbound":
      return "In transit to us";
    case "received":
      return "Received";
    case "picked":
      return "Picked";
    case "dispatched":
      return "Dispatched";
    case "in_transit":
      return route === "from_stock" ? "Out for delivery" : "In transit";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
  }
}

export function isStageValidForRoute(stage: LineStage, route: FulfilmentRoute): boolean {
  return stage === "cancelled" || ROUTE_STAGES[route].includes(stage);
}

/**
 * Which stages a person may move a line to by hand:
 * - forward any number of steps along its route (staff sometimes skip);
 * - back one step, to correct a mistake;
 * - cancelled from anything not yet delivered.
 * Delivered and cancelled are final. "Awaiting supplier" is set by raising a
 * PO, never by hand, so the stage can't claim a PO exists when it doesn't.
 */
export function allowedNextStages(current: LineStage, route: FulfilmentRoute): LineStage[] {
  if (current === "delivered" || current === "cancelled") return [];
  const seq = ROUTE_STAGES[route];
  const i = seq.indexOf(current);
  if (i < 0) return ["cancelled"];
  const forward = seq.slice(i + 1).filter((s) => s !== "po_sent");
  const back = i > 0 && seq[i - 1] !== "po_sent" ? [seq[i - 1]!] : [];
  return [...back, ...forward, "cancelled"];
}

export function canMoveStage(from: LineStage, to: LineStage, route: FulfilmentRoute): boolean {
  return allowedNextStages(from, route).includes(to);
}

// ── Order-level summary (Orders table) ─────────────────────────────────────
export interface LineSummaryInput {
  route: FulfilmentRoute;
  stage: LineStage;
}

export type OrderStatus = "open" | "delivered" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "Open",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function orderStatus(lines: readonly LineSummaryInput[]): OrderStatus {
  const live = lines.filter((l) => l.stage !== "cancelled");
  if (lines.length > 0 && live.length === 0) return "cancelled";
  if (live.length > 0 && live.every((l) => l.stage === "delivered")) return "delivered";
  return "open";
}

/** "Direct ship", "Via warehouse", "From stock", or "Mixed" when lines differ. */
export function orderFulfilmentLabel(lines: readonly LineSummaryInput[]): string {
  const routes = new Set(lines.filter((l) => l.stage !== "cancelled").map((l) => l.route));
  if (routes.size === 0) return lines.length ? ROUTE_LABELS[lines[0]!.route] : "—";
  if (routes.size > 1) return "Mixed";
  return ROUTE_LABELS[[...routes][0]!];
}

/** How far a stage is towards delivery, 0–1, whatever the route. */
function progress(line: LineSummaryInput): number {
  const seq = ROUTE_STAGES[line.route];
  const i = seq.indexOf(line.stage);
  return i < 0 ? 0 : i / (seq.length - 1);
}

/**
 * The order's stage is its least-advanced live line — the thing holding it
 * up. "Awaiting supplier · 2 lines" when several lines share it.
 */
export function orderStageLabel(lines: readonly LineSummaryInput[]): string {
  const live = lines.filter((l) => l.stage !== "cancelled");
  if (live.length === 0) return lines.length ? "Cancelled" : "No lines";
  const slowest = [...live].sort((a, b) => progress(a) - progress(b))[0]!;
  const label = stageLabel(slowest.stage, slowest.route);
  const same = live.filter((l) => stageLabel(l.stage, l.route) === label).length;
  return live.length > 1 && same > 1 && same < live.length ? `${label} · ${same} lines` : label;
}

// ── Input parsing and validation (new order / PO forms) ────────────────────

/** "1,250.50" → 125050 minor units. null when it isn't a valid amount. */
export function parseMoneyToMinor(input: string): number | null {
  const s = input.replace(/[£€$,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Quantities allow up to 3 decimal places (metres, kilos). */
export function parseQuantity(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** "2026-10-16" → same string if it's a real calendar date, else null. */
export function parseIsoDate(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const d = new Date(`${input}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input ? null : input;
}

export const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** Tidy a UK postcode to "NG24 1AB"; other countries' postcodes are kept as typed. */
export function normalisePostcode(input: string, countryCode: string): string {
  const s = input.trim().toUpperCase().replace(/\s+/g, " ");
  if (countryCode === "GB" && UK_POSTCODE.test(s)) {
    const compact = s.replace(/\s/g, "");
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }
  return s;
}

export type FieldErrors = Record<string, string>;

export interface NewOrderLineInput {
  sku: string;
  description: string;
  quantity: string;
  unitPrice: string;
  route: string;
}

export interface NewOrderInput {
  customerName: string;
  customerReference: string;
  soNumber: string;
  salesRepId: string;
  currency: string;
  promisedDate: string;
  deliveryName: string;
  deliveryLine1: string;
  deliveryLine2: string;
  deliveryTown: string;
  deliveryPostcode: string;
  deliveryCountry: string;
  lines: NewOrderLineInput[];
}

export interface ValidOrderLine {
  sku: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number | null;
  route: FulfilmentRoute;
}

export interface ValidOrder {
  customerName: string;
  customerReference: string | null;
  soNumber: string | null;
  salesRepId: string | null;
  currency: "GBP" | "EUR" | "USD";
  promisedDate: string | null;
  delivery: { name: string; line1: string; line2: string | null; town: string; postcode: string; country: string };
  lines: ValidOrderLine[];
}

export const MAX_ORDER_LINES = 200;

/** Checks a new order and returns either plain-English errors per field, or clean values. */
export function validateNewOrder(input: NewOrderInput): { ok: true; order: ValidOrder } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const t = (s: string) => s.trim();

  const customerName = t(input.customerName);
  if (!customerName) errors.customerName = "Enter the customer.";
  else if (customerName.length > 200) errors.customerName = "Use 200 characters or fewer.";

  const soNumber = t(input.soNumber).toUpperCase();
  if (soNumber && !/^[A-Z0-9][A-Z0-9\-/]{0,39}$/.test(soNumber)) errors.soNumber = "Use letters, numbers, dashes or slashes (40 at most).";

  const currency = input.currency;
  if (currency !== "GBP" && currency !== "EUR" && currency !== "USD") errors.currency = "Choose a currency.";

  const promisedDate = t(input.promisedDate) ? parseIsoDate(t(input.promisedDate)) : null;
  if (t(input.promisedDate) && !promisedDate) errors.promisedDate = "Enter a real date.";

  const country = t(input.deliveryCountry).toUpperCase() || "GB";
  if (!/^[A-Z]{2}$/.test(country)) errors.deliveryCountry = "Use a two-letter country code, e.g. GB.";
  if (!t(input.deliveryName)) errors.deliveryName = "Enter who it's going to.";
  if (!t(input.deliveryLine1)) errors.deliveryLine1 = "Enter the first line of the address.";
  if (!t(input.deliveryTown)) errors.deliveryTown = "Enter the town or city.";
  const postcode = normalisePostcode(input.deliveryPostcode, country);
  if (!postcode) errors.deliveryPostcode = "Enter the postcode.";
  else if (country === "GB" && !UK_POSTCODE.test(postcode)) errors.deliveryPostcode = "That doesn't look like a UK postcode.";

  const lines: ValidOrderLine[] = [];
  const filled = input.lines.filter((l) => t(l.description) || t(l.sku) || t(l.quantity) || t(l.unitPrice));
  if (filled.length === 0) errors.lines = "Add at least one line.";
  if (filled.length > MAX_ORDER_LINES) errors.lines = `An order can have up to ${MAX_ORDER_LINES} lines.`;
  filled.forEach((l, i) => {
    const n = i + 1;
    const description = t(l.description);
    if (!description) errors[`lines.${i}.description`] = `Line ${n}: describe the item.`;
    const quantity = parseQuantity(l.quantity);
    if (quantity === null) errors[`lines.${i}.quantity`] = `Line ${n}: enter a quantity above 0.`;
    const unitPriceMinor = t(l.unitPrice) ? parseMoneyToMinor(l.unitPrice) : null;
    if (t(l.unitPrice) && unitPriceMinor === null) errors[`lines.${i}.unitPrice`] = `Line ${n}: enter a price like 12.50.`;
    if (!isFulfilmentRoute(l.route)) errors[`lines.${i}.route`] = `Line ${n}: choose how it's fulfilled.`;
    if (description && quantity !== null && isFulfilmentRoute(l.route)) {
      lines.push({ sku: t(l.sku) || null, description, quantity, unitPriceMinor, route: l.route });
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    order: {
      customerName,
      customerReference: t(input.customerReference) || null,
      soNumber: soNumber || null,
      salesRepId: t(input.salesRepId) || null,
      currency: currency as ValidOrder["currency"],
      promisedDate,
      delivery: {
        name: t(input.deliveryName),
        line1: t(input.deliveryLine1),
        line2: t(input.deliveryLine2) || null,
        town: t(input.deliveryTown),
        postcode,
        country,
      },
      lines,
    },
  };
}

// ── Sales-rep filter on the Orders screen (decision E1) ─────────────────────
export type RepFilter = "mine" | "all" | { repId: string };

/** Sales reps open on their own orders; everyone else on all orders. */
export function defaultRepFilter(role: string): "mine" | "all" {
  return role === "sales" ? "mine" : "all";
}

export function parseRepFilter(value: string | undefined, role: string): RepFilter {
  if (value === "mine" || value === "all") return value;
  if (value && /^[0-9a-f-]{36}$/i.test(value)) return { repId: value };
  return defaultRepFilter(role);
}
