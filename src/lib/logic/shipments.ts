/**
 * Shipments and tracking (spec §5.2, §5.3, §9.2). Pure: no I/O, the current
 * time is passed in. Keep the enums in step with
 * supabase/migrations/0012_shipments.sql.
 */

import { CARRIER_KEYS, isCarrierKey, type CarrierKey } from "./carriers";
import { ROUTE_STAGES, type FulfilmentRoute, type LineStage } from "./orders";

// ── Legs ────────────────────────────────────────────────────────────────────
/** inbound: supplier → our warehouse · outbound: us → customer · direct: supplier → customer. */
export const SHIPMENT_LEGS = ["inbound", "outbound", "direct"] as const;
export type ShipmentLeg = (typeof SHIPMENT_LEGS)[number];

export const LEG_LABELS: Record<ShipmentLeg, string> = {
  inbound: "Inbound to us",
  outbound: "To the customer",
  direct: "Direct from supplier",
};

export function isShipmentLeg(value: unknown): value is ShipmentLeg {
  return typeof value === "string" && (SHIPMENT_LEGS as readonly string[]).includes(value);
}

/** Which legs a line on each route can travel on. */
export const ROUTE_LEGS: Record<FulfilmentRoute, readonly ShipmentLeg[]> = {
  from_stock: ["outbound"],
  via_warehouse: ["inbound", "outbound"],
  direct_ship: ["direct"],
};

/** The leg a new shipment for this line most likely is. */
export function defaultLeg(route: FulfilmentRoute, stage: LineStage): ShipmentLeg {
  if (route === "direct_ship") return "direct";
  if (route === "from_stock") return "outbound";
  return ROUTE_STAGES.via_warehouse.indexOf(stage) >= ROUTE_STAGES.via_warehouse.indexOf("received") ? "outbound" : "inbound";
}

// ── Status ──────────────────────────────────────────────────────────────────
export const SHIPMENT_STATUSES = ["pre_transit", "in_transit", "out_for_delivery", "delivered", "exception", "unknown"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pre_transit: "Booked, not collected yet",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Problem reported",
  unknown: "Not known yet",
};

export type Tone = "ok" | "warn" | "bad" | "neutral";

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, Tone> = {
  pre_transit: "neutral",
  in_transit: "neutral",
  out_for_delivery: "ok",
  delivered: "ok",
  exception: "bad",
  unknown: "warn",
};

export type ValueSource = "carrier" | "manual";

// ── Customs (spec §5.3; full customs handling is Phase 7) ──────────────────
export const CUSTOMS_STATUSES = ["not_required", "unknown", "in_progress", "held", "cleared"] as const;
export type CustomsStatus = (typeof CUSTOMS_STATUSES)[number];

export function isCustomsStatus(value: unknown): value is CustomsStatus {
  return typeof value === "string" && (CUSTOMS_STATUSES as readonly string[]).includes(value);
}

export const CUSTOMS_LABELS: Record<CustomsStatus, string> = {
  not_required: "Not needed",
  unknown: "Not known",
  in_progress: "In progress",
  held: "Held",
  cleared: "Cleared",
};

export const CUSTOMS_TONE: Record<CustomsStatus, Tone> = {
  not_required: "neutral",
  unknown: "warn",
  in_progress: "warn",
  held: "bad",
  cleared: "ok",
};

/** The business's own country. DEFAULT — CONFIRM: every organisation is UK-based in v1. */
export const HOME_COUNTRY = "GB";

/**
 * Does a delivery cross a customs border? Abroad, yes. Decision C6: a
 * GB → Northern Ireland movement (BT postcodes) counts too; Jersey, Guernsey
 * and the Isle of Man have their own country codes so are already abroad.
 */
export function isInternational(deliveryCountry: string, deliveryPostcode: string, home: string = HOME_COUNTRY): boolean {
  const country = deliveryCountry.trim().toUpperCase();
  if (country !== home) return true;
  return home === "GB" && /^BT\d/i.test(deliveryPostcode.trim());
}

const CUSTOMS_HELD =
  /\b(customs (hold|held|delay(ed)?|query|inspection|exception|issue)|held (by|at|in) customs|(awaiting|pending|requires?) (customs )?(clearance (documents|information)|documents|paperwork|payment of (duties|charges|import))|clearance (delay(ed)?|exception|event)|(duties|import (duties|charges|taxes)|duty) (and taxes )?(due|unpaid|outstanding))\b/i;
const CUSTOMS_CLEARED =
  /\b((customs )?clearance (is )?(complete(d)?|processing complete(d)?|successful)|cleared (customs|through customs|by customs)|released (by|from) customs|customs (cleared|released|status updated - cleared))\b/i;
const CUSTOMS_ANY = /\b(customs|clearance|import scan|export scan|clearing agency|broker)\b/i;

