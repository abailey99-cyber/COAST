import { describe, expect, it } from "vitest";
import {
  applySnapshot,
  defaultLeg,
  etaRange,
  eventKey,
  inferCustomsStatus,
  isInternational,
  lineStageForShipment,
  normaliseTrackingNumber,
  refineStatus,
  validateNewShipment,
  type ShipmentState,
  type TrackingSnapshot,
} from "./shipments";

const ev = (occurredAt: string, description: string) => ({ occurredAt, description });

const state = (over: Partial<ShipmentState> = {}): ShipmentState => ({
  status: "unknown",
  statusSource: "carrier",
  isInternational: false,
  customsStatus: "not_required",
  customsSource: "carrier",
  eventKeys: new Set(),
  events: [],
  ...over,
});

const snap = (over: Partial<TrackingSnapshot> = {}): TrackingSnapshot => ({
  status: "in_transit",
  statusText: "Arrived at hub",
  estimatedFrom: "2026-10-16",
  estimatedTo: "2026-10-17",
  deliveredAt: null,
  events: [
    { occurredAt: "2026-10-14T08:00:00Z", status: "pre_transit", description: "Label created", location: null },
    { occurredAt: "2026-10-14T12:00:00Z", status: "in_transit", description: "Arrived at hub", location: "East Midlands" },
  ],
  ...over,
});

describe("isInternational", () => {
  it("is false for mainland UK and true abroad", () => {
    expect(isInternational("GB", "NG24 1AB")).toBe(false);
    expect(isInternational("IE", "D02 X285")).toBe(true);
    expect(isInternational("gb", "SW1A 1AA")).toBe(false);
  });
  it("counts Northern Ireland and the Crown Dependencies (decision C6)", () => {
    expect(isInternational("GB", "BT1 5GS")).toBe(true);
    expect(isInternational("JE", "JE2 3AB")).toBe(true);
    expect(isInternational("IM", "IM1 1AA")).toBe(true);
  });
  it("doesn't mistake a postcode merely containing BT", () => {
    expect(isInternational("GB", "B1 1BT")).toBe(false);
  });
});

describe("inferCustomsStatus", () => {
  it("says unknown when no event mentions customs — never guesses", () => {
    expect(inferCustomsStatus([])).toBe("unknown");
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Arrived at hub")])).toBe("unknown");
  });
  it("reads held, cleared and in progress from the wording", () => {
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Arrived at customs")])).toBe("in_progress");
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Customs clearance delay")])).toBe("held");
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Held by customs pending documents")])).toBe("held");
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Import duties due")])).toBe("held");
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Clearance processing complete")])).toBe("cleared");
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Released by customs")])).toBe("cleared");
  });
  it("lets the latest customs event decide, whatever order they arrive in", () => {
    const events = [ev("2026-10-14T12:00:00Z", "Customs clearance complete"), ev("2026-10-14T08:00:00Z", "Customs clearance delay")];
    expect(inferCustomsStatus(events)).toBe("cleared");
  });
  it("ignores later events that don't mention customs", () => {
    expect(inferCustomsStatus([ev("2026-10-14T08:00:00Z", "Held at customs"), ev("2026-10-14T10:00:00Z", "Arrived at hub")])).toBe("held");
  });
});

describe("refineStatus", () => {
  it("spots out-for-delivery in words when the carrier only says in transit", () => {
    expect(refineStatus("in_transit", "With delivery courier")).toBe("out_for_delivery");
    expect(refineStatus("in_transit", "Shipment is out for delivery")).toBe("out_for_delivery");
    expect(refineStatus("in_transit", "Arrived at hub")).toBe("in_transit");
    expect(refineStatus("delivered", "Out for delivery")).toBe("delivered");
    expect(refineStatus("in_transit", null)).toBe("in_transit");
  });
});

describe("normaliseTrackingNumber", () => {
  it("upper-cases and strips spaces", () => {
    expect(normaliseTrackingNumber(" 1z 999 aa1 0123456784 ")).toBe("1Z999AA10123456784");
  });
  it("rejects junk", () => {
    expect(normaliseTrackingNumber("abc")).toBeNull();
    expect(normaliseTrackingNumber("<script>")).toBeNull();
    expect(normaliseTrackingNumber("")).toBeNull();
    expect(normaliseTrackingNumber("A".repeat(41))).toBeNull();
  });
});

