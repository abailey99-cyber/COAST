import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREDICTION_SETTINGS as S,
  addWorkingDays,
  leadTimeTicker,
  parseAvailability,
  predictLine,
  predictOrder,
  predictionChanged,
  predictionSettingsProblem,
  resolveLeadTime,
  ukDateOf,
  ukToday,
  workingDaysBetween,
  type LineForPrediction,
} from "./prediction";

// Wednesday 14 October 2026.
const TODAY = "2026-10-14";

const line = (over: Partial<LineForPrediction> = {}): LineForPrediction => ({
  id: "l1",
  lineNo: 1,
  route: "direct_ship",
  stage: "po_sent",
  supplierConfirmedDate: null,
  poSentDate: null,
  leadTime: null,
  shipments: [],
  ...over,
});

describe("dates", () => {
  it("gives the UK date, including late at night in summer time", () => {
    expect(ukToday(new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
    expect(ukToday(new Date("2026-12-14T23:30:00Z"))).toBe("2026-12-14");
    expect(ukDateOf("not a date")).toBeNull();
  });
  it("adds working days, skipping weekends and holidays", () => {
    expect(addWorkingDays(TODAY, 0)).toBe(TODAY);
    expect(addWorkingDays(TODAY, 2)).toBe("2026-10-16");
    expect(addWorkingDays(TODAY, 3)).toBe("2026-10-19"); // over the weekend
    expect(addWorkingDays("2026-10-17", 0)).toBe("2026-10-19"); // a Saturday moves to Monday
    expect(addWorkingDays(TODAY, 1, ["2026-10-15"])).toBe("2026-10-16");
  });
  it("counts working days between dates", () => {
    expect(workingDaysBetween("2026-10-12", TODAY)).toBe(2);
    expect(workingDaysBetween("2026-10-09", "2026-10-12")).toBe(1); // Fri → Mon
    expect(workingDaysBetween(TODAY, "2026-10-01")).toBe(0);
  });
});

describe("resolveLeadTime", () => {
  it("prefers a hand-set lead time, then availability, then the supplier's typical one", () => {
    expect(resolveLeadTime({ manualDays: 3, availabilityDays: 1, supplierDays: 9 })).toEqual({ days: 3, source: "manual" });
    expect(resolveLeadTime({ manualDays: null, availabilityDays: 0, supplierDays: 9 })).toEqual({ days: 0, source: "availability" });
    expect(resolveLeadTime({ manualDays: null, availabilityDays: null, supplierDays: 9 })).toEqual({ days: 9, source: "supplier" });
  });
  it("says nothing when it has nothing usable", () => {
    expect(resolveLeadTime({ manualDays: null, availabilityDays: null, supplierDays: null })).toBeNull();
    expect(resolveLeadTime({ manualDays: -1, availabilityDays: 1.5, supplierDays: 999 })).toBeNull();
  });
});

describe("leadTimeTicker", () => {
  const lead = { days: 5, source: "supplier" as const };
  it("counts working days since the PO was sent", () => {
    expect(leadTimeTicker("direct_ship", "po_sent", lead, "2026-10-12", TODAY)).toMatchObject({ label: "Day 2 of 5", overdue: false });
  });
  it("says when a line has run over its lead time", () => {
    const t = leadTimeTicker("via_warehouse", "confirmed", lead, "2026-10-01", TODAY);
    expect(t).toMatchObject({ overdue: true, elapsed: 9 });
    expect(t!.label).toBe("4 working days over its 5-day lead time");
  });
  it("waits for the PO, and stops once goods have arrived or for stock lines", () => {
    expect(leadTimeTicker("direct_ship", "ordered", lead, null, TODAY)!.label).toMatch(/starts when the PO is sent/);
    expect(leadTimeTicker("via_warehouse", "received", lead, "2026-10-01", TODAY)).toBeNull();
    expect(leadTimeTicker("from_stock", "ordered", lead, null, TODAY)).toBeNull();
    expect(leadTimeTicker("direct_ship", "po_sent", null, "2026-10-01", TODAY)).toBeNull();
  });
});

describe("predictLine", () => {
  it("uses the supplier's confirmed date as an exact date", () => {
    expect(predictLine(line({ supplierConfirmedDate: "2026-10-20" }), S, TODAY)).toMatchObject({ from: "2026-10-20", to: "2026-10-20", source: "supplier_confirmed" });
  });
  it("turns a supplier date that has passed into a fresh estimate, and says so", () => {
    const p = predictLine(line({ supplierConfirmedDate: "2026-10-09" }), S, TODAY);
    expect(p).toMatchObject({ from: TODAY, to: "2026-10-16", source: "supplier_confirmed" });
    expect(p.note).toMatch(/has passed/);
  });
  it("works out a range from the lead time, counted from when the PO was sent", () => {
    const p = predictLine(line({ poSentDate: "2026-10-12", leadTime: { days: 5, source: "supplier" } }), S, TODAY);
    expect(p).toMatchObject({ from: "2026-10-19", to: "2026-10-21", source: "lead_time", note: null });
  });
  it("counts the lead time from today when the PO hasn't gone, and says so", () => {
    const p = predictLine(line({ stage: "ordered", leadTime: { days: 2, source: "manual" } }), S, TODAY);
    expect(p).toMatchObject({ from: "2026-10-16", to: "2026-10-20" });
    expect(p.note).toMatch(/hasn't been sent/);
  });
  it("never predicts the past when a lead time has run out", () => {
    const p = predictLine(line({ poSentDate: "2026-09-01", leadTime: { days: 2, source: "supplier" } }), S, TODAY);
    expect(p.from).toBe(TODAY);
    expect(p.to! >= TODAY).toBe(true);
  });
  it("says 'not known yet' with no date and no lead time — never a guess", () => {
    expect(predictLine(line(), S, TODAY)).toMatchObject({ from: null, to: null, source: "unknown" });
  });
  it("prefers the carrier's estimate once it's on its way to the customer", () => {
    const shipments = [{ leg: "direct" as const, status: "in_transit" as const, etaFrom: "2026-10-16", etaTo: "2026-10-17", deliveredAt: null }];
    expect(predictLine(line({ stage: "in_transit", supplierConfirmedDate: "2026-10-20", shipments }), S, TODAY)).toMatchObject({ from: "2026-10-16", to: "2026-10-17", source: "carrier" });
  });
  it("adds turnaround and delivery days after goods reach the warehouse", () => {
    // Confirmed into the warehouse Fri 16 Oct; +1 turnaround +2 delivery = Wed 21 Oct.
    expect(predictLine(line({ route: "via_warehouse", stage: "confirmed", supplierConfirmedDate: "2026-10-16" }), S, TODAY)).toMatchObject({ from: "2026-10-21", to: "2026-10-21", source: "supplier_confirmed", note: "Reaches us Fri 16 Oct, then 3 working days to the customer" });
    const inbound = [{ leg: "inbound" as const, status: "in_transit" as const, etaFrom: "2026-10-15", etaTo: "2026-10-16", deliveredAt: null }];
    expect(predictLine(line({ route: "via_warehouse", stage: "inbound", shipments: inbound }), S, TODAY)).toMatchObject({ from: "2026-10-20", to: "2026-10-21", source: "carrier" });
    expect(predictLine(line({ route: "via_warehouse", stage: "received" }), S, TODAY)).toMatchObject({ from: "2026-10-19", to: "2026-10-21", source: "stock" });
  });
  it("predicts stock lines from turnaround and delivery days", () => {
    expect(predictLine(line({ route: "from_stock", stage: "ordered" }), S, TODAY)).toMatchObject({ from: "2026-10-19", to: "2026-10-21", source: "stock" });
    expect(predictLine(line({ route: "from_stock", stage: "dispatched" }), S, TODAY)).toMatchObject({ from: "2026-10-15", to: "2026-10-16", source: "in_transit" });
  });
  it("is done once delivered or cancelled", () => {
    const delivered = [{ leg: "outbound" as const, status: "delivered" as const, etaFrom: null, etaTo: null, deliveredAt: "2026-10-13T15:00:00Z" }];
    expect(predictLine(line({ route: "from_stock", stage: "in_transit", shipments: delivered }), S, TODAY)).toMatchObject({ done: true, source: "delivered", from: "2026-10-13" });
    expect(predictLine(line({ stage: "delivered" }), S, TODAY)).toMatchObject({ done: true, source: "delivered", from: null });
    expect(predictLine(line({ stage: "cancelled" }), S, TODAY)).toMatchObject({ done: true });
  });
  it("ignores an inbound shipment's delivery for a line still going to the customer", () => {
    const inbound = [{ leg: "inbound" as const, status: "delivered" as const, etaFrom: null, etaTo: null, deliveredAt: "2026-10-13T10:00:00Z" }];
    expect(predictLine(line({ route: "via_warehouse", stage: "received", shipments: inbound }), S, TODAY).done).toBe(false);
  });
});

describe("predictOrder", () => {
  it("is the slowest line, and names it", () => {
    const p = predictOrder(
      {
        promisedDate: "2026-10-30",
        override: null,
        lines: [line({ supplierConfirmedDate: "2026-10-16" }), line({ id: "l2", lineNo: 2, supplierConfirmedDate: "2026-10-22" })],
      },
      S,
      TODAY,
    );
    expect(p).toMatchObject({ from: "2026-10-22", to: "2026-10-22", source: "supplier_confirmed", confidence: "confirmed", atRisk: false });
    expect(p.reason).toMatch(/line 2 is the last/);
  });
  it("is an estimate when any part is worked out", () => {
    const p = predictOrder({ promisedDate: null, override: null, lines: [line({ poSentDate: TODAY, leadTime: { days: 3, source: "supplier" } })] }, S, TODAY);
    expect(p.confidence).toBe("estimate");
    expect(p.atRisk).toBeNull(); // no promised date: can't say
  });
  it("flags at risk when the latest likely date is after the promised date", () => {
    const lines = [line({ poSentDate: TODAY, leadTime: { days: 3, source: "supplier" } })]; // Mon 19 – Wed 21 Oct
    expect(predictOrder({ promisedDate: "2026-10-20", override: null, lines }, S, TODAY).atRisk).toBe(true);
    expect(predictOrder({ promisedDate: "2026-10-21", override: null, lines }, S, TODAY).atRisk).toBe(false);
  });
  it("flags at risk once the promised date has passed without delivery", () => {
    expect(predictOrder({ promisedDate: "2026-10-13", override: null, lines: [line({ supplierConfirmedDate: "2026-10-14" })] }, S, TODAY).atRisk).toBe(true);
  });
  it("is 'not known yet' when any line is, but still flags a line that's already too late", () => {
    const unknown = predictOrder({ promisedDate: "2026-10-30", override: null, lines: [line(), line({ id: "l2", lineNo: 2, supplierConfirmedDate: "2026-10-16" })] }, S, TODAY);
    expect(unknown).toMatchObject({ from: null, to: null, confidence: "unknown", atRisk: null });
    expect(unknown.reason).toMatch(/line 1 has no confirmed date/);
    const late = predictOrder({ promisedDate: "2026-10-15", override: null, lines: [line(), line({ id: "l2", lineNo: 2, supplierConfirmedDate: "2026-10-16" })] }, S, TODAY);
    expect(late.atRisk).toBe(true);
  });
  it("lets a date set by hand beat everything, and never be replaced", () => {
    const p = predictOrder({ promisedDate: "2026-10-20", override: { from: "2026-10-23", to: null }, lines: [line({ supplierConfirmedDate: "2026-10-16" })] }, S, TODAY);
    expect(p).toMatchObject({ from: "2026-10-23", to: "2026-10-23", source: "manual", confidence: "confirmed", atRisk: true });
    const range = predictOrder({ promisedDate: null, override: { from: "2026-10-23", to: "2026-10-27" }, lines: [] }, S, TODAY);
    expect(range).toMatchObject({ to: "2026-10-27", confidence: "estimate" });
  });
  it("is delivered, and not at risk, once every line is done", () => {
    const delivered = [{ leg: "direct" as const, status: "delivered" as const, etaFrom: null, etaTo: null, deliveredAt: "2026-10-12T09:00:00Z" }];
    const p = predictOrder({ promisedDate: "2026-10-01", override: null, lines: [line({ stage: "delivered", shipments: delivered }), line({ id: "l2", lineNo: 2, stage: "cancelled" })] }, S, TODAY);
    expect(p).toMatchObject({ source: "delivered", from: "2026-10-12", atRisk: false });
  });
  it("has nothing to say about an order without lines", () => {
    expect(predictOrder({ promisedDate: null, override: null, lines: [] }, S, TODAY)).toMatchObject({ source: "unknown", confidence: "unknown" });
  });
});

describe("predictionChanged", () => {
  it("records a first prediction, a moved date and a change in risk", () => {
    expect(predictionChanged(null, { from: "2026-10-16", to: "2026-10-16", atRisk: false })).toBe(true);
    expect(predictionChanged(null, { from: null, to: null, atRisk: null })).toBe(false);
    expect(predictionChanged({ from: "2026-10-16", to: "2026-10-16", atRisk: false }, { from: "2026-10-16", to: "2026-10-16", atRisk: false })).toBe(false);
    expect(predictionChanged({ from: "2026-10-16", to: "2026-10-16", atRisk: false }, { from: "2026-10-16", to: "2026-10-17", atRisk: false })).toBe(true);
    expect(predictionChanged({ from: "2026-10-16", to: "2026-10-16", atRisk: false }, { from: "2026-10-16", to: "2026-10-16", atRisk: true })).toBe(true);
  });
});

describe("predictionSettingsProblem", () => {
  it("accepts whole days from 0 to 30", () => {
    expect(predictionSettingsProblem(S)).toBeNull();
    expect(predictionSettingsProblem({ ...S, deliveryDays: 31 })).toMatch(/Delivery/);
    expect(predictionSettingsProblem({ ...S, spreadDays: 1.5 })).toMatch(/Estimate width/);
  });
});

describe("parseAvailability", () => {
  it("reads codes and days, with or without a header, in commas or tabs", () => {
    const r = parseAvailability("SKU,Days\nshf-200, 5\nPRB-90\t0\nMAT-3;in stock\nBAR-2M,10 working days");
    expect(r.rows).toEqual([
      { sku: "SHF-200", days: 5 },
      { sku: "PRB-90", days: 0 },
      { sku: "MAT-3", days: 0 },
      { sku: "BAR-2M", days: 10 },
    ]);
    expect(r.problems).toEqual([]);
  });
  it("lists rows it can't read instead of guessing", () => {
    const r = parseAvailability("SHF-200,soon\n,5\nTAPE-Y,400\nOK-1,3");
    expect(r.rows).toEqual([{ sku: "OK-1", days: 3 }]);
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toMatch(/Row 1: "soon" isn't a number/);
  });
  it("keeps the last value for a repeated code and ignores blank lines", () => {
    expect(parseAvailability("A1,2\n\nA1,4").rows).toEqual([{ sku: "A1", days: 4 }]);
  });
  it("stops at the row limit", () => {
    const r = parseAvailability("A1,1\nA2,1\nA3,1", 2);
    expect(r.rows).toHaveLength(2);
    expect(r.problems[0]).toMatch(/more than 2/);
  });
});

describe("formatRange", () => {
  it("shortens a range inside one month and spells out one that crosses months", async () => {
    const { formatRange } = await import("./prediction");
    expect(formatRange("2026-10-16", "2026-10-16")).toBe("Fri 16 Oct");
    expect(formatRange("2026-10-16", "2026-10-20")).toBe("Fri 16 – Tue 20 Oct");
    expect(formatRange("2026-10-30", "2026-11-03")).toBe("Fri 30 Oct – Tue 3 Nov");
    expect(formatRange(null, "2026-10-16")).toBeNull();
  });
});
