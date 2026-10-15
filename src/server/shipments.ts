import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lastCronRun, type CronRun } from "@/lib/data/cron";
import type { PoDetail } from "@/lib/data/procurement";
import { DuplicateError } from "@/lib/data/orders";
import { createShipment, getShipment, listCarrierActivity, listCarrierSettings, listShipmentLines, listShipments, listTrackingEvents, type ShipmentRow } from "@/lib/data/shipments";
import { listStaffInOrg } from "@/lib/data/staff";
import { CARRIERS, NO_ACTIVITY, carrierHealth, getCarrier, guessCarrier, hasLiveAdapter, selectableCarriers, trackableCarriers, type CarrierKey } from "@/lib/logic/carriers";
import { formatDateTime, formatIsoDate } from "@/lib/logic/format";
import type { HealthStatus } from "@/lib/logic/health";
import { canAccessSection } from "@/lib/logic/navigation";
import { stageLabel, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import { hasPermission } from "@/lib/logic/permissions";
import {
  CUSTOMS_LABELS,
  CUSTOMS_TONE,
  LEG_LABELS,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONE,
  defaultLeg,
  etaRange,
  normaliseTrackingNumber,
  type CustomsStatus,
  type ShipmentLeg,
  type ShipmentStatus,
  type Tone,
} from "@/lib/logic/shipments";
import { canCheckNow } from "@/lib/logic/tracking-poll";
import { getCustomsSettings, listCustomsDocuments } from "@/lib/data/problems";
import { DOC_LABELS, DOC_TYPES, borderCheck, linesMissingHsCode, needsCustomsAttention, requiredDocuments, type DocType } from "@/lib/logic/customs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff, type StaffContext } from "./session";

/** Loaders for shipments: the Shipments screen, one shipment, the order page panel, carrier connections. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

const today = () => new Date().toISOString().slice(0, 10);

export function formatEta(from: string | null, to: string | null): string | null {
  const r = etaRange(from, to);
  if (!r) return null;
  return r.from === r.to ? formatIsoDate(r.from) : `${formatIsoDate(r.from)} – ${formatIsoDate(r.to)}`;
}

export interface ShipmentItem {
  id: string;
  orderId: string;
  soNumber: string;
  customerName: string;
  leg: ShipmentLeg;
  legLabel: string;
  carrier: CarrierKey;
  carrierLabel: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  statusLabel: string;
  tone: Tone;
  statusText: string | null;
  manual: boolean;
  eta: string | null;
  delivered: string | null;
  customs: { label: string; tone: Tone; manual: boolean } | null;
  lastChecked: string | null;
  checkProblem: string | null;
  /** COAST checks this one with the carrier by itself. */
  live: boolean;
  needsAttention: boolean;
  /** Mainland → Northern Ireland / the islands, and nobody has said whether customs applies yet (C6). */
  customsToConfirm: boolean;
}

function toItem(s: ShipmentRow): ShipmentItem {
  const def = getCarrier(s.carrier);
  const live = hasLiveAdapter(s.carrier) && s.trackingNumber !== null;
  const customsProblem = s.isInternational && (s.customsStatus === "held" || s.customsStatus === "unknown");
  const customsToConfirm = s.leg !== "inbound" && s.status !== "delivered" && !s.customsConfirmed && borderCheck(s.deliveryCountry, s.deliveryPostcode, true).territory;
  return {
    id: s.id,
    orderId: s.salesOrderId,
    soNumber: s.soNumber,
    customerName: s.customerName,
    leg: s.leg,
    legLabel: LEG_LABELS[s.leg],
    carrier: s.carrier,
    carrierLabel: def.label,
    trackingNumber: s.trackingNumber,
    trackingUrl: s.trackingNumber && def.trackingUrl ? def.trackingUrl(s.trackingNumber) : null,
    status: s.status,
    statusLabel: SHIPMENT_STATUS_LABELS[s.status],
    tone: SHIPMENT_STATUS_TONE[s.status],
    statusText: s.statusText,
    manual: s.statusSource === "manual",
    eta: s.status === "delivered" ? null : formatEta(s.estimatedFrom, s.estimatedTo),
    delivered: s.deliveredAt ? formatDateTime(new Date(s.deliveredAt)) : null,
    customs: s.isInternational ? { label: CUSTOMS_LABELS[s.customsStatus], tone: CUSTOMS_TONE[s.customsStatus], manual: s.customsSource === "manual" } : null,
    lastChecked: s.poll.lastPolledAt ? formatDateTime(new Date(s.poll.lastPolledAt)) : null,
    checkProblem: s.poll.failures > 0 ? s.poll.lastError : null,
    live,
    needsAttention: s.status === "exception" || s.carrier === "unknown" || (customsProblem && s.status !== "delivered") || customsToConfirm || s.poll.failures >= 3,
    customsToConfirm,
  };
}

