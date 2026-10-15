import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "./escalation";
import { countByWaitingOn, feedCategory, isProblem, matchesFeed, parseFeedFilter, rankWaiting } from "./feed";
import { receiptOutcome, validateReceipt } from "./goods-in";
import { median, orderFigures, percent, readingFigures, spendConcentration, supplierFigures } from "./metrics";
import { DEFAULT_CALENDAR } from "./working-time";

describe("goods-in check-in", () => {
  it("takes 'all here' as everything still outstanding", () => {
    expect(validateReceipt({ quantity: "", condition: "ok", note: "" }, 10, 4)).toEqual({ ok: true, value: { quantity: 6, condition: "ok", note: null } });
  });
  it("won't let 'all here' be fewer than expected, or 'fewer' be all of it", () => {
    expect(validateReceipt({ quantity: "5", condition: "ok", note: "" }, 10, 4)).toMatchObject({ ok: false });
    expect(validateReceipt({ quantity: "6", condition: "short", note: "" }, 10, 4)).toMatchObject({ ok: false });
    expect(validateReceipt({ quantity: "2", condition: "short", note: "" }, 10, 4)).toEqual({ ok: true, value: { quantity: 2, condition: "short", note: null } });
  });
  it("needs a note for damaged or wrong items", () => {
    expect(validateReceipt({ quantity: "", condition: "damaged", note: "" }, 1, 0)).toMatchObject({ ok: false, error: expect.stringMatching(/Say what's wrong/) });
    expect(validateReceipt({ quantity: "", condition: "wrong_item", note: "Blue not red" }, 1, 0)).toEqual({ ok: true, value: { quantity: 0, condition: "wrong_item", note: "Blue not red" } });
  });
  it("rejects nonsense", () => {
    expect(validateReceipt({ quantity: "lots", condition: "short", note: "" }, 10, 0)).toMatchObject({ ok: false });
    expect(validateReceipt({ quantity: "1", condition: "lost", note: "" }, 10, 0)).toMatchObject({ ok: false });
    expect(validateReceipt({ quantity: "1.23456", condition: "ok", note: "" }, 1, 0)).toMatchObject({ ok: false });
  });
  it("says what happens to the line", () => {
    expect(receiptOutcome({ quantity: 6, condition: "ok", note: null }, 10, 4)).toMatch(/now Received/);
    expect(receiptOutcome({ quantity: 2, condition: "short", note: null }, 10, 4)).toBe("6 of 10 received so far. The line stays waiting for the rest.");
    expect(receiptOutcome({ quantity: 0, condition: "damaged", note: "x" }, 10, 0)).toMatch(/damaged/);
  });
});

describe("updates feed", () => {
  it("files each kind of event", () => {
    expect(feedCategory("supplier_responded", {})).toBe("suppliers");
    expect(feedCategory("customer_message", {})).toBe("customers");
    expect(feedCategory("shipment_status_changed", {})).toBe("shipments");
    expect(feedCategory("chase_opened", { chase: "internal" })).toBe("internal");
    expect(feedCategory("chase_opened", { chase: "supplier" })).toBe("suppliers");
    expect(feedCategory("something_new", {})).toBe("internal");
  });
  it("picks out the problems", () => {
    expect(isProblem("prediction_changed", { at_risk: true, was_at_risk: false })).toBe(true);
    expect(isProblem("prediction_changed", { at_risk: true, was_at_risk: true })).toBe(false);
    expect(isProblem("shipment_status_changed", { to: "exception" })).toBe(true);
    expect(isProblem("shipment_status_changed", { to: "delivered" })).toBe(false);
    expect(isProblem("supplier_responded", { status: "needs_review" })).toBe(true);
    expect(isProblem("goods_received", { condition: "damaged" })).toBe(true);
    expect(isProblem("goods_received", { condition: "ok" })).toBe(false);
    expect(isProblem("order_created", {})).toBe(false);
  });
  it("filters", () => {
    expect(matchesFeed("all", "order_created", {})).toBe(true);
    expect(matchesFeed("problems", "customer_message", {})).toBe(true);
    expect(matchesFeed("suppliers", "customer_message", {})).toBe(false);
    expect(parseFeedFilter("nonsense")).toBe("all");
  });
});

describe("waiting on someone", () => {
  // Wednesday 14 October 2026, 15:00 UK time.
  const now = new Date("2026-10-14T14:00:00Z");
  const item = (id: string, since: string, waitingOn: "supplier" | "us" = "supplier") => ({ id, waitingOn, since, title: id, detail: null, href: "/" });

  it("puts the most overdue first, then the longest waiting", () => {
    const ranked = rankWaiting([item("fresh", "2026-10-14T13:00:00Z"), item("old", "2026-10-09T09:00:00Z"), item("mid", "2026-10-13T08:00:00Z", "us")], now, DEFAULT_THRESHOLDS, DEFAULT_CALENDAR);
    expect(ranked.map((r) => r.id)).toEqual(["old", "mid", "fresh"]);
    expect(ranked[0]!.level).toBe("alert");
    expect(ranked[2]!.level).toBe("none");
    expect(countByWaitingOn(ranked)).toEqual({ supplier: 2, procurement: 0, us: 1, carrier: 0, customer: 0, overdue: 2 });
  });
});

describe("metrics", () => {
  it("has a median and a percentage that say 'not enough data' rather than 0", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
  });

  it("counts on-time delivery only where there was a promise", () => {
    const f = orderFigures([
      { status: "delivered", promisedDate: "2026-10-10", deliveredDate: "2026-10-09", atRisk: false },
      { status: "delivered", promisedDate: "2026-10-10", deliveredDate: "2026-10-12", atRisk: false },
      { status: "delivered", promisedDate: null, deliveredDate: "2026-10-12", atRisk: false },
      { status: "open", promisedDate: null, deliveredDate: null, atRisk: true },
      { status: "cancelled", promisedDate: null, deliveredDate: null, atRisk: null },
    ]);
    expect(f).toEqual({ open: 1, atRisk: 1, delivered: 3, onTime: { onTime: 1, measured: 2, percent: 50 } });
  });

  it("measures each supplier's answers, punctuality and real lead time", () => {
    const pos = [
      { supplierId: "a", supplierName: "Alpha", sentAt: "2026-10-12T09:00:00Z", firstResponseAt: "2026-10-12T11:00:00Z" },
      { supplierId: "a", supplierName: "Alpha", sentAt: "2026-10-12T09:00:00Z", firstResponseAt: null },
      { supplierId: "a", supplierName: "Alpha", sentAt: null, firstResponseAt: null },
      { supplierId: "b", supplierName: "Beta", sentAt: "2026-10-12T09:00:00Z", firstResponseAt: "2026-10-13T09:00:00Z" },
    ];
    const arrivals = [
      { supplierId: "a", supplierName: "Alpha", poSentDate: "2026-10-05", confirmedDate: "2026-10-09", arrivedDate: "2026-10-09", typicalLeadDays: 3 },
      { supplierId: "a", supplierName: "Alpha", poSentDate: "2026-10-05", confirmedDate: "2026-10-09", arrivedDate: "2026-10-12", typicalLeadDays: 3 },
      { supplierId: "a", supplierName: "Alpha", poSentDate: "2026-10-05", confirmedDate: "2026-10-20", arrivedDate: null, typicalLeadDays: 3 },
    ];
    const [alpha, beta] = supplierFigures(pos, arrivals, DEFAULT_CALENDAR);
    expect(alpha).toMatchObject({ supplierName: "Alpha", pos: 3, respondedPercent: 50, medianResponseHours: 2, onTimePercent: 50, arrivalsMeasured: 2, medianActualLeadDays: 4.5, typicalLeadDays: 3 });
    expect(beta).toMatchObject({ supplierName: "Beta", pos: 1, respondedPercent: 100, medianResponseHours: 8, onTimePercent: null, medianActualLeadDays: null });
  });

  it("shows spend concentration per currency, never mixing currencies", () => {
    const s = spendConcentration([
      { supplierId: "a", supplierName: "Alpha", currency: "GBP", amountMinor: 7500 },
      { supplierId: "b", supplierName: "Beta", currency: "GBP", amountMinor: 2500 },
      { supplierId: "a", supplierName: "Alpha", currency: "EUR", amountMinor: 100 },
      { supplierId: "c", supplierName: "Gamma", currency: "GBP", amountMinor: 0 },
    ]);
    expect(s).toEqual([
      { currency: "GBP", totalMinor: 10000, topPercent: 75, suppliers: [
        { supplierId: "a", supplierName: "Alpha", amountMinor: 7500, percent: 75 },
        { supplierId: "b", supplierName: "Beta", amountMinor: 2500, percent: 25 },
      ] },
      { currency: "EUR", totalMinor: 100, topPercent: 100, suppliers: [{ supplierId: "a", supplierName: "Alpha", amountMinor: 100, percent: 100 }] },
    ]);
  });

  it("measures how much supplier email COAST reads by itself", () => {
    const r = readingFigures([
      { source: "paste", status: "applied" },
      { source: "paste", status: "accepted" },
      { source: "inbound", status: "needs_review" },
      { source: "paste", status: "rejected" },
      { source: "link", status: "applied" },
    ]);
    expect(r).toEqual([
      { source: "email", total: 4, automatic: 1, reviewedAccepted: 1, notRelevant: 1, waiting: 1, automaticPercent: 25 },
      { source: "link", total: 1, automatic: 1, reviewedAccepted: 0, notRelevant: 0, waiting: 0, automaticPercent: 100 },
    ]);
  });
});