describe("eventKey", () => {
  it("is the same for the same event however the time and spacing are written", () => {
    expect(eventKey(ev("2026-10-14T13:00:00+01:00", "Arrived  at Hub"))).toBe(eventKey(ev("2026-10-14T12:00:00.000Z", "arrived at hub")));
  });
});

describe("applySnapshot", () => {
  it("takes the carrier's status, ETA and new events", () => {
    const out = applySnapshot(state(), snap());
    expect(out.patch.status).toBe("in_transit");
    expect(out.patch.estimatedFrom).toBe("2026-10-16");
    expect(out.patch.estimatedTo).toBe("2026-10-17");
    expect(out.newEvents).toHaveLength(2);
    expect(out.statusChange).toEqual({ from: "unknown", to: "in_transit" });
  });

  it("never stores the same event twice", () => {
    const first = applySnapshot(state(), snap());
    const again = applySnapshot(state({ status: "in_transit", eventKeys: new Set(first.newEvents.map((e) => e.key)) }), snap());
    expect(again.newEvents).toHaveLength(0);
    expect(again.statusChange).toBeNull();
  });

  it("drops events without a time or wording, and duplicates inside one snapshot", () => {
    const s = snap({
      events: [
        { occurredAt: "not a date", status: "in_transit", description: "x", location: null },
        { occurredAt: "2026-10-14T08:00:00Z", status: "in_transit", description: "  ", location: null },
        { occurredAt: "2026-10-14T08:00:00Z", status: "in_transit", description: "Hub", location: null },
        { occurredAt: "2026-10-14T08:00:00Z", status: "in_transit", description: "Hub", location: null },
      ],
    });
    expect(applySnapshot(state(), s).newEvents).toHaveLength(1);
  });

  it("keeps a status a person set by hand (sticky override), but still records events", () => {
    const out = applySnapshot(state({ status: "delivered", statusSource: "manual" }), snap());
    expect(out.patch.status).toBe("delivered");
    expect(out.statusChange).toBeNull();
    expect(out.newEvents).toHaveLength(2);
  });

  it("doesn't let a carrier's 'unknown' wipe out a status it gave before", () => {
    const out = applySnapshot(state({ status: "in_transit" }), snap({ status: "unknown", events: [] }));
    expect(out.patch.status).toBe("in_transit");
  });

  it("works out customs for international shipments only", () => {
    const customsSnap = snap({ events: [{ occurredAt: "2026-10-14T08:00:00Z", status: "in_transit", description: "Customs clearance delay", location: null }] });
    expect(applySnapshot(state({ isInternational: true, customsStatus: "unknown" }), customsSnap).patch.customsStatus).toBe("held");
    expect(applySnapshot(state(), customsSnap).patch.customsStatus).toBe("not_required");
  });

  it("keeps a customs status set by hand", () => {
    const customsSnap = snap({ events: [{ occurredAt: "2026-10-14T08:00:00Z", status: "in_transit", description: "Customs clearance delay", location: null }] });
    const out = applySnapshot(state({ isInternational: true, customsStatus: "cleared", customsSource: "manual" }), customsSnap);
    expect(out.patch.customsStatus).toBe("cleared");
  });

  it("treats a delivered international shipment with no customs wording as cleared", () => {
    const out = applySnapshot(state({ isInternational: true, customsStatus: "unknown" }), snap({ status: "delivered", events: [] }));
    expect(out.patch.customsStatus).toBe("cleared");
  });

  it("takes the delivery time from the latest delivered event when the carrier gives none", () => {
    const s = snap({
      status: "delivered",
      events: [
        { occurredAt: "2026-10-15T09:00:00Z", status: "out_for_delivery", description: "Out for delivery", location: null },
        { occurredAt: "2026-10-15T14:00:00Z", status: "delivered", description: "Delivered", location: null },
      ],
    });
    expect(applySnapshot(state({ status: "in_transit" }), s).patch.deliveredAt).toBe("2026-10-15T14:00:00Z");
  });

  it("has no delivery time unless it's delivered", () => {
    expect(applySnapshot(state(), snap({ deliveredAt: "2026-10-15T14:00:00Z" })).patch.deliveredAt).toBeNull();
  });

  it("uses a single ETA date as both ends of the range", () => {
    expect(applySnapshot(state(), snap({ estimatedTo: null })).patch.estimatedTo).toBe("2026-10-16");
  });
});

