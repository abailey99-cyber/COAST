import { describe, expect, it } from "vitest";
import { toCustomerView, type RawCustomerOrder } from "./masking";
import { buildCustomerEmail, decide, heldReadyToSend, isUrgent, topicForPredictionChange, topicForShipmentStatus, topicSummary, wants } from "./notifications";

const NOW = new Date("2026-10-14T12:00:00Z");
const prefs = (over = {}) => ({ email: "jo@customer-a.example", level: "milestones" as const, dailyDigest: false, ...over });

describe("who wants what", () => {
  it("follows the four levels", () => {
    expect(wants("everything", "out_for_delivery")).toBe(true);
    expect(wants("milestones", "out_for_delivery")).toBe(false);
    expect(wants("milestones", "delivered")).toBe(true);
    expect(wants("milestones", "date_changed")).toBe(false);
    expect(wants("problems", "late")).toBe(true);
    expect(wants("problems", "delivered")).toBe(false);
    expect(wants("replies", "late")).toBe(false);
    expect(wants("replies", "reply")).toBe(true);
  });
  it("treats problems and replies as urgent", () => {
    expect(isUrgent("late")).toBe(true);
    expect(isUrgent("reply")).toBe(true);
    expect(isUrgent("dispatched")).toBe(false);
  });
});

describe("decide", () => {
  it("skips without an email address, or when the level doesn't want it", () => {
    expect(decide("delivered", null, null, NOW)).toMatchObject({ action: "skip" });
    expect(decide("delivered", prefs({ email: null }), null, NOW)).toMatchObject({ action: "skip" });
    expect(decide("delivered", prefs({ level: "problems" }), null, NOW)).toMatchObject({ action: "skip" });
  });
  it("sends routine updates, but no more than one every few hours", () => {
    expect(decide("delivered", prefs(), null, NOW)).toEqual({ action: "send" });
    expect(decide("delivered", prefs(), "2026-10-14T10:00:00Z", NOW)).toMatchObject({ action: "hold" });
    expect(decide("delivered", prefs(), "2026-10-14T07:59:00Z", NOW)).toEqual({ action: "send" });
    expect(decide("delivered", prefs(), "2026-10-14T11:00:00Z", NOW, { minGapHours: 0, dateShiftDays: 2 })).toEqual({ action: "send" });
  });
  it("lets problems and replies through straight away, even with a daily summary", () => {
    expect(decide("late", prefs({ dailyDigest: true }), "2026-10-14T11:59:00Z", NOW)).toEqual({ action: "send" });
    expect(decide("reply", prefs({ level: "replies", dailyDigest: true }), "2026-10-14T11:59:00Z", NOW)).toEqual({ action: "send" });
  });
  it("holds routine updates for the daily summary when chosen", () => {
    expect(decide("dispatched", prefs({ dailyDigest: true }), null, NOW)).toMatchObject({ action: "hold", reason: "Waiting for the daily summary" });
  });
  it("releases held updates once the gap has passed", () => {
    expect(heldReadyToSend(null, NOW)).toBe(true);
    expect(heldReadyToSend("2026-10-14T10:00:00Z", NOW)).toBe(false);
    expect(heldReadyToSend("2026-10-14T08:00:00Z", NOW)).toBe(true);
  });
});

describe("topicForPredictionChange", () => {
  const est = (from: string, to: string, atRisk: boolean | null = false) => ({ from, to, confidence: "estimate" as const, source: "lead_time", atRisk });
  const conf = (d: string, source = "supplier_confirmed") => ({ from: d, to: d, confidence: "confirmed" as const, source, atRisk: false });

  it("says nothing about small drifts", () => {
    expect(topicForPredictionChange(est("2026-10-19", "2026-10-21"), est("2026-10-20", "2026-10-22"), "2026-10-30")).toBeNull();
  });
  it("reports a move of two days or more", () => {
    expect(topicForPredictionChange(est("2026-10-19", "2026-10-21"), est("2026-10-21", "2026-10-23"), "2026-10-30")).toBe("date_changed");
    expect(topicForPredictionChange(est("2026-10-19", "2026-10-21"), est("2026-10-21", "2026-10-23"), "2026-10-30", { minGapHours: 4, dateShiftDays: 5 })).toBeNull();
  });
  it("reports a newly confirmed date, and a confirmed date that moves", () => {
    expect(topicForPredictionChange(est("2026-10-19", "2026-10-21"), conf("2026-10-20"), "2026-10-30")).toBe("date_confirmed");
    expect(topicForPredictionChange(conf("2026-10-20"), conf("2026-10-20"), "2026-10-30")).toBeNull();
    expect(topicForPredictionChange(conf("2026-10-20"), conf("2026-10-21"), "2026-10-30")).toBe("date_confirmed");
  });
  it("calls crossing the promised date a problem, whatever the size of the move", () => {
    expect(topicForPredictionChange(est("2026-10-19", "2026-10-20"), est("2026-10-20", "2026-10-21"), "2026-10-20")).toBe("late");
    expect(topicForPredictionChange(null, est("2026-10-20", "2026-10-22"), "2026-10-21")).toBe("late");
  });
  it("tells them when it's back within the promise", () => {
    expect(topicForPredictionChange(est("2026-10-22", "2026-10-23"), est("2026-10-20", "2026-10-21"), "2026-10-21")).toBe("date_changed");
  });
  it("says nothing about a first estimate or an unknown date", () => {
    expect(topicForPredictionChange(null, est("2026-10-19", "2026-10-21"), "2026-10-30")).toBeNull();
    expect(topicForPredictionChange(est("2026-10-19", "2026-10-21"), { from: null, to: null, confidence: "unknown", source: "unknown", atRisk: null }, "2026-10-30")).toBeNull();
  });
});

