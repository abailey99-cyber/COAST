import { describe, expect, it } from "vitest";
import {
  CUSTOMER_STAGES,
  MaskingError,
  assertViewIsClean,
  customerStage,
  describeLeaks,
  findLeaks,
  orderCustomerStage,
  toCustomerView,
  type RawCustomerOrder,
} from "./masking";

const NOW = new Date("2026-10-14T12:00:00Z");
const SUPPLIER = "Grimsby Widget Works Ltd";
const SUPPLIER_EMAIL = "orders@grimsby-widgets.example";
const PO = "PO-5017";

/** A raw order stuffed with every secret in every place it could hide. */
function raw(over: Partial<RawCustomerOrder> = {}): RawCustomerOrder {
  return {
    org: { displayName: "[Demo Org A]", logoUrl: null, supplierWord: "shipper", showDirectCarrier: false },
    order: {
      soNumber: "SO-10421",
      customerName: "[Customer A]",
      customerReference: "CA-PO-7781",
      createdAt: "2026-10-06T09:14:00Z",
      promisedDate: "2026-10-20",
      salesRepName: "[Rep name]",
      delivery: { name: "[Customer A] Goods In", line1: "1 Example Park", line2: null, town: "Newark", postcode: "NG24 1AB", country: "GB" },
      internalNotes: `Margin is thin — ${SUPPLIER} charges £9.40, see ${PO}`,
    },
    lines: [
      { lineNo: 1, description: "Industrial shelving unit", quantity: 4, route: "direct_ship", stage: "confirmed", supplierName: SUPPLIER, poNumber: PO, unitCostMinor: 940 },
      { lineNo: 2, description: "Pallet racking beams", quantity: 20, route: "via_warehouse", stage: "inbound", supplierName: "Hull Steel Co", poNumber: "PO-5018", unitCostMinor: 1519 },
    ],
    prediction: { from: "2026-10-16", to: "2026-10-16", confidence: "confirmed", source: "supplier_confirmed", atRisk: false },
    shipments: [
      { leg: "direct", carrier: "dhl", trackingNumber: "1234567890", status: "in_transit", deliveredAt: null },
      { leg: "inbound", carrier: "ups", trackingNumber: "1Z999AA10123456784", status: "in_transit", deliveredAt: null },
    ],
    events: [
      { id: 1, kind: "order_created", detail: {}, createdAt: "2026-10-06T09:14:00Z" },
      { id: 2, kind: "po_raised", detail: { purchase_order_id: "p1", po_number: PO }, createdAt: "2026-10-06T10:00:00Z" },
      { id: 3, kind: "po_emailed", detail: { purchase_order_id: "p1", email: "po", to: SUPPLIER_EMAIL }, createdAt: "2026-10-06T10:01:00Z" },
      { id: 4, kind: "prediction_changed", detail: { from: "2026-10-14", to: "2026-10-17", source: "lead_time", confidence: "estimate" }, createdAt: "2026-10-06T16:20:00Z" },
      { id: 5, kind: "supplier_responded", detail: { purchase_order_id: "p1", source: "link", status: "applied", supplier: SUPPLIER }, createdAt: "2026-10-08T14:05:00Z" },
      { id: 6, kind: "prediction_changed", detail: { from: "2026-10-16", to: "2026-10-16", source: "supplier_confirmed", confidence: "confirmed" }, createdAt: "2026-10-08T14:05:01Z" },
      { id: 7, kind: "chase_opened", detail: { chase: "supplier", purchase_order_id: "p1", note: `Chased ${SUPPLIER}` }, createdAt: "2026-10-09T09:00:00Z" },
      { id: 8, kind: "shipment_status_changed", detail: { leg: "inbound", carrier: "ups", to: "in_transit", tracking: "1Z999AA10123456784" }, createdAt: "2026-10-10T09:00:00Z" },
      { id: 9, kind: "shipment_status_changed", detail: { leg: "direct", carrier: "dhl", to: "in_transit", location: "Grimsby, GB" }, createdAt: "2026-10-14T10:42:00Z" },
      { id: 10, kind: "order_updated", detail: { fields: ["promised_date"], note: `${PO} moved` }, createdAt: "2026-10-14T11:00:00Z" },
    ],
    messages: [],
    secrets: { supplierNames: [SUPPLIER, "Hull Steel Co"], poNumbers: [PO, "PO-5018"] },
    ...over,
  };
}

