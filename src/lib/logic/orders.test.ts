import { describe, expect, it } from "vitest";
import {
  FULFILMENT_ROUTES,
  ROUTE_STAGES,
  allowedNextStages,
  canMoveStage,
  defaultRepFilter,
  isStageValidForRoute,
  normalisePostcode,
  orderFulfilmentLabel,
  orderStageLabel,
  orderStatus,
  parseIsoDate,
  parseMoneyToMinor,
  parseQuantity,
  parseRepFilter,
  stageLabel,
  validateNewOrder,
  type NewOrderInput,
} from "./orders";

describe("route stage sequences (handoff §7.5)", () => {
  it("start at ordered and end at delivered", () => {
    for (const r of FULFILMENT_ROUTES) {
      expect(ROUTE_STAGES[r][0]).toBe("ordered");
      expect(ROUTE_STAGES[r].at(-1)).toBe("delivered");
    }
  });

  it("only sends supplier routes through a PO, and only via-warehouse through goods-in", () => {
    expect(ROUTE_STAGES.from_stock).not.toContain("po_sent");
    expect(ROUTE_STAGES.direct_ship).toContain("po_sent");
    expect(ROUTE_STAGES.direct_ship).not.toContain("received");
    expect(ROUTE_STAGES.via_warehouse).toContain("received");
  });

  it("allows cancelled on every route", () => {
    for (const r of FULFILMENT_ROUTES) expect(isStageValidForRoute("cancelled", r)).toBe(true);
    expect(isStageValidForRoute("received", "direct_ship")).toBe(false);
  });
});

describe("stageLabel", () => {
  it("uses the mockup's wording", () => {
    expect(stageLabel("po_sent", "direct_ship")).toBe("Awaiting supplier");
    expect(stageLabel("confirmed", "direct_ship")).toBe("Supplier confirmed");
    expect(stageLabel("inbound", "via_warehouse")).toBe("In transit to us");
    expect(stageLabel("in_transit", "from_stock")).toBe("Out for delivery");
  });

  it("says what an untouched line needs", () => {
    expect(stageLabel("ordered", "direct_ship")).toBe("Needs PO");
    expect(stageLabel("ordered", "from_stock")).toBe("To pick");
  });
});

describe("allowedNextStages", () => {
  it("goes forward any number of steps, back one, or cancelled", () => {
    expect(allowedNextStages("confirmed", "direct_ship")).toEqual(["dispatched", "in_transit", "delivered", "cancelled"].length ? ["dispatched", "in_transit", "delivered", "cancelled"] : []);
    expect(allowedNextStages("dispatched", "direct_ship")).toEqual(["confirmed", "in_transit", "delivered", "cancelled"]);
  });

  it("never offers Awaiting supplier by hand — raising a PO sets it", () => {
    for (const r of FULFILMENT_ROUTES) {
      for (const s of ROUTE_STAGES[r]) expect(allowedNextStages(s, r)).not.toContain("po_sent");
    }
  });

  it("treats delivered and cancelled as final", () => {
    expect(allowedNextStages("delivered", "from_stock")).toEqual([]);
    expect(allowedNextStages("cancelled", "direct_ship")).toEqual([]);
  });

  it("only offers stages from the line's own route", () => {
    expect(allowedNextStages("ordered", "from_stock")).not.toContain("confirmed");
    expect(canMoveStage("ordered", "received", "direct_ship")).toBe(false);
  });

  it("copes with a stage that isn't on the route (bad data) by only allowing cancel", () => {
    expect(allowedNextStages("received", "direct_ship")).toEqual(["cancelled"]);
  });
});

describe("order summary", () => {
  const ds = (stage: Parameters<typeof stageLabel>[0]) => ({ route: "direct_ship" as const, stage });
  const fs = (stage: Parameters<typeof stageLabel>[0]) => ({ route: "from_stock" as const, stage });

  it("is delivered only when every live line is", () => {
    expect(orderStatus([ds("delivered"), fs("delivered")])).toBe("delivered");
    expect(orderStatus([ds("delivered"), ds("cancelled")])).toBe("delivered");
    expect(orderStatus([ds("delivered"), fs("dispatched")])).toBe("open");
  });

  it("is cancelled when every line is cancelled, and open with no lines", () => {
    expect(orderStatus([ds("cancelled")])).toBe("cancelled");
    expect(orderStatus([])).toBe("open");
  });

  it("names the route, or Mixed", () => {
    expect(orderFulfilmentLabel([ds("ordered"), ds("po_sent")])).toBe("Direct ship");
    expect(orderFulfilmentLabel([ds("ordered"), fs("picked")])).toBe("Mixed");
    expect(orderFulfilmentLabel([ds("ordered"), fs("cancelled")])).toBe("Direct ship");
    expect(orderFulfilmentLabel([])).toBe("—");
  });

  it("shows the stage holding the order up", () => {
    expect(orderStageLabel([ds("po_sent"), fs("dispatched")])).toBe("Awaiting supplier");
    expect(orderStageLabel([ds("po_sent"), ds("po_sent"), ds("confirmed")])).toBe("Awaiting supplier · 2 lines");
    expect(orderStageLabel([ds("delivered")])).toBe("Delivered");
    expect(orderStageLabel([ds("cancelled")])).toBe("Cancelled");
    expect(orderStageLabel([])).toBe("No lines");
  });
});

