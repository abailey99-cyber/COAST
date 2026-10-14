import { describe, expect, it } from "vitest";
import { classifyHttpStatus, mockTrack, parseDhl, parseFedex, parseRoyalMail, parseUps, type TrackOutcome } from "./carrier-responses";

function snapshot(o: TrackOutcome) {
  if (!o.ok) throw new Error(`expected a snapshot, got ${o.kind}`);
  return o.snapshot;
}

describe("classifyHttpStatus", () => {
  it("maps HTTP answers to what they mean for tracking", () => {
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("auth");
    expect(classifyHttpStatus(404)).toBe("not_found");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(503)).toBe("unavailable");
    expect(classifyHttpStatus(400)).toBe("bad_response");
  });
});

// Shapes follow each carrier's public documentation (see the UNVERIFIED notes in the parser).
describe("parseDhl", () => {
  const body = {
    shipments: [
      {
        id: "1234567890",
        service: "express",
        status: { timestamp: "2026-10-14T09:10:00+02:00", statusCode: "transit", status: "transit", description: "With delivery courier", location: { address: { addressLocality: "LONDON - UK" } } },
        estimatedDeliveryTimeFrame: { estimatedFrom: "2026-10-15T09:00:00Z", estimatedThrough: "2026-10-16T18:00:00Z" },
        events: [
          { timestamp: "2026-10-14T09:10:00+02:00", statusCode: "transit", description: "With delivery courier", location: { address: { addressLocality: "LONDON - UK" } } },
          { timestamp: "2026-10-13T20:00:00+02:00", statusCode: "transit", description: "Customs status updated", location: { address: { addressLocality: "EAST MIDLANDS - UK" } } },
          { timestamp: "2026-10-12T10:00:00+02:00", statusCode: "pre-transit", description: "Shipment information received" },
        ],
      },
    ],
  };

  it("reads status, ETA range and events, newest first", () => {
    const s = snapshot(parseDhl(body));
    expect(s.status).toBe("out_for_delivery");
    expect(s.estimatedFrom).toBe("2026-10-15");
    expect(s.estimatedTo).toBe("2026-10-16");
    expect(s.events).toHaveLength(3);
    expect(s.events[0]).toMatchObject({ occurredAt: "2026-10-14T07:10:00.000Z", status: "out_for_delivery", location: "LONDON - UK" });
    expect(s.events[2]).toMatchObject({ status: "pre_transit", location: null });
  });
  it("reads a delivery", () => {
    const s = snapshot(parseDhl({ shipments: [{ status: { statusCode: "delivered", description: "Delivered", timestamp: "2026-10-15T11:00:00Z" }, events: [] }] }));
    expect(s.status).toBe("delivered");
    expect(s.deliveredAt).toBe("2026-10-15T11:00:00.000Z");
  });
  it("reports an empty answer as not found, and odd shapes without crashing", () => {
    expect(parseDhl({ shipments: [] })).toMatchObject({ ok: false, kind: "not_found" });
    expect(parseDhl(null)).toMatchObject({ ok: false });
    const s = snapshot(parseDhl({ shipments: [{ status: { statusCode: "teleported" }, events: [{ timestamp: 5 }, "nonsense"] }] }));
    expect(s.status).toBe("unknown");
    expect(s.events).toEqual([]);
  });
  it("maps DHL's failure code to a problem", () => {
    expect(snapshot(parseDhl({ shipments: [{ status: { statusCode: "failure", description: "Returned" } }] })).status).toBe("exception");
  });
});