// ── Shipments screen ────────────────────────────────────────────────────────
export const SHIPMENT_VIEWS = ["live", "attention", "customs", "delivered", "all"] as const;
export type ShipmentView = (typeof SHIPMENT_VIEWS)[number];
export const SHIPMENT_VIEW_LABELS: Record<ShipmentView, string> = { live: "On the way", attention: "Needs attention", customs: "Customs", delivered: "Delivered", all: "All" };

function parseView(v: string | undefined): ShipmentView {
  return (SHIPMENT_VIEWS as readonly string[]).includes(v ?? "") ? (v as ShipmentView) : "live";
}

function inView(s: ShipmentItem, view: ShipmentView): boolean {
  if (view === "live") return s.status !== "delivered";
  if (view === "attention") return s.needsAttention;
  if (view === "customs") return s.status !== "delivered" && (s.customs !== null || s.customsToConfirm);
  if (view === "delivered") return s.status === "delivered";
  return true;
}

export interface ShipmentsView {
  view: ShipmentView;
  q: string;
  counts: Record<ShipmentView, number>;
  shipments: ShipmentItem[];
  /** Supplier legs are hidden from this person (E1). */
  supplierLegsHidden: boolean;
}

export async function loadShipments(params: { view?: string; q?: string }): Promise<ShipmentsView> {
  const staff = await requireStaff({ section: "shipments" });
  const view = parseView(params.view);
  const q = (params.q ?? "").trim().slice(0, 100);
  const all = (await listShipments(await client())).map(toItem);
  const needle = q.toUpperCase().replace(/\s+/g, "");
  const matching = needle
    ? all.filter((s) => (s.trackingNumber ?? "").includes(needle) || s.soNumber.toUpperCase().includes(needle) || s.customerName.toUpperCase().replace(/\s+/g, "").includes(needle))
    : all;
  const counts = Object.fromEntries(SHIPMENT_VIEWS.map((v) => [v, matching.filter((s) => inView(s, v)).length])) as Record<ShipmentView, number>;
  return { view, q, counts, shipments: matching.filter((s) => inView(s, view)), supplierLegsHidden: !hasPermission(staff.permissions, "supplier.identity.view") };
}

// ── One shipment ────────────────────────────────────────────────────────────
export interface ShipmentPage {
  shipment: ShipmentItem;
  lines: { id: string; label: string; stage: string }[];
  events: { id: number; when: string; status: string; tone: Tone; description: string; location: string | null; source: string }[];
  note: string | null;
  createdAt: string;
  createdBy: string;
  nextCheck: string | null;
  can: { manage: boolean; checkNow: boolean; openOrder: boolean };
  checkNowReason: string | null;
  statusOptions: { value: ShipmentStatus; label: string }[];
  customsOptions: { value: CustomsStatus; label: string }[];
  carriers: { key: CarrierKey; label: string }[];
  customs: ShipmentCustoms | null;
}

/** Customs on one shipment (spec §5.3): does it apply, which documents, what's missing. */
export interface ShipmentCustoms {
  applies: boolean;
  /** Mainland → Northern Ireland or the islands: a person confirms (C6). */
  territory: boolean;
  confirmed: boolean;
  docs: { type: DocType; label: string; required: boolean; received: string | null; note: string | null }[];
  outstanding: number;
  missingHsCodes: number[];
  ourEori: string | null;
  customer: { id: string; name: string; eori: string | null } | null;
  needsAttention: boolean;
}