describe("parsing", () => {
  it.each([
    ["12.5", 1250],
    ["£1,250.00", 125000],
    ["0", 0],
    ["7", 700],
  ])("money %s → %i", (s, n) => expect(parseMoneyToMinor(s)).toBe(n));

  it.each(["", "abc", "1.234", "-5", "1e3", "12.5.5"])("rejects money %s", (s) => expect(parseMoneyToMinor(s)).toBeNull());

  it("parses quantities above zero with up to 3 decimals", () => {
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("1.125")).toBe(1.125);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("1.1234")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
  });

  it("accepts only real dates", () => {
    expect(parseIsoDate("2026-10-16")).toBe("2026-10-16");
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("16/10/2026")).toBeNull();
  });

  it("tidies UK postcodes and leaves others alone", () => {
    expect(normalisePostcode(" ng241ab ", "GB")).toBe("NG24 1AB");
    expect(normalisePostcode("sw1a  1aa", "GB")).toBe("SW1A 1AA");
    expect(normalisePostcode("75001", "FR")).toBe("75001");
  });
});

describe("validateNewOrder", () => {
  const base: NewOrderInput = {
    customerName: "[Customer A]",
    customerReference: "PO-CUST-77",
    soNumber: "",
    salesRepId: "",
    currency: "GBP",
    promisedDate: "2026-10-20",
    deliveryName: "[Customer A] Goods In",
    deliveryLine1: "1 Example Street",
    deliveryLine2: "",
    deliveryTown: "Newark",
    deliveryPostcode: "ng24 1ab",
    deliveryCountry: "GB",
    lines: [{ sku: "SKU-1", description: "Widget", quantity: "2", unitPrice: "12.50", route: "direct_ship" }],
  };

  it("accepts a good order and tidies it", () => {
    const r = validateNewOrder(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.delivery.postcode).toBe("NG24 1AB");
    expect(r.order.soNumber).toBeNull();
    expect(r.order.lines).toEqual([{ sku: "SKU-1", description: "Widget", quantity: 2, unitPriceMinor: 1250, route: "direct_ship" }]);
  });

  it("ignores completely blank lines", () => {
    const r = validateNewOrder({ ...base, lines: [...base.lines, { sku: "", description: "", quantity: "", unitPrice: "", route: "from_stock" }] });
    expect(r.ok && r.order.lines.length).toBe(1);
  });

  it("explains every problem in plain English", () => {
    const r = validateNewOrder({
      ...base,
      customerName: " ",
      currency: "JPY",
      promisedDate: "2026-13-01",
      deliveryPostcode: "not a postcode",
      soNumber: "SO 1 0",
      lines: [{ sku: "", description: "", quantity: "0", unitPrice: "abc", route: "teleport" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(
      ["currency", "customerName", "deliveryPostcode", "lines.0.description", "lines.0.quantity", "lines.0.route", "lines.0.unitPrice", "promisedDate", "soNumber"].sort(),
    );
  });

  it("needs at least one line", () => {
    const r = validateNewOrder({ ...base, lines: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBeDefined();
  });

  it("allows a line with no price", () => {
    const r = validateNewOrder({ ...base, lines: [{ ...base.lines[0]!, unitPrice: "" }] });
    expect(r.ok && r.order.lines[0]!.unitPriceMinor).toBeNull();
  });
});

describe("sales-rep filter (E1)", () => {
  it("opens sales reps on their own orders, everyone else on all", () => {
    expect(defaultRepFilter("sales")).toBe("mine");
    for (const r of ["admin", "procurement", "sales_manager", "director", "goods_in"]) expect(defaultRepFilter(r)).toBe("all");
  });

  it("reads the filter from the address, falling back to the default", () => {
    expect(parseRepFilter("all", "sales")).toBe("all");
    expect(parseRepFilter(undefined, "sales")).toBe("mine");
    expect(parseRepFilter("0b0e2a3b-1f8a-4c9c-9a75-84f4f6f5aaaa", "admin")).toEqual({ repId: "0b0e2a3b-1f8a-4c9c-9a75-84f4f6f5aaaa" });
    expect(parseRepFilter("'; drop table", "admin")).toBe("all");
  });
});