/**
 * Customs status from a carrier's event wording. No carrier publishes a
 * customs code (spec §5.3), so this reads the words — the latest event that
 * mentions customs decides — and says "unknown" when nothing does.
 */
export function inferCustomsStatus(events: readonly { occurredAt: string; description: string }[]): CustomsStatus {
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let found: CustomsStatus = "unknown";
  for (const e of sorted) {
    if (CUSTOMS_HELD.test(e.description)) found = "held";
    else if (CUSTOMS_CLEARED.test(e.description)) found = "cleared";
    else if (CUSTOMS_ANY.test(e.description)) found = "in_progress";
  }
  return found;
}

const OUT_FOR_DELIVERY = /\b(out for delivery|with (the )?(delivery )?courier for delivery|on (the )?(vehicle|van) for delivery|with delivery courier)\b/i;

/** Carriers that don't report "out for delivery" as a status still say it in words (DHL, for one). */
export function refineStatus(status: ShipmentStatus, description: string | null): ShipmentStatus {
  if (status === "in_transit" && description && OUT_FOR_DELIVERY.test(description)) return "out_for_delivery";
  return status;
}

// ── Tracking numbers ────────────────────────────────────────────────────────
/** Upper-case, without spaces. Null when there's nothing usable. */
export function normaliseTrackingNumber(input: string): string | null {
  const n = input.replace(/[\s.]+/g, "").toUpperCase();
  return /^[A-Z0-9-]{4,40}$/.test(n) ? n : null;
}

// ── Applying a carrier snapshot ─────────────────────────────────────────────
export interface TrackingEventInput {
  occurredAt: string;
  status: ShipmentStatus;
  description: string;
  location: string | null;
}

/** What a carrier adapter reports for one shipment, already in COAST's terms. */
export interface TrackingSnapshot {
  status: ShipmentStatus;
  statusText: string | null;
  /** ISO dates; both null when the carrier doesn't say. */
  estimatedFrom: string | null;
  estimatedTo: string | null;
  deliveredAt: string | null;
  events: TrackingEventInput[];
}

export interface ShipmentState {
  status: ShipmentStatus;
  statusSource: ValueSource;
  isInternational: boolean;
  customsStatus: CustomsStatus;
  customsSource: ValueSource;
  /** Keys of events already stored. */
  eventKeys: ReadonlySet<string>;
  /** Every stored event, for customs wording. */
  events: readonly { occurredAt: string; description: string }[];
}

export interface SnapshotPatch {
  status: ShipmentStatus;
  statusText: string | null;
  estimatedFrom: string | null;
  estimatedTo: string | null;
  deliveredAt: string | null;
  customsStatus: CustomsStatus;
}

export interface SnapshotOutcome {
  patch: SnapshotPatch;
  newEvents: (TrackingEventInput & { key: string })[];
  statusChange: { from: ShipmentStatus; to: ShipmentStatus } | null;
}

/** Stable identity for a carrier event, so polling twice never stores it twice. */
export function eventKey(e: { occurredAt: string; description: string }): string {
  const t = Date.parse(e.occurredAt);
  const when = Number.isNaN(t) ? e.occurredAt : new Date(t).toISOString();
  return `${when}|${e.description.trim().toLowerCase().replace(/\s+/g, " ")}`.slice(0, 600);
}

/**
 * Fold a fresh carrier snapshot into a shipment. Manual values are sticky
 * (non-negotiable 3): a status or customs status set by a person stays until
 * a person hands it back to the carrier; new events are still recorded.
 * A carrier answering "unknown" never wipes out a status it reported before.
 */
export function applySnapshot(current: ShipmentState, snap: TrackingSnapshot): SnapshotOutcome {
  const seen = new Set(current.eventKeys);
  const newEvents: SnapshotOutcome["newEvents"] = [];
  for (const e of snap.events) {
    if (!e.description.trim() || Number.isNaN(Date.parse(e.occurredAt))) continue;
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    newEvents.push({ ...e, description: e.description.trim().slice(0, 500), location: e.location?.trim().slice(0, 200) || null, key });
  }

  let status = current.status;
  if (current.statusSource === "carrier" && !(snap.status === "unknown" && current.status !== "unknown")) status = snap.status;

  let customsStatus = current.customsStatus;
  if (current.isInternational && current.customsSource === "carrier") {
    const inferred = inferCustomsStatus([...current.events, ...newEvents]);
    // Delivered across a border means it cleared — a fact, not a guess.
    customsStatus = inferred === "unknown" && snap.status === "delivered" ? "cleared" : inferred;
  }

  const deliveredAt =
    snap.deliveredAt ??
    (snap.status === "delivered"
      ? ([...snap.events].filter((e) => e.status === "delivered").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt ?? null)
      : null);

  return {
    patch: {
      status,
      statusText: snap.statusText?.trim().slice(0, 300) || null,
      estimatedFrom: snap.estimatedFrom,
      estimatedTo: snap.estimatedTo ?? snap.estimatedFrom,
      deliveredAt: status === "delivered" ? deliveredAt : null,
      customsStatus,
    },
    newEvents,
    statusChange: status !== current.status ? { from: current.status, to: status } : null,
  };
}