describe("customer stages (decision B6)", () => {
  it("maps every internal stage onto the five customer stages", () => {
    expect(CUSTOMER_STAGES).toEqual(["Ordered", "Confirmed", "Dispatched", "In transit", "Delivered"]);
    expect(customerStage("direct_ship", "po_sent")).toBe(0);
    expect(customerStage("direct_ship", "confirmed")).toBe(1);
    expect(customerStage("direct_ship", "in_transit")).toBe(3);
    expect(customerStage("direct_ship", "cancelled")).toBeNull();
  });
  it("hides the warehouse leg: goods coming to us and received both show as Confirmed", () => {
    expect(customerStage("via_warehouse", "inbound")).toBe(1);
    expect(customerStage("via_warehouse", "received")).toBe(1);
  });
  it("shows a stock line as confirmed once picked, then straight on to dispatched", () => {
    expect(customerStage("from_stock", "picked")).toBe(1);
    expect(customerStage("from_stock", "dispatched")).toBe(2);
  });
  it("puts the order at its least-advanced live line", () => {
    expect(orderCustomerStage([{ route: "direct_ship", stage: "in_transit" }, { route: "via_warehouse", stage: "inbound" }])).toBe(1);
    expect(orderCustomerStage([{ route: "direct_ship", stage: "cancelled" }, { route: "from_stock", stage: "delivered" }])).toBe(4);
    expect(orderCustomerStage([{ route: "direct_ship", stage: "cancelled" }])).toBeNull();
  });
});

