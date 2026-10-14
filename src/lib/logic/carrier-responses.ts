/**
 * Turning each carrier's tracking response into COAST's TrackingSnapshot.
 * Pure: the adapters in src/lib/carriers do the network calls and hand the
 * JSON here. Every parser is defensive — a missing or renamed field gives an
 * empty value, never a crash (docs/integrations/carrier-tracking.md).
 */

import type { CarrierErrorKind } from "./carriers";
import { refineStatus, type ShipmentStatus, type TrackingEventInput, type TrackingSnapshot } from "./shipments";

export type TrackOutcome =
  | { ok: true; snapshot: TrackingSnapshot }
  | { ok: false; kind: "not_found" | CarrierErrorKind; message: string };

/** What an HTTP status means for a tracking call. */
export function classifyHttpStatus(status: number): "not_found" | CarrierErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_response";
}

export const ERROR_MESSAGES: Record<"not_found" | CarrierErrorKind, string> = {
  not_found: "The carrier doesn't know this tracking number yet. New labels can take a few hours to appear.",
  auth: "The carrier turned down COAST's credentials.",
  rate_limited: "The carrier asked COAST to slow down.",
  unavailable: "The carrier's tracking service didn't respond.",
  bad_response: "The carrier sent back something COAST couldn't read.",
  unsupported: "Live tracking isn't available for this carrier yet.",
};

export function failure(kind: "not_found" | CarrierErrorKind): TrackOutcome {
  return { ok: false, kind, message: ERROR_MESSAGES[kind] };
}

// ── Defensive readers ───────────────────────────────────────────────────────
type Json = unknown;

function at(value: Json, ...path: (string | number)[]): Json {
  let cur: Json = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, Json>)[key];
  }
  return cur;
}

