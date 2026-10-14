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
    ).toEqual({ open: 3, awaitingSupplier: 2, needsPo: 1 });
  });

  it("is all zero with no orders", () => {
    expect(orderKpis([])).toEqual({ open: 0, awaitingSupplier: 0, needsPo: 0 });
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