describe("toCustomerView — leak tests", () => {
  const view = toCustomerView(raw(), NOW);
  const text = JSON.stringify(view);

  it("never contains a supplier name, PO number, cost, supplier email or internal note", () => {
    for (const secret of [SUPPLIER, "Grimsby", "Hull Steel", PO, "PO-5018", "5017", "940", "9.40", "15.19", SUPPLIER_EMAIL, "Margin", "thin"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("never shows a direct shipment's carrier or tracking number by default", () => {
    expect(text).not.toContain("1234567890");
    expect(text).not.toContain("DHL");
    expect(view.tracking).toEqual([]);
  });

  it("never reveals the inbound leg (goods coming to us first)", () => {
    expect(text).not.toContain("1Z999AA10123456784");
    expect(text).not.toContain("UPS");
    expect(view.updates.filter((u) => u.title === "In transit")).toHaveLength(1);
  });

  it("drops POs, emails, chases and internal edits from the timeline", () => {
    expect(view.updates.map((u) => u.title)).toEqual(["In transit", "Delivery date confirmed: 16 October", "Order confirmed", "Estimated Wed 14 – Sat 17 Oct", "Order received"]);
  });

  it("passes the final scan, and the scan catches a leak if one is forced in", () => {
    expect(() => assertViewIsClean(view, raw().secrets)).not.toThrow();
    const tampered = { ...view, latest: `Shipped by ${SUPPLIER.toUpperCase()}` };
    expect(() => assertViewIsClean(tampered, raw().secrets)).toThrow(MaskingError);
  });

  it("has no field a supplier detail could live in", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(view);
    for (const forbidden of ["supplierName", "supplier", "poNumber", "po", "unitCostMinor", "cost", "internalNotes", "notes", "origin", "email"]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });
});

describe("toCustomerView — what the customer does see", () => {
  it("leads with the confirmed date and a plain-English progress line", () => {
    const v = toCustomerView(raw(), NOW);
    expect(v.headline).toEqual({ kind: "arriving", from: "2026-10-16", to: "2026-10-16" });
    expect(v.status).toEqual({ label: "Confirmed · on track", tone: "ok" });
    expect(v.stage).toBe(1);
    expect(v.latest).toBe("Your order is confirmed and is on schedule for delivery on Friday 16 October.");
    expect(v.lines).toEqual([
      { lineNo: 1, description: "Industrial shelving unit", quantity: 4 },
      { lineNo: 2, description: "Pallet racking beams", quantity: 20 },
    ]);
    expect(v.deliverTo).toEqual(["[Customer A] Goods In", "1 Example Park", "Newark", "NG24 1AB"]);
    expect(v.repName).toBe("[Rep name]");
    expect(v.updates[0]!.current).toBe(true);
  });

  it("shows an estimate as a range, and says it may be late when at risk", () => {
    const v = toCustomerView(raw({ prediction: { from: "2026-10-19", to: "2026-10-21", confidence: "estimate", source: "lead_time", atRisk: true } }), NOW);
    expect(v.headline.kind).toBe("estimated");
    expect(v.status).toEqual({ label: "Confirmed · may be later than planned", tone: "warn" });
    expect(v.latest).toMatch(/may arrive later than first planned — we're expecting it between Mon 19 – Wed 21 Oct/);
  });

  it("says when there's no date yet, instead of guessing", () => {
    const v = toCustomerView(raw({ prediction: null }), NOW);
    expect(v.headline.kind).toBe("unknown");
    expect(v.latest).toMatch(/We'll show a delivery date as soon as we have one/);
  });

  it("names our own carrier, and a direct one only when the company allows it", () => {
    const own = raw({
      shipments: [{ leg: "outbound", carrier: "dhl", trackingNumber: "5555555555", status: "in_transit", deliveredAt: null }],
      events: [{ id: 1, kind: "shipment_status_changed", detail: { leg: "outbound", carrier: "dhl", to: "in_transit" }, createdAt: "2026-10-14T10:00:00Z" }],
    });
    const v = toCustomerView(own, NOW);
    expect(v.updates[0]!.badge).toEqual({ kind: "carrier", label: "CARRIER · DHL EXPRESS" });
    expect(v.tracking).toEqual([{ carrier: "DHL Express", trackingNumber: "5555555555", trackingUrl: expect.stringContaining("5555555555") }]);
    const allowed = toCustomerView(raw({ org: { ...raw().org, showDirectCarrier: true } }), NOW);
    expect(allowed.tracking.map((t) => t.carrier)).toEqual(["DHL Express"]);
    const hidden = toCustomerView(raw(), NOW);
    expect(hidden.updates[0]!.badge).toEqual({ kind: "shipper", label: "SHIPPER UPDATE" });
  });

  it("uses the company's own word for a supplier (decision B8)", () => {
    const v = toCustomerView(raw({ org: { ...raw().org, supplierWord: "partner" } }), NOW);
    expect(v.updates.some((u) => u.badge?.label === "PARTNER UPDATE")).toBe(true);
  });

  it("handles delivered and cancelled orders", () => {
    const delivered = toCustomerView(
      raw({
        lines: raw().lines.map((l) => ({ ...l, stage: "delivered" as const })),
        shipments: [{ leg: "direct", carrier: "dhl", trackingNumber: "1", status: "delivered", deliveredAt: "2026-10-15T13:00:00Z" }],
      }),
      NOW,
    );
    expect(delivered.headline).toEqual({ kind: "delivered", from: "2026-10-15", to: "2026-10-15" });
    expect(delivered.stage).toBe(4);
    expect(delivered.latest).toBe("Your order has been delivered on Thursday 15 October.");
    const cancelled = toCustomerView(raw({ lines: raw().lines.map((l) => ({ ...l, stage: "cancelled" as const })) }), NOW);
    expect(cancelled.status.label).toBe("Cancelled");
    expect(cancelled.lines).toEqual([]);
  });

  it("shows the conversation as 'you' and 'us', with staff names only", () => {
    const v = toCustomerView(
      raw({
        messages: [
          { id: "m1", from: "customer", authorName: "Jo Bloggs", body: "Any news?", createdAt: "2026-10-14T09:00:00Z" },
          { id: "m2", from: "staff", authorName: "[Rep name]", body: "Due Friday.", createdAt: "2026-10-14T09:30:00Z" },
        ],
      }),
      NOW,
    );
    expect(v.messages).toEqual([
      { id: "m1", from: "you", name: null, body: "Any news?", at: "2026-10-14T09:00:00Z" },
      { id: "m2", from: "us", name: "[Rep name]", body: "Due Friday.", at: "2026-10-14T09:30:00Z" },
    ]);
    expect(v.lastUpdated).toBe("2026-10-14T11:00:00Z");
  });

  it("shows the customer's own problem reports with customer-safe wording, and nothing internal (spec §5.4)", () => {
    const r = raw({
      problems: [
        { id: "x1", raisedVia: "customer", category: "damaged", status: "waiting_supplier", createdAt: "2026-10-14T09:00:00Z", rootCause: `${SUPPLIER} packed it badly`, resolutionNote: `Credit from ${PO}` },
        { id: "x2", raisedVia: "goods_in", category: "short", status: "triage", createdAt: "2026-10-13T09:00:00Z" },
      ],
    });
    const v = toCustomerView(r, NOW);
    expect(v.problems).toEqual([{ id: "x1", what: "Damaged", status: "We're sorting it out", reportedAt: "2026-10-14T09:00:00Z", open: true }]);
    expect(findLeaks(JSON.stringify(v), r.secrets)).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/supplier|packed it badly|goods_in/i);
  });

  it("gives the one approved customs line while a delivery is held, and nothing else about customs (C7)", () => {
    const held = toCustomerView(raw({ shipments: [{ leg: "direct", carrier: "dhl", trackingNumber: "1234567890", status: "in_transit", deliveredAt: null, customsHeld: true }] }), NOW);
    expect(held.customsNote).toBe("Customs checks in progress — we're on it.");
    expect(toCustomerView(raw(), NOW).customsNote).toBeNull();
    const inbound = toCustomerView(raw({ shipments: [{ leg: "inbound", carrier: "ups", trackingNumber: null, status: "in_transit", deliveredAt: null, customsHeld: true }] }), NOW);
    expect(inbound.customsNote).toBeNull();
  });
});

describe("findLeaks — staff replies", () => {
  const secrets = { supplierNames: [SUPPLIER, "Hull Steel Co", "AB"], poNumbers: [PO] };

  it("catches supplier names however they're written", () => {
    for (const t of [`It's coming from ${SUPPLIER}.`, "grimsby widget works ltd will ship", "GRIMSBY-WIDGET-WORKS-LTD", "Grimsby  Widget Works Ltd", "via hull steel co."]) {
      expect(findLeaks(t, secrets).length, t).toBeGreaterThan(0);
    }
  });
  it("catches a supplier name with its company ending dropped or swapped, and & written as and (readiness Task 5B)", () => {
    const secrets = { supplierNames: ["Grimsby Widget Works Ltd", "Smith & Sons Limited", "Hull Ltd"], poNumbers: [] };
    expect(findLeaks("It's coming from Grimsby Widget Works.", secrets).map((l) => l.value)).toEqual(["Grimsby Widget Works Ltd"]);
    expect(findLeaks("grimsby widget works limited are shipping", secrets).map((l) => l.value)).toEqual(["Grimsby Widget Works Ltd"]);
    expect(findLeaks("Smith and Sons will deliver", secrets).map((l) => l.value)).toEqual(["Smith & Sons Limited"]);
    expect(findLeaks("SMITH & SONS LTD", secrets).map((l) => l.value)).toEqual(["Smith & Sons Limited"]);
    // Too short once the ending is gone: "Hull" alone is a city, not a leak.
    expect(findLeaks("Our warehouse in Hull", secrets)).toEqual([]);
    expect(findLeaks("Hull Ltd sent it", secrets).map((l) => l.value)).toEqual(["Hull Ltd"]);
  });

  it("catches PO numbers however they're written", () => {
    const secrets = { supplierNames: [], poNumbers: ["PO-5017"] };
    for (const t of ["see P.O. 5017", "PO #5017", "PO no. 5017", "po number: 5017", "PO5017", "po 5017"]) expect(findLeaks(t, secrets), t).toHaveLength(1);
    for (const t of ["see PO-50171", "invoice 5017", "PO-5018"]) expect(findLeaks(t, secrets), t).toEqual([]);
  });

  it("catches PO numbers with or without the dash", () => {
    for (const t of ["See PO-5017", "po5017 is late", "ref PO 5017", "(PO-5017)"]) {
      expect(findLeaks(t, secrets).map((l) => l.kind), t).toContain("po");
    }
  });
  it("doesn't block ordinary messages", () => {
    for (const t of ["Your order is due Friday.", "We're chasing the courier for you.", "Order SO-10421 is on its way.", "PO-50170 is someone else's", "Grimsby is a town"]) {
      expect(findLeaks(t, secrets), t).toEqual([]);
    }
  });
  it("ignores names too short to scan safely", () => {
    expect(findLeaks("AB testing", secrets)).toEqual([]);
  });
  it("explains a block in plain English", () => {
    const msg = describeLeaks(findLeaks(`${SUPPLIER} / PO-5017`, secrets), "shipper");
    expect(msg).toMatch(/the shipper name “Grimsby Widget Works Ltd” and the purchase order number PO-5017/);
    expect(msg).toMatch(/wasn't sent/);
  });
});
