/**
 * The Orders screen (App.dc.html): filter pills, KPI tiles, history wording.
 * Pure: no I/O.
 */

import { ROUTE_LABELS, isFulfilmentRoute, isLineStage, orderStatus, stageLabel, type FulfilmentRoute, type LineSummaryInput } from "./orders";
import { PO_STATUS_LABELS, type PoStatus } from "./purchase-orders";

export const ORDER_VIEWS = ["open", "direct", "delivered", "all"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

export const ORDER_VIEW_LABELS: Record<OrderView, string> = {
  open: "All open",
  direct: "Direct ship",
  delivered: "Delivered",
  all: "Everything",
};

export function parseOrderView(value: string | undefined): OrderView {
  return (ORDER_VIEWS as readonly string[]).includes(value ?? "") ? (value as OrderView) : "open";
}

interface Listable {
  lines: readonly LineSummaryInput[];
}

export function matchesView(order: Listable, view: OrderView): boolean {
  const status = orderStatus(order.lines);
  switch (view) {
    case "open":
      return status === "open";
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
}

/** Only figures COAST can actually work out today. "At risk" and "auto-confirmed" arrive with Phases 4 and 2. */
export function orderKpis(orders: readonly Listable[]): OrderKpis {
  let open = 0;
  let awaitingSupplier = 0;
  let needsPo = 0;
  for (const o of orders) {
    if (orderStatus(o.lines) !== "open") continue;
    open++;
    if (o.lines.some((l) => l.stage === "po_sent")) awaitingSupplier++;
    if (o.lines.some((l) => l.stage === "ordered" && l.route !== "from_stock")) needsPo++;
  }
  return { open, awaitingSupplier, needsPo };
}

// ── Order history wording ───────────────────────────────────────────────────
export interface EventInput {
  kind: "order_created" | "line_stage_changed" | "po_raised" | "po_status_changed";
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
    case "line_stage_changed": {
      const to = e.detail.to;
      const route = line?.route;
      if (!isLineStage(to) || !route || !isFulfilmentRoute(route)) return `${lineRef} changed stage`;
      return `${lineRef} → ${stageLabel(to, route)}`;
    }
  }
}

export { ROUTE_LABELS };
