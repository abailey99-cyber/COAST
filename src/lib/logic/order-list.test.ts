import { describe, expect, it } from "vitest";
import { describeEvent, matchesView, orderKpis, parseOrderView, type EventContext } from "./order-list";

const order = (...lines: [string, string][]) => ({ lines: lines.map(([route, stage]) => ({ route, stage })) as never });

describe("matchesView", () => {
  const open = order(["direct_ship", "po_sent"], ["from_stock", "delivered"]);
  const delivered = order(["from_stock", "delivered"]);
  const stockOnly = order(["from_stock", "picked"]);

  it("splits open and delivered", () => {
    expect(matchesView(open, "open")).toBe(true);
    expect(matchesView(delivered, "open")).toBe(false);
    expect(matchesView(delivered, "delivered")).toBe(true);
    expect(matchesView(delivered, "all")).toBe(true);
  });

  it("shows open orders with a live direct-ship line under Direct ship", () => {
    expect(matchesView(open, "direct")).toBe(true);
    expect(matchesView(stockOnly, "direct")).toBe(false);
    expect(matchesView(order(["direct_ship", "cancelled"], ["from_stock", "picked"]), "direct")).toBe(false);
  });

  it("defaults unknown views to All open", () => {
    expect(parseOrderView("nonsense")).toBe("open");
    expect(parseOrderView(undefined)).toBe("open");
    expect(parseOrderView("delivered")).toBe("delivered");
  });
});

describe("orderKpis", () => {
  it("counts only open orders", () => {
    expect(
      orderKpis([
        order(["direct_ship", "po_sent"]),
        order(["direct_ship", "ordered"], ["via_warehouse", "po_sent"]),
        order(["from_stock", "ordered"]),
        order(["direct_ship", "delivered"]),
      ]),
    ).toEqual({ open: 3, awaitingSupplier: 2, needsPo: 1, atRisk: 0 });
  });

  it("is all zero with no orders", () => {
    expect(orderKpis([])).toEqual({ open: 0, awaitingSupplier: 0, needsPo: 0, atRisk: 0 });
  });
});

describe("describeEvent", () => {
  const ctx: EventContext = {
    lines: new Map([["l1", { lineNo: 1, route: "direct_ship" as const }]]),
    poNumbers: new Map([["p1", "PO-5001"]]),
  };

  it("describes each kind", () => {
    expect(describeEvent({ kind: "order_created", orderLineId: null, detail: {} }, ctx)).toBe("Order created");
    expect(describeEvent({ kind: "po_raised", orderLineId: "l1", detail: { purchase_order_id: "p1" } }, ctx)).toBe("Purchase order PO-5001 raised for line 1");
    expect(describeEvent({ kind: "po_status_changed", orderLineId: null, detail: { purchase_order_id: "p1", to: "confirmed" } }, ctx)).toBe("Purchase order PO-5001 marked confirmed");
    expect(describeEvent({ kind: "line_stage_changed", orderLineId: "l1", detail: { from: "po_sent", to: "confirmed" } }, ctx)).toBe("Line 1 → Supplier confirmed");
  });

  it("hides PO numbers from people who can't see them", () => {
    const hidden = { ...ctx, poNumbers: new Map() };
    expect(describeEvent({ kind: "po_raised", orderLineId: "l1", detail: { purchase_order_id: "p1" } }, hidden)).toBe("A purchase order raised for line 1");
  });

  it("copes with odd data", () => {
    expect(describeEvent({ kind: "line_stage_changed", orderLineId: "gone", detail: { to: "weird" } }, ctx)).toBe("A line changed stage");
    expect(describeEvent({ kind: "po_status_changed", orderLineId: null, detail: {} }, ctx)).toBe("A purchase order marked changed");
  });
});

describe("describeEvent — edits", () => {
  const ctx: EventContext = { lines: new Map([["l1", { lineNo: 1, route: "direct_ship" as const }]]), poNumbers: new Map() };
  it("names the fields that changed, never their values", () => {
    expect(describeEvent({ kind: "order_updated", orderLineId: null, detail: { fields: ["promised_date", "delivery_address"] } }, ctx)).toBe("Order details changed (promised date, delivery address)");
    expect(describeEvent({ kind: "line_updated", orderLineId: "l1", detail: { fields: ["quantity", "price"] } }, ctx)).toBe("Line 1 changed (quantity, price)");
    expect(describeEvent({ kind: "line_added", orderLineId: "l1", detail: {} }, ctx)).toBe("Line 1 added");
    expect(describeEvent({ kind: "order_updated", orderLineId: null, detail: {} }, ctx)).toBe("Order details changed");
  });
});