describe("parseFedex", () => {
  const body = {
    output: {
      completeTrackResults: [
        {
          trackingNumber: "123456789012",
          trackResults: [
            {
              latestStatusDetail: { code: "IT", derivedCode: "IT", description: "In transit" },
              dateAndTimes: [{ type: "ESTIMATED_DELIVERY", dateTime: "2026-10-16T00:00:00-06:00" }],
              scanEvents: [
                { date: "2026-10-14T05:00:00-06:00", eventType: "AR", derivedStatusCode: "IT", eventDescription: "Arrived at FedEx location", scanLocation: { city: "MEMPHIS", countryCode: "US" } },
                { date: "2026-10-13T05:00:00-06:00", eventType: "OC", derivedStatusCode: "IN", eventDescription: "Shipment information sent to FedEx", scanLocation: {} },
              ],
            },
          ],
        },
      ],
    },
  };

  it("reads status, ETA and events", () => {
    const s = snapshot(parseFedex(body));
    expect(s.status).toBe("in_transit");
    expect(s.estimatedFrom).toBe("2026-10-16");
    expect(s.events[0]).toMatchObject({ location: "MEMPHIS, US", status: "in_transit" });
  });
  it("prefers the delivery window when there is one", () => {
    const b = structuredClone(body);
    (b.output.completeTrackResults[0]!.trackResults[0] as Record<string, unknown>).estimatedDeliveryTimeWindow = { window: { begins: "2026-10-16T08:00:00", ends: "2026-10-17T18:00:00" } };
    expect(snapshot(parseFedex(b))).toMatchObject({ estimatedFrom: "2026-10-16", estimatedTo: "2026-10-17" });
  });
  it("reads a delivery with its time", () => {
    const s = snapshot(
      parseFedex({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: "DL", description: "Delivered" }, dateAndTimes: [{ type: "ACTUAL_DELIVERY", dateTime: "2026-10-15T10:30:00Z" }] }] }] } }),
    );
    expect(s.status).toBe("delivered");
    expect(s.deliveredAt).toBe("2026-10-15T10:30:00.000Z");
  });
  it("turns FedEx's not-found error into not found", () => {
    const b = { output: { completeTrackResults: [{ trackResults: [{ error: { code: "TRACKING.TRACKINGNUMBER.NOTFOUND", message: "Not found" } }] }] } };
    expect(parseFedex(b)).toMatchObject({ ok: false, kind: "not_found" });
    expect(parseFedex({})).toMatchObject({ ok: false, kind: "bad_response" });
  });
  it("maps exception codes to a problem and out-for-delivery to its own status", () => {
    const one = (code: string) => snapshot(parseFedex({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code } }] }] } })).status;
    expect(one("DE")).toBe("exception");
    expect(one("OD")).toBe("out_for_delivery");
    expect(one("OC")).toBe("pre_transit");
  });
});

describe("parseUps", () => {
  const body = {
    trackResponse: {
      shipment: [
        {
          package: [
            {
              trackingNumber: "1Z999AA10123456784",
              currentStatus: { type: "I", description: "Out For Delivery Today", code: "OT" },
              deliveryDate: [{ type: "SDD", date: "20261015" }],
              activity: [
                { date: "20261015", time: "071500", status: { type: "I", description: "Out For Delivery Today" }, location: { address: { city: "Newark", countryCode: "GB" } } },
                { date: "20261014", time: "221000", status: { type: "I", description: "Arrived at Facility" }, location: { address: { city: "Tamworth", countryCode: "GB" } } },
                { date: "20261013", time: "", status: { type: "M", description: "Shipper created a label" } },
              ],
            },
          ],
        },
      ],
    },
  };

  it("reads status, scheduled date and activity", () => {
    const s = snapshot(parseUps(body));
    expect(s.status).toBe("out_for_delivery");
    expect(s.estimatedFrom).toBe("2026-10-15");
    expect(s.events[0]).toMatchObject({ occurredAt: "2026-10-15T07:15:00.000Z", location: "Newark, GB", status: "out_for_delivery" });
    expect(s.events[2]).toMatchObject({ status: "pre_transit", occurredAt: "2026-10-13T00:00:00.000Z" });
  });
  it("reads a delivery", () => {
    const s = snapshot(
      parseUps({ trackResponse: { shipment: [{ package: [{ currentStatus: { type: "D", description: "Delivered" }, deliveryDate: [{ type: "DEL", date: "20261015" }], deliveryTime: { endTime: "143000" } }] }] } }),
    );
    expect(s.status).toBe("delivered");
    expect(s.deliveredAt).toBe("2026-10-15T14:30:00.000Z");
  });
  it("reads UPS's not-found warning, and odd shapes without crashing", () => {
    expect(parseUps({ trackResponse: { shipment: [{ warnings: [{ code: "TW0001", message: "Tracking Information Not Found" }] }] } })).toMatchObject({ ok: false, kind: "not_found" });
    expect(parseUps({})).toMatchObject({ ok: false, kind: "bad_response" });
    expect(snapshot(parseUps({ trackResponse: { shipment: [{ package: [{ activity: [{ date: "bad" }] }] }] } })).events).toEqual([]);
  });
});