describe("topicForShipmentStatus", () => {
  it("turns customer-leg movements into milestones and ignores the inbound leg", () => {
    expect(topicForShipmentStatus("outbound", "unknown", "in_transit")).toBe("dispatched");
    expect(topicForShipmentStatus("direct", "pre_transit", "in_transit")).toBe("dispatched");
    expect(topicForShipmentStatus("direct", "in_transit", "out_for_delivery")).toBe("out_for_delivery");
    expect(topicForShipmentStatus("outbound", "out_for_delivery", "delivered")).toBe("delivered");
    expect(topicForShipmentStatus("outbound", "in_transit", "exception")).toBe("delivery_problem");
    expect(topicForShipmentStatus("inbound", "unknown", "delivered")).toBeNull();
    expect(topicForShipmentStatus("outbound", "exception", "in_transit")).toBeNull();
  });
});

describe("customer emails", () => {
  const raw: RawCustomerOrder = {
    org: { displayName: "[Demo Org A]", logoUrl: null, supplierWord: "shipper", showDirectCarrier: false },
    order: {
      soNumber: "SO-10421", customerName: "[Customer A]", customerReference: "CA-7781", createdAt: "2026-10-06T09:00:00Z", promisedDate: null, salesRepName: null,
      delivery: { name: "x", line1: "x", line2: null, town: "x", postcode: "NG24 1AB", country: "GB" }, internalNotes: "Hull Steel Co is cheap",
    },
    lines: [{ lineNo: 1, description: "Shelf", quantity: 1, route: "direct_ship", stage: "confirmed", supplierName: "Hull Steel Co", poNumber: "PO-5018", unitCostMinor: 100 }],
    prediction: { from: "2026-10-16", to: "2026-10-16", confidence: "confirmed", source: "supplier_confirmed", atRisk: false },
    shipments: [],
    events: [],
    messages: [],
    secrets: { supplierNames: ["Hull Steel Co"], poNumbers: ["PO-5018"] },
  };
  const view = toCustomerView(raw, NOW);

  it("words each topic plainly", () => {
    expect(topicSummary("date_confirmed", view)).toBe("Delivery date confirmed: Fri 16 Oct.");
    expect(topicSummary("reply", view, "Due Friday")).toBe("New reply: “Due Friday”");
  });
  it("is built from the masked view, with tracking and preference links", () => {
    const e = buildCustomerEmail(view, ["Delivery date confirmed: Fri 16 Oct."], { track: "https://x.test/track/K7Q-4M2-XP9", preferences: "https://x.test/track/K7Q-4M2-XP9#updates" });
    expect(e.subject).toBe("SO-10421: Delivery date confirmed: Fri 16 Oct.");
    expect(e.text).toContain("https://x.test/track/K7Q-4M2-XP9");
    expect(e.text).toContain("Change how often you hear from us");
    for (const s of [e.subject, e.text, e.html]) {
      expect(s).not.toContain("Hull Steel");
      expect(s).not.toContain("PO-5018");
    }
  });
  it("lists several folded updates, and escapes HTML", () => {
    const e = buildCustomerEmail(view, ["One <b>", "Two"], { track: "t", preferences: "p" });
    expect(e.text).toContain("- One <b>\n- Two");
    expect(e.html).toContain("<li>One &lt;b&gt;</li>");
  });
});