describe("describeEvent — supplier loop", () => {
  const ctx: EventContext = { lines: new Map([["l1", { lineNo: 1, route: "direct_ship" as const }]]), poNumbers: new Map([["p1", "PO-5001"]]) };
  it("describes emails, answers and chases without naming the supplier", () => {
    expect(describeEvent({ kind: "po_emailed", orderLineId: null, detail: { purchase_order_id: "p1", email: "po", status: "logged" } }, ctx)).toBe(
      "Purchase order PO-5001: email to the supplier written (logged — email isn't connected yet)",
    );
    expect(describeEvent({ kind: "supplier_responded", orderLineId: null, detail: { source: "link", status: "applied" } }, ctx)).toBe("Supplier answered via the confirmation link — applied automatically");
    expect(describeEvent({ kind: "chase_opened", orderLineId: "l1", detail: { chase: "internal" } }, ctx)).toBe("Line 1: procurement asked for an update");
    expect(describeEvent({ kind: "chase_chased", orderLineId: null, detail: { chase: "supplier", purchase_order_id: "p1" } }, ctx)).toBe("Purchase order PO-5001: supplier chased");
    expect(describeEvent({ kind: "chase_resolved", orderLineId: "l1", detail: { chase: "internal" } }, ctx)).toBe("Line 1: procurement answered");
  });

  it("describes shipments without a tracking number or supplier name", () => {
    expect(describeEvent({ kind: "shipment_added", orderLineId: null, detail: { leg: "direct", carrier: "dhl" } }, ctx)).toBe("Direct shipment (DHL Express) added");
    expect(describeEvent({ kind: "shipment_added", orderLineId: null, detail: { leg: "outbound", carrier: "unknown" } }, ctx)).toBe("Shipment to the customer added");
    expect(describeEvent({ kind: "shipment_status_changed", orderLineId: null, detail: { leg: "inbound", carrier: "ups", to: "delivered", source: "carrier" } }, ctx)).toBe("Inbound shipment (UPS): delivered");
    expect(describeEvent({ kind: "shipment_status_changed", orderLineId: null, detail: { leg: "outbound", carrier: "other", to: "in_transit", source: "manual" } }, ctx)).toBe("Shipment to the customer: in transit (set by hand)");
    expect(describeEvent({ kind: "shipment_status_changed", orderLineId: null, detail: { leg: "sideways", to: "teleported" } }, ctx)).toBe("Shipment updated");
  });
});

describe("at risk (Phase 4)", () => {
  const lines = [{ route: "direct_ship" as const, stage: "confirmed" as const }];
  it("lists only open orders flagged at risk, and counts them", () => {
    expect(matchesView({ lines, atRisk: true }, "at_risk")).toBe(true);
    expect(matchesView({ lines, atRisk: null }, "at_risk")).toBe(false);
    expect(matchesView({ lines: [{ route: "direct_ship" as const, stage: "delivered" as const }], atRisk: true }, "at_risk")).toBe(false);
    expect(orderKpis([{ lines, atRisk: true }, { lines, atRisk: false }, { lines }]).atRisk).toBe(1);
  });

  it("describes prediction changes in plain English", () => {
    const ctx: EventContext = { lines: new Map(), poNumbers: new Map() };
    const d = (detail: Record<string, unknown>) => describeEvent({ kind: "prediction_changed", orderLineId: null, detail }, ctx);
    expect(d({ from: "2026-10-16", to: "2026-10-16", source: "supplier_confirmed", at_risk: false })).toBe("Predicted delivery now Fri 16 Oct (supplier's confirmed date)");
    expect(d({ from: "2026-10-19", to: "2026-10-21", source: "lead_time", at_risk: true, was_at_risk: false })).toBe("At risk: predicted delivery Mon 19 – Wed 21 Oct (worked out from the lead time)");
    expect(d({ from: "2026-10-16", to: "2026-10-16", source: "manual", at_risk: false, was_at_risk: true })).toBe("Back on track: predicted delivery Fri 16 Oct (set by hand)");
    expect(d({ from: null, to: null, source: "unknown", at_risk: null })).toBe("Predicted delivery not known yet");
  });
});