async function loadCustomsFor(supabase: SupabaseClient, row: ShipmentRow, names: Map<string, string>): Promise<ShipmentCustoms | null> {
  if (row.leg === "inbound" && !row.isInternational) return null;
  const settings = await getCustomsSettings(supabase);
  const border = row.leg === "inbound" ? { international: row.isInternational, territory: false } : borderCheck(row.deliveryCountry, row.deliveryPostcode, settings.territoriesNeedCustoms);
  if (!row.isInternational && !border.territory) return null;
  const [stored, lines, order] = await Promise.all([
    listCustomsDocuments(supabase, row.id),
    row.lineIds.length
      ? supabase.from("order_lines").select("line_no, hs_code, country_of_origin, dangerous_goods").in("id", row.lineIds).returns<{ line_no: number; hs_code: string | null; country_of_origin: string | null; dangerous_goods: string | null }[]>()
      : Promise.resolve({ data: [] as { line_no: number; hs_code: string | null; country_of_origin: string | null; dangerous_goods: string | null }[] }),
    supabase.from("sales_orders").select("customers(id, name, eori)").eq("id", row.salesOrderId).maybeSingle<{ customers: { id: string; name: string; eori: string | null } | null }>(),
  ]);
  const facts = (lines.data ?? []).map((l) => ({ lineNo: l.line_no, hsCode: l.hs_code, countryOfOrigin: l.country_of_origin, dangerousGoods: l.dangerous_goods }));
  // The suggested checklist, with anything a person has set taking precedence.
  const suggested = new Set(row.isInternational ? requiredDocuments(row.leg, facts) : []);
  const byType = new Map(stored.map((d) => [d.docType, d]));
  const docs = DOC_TYPES.filter((t) => suggested.has(t) || byType.has(t)).map((t) => {
    const s = byType.get(t);
    return {
      type: t,
      label: DOC_LABELS[t],
      required: s ? s.required : true,
      received: s?.receivedAt ? `${formatDateTime(new Date(s.receivedAt))}${s.receivedBy ? ` · ${names.get(s.receivedBy) ?? "someone"}` : ""}` : null,
      note: s?.note ?? null,
    };
  });
  const outstanding = docs.filter((d) => d.required && !d.received).length;
  const territoryUnconfirmed = border.territory && !row.customsConfirmed;
  return {
    applies: row.isInternational,
    territory: border.territory,
    confirmed: row.customsConfirmed,
    docs: row.isInternational ? docs : [],
    outstanding: row.isInternational ? outstanding : 0,
    missingHsCodes: row.isInternational ? linesMissingHsCode(facts) : [],
    ourEori: settings.eori,
    customer: order.data?.customers ?? null,
    needsAttention: needsCustomsAttention({ international: row.isInternational, delivered: row.status === "delivered", customsStatus: row.customsStatus, territoryUnconfirmed, outstandingDocs: outstanding }),
  };
}