function str(value: Json): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function list(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

/** An ISO timestamp, or null if it isn't one. */
function isoTime(value: Json): string | null {
  const s = str(value);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The date part (YYYY-MM-DD) of a timestamp as the carrier wrote it — its local date, not ours. */
function isoDate(value: Json): string | null {
  const s = str(value);
  if (!s) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function joinPlace(...parts: (string | null)[]): string | null {
  const p = parts.filter((x): x is string => Boolean(x));
  return p.length ? p.join(", ") : null;
}

function finish(status: ShipmentStatus, statusText: string | null, events: TrackingEventInput[], eta: { from: string | null; to: string | null }, deliveredAt: string | null): TrackingSnapshot {
  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return {
    status: refineStatus(status, statusText ?? sorted[0]?.description ?? null),
    statusText,
    estimatedFrom: eta.from,
    estimatedTo: eta.to ?? eta.from,
    deliveredAt,
    events: sorted,
  };
}

// ── DHL Unified Tracking API ────────────────────────────────────────────────
// UNVERIFIED: built from DHL's public documentation (developer.dhl.com,
// Shipment Tracking – Unified); not yet run against a live key.
const DHL_STATUS: Record<string, ShipmentStatus> = {
  "pre-transit": "pre_transit",
  transit: "in_transit",
  delivered: "delivered",
  failure: "exception",
  unknown: "unknown",
};

function dhlStatus(code: Json): ShipmentStatus {
  const s = str(code)?.toLowerCase();
  return (s && DHL_STATUS[s]) || "unknown";
}

export function parseDhl(body: Json): TrackOutcome {
  const shipment = list(at(body, "shipments"))[0];
  if (!shipment) return failure("not_found");

  const events: TrackingEventInput[] = [];
  for (const e of list(at(shipment, "events"))) {
    const occurredAt = isoTime(at(e, "timestamp"));
    const description = str(at(e, "description")) ?? str(at(e, "status"));
    if (!occurredAt || !description) continue;
    const status = refineStatus(dhlStatus(at(e, "statusCode")), description);
    events.push({ occurredAt, status, description, location: str(at(e, "location", "address", "addressLocality")) });
  }

  const current = at(shipment, "status");
  const status = dhlStatus(at(current, "statusCode"));
  const statusText = str(at(current, "description")) ?? str(at(current, "status"));
  const frame = at(shipment, "estimatedDeliveryTimeFrame");
  const eta = {
    from: isoDate(at(frame, "estimatedFrom")) ?? isoDate(at(shipment, "estimatedTimeOfDelivery")),
    to: isoDate(at(frame, "estimatedThrough")),
  };
  const deliveredAt = status === "delivered" ? isoTime(at(current, "timestamp")) : null;
  return { ok: true, snapshot: finish(status, statusText, events, eta, deliveredAt) };
}

// ── FedEx Track API (also TNT) ──────────────────────────────────────────────
// UNVERIFIED: built from FedEx's public documentation (developer.fedex.com,
// Track API v1); not yet run against live credentials.
const FEDEX_DELIVERED = new Set(["DL"]);
const FEDEX_OUT = new Set(["OD"]);
const FEDEX_PRE = new Set(["OC", "LP"]);
const FEDEX_PROBLEM = new Set(["DE", "SE", "CA", "RS", "DY", "HL", "RP"]);

function fedexStatus(code: Json): ShipmentStatus {
  const c = str(code)?.toUpperCase();
  if (!c) return "unknown";
  if (FEDEX_DELIVERED.has(c)) return "delivered";
  if (FEDEX_OUT.has(c)) return "out_for_delivery";
  if (FEDEX_PRE.has(c)) return "pre_transit";
  if (FEDEX_PROBLEM.has(c)) return "exception";
  return "in_transit";
}

export function parseFedex(body: Json): TrackOutcome {
  const result = list(at(list(at(body, "output", "completeTrackResults"))[0], "trackResults"))[0];
  if (!result) return failure("bad_response");
  const errorCode = str(at(result, "error", "code"));
  if (errorCode) return failure(/NOTFOUND|NOT\.FOUND|INVALID/i.test(errorCode) ? "not_found" : "bad_response");

  const events: TrackingEventInput[] = [];
  for (const e of list(at(result, "scanEvents"))) {
    const occurredAt = isoTime(at(e, "date"));
    const description = str(at(e, "eventDescription"));
    if (!occurredAt || !description) continue;
    events.push({
      occurredAt,
      status: refineStatus(fedexStatus(at(e, "derivedStatusCode") ?? at(e, "eventType")), description),
      description,
      location: joinPlace(str(at(e, "scanLocation", "city")), str(at(e, "scanLocation", "countryCode"))),
    });
  }

  const latest = at(result, "latestStatusDetail");
  const status = fedexStatus(at(latest, "derivedCode") ?? at(latest, "code"));
  const statusText = str(at(latest, "description")) ?? str(at(latest, "statusByLocale"));
  const times = list(at(result, "dateAndTimes"));
  const timeOf = (type: string) => times.find((t) => str(at(t, "type")) === type);
  const window = at(result, "estimatedDeliveryTimeWindow", "window");
  const eta = {
    from: isoDate(at(window, "begins")) ?? isoDate(at(timeOf("ESTIMATED_DELIVERY"), "dateTime")),
    to: isoDate(at(window, "ends")),
  };
  const deliveredAt = status === "delivered" ? isoTime(at(timeOf("ACTUAL_DELIVERY"), "dateTime")) : null;
  return { ok: true, snapshot: finish(status, statusText, events, eta, deliveredAt) };
}

// ── UPS Tracking API ────────────────────────────────────────────────────────
// UNVERIFIED: built from UPS's public documentation (developer.ups.com,
// Tracking API v1); not yet run against live credentials. UPS gives local
// times without a zone; COAST stores them as if they were UTC.
const UPS_TYPE: Record<string, ShipmentStatus> = { D: "delivered", I: "in_transit", P: "in_transit", M: "pre_transit", X: "exception", RS: "exception" };

function upsStatus(type: Json): ShipmentStatus {
  const t = str(type)?.toUpperCase();
  return (t && UPS_TYPE[t]) || "unknown";
}

function upsTime(date: Json, time: Json): string | null {
  const d = str(date);
  if (!d || !/^\d{8}$/.test(d)) return null;
  const t = (str(time) ?? "000000").padEnd(6, "0");
  if (!/^\d{6}$/.test(t)) return null;
  return isoTime(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`);
}

export function parseUps(body: Json): TrackOutcome {
  const shipment = list(at(body, "trackResponse", "shipment"))[0];
  if (!shipment) return failure("bad_response");
  const pkg = list(at(shipment, "package"))[0];
  if (!pkg) {
    const warning = str(at(list(at(shipment, "warnings"))[0], "message"));
    return failure(warning && /not found/i.test(warning) ? "not_found" : "bad_response");
  }

  const events: TrackingEventInput[] = [];
  for (const a of list(at(pkg, "activity"))) {
    const occurredAt = upsTime(at(a, "date"), at(a, "time"));
    const description = str(at(a, "status", "description"));
    if (!occurredAt || !description) continue;
    events.push({
      occurredAt,
      status: refineStatus(upsStatus(at(a, "status", "type")), description),
      description,
      location: joinPlace(str(at(a, "location", "address", "city")), str(at(a, "location", "address", "countryCode"))),
    });
  }

  const current = at(pkg, "currentStatus");
  const latestType = at(list(at(pkg, "activity"))[0], "status", "type");
  const status = upsStatus(at(current, "type") ?? latestType);
  const statusText = str(at(current, "description")) ?? str(at(current, "simplifiedTextDescription"));
  const dates = list(at(pkg, "deliveryDate"));
  const dateOf = (type: string) => str(at(dates.find((d) => str(at(d, "type")) === type), "date"));
  const expected = dateOf("SDD") ?? dateOf("RDD") ?? dateOf("EDD");
  const eta = { from: expected ? isoDate(expected) : null, to: null };
  const deliveredDate = dateOf("DEL");
  const deliveredAt = status === "delivered" ? (deliveredDate ? upsTime(deliveredDate, at(pkg, "deliveryTime", "endTime")) : (events.find((e) => e.status === "delivered")?.occurredAt ?? null)) : null;
  return { ok: true, snapshot: finish(status, statusText, events, eta, deliveredAt) };
}

// ── Royal Mail Tracking API v2 ──────────────────────────────────────────────
// UNVERIFIED: best-effort reconstruction from Royal Mail Group's developer
// portal (mailpieces/v2/{id}/events). Needs a correction pass with a live
// account; shown as "beta".
function royalMailStatus(category: Json, code: Json): ShipmentStatus {
  const c = `${str(category) ?? ""} ${str(code) ?? ""}`.toUpperCase();
  if (/DELIVERED/.test(c)) return "delivered";
  if (/RETURN|UNDELIVERABLE|DAMAGED|LOST|FAILED/.test(c)) return "exception";
  if (/OUT FOR DELIVERY/.test(c)) return "out_for_delivery";
  if (/IN TRANSIT|IN PROGRESS|RECEIVED|COLLECTED|DESPATCHED|DISPATCHED/.test(c)) return "in_transit";
  if (/PRE|AWAITING|LABEL|NOT YET/.test(c)) return "pre_transit";
  return "unknown";
}

export function parseRoyalMail(body: Json): TrackOutcome {
  const piece = at(body, "mailPieces");
  const p = Array.isArray(piece) ? piece[0] : piece;
  if (!p || typeof p !== "object") return failure(at(body, "errors") ? "not_found" : "bad_response");

  const events: TrackingEventInput[] = [];
  for (const e of list(at(p, "events"))) {
    const occurredAt = isoTime(at(e, "eventDateTime"));
    const description = str(at(e, "eventName"));
    if (!occurredAt || !description) continue;
    events.push({ occurredAt, status: refineStatus(royalMailStatus(null, description), description), description, location: str(at(e, "locationName")) });
  }

  const summary = at(p, "summary");
  const status = royalMailStatus(at(summary, "statusCategory"), at(summary, "statusDescription"));
  const statusText = str(at(summary, "statusDescription"));
  const est = at(p, "estimatedDelivery");
  const eta = { from: isoDate(at(est, "startOfEstimatedWindow")) ?? isoDate(at(est, "date")), to: isoDate(at(est, "endOfEstimatedWindow")) };
  const deliveredAt = status === "delivered" ? isoTime(at(summary, "eventDateTime")) : null;
  return { ok: true, snapshot: finish(status, statusText, events, eta, deliveredAt) };
}

// ── The test carrier ────────────────────────────────────────────────────────
interface MockStep {
  /** Minutes after the shipment was added. Negative = already happened when it was added. */
  at: number;
  status: ShipmentStatus;
  description: string;
  location: string | null;
}

const NORMAL: MockStep[] = [
  { at: -2880, status: "pre_transit", description: "Shipment information received", location: "Leicester, GB" },
  { at: -2400, status: "in_transit", description: "Collected from sender", location: "Leicester, GB" },
  { at: -1800, status: "in_transit", description: "Arrived at sorting hub", location: "East Midlands, GB" },
  { at: 1440, status: "in_transit", description: "Departed sorting hub", location: "East Midlands, GB" },
  { at: 2400, status: "out_for_delivery", description: "Out for delivery", location: "Newark, GB" },
  { at: 2700, status: "delivered", description: "Delivered — signed for", location: "Newark, GB" },
];

const SCENARIOS: Record<string, MockStep[]> = {
  DELIVERED: NORMAL.map((s, i) => ({ ...s, at: -3000 + i * 300 })),
  TRANSIT: NORMAL,
  BOOKED: [{ at: -60, status: "pre_transit", description: "Shipment information received", location: null }],
  CUSTOMS: [
    { at: -2880, status: "pre_transit", description: "Shipment information received", location: "Rotterdam, NL" },
    { at: -2400, status: "in_transit", description: "Collected from sender", location: "Rotterdam, NL" },
    { at: -1500, status: "in_transit", description: "Arrived at customs", location: "Dublin, IE" },
    { at: -600, status: "in_transit", description: "Customs clearance delay — awaiting documents", location: "Dublin, IE" },
  ],
  CLEARED: [
    { at: -2880, status: "pre_transit", description: "Shipment information received", location: "Rotterdam, NL" },
    { at: -1500, status: "in_transit", description: "Arrived at customs", location: "Dublin, IE" },
    { at: -900, status: "in_transit", description: "Customs clearance complete", location: "Dublin, IE" },
    { at: 1440, status: "out_for_delivery", description: "Out for delivery", location: "Dublin, IE" },
  ],
  EXCEPTION: [
    { at: -2880, status: "pre_transit", description: "Shipment information received", location: "Leicester, GB" },
    { at: -2000, status: "in_transit", description: "Collected from sender", location: "Leicester, GB" },
    { at: -300, status: "exception", description: "Damaged in transit — returning to sender", location: "East Midlands, GB" },
  ],
};

const DAY = 24 * 60 * 60_000;

/**
 * The test carrier: the tracking number picks a scenario and time reveals
 * it. MOCK-DELIVERED-1, MOCK-TRANSIT-1, MOCK-BOOKED-1, MOCK-CUSTOMS-1,
 * MOCK-CLEARED-1, MOCK-EXCEPTION-1; MOCK-NOTFOUND-… and MOCK-DOWN-… give
 * errors; anything else follows the normal journey.
 */
export function mockTrack(trackingNumber: string, addedAt: Date, now: Date): TrackOutcome {
  const word = /^MOCK-([A-Z]+)/.exec(trackingNumber.toUpperCase())?.[1] ?? "";
  if (word === "NOTFOUND") return failure("not_found");
  if (word === "DOWN") return failure("unavailable");
  const steps = SCENARIOS[word] ?? NORMAL;
  const base = addedAt.getTime();
  const happened = steps.filter((s) => base + s.at * 60_000 <= now.getTime());
  const events: TrackingEventInput[] = happened.map((s) => ({
    occurredAt: new Date(base + s.at * 60_000).toISOString(),
    status: s.status,
    description: s.description,
    location: s.location,
  }));
  const last = happened[happened.length - 1];
  const status: ShipmentStatus = last?.status ?? "unknown";
  const eta =
    status === "delivered" || status === "exception"
      ? { from: null, to: null }
      : { from: new Date(base + 2 * DAY).toISOString().slice(0, 10), to: new Date(base + 3 * DAY).toISOString().slice(0, 10) };
  return { ok: true, snapshot: finish(status, last?.description ?? null, events, eta, status === "delivered" ? (events[events.length - 1]?.occurredAt ?? null) : null) };
}