// ── Moving order lines along with their shipment ────────────────────────────
/**
 * The stage a shipment's status puts its lines at, or null for "no change".
 * Lines only ever move forward this way; a person can still move them by
 * hand. Inbound deliveries stop at "In transit to us" — goods-in confirms
 * receipt (Phase 6).
 */
export function lineStageForShipment(route: FulfilmentRoute, current: LineStage, leg: ShipmentLeg, status: ShipmentStatus): LineStage | null {
  if (current === "delivered" || current === "cancelled") return null;
  if (!ROUTE_LEGS[route].includes(leg)) return null;

  let target: LineStage | null = null;
  if (leg === "inbound") {
    if (status === "in_transit" || status === "out_for_delivery" || status === "delivered") target = "inbound";
  } else if (status === "in_transit" || status === "out_for_delivery") target = "in_transit";
  else if (status === "delivered") target = "delivered";

  if (!target) return null;
  const seq = ROUTE_STAGES[route];
  const from = seq.indexOf(current);
  const to = seq.indexOf(target);
  return to > from ? target : null;
}

// ── Adding a shipment ───────────────────────────────────────────────────────
export interface ShipmentLineOption {
  id: string;
  route: FulfilmentRoute;
  stage: LineStage;
  quantity: number;
}

export interface NewShipmentInput {
  leg: string;
  carrier: string;
  trackingNumber: string;
  lineIds: readonly string[];
  note: string;
}

export interface ValidShipment {
  leg: ShipmentLeg;
  carrier: CarrierKey;
  trackingNumber: string | null;
  lineIds: string[];
  note: string | null;
}

export type ShipmentErrors = Partial<Record<"leg" | "carrier" | "trackingNumber" | "lines" | "note", string>>;

/** Carriers that never have a tracking number to look up. */
export function carrierNeedsTrackingNumber(carrier: CarrierKey): boolean {
  return carrier !== "other";
}

export function validateNewShipment(
  input: NewShipmentInput,
  lines: readonly ShipmentLineOption[],
  options: { allowedCarriers?: readonly CarrierKey[] } = {},
): { ok: true; value: ValidShipment } | { ok: false; errors: ShipmentErrors } {
  const errors: ShipmentErrors = {};
  const allowed = options.allowedCarriers ?? CARRIER_KEYS;

  const leg = isShipmentLeg(input.leg) ? input.leg : null;
  if (!leg) errors.leg = "Choose where this shipment is going.";

  const carrier = isCarrierKey(input.carrier) && allowed.includes(input.carrier) ? input.carrier : null;
  if (!carrier) errors.carrier = "Choose a carrier.";

  let trackingNumber: string | null = null;
  if (input.trackingNumber.trim()) {
    trackingNumber = normaliseTrackingNumber(input.trackingNumber);
    if (!trackingNumber) errors.trackingNumber = "That doesn't look like a tracking number: use 4–40 letters, numbers or dashes.";
  } else if (carrier && carrierNeedsTrackingNumber(carrier)) {
    errors.trackingNumber = "Enter the tracking number.";
  }

  const ids = [...new Set(input.lineIds)];
  if (ids.length === 0) errors.lines = "Choose at least one line.";
  for (const id of ids) {
    const line = lines.find((l) => l.id === id);
    if (!line) {
      errors.lines = "One of those lines isn't on this order.";
      break;
    }
    if (line.stage === "cancelled" || line.stage === "delivered") {
      errors.lines = "Delivered or cancelled lines can't go on a new shipment.";
      break;
    }
    if (leg && !ROUTE_LEGS[line.route].includes(leg)) {
      errors.lines = `A ${LEG_LABELS[leg].toLowerCase()} shipment can't carry a line that's fulfilled another way.`;
      break;
    }
  }

  const note = input.note.trim();
  if (note.length > 1000) errors.note = "Keep the note under 1,000 characters.";

  if (Object.keys(errors).length > 0 || !leg || !carrier) return { ok: false, errors };
  return { ok: true, value: { leg, carrier, trackingNumber, lineIds: ids, note: note || null } };
}

/** Delivered shipments are finished; everything else is still worth checking. */
export function isShipmentLive(status: ShipmentStatus): boolean {
  return status !== "delivered";
}

/** "14–17 Oct" style range for an ETA, or null when there's none. */
export function etaRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from && !to) return null;
  const a = from ?? to!;
  const b = to ?? from!;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
