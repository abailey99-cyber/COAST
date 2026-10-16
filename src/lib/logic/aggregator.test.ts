import { describe, expect, it } from "vitest";
import { costLevel, mapCarrier, mapStatus, newEvents, nextAggregatorCheck, shouldAlert, snapshotFromEvents, trackingRoute, type AggregatorEvent, type ProviderMapping } from "./aggregator";

const M: ProviderMapping = {
  carriers: { "dhl-express": "dhl", fedex: "fedex", "royal-mail": "royal_mail" },
  statuses: { info_received: "pre_transit", in_transit: "in_transit", out_for_delivery: "out_for_delivery", delivered: "delivered", exception: "exception" },
};
const ev = (id: string, code: string, at: string, extra: Partial<AggregatorEvent> = {}): AggregatorEvent => ({ eventId: id, trackingNumber: "T1", carrierCode: "dhl-express", statusCode: code, description: code.replace(/_/g, " "), occurredAt: at, location: null, ...extra });
const now = new Date("2026-10-16T12:00:00Z");

describe("aggregator mapping", () => {
  it("maps known carriers and statuses, and anything else to unknown — never a guess", () => {
    expect(mapCarrier("DHL-Express", M)).toBe("dhl");
    expect(mapCarrier("pigeon-post", M)).toBe("unknown");
    expect(mapCarrier(null, M)).toBe("unknown");
    expect(mapStatus("Delivered", M)).toBe("delivered");
    expect(mapStatus("held_by_aliens", M)).toBe("unknown");
  });
});

describe("webhook events", () => {
  it("ignores duplicates, including repeats within one delivery", () => {
    const fresh = newEvents([ev("a", "in_transit", "2026-10-15T10:00:00Z"), ev("a", "in_transit", "2026-10-15T10:00:00Z"), ev("b", "delivered", "2026-10-16T09:00:00Z")], new Set(["b"]));
    expect(fresh.map((e) => e.eventId)).toEqual(["a"]);
  });

  it("takes the status from the latest event by time, even when events arrive out of order", () => {
    const s = snapshotFromEvents([ev("2", "delivered", "2026-10-16T09:00:00Z"), ev("1", "in_transit", "2026-10-15T10:00:00Z")], M);
    expect(s.status).toBe("delivered");
    expect(s.deliveredAt).toBe("2026-10-16T09:00:00Z");
    expect(s.events.map((e) => e.status)).toEqual(["in_transit", "delivered"]);
  });

  it("never lets an unmapped status override a real one", () => {
    const s = snapshotFromEvents([ev("1", "in_transit", "2026-10-15T10:00:00Z"), ev("2", "held_by_aliens", "2026-10-15T12:00:00Z")], M);
    expect(s.status).toBe("in_transit");
    expect(s.statusText).toBe("held by aliens");
    expect(snapshotFromEvents([ev("1", "weird", "2026-10-15T10:00:00Z")], M).status).toBe("unknown");
  });

  it("keeps the carrier's latest estimate", () => {
    const s = snapshotFromEvents([ev("1", "in_transit", "2026-10-15T10:00:00Z", { estimatedFrom: "2026-10-19", estimatedTo: "2026-10-20" }), ev("2", "in_transit", "2026-10-15T18:00:00Z")], M);
    expect([s.estimatedFrom, s.estimatedTo]).toEqual(["2026-10-19", "2026-10-20"]);
  });
});

describe("adaptive checking (no webhooks)", () => {
  const base = { now, predictedDate: null, lastEventAt: "2026-10-16T08:00:00Z", webhooks: false, cost: "ok" as const };
  const hours = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 3_600_000 : null);
  it("checks often near the delivery date, rarely when quiet, and stops once delivered", () => {
    expect(hours(nextAggregatorCheck({ ...base, status: "in_transit", predictedDate: "2026-10-17" }))).toBe(2);
    expect(hours(nextAggregatorCheck({ ...base, status: "out_for_delivery" }))).toBe(2);
    expect(hours(nextAggregatorCheck({ ...base, status: "in_transit" }))).toBe(8);
    expect(hours(nextAggregatorCheck({ ...base, status: "in_transit", lastEventAt: "2026-10-12T08:00:00Z" }))).toBe(24);
    expect(nextAggregatorCheck({ ...base, status: "delivered" })).toBeNull();
  });
  it("only checks once a day as a safety net when webhooks are on, and slows near the cost cap without stopping", () => {
    expect(hours(nextAggregatorCheck({ ...base, status: "in_transit", webhooks: true }))).toBe(24);
    expect(hours(nextAggregatorCheck({ ...base, status: "in_transit", cost: "near" }))).toBe(32);
    expect(hours(nextAggregatorCheck({ ...base, status: "in_transit", cost: "over" }))).not.toBeNull();
  });
});

describe("tracking cost cap", () => {
  it("is 5% of the plan price, near at 80% of that, over at 100%", () => {
    expect(costLevel(0, 20000)).toEqual({ level: "ok", capMinor: 1000, percentUsed: 0 });
    expect(costLevel(800, 20000)).toMatchObject({ level: "near", percentUsed: 80 });
    expect(costLevel(1000, 20000)).toMatchObject({ level: "over" });
    expect(costLevel(5000, null)).toEqual({ level: "no_plan", capMinor: null, percentUsed: null });
  });
  it("tells the founder once per level per month", () => {
    expect(shouldAlert("near", null)).toBe(true);
    expect(shouldAlert("near", "near")).toBe(false);
    expect(shouldAlert("over", "near")).toBe(true);
    expect(shouldAlert("ok", null)).toBe(false);
  });
});

describe("which way a shipment is tracked", () => {
  const base = { carrier: "dhl" as const, hasTrackingNumber: true, ownAccount: false, directAllowed: true, aggregatorReady: true };
  it("prefers the organisation's own account, then the aggregator, else by hand", () => {
    expect(trackingRoute({ ...base, ownAccount: true })).toBe("direct");
    expect(trackingRoute(base)).toBe("aggregator");
    expect(trackingRoute({ ...base, aggregatorReady: false })).toBe("manual");
    expect(trackingRoute({ ...base, ownAccount: true, directAllowed: false })).toBe("aggregator");
    expect(trackingRoute({ ...base, hasTrackingNumber: false })).toBe("manual");
    expect(trackingRoute({ ...base, carrier: "other" })).toBe("manual");
    expect(trackingRoute({ ...base, carrier: "mock", aggregatorReady: false })).toBe("direct");
  });
});