describe("lineStageForShipment", () => {
  it("moves direct-ship lines to in transit, then delivered", () => {
    expect(lineStageForShipment("direct_ship", "confirmed", "direct", "in_transit")).toBe("in_transit");
    expect(lineStageForShipment("direct_ship", "confirmed", "direct", "out_for_delivery")).toBe("in_transit");
    expect(lineStageForShipment("direct_ship", "in_transit", "direct", "delivered")).toBe("delivered");
  });
  it("moves warehouse lines to 'in transit to us' on the inbound leg and stops there", () => {
    expect(lineStageForShipment("via_warehouse", "confirmed", "inbound", "in_transit")).toBe("inbound");
    expect(lineStageForShipment("via_warehouse", "inbound", "inbound", "delivered")).toBeNull();
  });
  it("moves warehouse lines on the outbound leg", () => {
    expect(lineStageForShipment("via_warehouse", "received", "outbound", "in_transit")).toBe("in_transit");
    expect(lineStageForShipment("from_stock", "picked", "outbound", "delivered")).toBe("delivered");
  });
  it("never moves a line backwards, or a finished line at all", () => {
    expect(lineStageForShipment("direct_ship", "delivered", "direct", "in_transit")).toBeNull();
    expect(lineStageForShipment("direct_ship", "cancelled", "direct", "delivered")).toBeNull();
    expect(lineStageForShipment("via_warehouse", "received", "inbound", "in_transit")).toBeNull();
  });
  it("does nothing for booked, problem or unknown statuses", () => {
    expect(lineStageForShipment("direct_ship", "confirmed", "direct", "pre_transit")).toBeNull();
    expect(lineStageForShipment("direct_ship", "confirmed", "direct", "exception")).toBeNull();
    expect(lineStageForShipment("direct_ship", "confirmed", "direct", "unknown")).toBeNull();
  });
  it("ignores a leg the line's route can't use", () => {
    expect(lineStageForShipment("direct_ship", "confirmed", "outbound", "delivered")).toBeNull();
  });
});

describe("defaultLeg", () => {
  it("follows the route and, for the warehouse, where the goods are", () => {
    expect(defaultLeg("direct_ship", "confirmed")).toBe("direct");
    expect(defaultLeg("from_stock", "ordered")).toBe("outbound");
    expect(defaultLeg("via_warehouse", "confirmed")).toBe("inbound");
    expect(defaultLeg("via_warehouse", "received")).toBe("outbound");
  });
});

describe("validateNewShipment", () => {
  const lines = [
    { id: "a", route: "direct_ship" as const, stage: "confirmed" as const, quantity: 2 },
    { id: "b", route: "from_stock" as const, stage: "picked" as const, quantity: 1 },
    { id: "c", route: "direct_ship" as const, stage: "delivered" as const, quantity: 1 },
  ];
  const input = { leg: "direct", carrier: "dhl", trackingNumber: "12345 67890", lineIds: ["a"], note: "" };

  it("accepts a good shipment and tidies the tracking number", () => {
    const r = validateNewShipment(input, lines);
    expect(r).toEqual({ ok: true, value: { leg: "direct", carrier: "dhl", trackingNumber: "1234567890", lineIds: ["a"], note: null } });
  });
  it("needs a tracking number unless it's an own delivery", () => {
    expect(validateNewShipment({ ...input, trackingNumber: "" }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, carrier: "other", trackingNumber: "" }, lines).ok).toBe(true);
  });
  it("rejects unknown carriers, legs and carriers not on offer", () => {
    expect(validateNewShipment({ ...input, carrier: "pigeon" }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, leg: "sideways" }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, carrier: "mock" }, lines, { allowedCarriers: ["dhl"] }).ok).toBe(false);
  });
  it("rejects lines that aren't on the order, are finished, or travel another way", () => {
    expect(validateNewShipment({ ...input, lineIds: [] }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, lineIds: ["zzz"] }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, lineIds: ["c"] }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, lineIds: ["a", "b"] }, lines).ok).toBe(false);
  });
  it("rejects a bad tracking number and an over-long note", () => {
    expect(validateNewShipment({ ...input, trackingNumber: "!!" }, lines).ok).toBe(false);
    expect(validateNewShipment({ ...input, note: "x".repeat(1001) }, lines).ok).toBe(false);
  });
});

describe("etaRange", () => {
  it("returns null without dates and orders the ends", () => {
    expect(etaRange(null, null)).toBeNull();
    expect(etaRange("2026-10-17", "2026-10-14")).toEqual({ from: "2026-10-14", to: "2026-10-17" });
    expect(etaRange(null, "2026-10-14")).toEqual({ from: "2026-10-14", to: "2026-10-14" });
  });
});
