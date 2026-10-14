/**
 * The Orders screen (App.dc.html): filter pills, KPI tiles, history wording.
 * Pure: no I/O.
 */

import { ROUTE_LABELS, isFulfilmentRoute, isLineStage, orderStatus, stageLabel, type FulfilmentRoute, type LineSummaryInput } from "./orders";
import { PO_STATUS_LABELS, type PoStatus } from "./purchase-orders";
import { getCarrier, isCarrierKey } from "./carriers";
import { SHIPMENT_STATUS_LABELS, isShipmentLeg, isShipmentStatus } from "./shipments";
import { PREDICTION_SOURCE_LABELS, formatRange, isPredictionSource } from "./prediction";

const NOTIFIED_WORDS: Record<string, string> = {
  date_confirmed: "delivery date confirmed",
  date_changed: "delivery date changed",
  dispatched: "dispatched",
  out_for_delivery: "out for delivery",
  delivered: "delivered",
  late: "may be late",
  delivery_problem: "delivery problem",
  reply: "reply",
  digest: "daily summary",
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export const ORDER_VIEWS = ["open", "at_risk", "direct", "delivered", "all"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

export const ORDER_VIEW_LABELS: Record<OrderView, string> = {
  open: "All open",
  at_risk: "At risk",
  direct: "Direct ship",
  delivered: "Delivered",
  all: "Everything",
};

export function parseOrderView(value: string | undefined): OrderView {
  return (ORDER_VIEWS as readonly string[]).includes(value ?? "") ? (value as OrderView) : "open";
}

interface Listable {
  lines: readonly LineSummaryInput[];
  /** From the order's prediction (Phase 4); null or missing = can't tell. */
  atRisk?: boolean | null;
}

export function matchesView(order: Listable, view: OrderView): boolean {
  const status = orderStatus(order.lines);
  switch (view) {
    case "open":
      return status === "open";
    case "at_risk":
      return status === "open" && order.atRisk === true;
    case "direct":
      return status === "open" && order.lines.some((l) => l.route === "direct_ship" && l.stage !== "cancelled");
    case "delivered":
      return status === "delivered";
    case "all":
      return true;
  }
}

export interface OrderKpis {
  open: number;
  awaitingSupplier: number;
  needsPo: number;
  atRisk: number;
}

/** Only figures COAST can actually work out today. "Auto-confirmed this week" waits for Metrics (Phase 6). */
export function orderKpis(orders: readonly Listable[]): OrderKpis {
  let open = 0;
  let awaitingSupplier = 0;
  let needsPo = 0;
  let atRisk = 0;
  for (const o of orders) {
    if (orderStatus(o.lines) !== "open") continue;
    open++;
    if (o.lines.some((l) => l.stage === "po_sent")) awaitingSupplier++;
    if (o.lines.some((l) => l.stage === "ordered" && l.route !== "from_stock")) needsPo++;
    if (o.atRisk === true) atRisk++;
  }
  return { open, awaitingSupplier, needsPo, atRisk };
}

// ── Order history wording ───────────────────────────────────────────────────
export type OrderEventKind =
  | "order_created"
  | "line_stage_changed"
  | "po_raised"
  | "po_status_changed"
  | "order_updated"
  | "line_added"
  | "line_updated"
  | "po_emailed"
  | "supplier_responded"
  | "chase_opened"
  | "chase_chased"
  | "chase_resolved"
  | "shipment_added"
  | "shipment_status_changed"
  | "prediction_changed"
  | "customer_message"
  | "staff_reply"
  | "customer_notified"
  | "goods_received";

const SOURCE_WORDS: Record<string, string> = { link: "the confirmation link", paste: "email (pasted in)", inbound: "email" };
const OUTCOME_WORDS: Record<string, string> = { applied: "applied automatically", needs_review: "sent for review", accepted: "accepted after review", rejected: "marked not relevant" };

const FIELD_LABELS: Record<string, string> = {
  customer: "customer",
  customer_reference: "their reference",
  sales_rep: "sales rep",
  currency: "currency",
  promised_date: "promised date",
  delivery_address: "delivery address",
  sku: "product code",
  description: "description",
  quantity: "quantity",
  price: "price",
};

function fieldList(detail: Record<string, unknown>): string {
  const fields = Array.isArray(detail.fields) ? detail.fields.filter((f): f is string => typeof f === "string") : [];
  const labels = fields.map((f) => FIELD_LABELS[f] ?? f);
  return labels.length ? ` (${labels.join(", ")})` : "";
}
export interface EventInput {
  kind: OrderEventKind;
  orderLineId: string | null;
  detail: Record<string, unknown>;
}

export interface EventContext {
  /** Line number and route by line id. */
  lines: ReadonlyMap<string, { lineNo: number; route: FulfilmentRoute }>;
  /** PO numbers the viewer may see, by PO id. Missing = hidden from this viewer. */
  poNumbers: ReadonlyMap<string, string>;
}

function poRef(id: unknown, ctx: EventContext): string {
  const n = typeof id === "string" ? ctx.poNumbers.get(id) : undefined;
  return n ? `Purchase order ${n}` : "A purchase order";
}

function isPoStatus(v: unknown): v is PoStatus {
  return typeof v === "string" && v in PO_STATUS_LABELS;
}

function shipmentRef(detail: Record<string, unknown>): string {
  const carrier = isCarrierKey(detail.carrier) ? getCarrier(detail.carrier).label : null;
  const leg = isShipmentLeg(detail.leg) ? LEG_WORDS[detail.leg] : "Shipment";
  return carrier && detail.carrier !== "unknown" && detail.carrier !== "other" ? `${leg} (${carrier})` : leg;
}

const LEG_WORDS = { inbound: "Inbound shipment", outbound: "Shipment to the customer", direct: "Direct shipment" } as const;

/** One line of plain English per history entry. Never names a supplier. */
export function describeEvent(e: EventInput, ctx: EventContext): string {
  const line = e.orderLineId ? ctx.lines.get(e.orderLineId) : undefined;
  const lineRef = line ? `Line ${line.lineNo}` : "A line";
  switch (e.kind) {
    case "order_created":
      return "Order created";
    case "po_raised":
      return `${poRef(e.detail.purchase_order_id, ctx)} raised for ${lineRef.toLowerCase()}`;
    case "po_status_changed": {
      const to = e.detail.to;
      return `${poRef(e.detail.purchase_order_id, ctx)} marked ${isPoStatus(to) ? PO_STATUS_LABELS[to].toLowerCase() : "changed"}`;
    }
    case "order_updated":
      return `Order details changed${fieldList(e.detail)}`;
    case "line_added":
      return `${lineRef} added`;
    case "line_updated":
      return `${lineRef} changed${fieldList(e.detail)}`;
    case "po_emailed": {
      const what = e.detail.email === "po_chase" ? "chase" : "email";
      const logged = e.detail.status === "logged" ? " (logged — email isn't connected yet)" : "";
      return `${poRef(e.detail.purchase_order_id, ctx)}: ${what} to the supplier written${logged}`;
    }
    case "supplier_responded": {
      const via = SOURCE_WORDS[String(e.detail.source)] ?? "a reply";
      const outcome = OUTCOME_WORDS[String(e.detail.status)] ?? "received";
      return `Supplier answered via ${via} — ${outcome}`;
    }
    case "chase_opened":
      return e.detail.chase === "internal" ? `${lineRef}: procurement asked for an update` : `${poRef(e.detail.purchase_order_id, ctx)}: supplier chase started`;
    case "chase_chased":
      return `${poRef(e.detail.purchase_order_id, ctx)}: supplier chased`;
    case "chase_resolved":
      return e.detail.chase === "internal" ? `${lineRef}: procurement answered` : `${poRef(e.detail.purchase_order_id, ctx)}: supplier chase closed`;
    case "shipment_added":
      return `${shipmentRef(e.detail)} added`;
    case "shipment_status_changed": {
      const to = e.detail.to;
      const by = e.detail.source === "manual" ? " (set by hand)" : "";
      return isShipmentStatus(to) ? `${shipmentRef(e.detail)}: ${SHIPMENT_STATUS_LABELS[to].toLowerCase()}${by}` : `${shipmentRef(e.detail)} updated`;
    }
    case "prediction_changed": {
      const when = formatRange(str(e.detail.from), str(e.detail.to));
      const source = isPredictionSource(e.detail.source) && e.detail.source !== "unknown" ? ` (${PREDICTION_SOURCE_LABELS[e.detail.source]})` : "";
      if (e.detail.at_risk === true && e.detail.was_at_risk !== true) return `At risk: predicted delivery ${when ?? "not known"}${source}`;
      if (e.detail.at_risk !== true && e.detail.was_at_risk === true) return `Back on track: predicted delivery ${when ?? "not known"}${source}`;
      return when ? `Predicted delivery now ${when}${source}` : "Predicted delivery not known yet";
    }
    case "customer_message":
      return "Customer sent a message";
    case "staff_reply":
      return "Replied to the customer";
    case "customer_notified":
      return `Customer emailed${typeof e.detail.topic === "string" ? `: ${NOTIFIED_WORDS[e.detail.topic] ?? "an update"}` : ""}${e.detail.status === "logged" ? " (logged — email isn't connected yet)" : ""}`;
    case "goods_received": {
      const q = typeof e.detail.quantity === "number" ? e.detail.quantity : Number(e.detail.quantity);
      const what = e.detail.condition === "damaged" ? "arrived damaged" : e.detail.condition === "wrong_item" ? "the wrong item arrived" : e.detail.condition === "short" ? `${Number.isFinite(q) ? q : "some"} arrived (fewer than expected)` : `${Number.isFinite(q) ? q : "all"} checked in`;
      return `${lineRef}: ${what}`;
    }
    case "line_stage_changed": {
      const to = e.detail.to;
      const route = line?.route;
      if (!isLineStage(to) || !route || !isFulfilmentRoute(route)) return `${lineRef} changed stage`;
      return `${lineRef} → ${stageLabel(to, route)}`;
    }
  }
}

export { ROUTE_LABELS };