describe("parseRoyalMail (best effort)", () => {
  it("reads the summary, estimated window and events", () => {
    const s = snapshot(
      parseRoyalMail({
        mailPieces: {
          mailPieceId: "AB123456789GB",
          summary: { statusCategory: "IN TRANSIT", statusDescription: "Item received at mail centre", eventDateTime: "2026-10-14T08:00:00+01:00" },
          estimatedDelivery: { date: "2026-10-15", startOfEstimatedWindow: "2026-10-15T08:00:00+01:00", endOfEstimatedWindow: "2026-10-15T18:00:00+01:00" },
          events: [{ eventCode: "EVNMI", eventName: "Item received at mail centre", eventDateTime: "2026-10-14T08:00:00+01:00", locationName: "Nottingham MC" }],
        },
      }),
    );
    expect(s.status).toBe("in_transit");
    expect(s.estimatedFrom).toBe("2026-10-15");
    expect(s.events[0]).toMatchObject({ location: "Nottingham MC" });
  });
  it("reads an errors-only answer as not found", () => {
    expect(parseRoyalMail({ errors: [{ errorCode: "E1142" }] })).toMatchObject({ ok: false, kind: "not_found" });
    expect(parseRoyalMail("nonsense")).toMatchObject({ ok: false, kind: "bad_response" });
  });
});

describe("mockTrack", () => {
  const added = new Date("2026-10-14T09:00:00Z");

  it("is already delivered for MOCK-DELIVERED numbers", () => {
    const s = snapshot(mockTrack("MOCK-DELIVERED-1", added, added));
    expect(s.status).toBe("delivered");
    expect(s.deliveredAt).not.toBeNull();
    expect(s.events.length).toBe(6);
  });
  it("reveals the normal journey as time passes", () => {
    expect(snapshot(mockTrack("MOCK-TRANSIT-1", added, added)).status).toBe("in_transit");
    expect(snapshot(mockTrack("MOCK-TRANSIT-1", added, new Date(added.getTime() + 2500 * 60_000))).status).toBe("out_for_delivery");
    expect(snapshot(mockTrack("MOCK-TRANSIT-1", added, new Date(added.getTime() + 3000 * 60_000))).status).toBe("delivered");
  });
  it("gives the same events every time for the same moment", () => {
    expect(mockTrack("MOCK-TRANSIT-1", added, added)).toEqual(mockTrack("MOCK-TRANSIT-1", added, added));
  });
  it("covers customs, problems and errors", () => {
    expect(snapshot(mockTrack("MOCK-CUSTOMS-1", added, added)).events.some((e) => /customs/i.test(e.description))).toBe(true);
    expect(snapshot(mockTrack("MOCK-EXCEPTION-1", added, added)).status).toBe("exception");
    expect(mockTrack("MOCK-NOTFOUND-1", added, added)).toMatchObject({ ok: false, kind: "not_found" });
    expect(mockTrack("MOCK-DOWN-1", added, added)).toMatchObject({ ok: false, kind: "unavailable" });
  });
});
