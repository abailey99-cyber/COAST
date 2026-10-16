/**
 * The masking layer (CLAUDE.md non-negotiable 1, spec §2 and §9.3).
 *
 * Customer-facing code only ever receives a CustomerOrderView. That type has
 * no field for a supplier name, PO number, cost, internal note, or where a
 * direct shipment came from — so no screen or email built from it can leak
 * one. `toCustomerView` is the only function that builds it from the raw
 * internal record. `findLeaks` checks free text (a staff reply, or the
 * finished view itself) for any real supplier name or PO number.
 *
 * Pure: "now" is passed in.
 */

import { formatRange } from "./prediction";
import type { FulfilmentRoute, LineStage } from "./orders";
import type { CarrierKey } from "./carriers";
import { getCarrier } from "./carriers";
import type { ShipmentLeg, ShipmentStatus } from "./shipments";
import { CUSTOMER_CUSTOMS_LINE } from "./customs";
import { CATEGORY_LABELS, customerStatus, isCategory, isOpen, isProblemStatus, type ProblemStatus } from "./problems";

// ── Customer stages (decision B6) ───────────────────────────────────────────
export const CUSTOMER_STAGES = ["Ordered", "Confirmed", "Dispatched", "In transit", "Delivered"] as const;
export type CustomerStageIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Where a line is, in the customer's five stages. The warehouse leg
 * ("In transit to us", "Received") shows as Confirmed — the customer never
 * sees that goods came from somewhere else first. From stock skips
 * Confirmed (shown as done once picked).
 */
export function customerStage(route: FulfilmentRoute, stage: LineStage): CustomerStageIndex | null {
  switch (stage) {
    case "cancelled":
      return null;
    case "ordered":
    case "po_sent":
      return 0;
    case "confirmed":
    case "inbound":
    case "received":
    case "picked":
      return 1;
    case "dispatched":
      return 2;
    case "in_transit":
      return 3;
    case "delivered":
      return 4;
  }
  void route;
}

/** The order as a whole is as far along as its least-advanced live line. */
export function orderCustomerStage(lines: readonly { route: FulfilmentRoute; stage: LineStage }[]): CustomerStageIndex | null {
  const stages = lines.map((l) => customerStage(l.route, l.stage)).filter((s): s is CustomerStageIndex => s !== null);
  if (stages.length === 0) return null;
  return Math.min(...stages) as CustomerStageIndex;
}

// ── The raw input: everything the masker is allowed to read ─────────────────
export interface RawCustomerOrder {
  org: {
    displayName: string;
    logoUrl: string | null;
    /** What a supplier is called to a customer (decision B8), e.g. "shipper". */
    supplierWord: string;
    /** Spec §5.7: show a direct shipment's carrier and tracking number to the customer? */
    showDirectCarrier: boolean;
  };
  order: {
    soNumber: string;
    customerName: string;
    customerReference: string | null;
    createdAt: string;
    promisedDate: string | null;
    salesRepName: string | null;
    delivery: { name: string; line1: string; line2: string | null; town: string; postcode: string; country: string };
    /** Internal only. Never copied into the view. */
    internalNotes: string | null;
  };
  lines: {
    lineNo: number;
    description: string;
    quantity: number;
    route: FulfilmentRoute;
    stage: LineStage;
    /** Internal only. */
    supplierName: string | null;
    poNumber: string | null;
    unitCostMinor: number | null;
  }[];
  prediction: { from: string | null; to: string | null; confidence: "confirmed" | "estimate" | "unknown"; source: string; atRisk: boolean | null } | null;
  shipments: {
    leg: ShipmentLeg;
    carrier: CarrierKey;
    trackingNumber: string | null;
    status: ShipmentStatus;
    deliveredAt: string | null;
    /** Crossing a border and held at customs (decision C7: the customer gets one fixed line, nothing more). */
    customsHeld?: boolean;
  }[];
  /** Delivery problems on the order. Only the category, status and date of the customer's own reports ever reach the view. */
  problems?: {
    id: string;
    raisedVia: "customer" | "carrier" | "goods_in" | "staff";
    category: string;
    status: string;
    createdAt: string;
    /** Internal only. */
    rootCause?: string | null;
    resolutionNote?: string | null;
  }[];
  /** The order's history (order_events), oldest first. */
  events: { id: number; kind: string; detail: Record<string, unknown>; createdAt: string }[];
  messages: { id: string; from: "customer" | "staff"; authorName: string | null; body: string; createdAt: string }[];
  /** For the leak check. */
  secrets: { supplierNames: string[]; poNumbers: string[] };
}