export async function loadShipment(id: string): Promise<ShipmentPage | null> {
  const staff = await requireStaff({ section: "shipments" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await client();
  const row = await getShipment(supabase, id);
  if (!row) return null;
  const [events, lines, team, activity] = await Promise.all([
    listTrackingEvents(supabase, id),
    listShipmentLineLabels(supabase, id),
    listStaffInOrg(supabase),
    listCarrierActivity(supabase, today()),
  ]);
  const names = new Map(team.map((p) => [p.id, p.fullName]));
  const item = toItem(row);
  const manage = hasPermission(staff.permissions, "shipments.manage");
  const def = getCarrier(row.carrier);
  const reason = !item.live
    ? row.trackingNumber
      ? `${def.label} can't be checked automatically yet.`
      : "There's no tracking number to check."
    : !canCheckNow(def.pacing, (activity[row.carrier] ?? NO_ACTIVITY).callsToday)
      ? `Today's ${def.label} limit is used up. Checks start again tomorrow.`
      : null;
  const notConfigured = item.live && carrierHealth(def, process.env, activity[row.carrier]).status === "unconfigured";

  return {
    shipment: item,
    lines,
    events: events.map((e) => ({
      id: e.id,
      when: formatDateTime(new Date(e.occurredAt)),
      status: SHIPMENT_STATUS_LABELS[e.status],
      tone: SHIPMENT_STATUS_TONE[e.status],
      description: e.description,
      location: e.location,
      source: e.source === "manual" ? (e.createdBy ? (names.get(e.createdBy) ?? "Someone") : "Someone") : def.label,
    })),
    note: row.note,
    createdAt: formatDateTime(new Date(row.createdAt)),
    createdBy: row.createdBy ? (names.get(row.createdBy) ?? "Someone") : "COAST",
    nextCheck: row.poll.nextPollAt ? formatDateTime(new Date(row.poll.nextPollAt)) : null,
    can: { manage, checkNow: manage && !reason && !notConfigured, openOrder: canAccessSection(staff.permissions, "orders") },
    checkNowReason: notConfigured ? `${def.label} isn't connected yet, so COAST can't check it.` : reason,
    statusOptions: SHIPMENT_STATUSES.map((s) => ({ value: s, label: SHIPMENT_STATUS_LABELS[s] })),
    customsOptions: (["unknown", "in_progress", "held", "cleared"] as const).map((c) => ({ value: c, label: CUSTOMS_LABELS[c] })),
    carriers: carrierOptions(),
    customs: await loadCustomsFor(supabase, row, names),
  };
}

async function listShipmentLineLabels(supabase: SupabaseClient, shipmentId: string) {
  return (await listShipmentLines(supabase, shipmentId)).map((l) => ({ id: l.id, label: `Line ${l.lineNo} · ${l.description}`, stage: stageLabel(l.stage, l.route) }));
}

function carrierOptions(): { key: CarrierKey; label: string }[] {
  return selectableCarriers(process.env.COAST_ENV).map((c) => ({ key: c.key, label: c.label }));
}

// ── Order page panel ────────────────────────────────────────────────────────
export interface OrderShipments {
  shipments: ShipmentItem[];
  canOpenShipments: boolean;
  /** null when this person can't add shipments. */
  form: {
    lines: { id: string; label: string; route: FulfilmentRoute; defaultLeg: ShipmentLeg }[];
    legs: { value: ShipmentLeg; label: string }[];
    carriers: { key: CarrierKey; label: string }[];
  } | null;
}

export async function loadOrderShipments(
  staff: StaffContext,
  supabase: SupabaseClient,
  orderId: string,
  lines: { id: string; lineNo: number; description: string; route: FulfilmentRoute; stage: LineStage }[],
): Promise<OrderShipments> {
  const shipments = (await listShipments(supabase, { orderId })).map(toItem);
  const canSeeSupplierLegs = hasPermission(staff.permissions, "supplier.identity.view");
  const canAdd = hasPermission(staff.permissions, "shipments.manage");
  const open = lines.filter((l) => l.stage !== "delivered" && l.stage !== "cancelled" && (canSeeSupplierLegs || l.route !== "direct_ship"));
  const legs = (Object.keys(LEG_LABELS) as ShipmentLeg[]).filter((leg) => canSeeSupplierLegs || leg === "outbound");
  return {
    shipments,
    canOpenShipments: canAccessSection(staff.permissions, "shipments"),
    form:
      canAdd && open.length > 0
        ? {
            lines: open.map((l) => ({ id: l.id, label: `Line ${l.lineNo} · ${l.description}`, route: l.route, defaultLeg: canSeeSupplierLegs ? defaultLeg(l.route, l.stage) : "outbound" })),
            legs: legs.map((value) => ({ value, label: LEG_LABELS[value] })),
            carriers: carrierOptions(),
          }
        : null,
  };
}

// ── Tracking numbers from a supplier's answer become shipments ──────────────
/**
 * Spec HowItWorks step 6: tracking numbers a supplier sends become live
 * shipments. One shipment per tracking number per order, on the PO's lines
 * for that order (direct-ship lines travel direct, warehouse lines inbound).
 * The carrier is guessed only from an unmistakable number shape; otherwise
 * it's "not known yet" and the Shipments screen asks a person to choose.
 */
export async function addSupplierShipments(db: SupabaseClient, po: PoDetail, trackingNumbers: readonly string[]): Promise<number> {
  const numbers = [...new Set(trackingNumbers.map(normaliseTrackingNumber).filter((n): n is string => n !== null))].slice(0, 10);
  if (numbers.length === 0) return 0;
  const groups = new Map<string, { orderId: string; leg: ShipmentLeg; lineIds: string[]; international: boolean }>();
  const customs = await getCustomsSettings(db);
  for (const l of po.lines) {
    if (!l.orderId || !l.orderLineId || l.stage === "delivered" || l.stage === "cancelled") continue;
    const leg: ShipmentLeg | null = l.route === "direct_ship" ? "direct" : l.route === "via_warehouse" ? "inbound" : null;
    if (!leg) continue;
    const key = `${l.orderId}|${leg}`;
    const g = groups.get(key) ?? { orderId: l.orderId, leg, lineIds: [], international: leg === "direct" && borderCheck(l.deliveryCountry, l.deliveryPostcode, customs.territoriesNeedCustoms).international };
    g.lineIds.push(l.orderLineId);
    groups.set(key, g);
  }
  let added = 0;
  for (const n of numbers) {
    const carrier = guessCarrier(n) ?? "unknown";
    for (const g of groups.values()) {
      try {
        await createShipment(
          db,
          g.orderId,
          { leg: g.leg, carrier, trackingNumber: n, lineIds: g.lineIds, note: "Added from the supplier's reply." },
          { isInternational: g.international, customsStatus: g.international ? "unknown" : "not_required" },
        );
        added++;
      } catch (e) {
        // Already on the order, or this person can't add shipments: the number stays visible on the answer.
        if (!(e instanceof DuplicateError)) console.warn("[shipments] couldn't add a supplier tracking number", e instanceof Error ? e.message : e);
      }
    }
  }
  return added;
}

// ── Carrier connections (Settings, sidebar) ─────────────────────────────────
export interface CarrierConnection {
  key: CarrierKey;
  label: string;
  monogram: string;
  beta: boolean;
  status: HealthStatus;
  reason: string;
  claimWindowDays: number | null;
  usage: string | null;
}

export interface CarrierConnectionsView {
  carriers: CarrierConnection[];
  lastRun: CronRun | null;
  lastRunLabel: string;
  canEdit: boolean;
}

export async function loadCarrierConnections(staff: StaffContext): Promise<CarrierConnectionsView> {
  const supabase = await client();
  const [activity, settings, lastRun] = await Promise.all([listCarrierActivity(supabase, today()), listCarrierSettings(supabase), lastCronRun(supabase, "tracking-poll")]);
  const carriers = trackableCarriers(process.env.COAST_ENV).map((def) => {
    const a = activity[def.key] ?? NO_ACTIVITY;
    const h = carrierHealth(def, process.env, a);
    return {
      key: def.key,
      label: def.label,
      monogram: def.monogram,
      beta: def.confidence === "best_effort",
      status: h.status,
      reason: h.reason,
      claimWindowDays: settings[def.key]?.claimWindowDays ?? null,
      usage: def.pacing.dailyLimit !== null && h.status !== "unconfigured" ? `${a.callsToday} of ${def.pacing.dailyLimit} checks used today` : null,
    };
  });
  const lastRunLabel = !lastRun
    ? "The tracking schedule hasn't run yet."
    : `Last run ${formatDateTime(new Date(lastRun.startedAt))}${lastRun.outcome === "ok" ? "" : lastRun.outcome === "partial" ? " · some checks failed" : lastRun.outcome === "error" ? " · it failed" : " · still running"}.`;
  return { carriers, lastRun, lastRunLabel, canEdit: hasPermission(staff.permissions, "settings.edit") };
}

/** "● 3 healthy · ● 1 check" for the sidebar card (App.dc.html). Only carriers that are set up count. */
export async function carrierSummary(): Promise<{ healthy: number; check: number; total: number } | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const activity = await listCarrierActivity(supabase, today()).catch(() => ({}) as Awaited<ReturnType<typeof listCarrierActivity>>);
  const set = trackableCarriers(process.env.COAST_ENV)
    .filter((d) => d.confidence !== "test")
    .map((d) => carrierHealth(d, process.env, activity[d.key]))
    .filter((h) => h.status !== "unconfigured");
  return { healthy: set.filter((h) => h.status === "ok").length, check: set.filter((h) => h.status !== "ok").length, total: CARRIERS.length };
}