// ── The masked output: the only thing customer code may touch ───────────────
export type Badge = { kind: "carrier"; label: string } | { kind: "shipper"; label: string } | null;

export interface CustomerUpdate {
  id: string;
  at: string;
  title: string;
  badge: Badge;
  /** e.g. "Tracking 1Z999…", "shown as a range until confirmed". */
  detail: string | null;
  current: boolean;
}

export interface CustomerOrderView {
  branding: { displayName: string; logoUrl: string | null };
  soNumber: string;
  customerReference: string | null;
  placedAt: string;
  /** "Arriving Thursday 16 October" style headline. */
  headline: { kind: "arriving" | "estimated" | "delivered" | "unknown" | "cancelled"; from: string | null; to: string | null };
  status: { label: string; tone: "ok" | "warn" | "neutral" };
  stage: CustomerStageIndex | null;
  /** One sentence for the progress card. */
  latest: string;
  lastUpdated: string;
  updates: CustomerUpdate[];
  lines: { lineNo: number; description: string; quantity: number }[];
  deliverTo: string[];
  /** Decision C7: "Customs checks in progress — we're on it." while a delivery is held; otherwise null. */
  customsNote: string | null;
  /** The customer's own problem reports: what, when, and a customer-safe status (spec §5.4). */
  problems: { id: string; what: string; status: string; reportedAt: string; open: boolean }[];
  repName: string | null;
  tracking: { carrier: string; trackingNumber: string | null; trackingUrl: string | null }[];
  messages: { id: string; from: "you" | "us"; name: string | null; body: string; at: string }[];
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

const STATUS_WORDS: Partial<Record<ShipmentStatus, string>> = {
  pre_transit: "Dispatch booked",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Delivery problem reported",
};

function shown(sh: RawCustomerOrder["shipments"][number], org: RawCustomerOrder["org"]): boolean {
  return sh.leg === "outbound" || (sh.leg === "direct" && org.showDirectCarrier);
}

/**
 * The one raw → masked conversion. Everything a customer sees is built
 * here, from fields chosen one by one — nothing is copied across wholesale.
 */
export function toCustomerView(raw: RawCustomerOrder, now: Date): CustomerOrderView {
  const live = raw.lines.filter((l) => l.stage !== "cancelled");
  const stage = orderCustomerStage(live);
  const delivered = live.length > 0 && live.every((l) => l.stage === "delivered");
  const cancelled = live.length === 0 && raw.lines.length > 0;
  const word = raw.org.supplierWord.trim() || "shipper";
  const shipperBadge: Badge = { kind: "shipper", label: `${word.toUpperCase()} UPDATE` };

  // Headline and status.
  const p = raw.prediction;
  let headline: CustomerOrderView["headline"];
  if (cancelled) headline = { kind: "cancelled", from: null, to: null };
  else if (delivered) {
    const last = raw.shipments.filter((s) => s.leg !== "inbound" && s.deliveredAt).map((s) => s.deliveredAt!.slice(0, 10)).sort().at(-1) ?? null;
    headline = { kind: "delivered", from: last, to: last };
  } else if (p?.from) headline = { kind: p.confidence === "confirmed" ? "arriving" : "estimated", from: p.from, to: p.to };
  else headline = { kind: "unknown", from: null, to: null };

  const late = !delivered && !cancelled && p?.atRisk === true;
  const stageWord = stage === null ? "Cancelled" : CUSTOMER_STAGES[stage];
  const status: CustomerOrderView["status"] = cancelled
    ? { label: "Cancelled", tone: "neutral" }
    : delivered
      ? { label: "Delivered", tone: "ok" }
      : late
        ? { label: `${stageWord} · may be later than planned`, tone: "warn" }
        : { label: `${stageWord}${p?.from ? " · on track" : ""}`, tone: p?.from ? "ok" : "neutral" };

  // Timeline: from the order's history, mapped one kind at a time; anything
  // not listed here (POs, chases, internal edits) never reaches the customer.
  const updates: CustomerUpdate[] = [];
  let confirmedShown = false;
  for (const e of raw.events) {
    const id = `e${e.id}`;
    switch (e.kind) {
      case "order_created":
        updates.push({ id, at: e.createdAt, title: "Order received", badge: null, detail: null, current: false });
        break;
      case "supplier_responded":
      case "po_status_changed": {
        const confirmedNow = e.kind === "po_status_changed" ? e.detail.to === "confirmed" : e.detail.status === "applied" || e.detail.status === "accepted";
        if (confirmedNow && !confirmedShown) {
          confirmedShown = true;
          updates.push({ id, at: e.createdAt, title: "Order confirmed", badge: shipperBadge, detail: null, current: false });
        }
        break;
      }
      case "prediction_changed": {
        const from = typeof e.detail.from === "string" ? e.detail.from : null;
        const to = typeof e.detail.to === "string" ? e.detail.to : null;
        if (!from) break;
        const range = formatRange(from, to);
        if (e.detail.source === "supplier_confirmed" && from === to) {
          updates.push({ id, at: e.createdAt, title: `Delivery date confirmed: ${longDate(from).replace(/^\w+ /, "")}`, badge: shipperBadge, detail: null, current: false });
        } else if (e.detail.confidence === "confirmed" && from === to) {
          updates.push({ id, at: e.createdAt, title: `Delivery date: ${longDate(from)}`, badge: null, detail: null, current: false });
        } else {
          updates.push({ id, at: e.createdAt, title: `Estimated ${range}`, badge: null, detail: "shown as a range until confirmed", current: false });
        }
        break;
      }
      case "shipment_status_changed": {
        const leg = e.detail.leg;
        if (leg === "inbound") break; // the customer never sees goods coming to us
        const to = e.detail.to as ShipmentStatus;
        const title = STATUS_WORDS[to];
        if (!title) break;
        const carrierKey = e.detail.carrier as CarrierKey;
        const named = (leg === "outbound" || raw.org.showDirectCarrier) && carrierKey !== "other" && carrierKey !== "unknown";
        let badge: Badge = null;
        if (named) {
          try {
            badge = { kind: "carrier", label: `CARRIER · ${getCarrier(carrierKey).label.toUpperCase()}` };
          } catch {
            badge = null;
          }
        } else if (leg === "direct") badge = shipperBadge;
        updates.push({ id, at: e.createdAt, title, badge, detail: null, current: false });
        break;
      }
      default:
        break; // POs, emails, chases, internal edits: never shown to a customer
    }
  }
  updates.sort((a, b) => b.at.localeCompare(a.at));
  if (updates[0]) updates[0].current = true;

  const latest = cancelled
    ? "This order has been cancelled."
    : delivered
      ? `Your order has been delivered${headline.from ? ` on ${longDate(headline.from)}` : ""}.`
      : headlineSentence(stage, headline, late);

  const lastUpdated = [raw.order.createdAt, ...raw.events.map((e) => e.createdAt), ...raw.messages.map((m) => m.createdAt)].sort().at(-1) ?? raw.order.createdAt;

  const d = raw.order.delivery;
  const view: CustomerOrderView = {
    branding: { displayName: raw.org.displayName, logoUrl: raw.org.logoUrl },
    soNumber: raw.order.soNumber,
    customerReference: raw.order.customerReference,
    placedAt: raw.order.createdAt,
    headline,
    status,
    stage: cancelled ? null : delivered ? 4 : stage,
    latest,
    lastUpdated,
    updates,
    lines: [...live].sort((a, b) => a.lineNo - b.lineNo).map((l) => ({ lineNo: l.lineNo, description: l.description, quantity: l.quantity })),
    customsNote: !delivered && !cancelled && raw.shipments.some((s) => s.leg !== "inbound" && s.customsHeld === true && s.status !== "delivered") ? CUSTOMER_CUSTOMS_LINE : null,
    problems: (raw.problems ?? [])
      .filter((x) => x.raisedVia === "customer" && isProblemStatus(x.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((x) => {
        const status = x.status as ProblemStatus;
        return { id: x.id, what: isCategory(x.category) ? CATEGORY_LABELS[x.category] : CATEGORY_LABELS.other, status: customerStatus(status), reportedAt: x.createdAt, open: isOpen(status) };
      }),
    deliverTo: [d.name, d.line1, d.line2, d.town, d.postcode].filter((x): x is string => Boolean(x && x.trim())),
    repName: raw.order.salesRepName,
    tracking: raw.shipments
      .filter((s) => shown(s, raw.org) && s.carrier !== "unknown" && s.carrier !== "other")
      .map((s) => {
        const def = getCarrier(s.carrier);
        return {
          carrier: def.label,
          trackingNumber: s.trackingNumber,
          trackingUrl: s.trackingNumber && def.trackingUrl ? def.trackingUrl(s.trackingNumber) : null,
        };
      }),
    messages: raw.messages.map((m) => ({ id: m.id, from: m.from === "customer" ? "you" : "us", name: m.from === "staff" ? m.authorName : null, body: m.body, at: m.createdAt })),
  };
  void now;
  return view;
}

function headlineSentence(stage: CustomerStageIndex | null, h: CustomerOrderView["headline"], late: boolean): string {
  const when = h.from ? (h.kind === "arriving" ? `on ${longDate(h.from)}` : `between ${formatRange(h.from, h.to)}`) : null;
  const step =
    stage === 0
      ? "We've received your order"
      : stage === 1
        ? "Your order is confirmed"
        : stage === 2
          ? "Your order has been dispatched"
          : stage === 3
            ? "Your order is on its way"
            : "Your order is being prepared";
  if (!when) return `${step}. We'll show a delivery date as soon as we have one.`;
  if (late) return `${step}. It may arrive later than first planned — we're expecting it ${when}.`;
  return `${step} and is on schedule for delivery ${when}.`;
}

// ── Leak checks ─────────────────────────────────────────────────────────────
export interface Leak {
  kind: "supplier" | "po";
  value: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names too short or generic to scan for safely (they'd block ordinary words). */
function scannable(name: string): boolean {
  return name.replace(/[^A-Za-z0-9]/g, "").length >= 3;
}

/** Company endings people drop or swap ("Acme Widgets Ltd" → "Acme Widgets", "Acme Widgets Limited"). */
const COMPANY_SUFFIXES = ["ltd", "limited", "plc", "llp", "lp", "inc", "incorporated", "corp", "corporation", "co", "company", "group", "holdings", "uk", "gmbh", "bv", "sa", "srl", "sarl", "ag", "pty", "llc"];
const SUFFIX = `(?:[^A-Za-z0-9]{1,3}(?:${COMPANY_SUFFIXES.join("|")}))*`;

/** "&" and "and" are the same word for matching. */
const andWords = (s: string) => s.replace(/&/g, " and ");

/** A name's distinctive part, without its company ending; null when what's left is too short to scan safely. */
function coreName(words: readonly string[]): string[] | null {
  const core = [...words];
  while (core.length > 1 && COMPANY_SUFFIXES.includes(core.at(-1)!.toLowerCase())) core.pop();
  const letters = core.join("").length;
  // "Hull" alone would block a city; two words, or one long word, is distinctive enough.
  return core.length >= 2 || letters >= 6 ? core : null;
}

/**
 * Any real supplier name or PO number in `text` (CLAUDE.md non-negotiable 1).
 * Case-insensitive; names match as whole words, ignoring spacing and
 * punctuation ("Acme  Ltd", "ACME-LTD"), "&" written as "and", and the
 * company ending dropped or swapped ("Acme Widgets", "Acme Widgets
 * Limited"). PO numbers match with or without the dash, and written as
 * "P.O. 5017", "PO #5017" or "PO no. 5017".
 */
export function findLeaks(text: string, secrets: { supplierNames: readonly string[]; poNumbers: readonly string[] }): Leak[] {
  const leaks: Leak[] = [];
  const flat = andWords(text.normalize("NFKC"));
  for (const name of new Set(secrets.supplierNames.map((n) => n.trim()).filter(scannable))) {
    const words = andWords(name.normalize("NFKC")).split(/[^A-Za-z0-9]+/).filter(Boolean);
    const exact = new RegExp(`(^|[^A-Za-z0-9])${words.map(escapeRe).join("[^A-Za-z0-9]{0,3}")}(?![A-Za-z0-9])`, "i");
    const core = coreName(words);
    const variant = core ? new RegExp(`(^|[^A-Za-z0-9])${core.map(escapeRe).join("[^A-Za-z0-9]{0,3}")}${SUFFIX}(?![A-Za-z0-9])`, "i") : null;
    if (exact.test(flat) || variant?.test(flat)) leaks.push({ kind: "supplier", value: name });
  }
  for (const po of new Set(secrets.poNumbers.map((p) => p.trim()).filter(Boolean))) {
    const parts = po.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const plain = new RegExp(`(^|[^A-Za-z0-9])${parts.map(escapeRe).join("[^A-Za-z0-9]?")}(?![0-9])`, "i");
    // "PO-5017" also written "P.O. 5017", "PO #5017", "PO no. 5017", "PO number 5017".
    const m = po.match(/^P\W?O\W?(\d{3,})$/i);
    const spelled = m ? new RegExp(String.raw`(^|[^A-Za-z0-9])P\.?\s*O\.?\s*(?:#|no\.?|num(?:ber)?\.?)?\s*:?\s*` + m[1] + String.raw`(?![0-9])`, "i") : null;
    if (plain.test(flat) || spelled?.test(flat)) leaks.push({ kind: "po", value: po });
  }
  return leaks;
}

/** Plain-English reason a staff reply was blocked. */
export function describeLeaks(leaks: readonly Leak[], supplierWord = "supplier"): string {
  const names = leaks.filter((l) => l.kind === "supplier").map((l) => l.value);
  const pos = leaks.filter((l) => l.kind === "po").map((l) => l.value);
  const parts = [
    names.length ? `the ${supplierWord} name${names.length > 1 ? "s" : ""} ${names.map((n) => `“${n}”`).join(", ")}` : null,
    pos.length ? `the purchase order number${pos.length > 1 ? "s" : ""} ${pos.join(", ")}` : null,
  ].filter(Boolean);
  return `This message mentions ${parts.join(" and ")}. Customers must never see who supplies their order, so it wasn't sent. Take ${leaks.length > 1 ? "them" : "it"} out and try again.`;
}

/** Defence in depth: the finished view is scanned too, and refused if anything slipped through. */
export function assertViewIsClean(view: CustomerOrderView, secrets: RawCustomerOrder["secrets"]): void {
  const leaks = findLeaks(JSON.stringify(view), secrets);
  if (leaks.length > 0) throw new MaskingError(leaks);
}

export class MaskingError extends Error {
  constructor(public readonly leaks: Leak[]) {
    super("The customer view contained supplier details and was refused.");
    this.name = "MaskingError";
  }
}
