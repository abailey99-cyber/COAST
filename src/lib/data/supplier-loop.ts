import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCurrency, type Currency } from "@/lib/logic/format";
import type { Confidence } from "@/lib/logic/email-reading";
import type { EscalationThresholds } from "@/lib/logic/escalation";
import type { ConfirmedLine, ResponseLine, ResponseSource } from "@/lib/logic/supplier-response";
import type { WorkingCalendar } from "@/lib/logic/working-time";
import { DEFAULT_CALENDAR } from "@/lib/logic/working-time";

/**
 * Supplier emails, confirmation links, supplier answers and chases.
 * Reads and writes only. Staff calls use the signed-in client (RLS applies);
 * the public confirmation page passes the service-role client and is scoped
 * by a link hash.
 */

// ── Emails ──────────────────────────────────────────────────────────────────
export interface EmailRow {
  id: string;
  kind: "po" | "po_chase";
  toAddress: string;
  subject: string;
  bodyText: string;
  channel: string;
  status: "logged" | "sent" | "failed";
  createdAt: string;
}

export async function recordEmail(
  client: SupabaseClient,
  row: { orgId: string; kind: "po" | "po_chase"; purchaseOrderId: string; to: string; subject: string; text: string; html: string; channel: "log" | "m365"; status: "logged" | "sent" | "failed"; error?: string },
): Promise<void> {
  const { error } = await client.from("outbound_emails").insert({
    org_id: row.orgId,
    kind: row.kind,
    purchase_order_id: row.purchaseOrderId,
    to_address: row.to,
    subject: row.subject,
    body_text: row.text,
    body_html: row.html,
    channel: row.channel,
    status: row.status,
    error: row.error ?? null,
  });
  if (error) throw new Error(`Couldn't record the email: ${error.message}`);
}

export async function listEmailsForPo(client: SupabaseClient, poId: string): Promise<EmailRow[]> {
  const { data, error } = await client
    .from("outbound_emails")
    .select("id, kind, to_address, subject, body_text, channel, status, created_at")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: false })
    .returns<{ id: string; kind: EmailRow["kind"]; to_address: string; subject: string; body_text: string; channel: string; status: EmailRow["status"]; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load emails: ${error.message}`);
  return (data ?? []).map((e) => ({ id: e.id, kind: e.kind, toAddress: e.to_address, subject: e.subject, bodyText: e.body_text, channel: e.channel, status: e.status, createdAt: e.created_at }));
}

// ── Confirmation links ──────────────────────────────────────────────────────
export interface LinkRow {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  lastOpenedAt: string | null;
  createdAt: string;
}

/** Revokes any live links for the PO, then adds the new one (one live link per PO). */
export async function replaceLink(client: SupabaseClient, poId: string, userId: string, tokenHash: string, expiresAt: Date): Promise<string> {
  const now = new Date().toISOString();
  const revoke = await client.from("po_links").update({ revoked_at: now, revoked_by: userId }).eq("purchase_order_id", poId).is("revoked_at", null);
  if (revoke.error) throw new Error(`Couldn't revoke the old link: ${revoke.error.message}`);
  const { data, error } = await client.from("po_links").insert({ purchase_order_id: poId, token_hash: tokenHash, expires_at: expiresAt.toISOString() }).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't create the link: ${error.message}`);
  return data.id;
}

export async function revokeLink(client: SupabaseClient, linkId: string, userId: string): Promise<boolean> {
  const { data, error } = await client.from("po_links").update({ revoked_at: new Date().toISOString(), revoked_by: userId }).eq("id", linkId).is("revoked_at", null).select("id");
  if (error) throw new Error(`Couldn't revoke the link: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function listLinksForPo(client: SupabaseClient, poId: string): Promise<LinkRow[]> {
  const { data, error } = await client
    .from("po_links")
    .select("id, expires_at, revoked_at, last_opened_at, created_at")
    .eq("purchase_order_id", poId)
    .order("created_at", { ascending: false })
    .returns<{ id: string; expires_at: string; revoked_at: string | null; last_opened_at: string | null; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load links: ${error.message}`);
  return (data ?? []).map((l) => ({ id: l.id, expiresAt: l.expires_at, revokedAt: l.revoked_at, lastOpenedAt: l.last_opened_at, createdAt: l.created_at }));
}

// ── The supplier's view, through a link (service-role client) ───────────────
/**
 * Supplier-safe projection (spec §7.1): PO lines, quantities, requested
 * dates, the PO's own price, and the delivery address for direct-ship lines.
 * There is no field for the customer's price, margin, internal notes or any
 * other supplier — the query doesn't fetch them.
 */
export interface SupplierLinkView {
  linkId: string;
  orgId: string;
  expiresAt: string;
  revoked: boolean;
  purchaseOrderId: string;
  poNumber: string;
  poStatus: string;
  currency: Currency;
  buyerName: string;
  supplierName: string;
  lines: {
    poLineId: string;
    description: string;
    sku: string | null;
    quantity: number;
    requestedDate: string | null;
    unitCostMinor: number | null;
    confirmedDate: string | null;
    deliverTo: string | null;
  }[];
  lastAnswerAt: string | null;
}

interface LinkViewRow {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  purchase_orders: {
    id: string;
    org_id: string;
    po_number: string;
    status: string;
    currency: string;
    organisations: { name: string } | null;
    suppliers: { name: string } | null;
    purchase_order_lines: {
      id: string;
      quantity: number | string;
      requested_date: string | null;
      confirmed_date: string | null;
      purchase_order_line_costs: { unit_cost_minor: number } | null;
      order_lines: {
        description: string;
        sku: string | null;
        route: string;
        sales_orders: { delivery_name: string; delivery_line1: string; delivery_line2: string | null; delivery_town: string; delivery_postcode: string; delivery_country: string } | null;
      } | null;
    }[];
  } | null;
}

export async function getLinkView(admin: SupabaseClient, tokenHash: string): Promise<SupplierLinkView | null> {
  const { data, error } = await admin
    .from("po_links")
    .select(
      `id, expires_at, revoked_at,
       purchase_orders(id, org_id, po_number, status, currency, organisations(name), suppliers(name),
         purchase_order_lines(id, quantity, requested_date, confirmed_date, purchase_order_line_costs(unit_cost_minor),
           order_lines(description, sku, route,
             sales_orders(delivery_name, delivery_line1, delivery_line2, delivery_town, delivery_postcode, delivery_country))))`,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle<LinkViewRow>();
  if (error) throw new Error(`Couldn't load the link: ${error.message}`);
  const po = data?.purchase_orders;
  if (!data || !po) return null;

  const last = await admin
    .from("supplier_responses")
    .select("created_at")
    .eq("purchase_order_id", po.id)
    .eq("source", "link")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();

  return {
    linkId: data.id,
    orgId: po.org_id,
    expiresAt: data.expires_at,
    revoked: data.revoked_at !== null,
    purchaseOrderId: po.id,
    poNumber: po.po_number,
    poStatus: po.status,
    currency: isCurrency(po.currency) ? po.currency : "GBP",
    buyerName: po.organisations?.name ?? "",
    supplierName: po.suppliers?.name ?? "",
    lines: (po.purchase_order_lines ?? []).map((pl) => {
      const so = pl.order_lines?.sales_orders;
      const direct = pl.order_lines?.route === "direct_ship" && so;
      return {
        poLineId: pl.id,
        description: pl.order_lines?.description ?? "",
        sku: pl.order_lines?.sku ?? null,
        quantity: Number(pl.quantity),
        requestedDate: pl.requested_date,
        unitCostMinor: pl.purchase_order_line_costs?.unit_cost_minor ?? null,
        confirmedDate: pl.confirmed_date,
        deliverTo: direct
          ? [so.delivery_name, so.delivery_line1, so.delivery_line2, so.delivery_town, so.delivery_postcode, so.delivery_country].filter(Boolean).join(", ")
          : null,
      };
    }),
    lastAnswerAt: last.data?.created_at ?? null,
  };
}

export async function touchLink(admin: SupabaseClient, linkId: string): Promise<void> {
  await admin.from("po_links").update({ last_opened_at: new Date().toISOString() }).eq("id", linkId);
}

// ── Supplier answers ────────────────────────────────────────────────────────
export interface ResponseRow {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierName: string;
  source: ResponseSource;
  rawText: string | null;
  lines: ResponseLine[];
  extras: {
    trackingNumbers?: string[];
    supplierReference?: string;
    note?: string;
    currency?: string | null;
    /** What the PO looked like before an emailed date applied itself, so it can be undone (readiness Task 3). */
    previous?: { poStatus: string; lines: { poLineId: string; confirmedDate: string | null; confirmedQuantity: number | null }[] };
    /** Which inbound email it came from. */
    inboundMessageId?: string;
  };
  confidence: Confidence;
  reasons: string[];
  status: "applied" | "needs_review" | "accepted" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export async function insertResponse(
  client: SupabaseClient,
  r: {
    orgId: string;
    purchaseOrderId: string;
    source: ResponseSource;
    rawText: string | null;
    lines: ResponseLine[];
    extras: ResponseRow["extras"];
    confidence: Confidence;
    reasons: string[];
    status: "applied" | "needs_review";
    linkId?: string;
  },
): Promise<string> {
  const answer = r.lines.map((l) => ({ poLineId: l.poLineId, available: l.available, quantity: l.quantity, date: l.date }));
  const { data, error } = await client
    .from("supplier_responses")
    .insert({
      org_id: r.orgId,
      purchase_order_id: r.purchaseOrderId,
      source: r.source,
      raw_text: r.rawText,
      answer,
      extras: r.extras,
      confidence: r.confidence,
      reasons: r.reasons,
      status: r.status,
      link_id: r.linkId ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Couldn't save the supplier's answer: ${error.message}`);
  const prices = r.lines.filter((l) => l.unitCostMinor !== null).map((l) => ({ poLineId: l.poLineId, unitCostMinor: l.unitCostMinor }));
  if (prices.length) {
    // Without costs.view this insert is refused by RLS; the prices are then simply not kept.
    await client.from("supplier_response_prices").insert({ supplier_response_id: data.id, prices });
  }
  return data.id;
}

interface ResponseDbRow {
  id: string;
  purchase_order_id: string;
  source: ResponseSource;
  raw_text: string | null;
  answer: { poLineId: string; available: boolean; quantity: number | null; date: string | null }[];
  extras: ResponseRow["extras"];
  confidence: Confidence;
  reasons: string[];
  status: ResponseRow["status"];
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  purchase_orders: { po_number: string; suppliers: { name: string } | null } | null;
  supplier_response_prices: { prices: { poLineId: string; unitCostMinor: number }[] } | null;
}

const RESPONSE_COLUMNS =
  "id, purchase_order_id, source, raw_text, answer, extras, confidence, reasons, status, created_at, reviewed_at, review_note, purchase_orders(po_number, suppliers(name)), supplier_response_prices(prices)";

function toResponse(r: ResponseDbRow): ResponseRow {
  const prices = new Map((r.supplier_response_prices?.prices ?? []).map((p) => [p.poLineId, p.unitCostMinor]));
  return {
    id: r.id,
    purchaseOrderId: r.purchase_order_id,
    poNumber: r.purchase_orders?.po_number ?? "",
    supplierName: r.purchase_orders?.suppliers?.name ?? "",
    source: r.source,
    rawText: r.raw_text,
    lines: (r.answer ?? []).map((a) => ({ ...a, unitCostMinor: prices.get(a.poLineId) ?? null })),
    extras: r.extras ?? {},
    confidence: r.confidence,
    reasons: r.reasons ?? [],
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  };
}

export async function listResponses(client: SupabaseClient, filter: { status?: ResponseRow["status"]; poId?: string }): Promise<ResponseRow[]> {
  let q = client.from("supplier_responses").select(RESPONSE_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.poId) q = q.eq("purchase_order_id", filter.poId);
  const { data, error } = await q.returns<ResponseDbRow[]>();
  if (error) throw new Error(`Couldn't load supplier answers: ${error.message}`);
  return (data ?? []).map(toResponse);
}

export async function getResponse(client: SupabaseClient, id: string): Promise<ResponseRow | null> {
  const { data, error } = await client.from("supplier_responses").select(RESPONSE_COLUMNS).eq("id", id).maybeSingle<ResponseDbRow>();
  if (error) throw new Error(`Couldn't load the supplier's answer: ${error.message}`);
  return data ? toResponse(data) : null;
}

export async function countNeedsReview(client: SupabaseClient): Promise<number> {
  const { count, error } = await client.from("supplier_responses").select("id", { count: "exact", head: true }).eq("status", "needs_review");
  if (error) return 0;
  return count ?? 0;
}

export async function applyAnswer(
  client: SupabaseClient,
  a: { purchaseOrderId: string; responseId: string | null; reviewStatus: "applied" | "accepted"; lines: ConfirmedLine[]; fullyConfirmed: boolean; includePrices: boolean },
): Promise<void> {
  const { error } = await client.rpc("apply_supplier_answer", {
    p: {
      purchase_order_id: a.purchaseOrderId,
      response_id: a.responseId ?? "",
      review_status: a.reviewStatus,
      fully_confirmed: a.fullyConfirmed,
      lines: a.lines.map((l) => ({
        po_line_id: l.poLineId,
        confirmed_date: l.confirmedDate,
        confirmed_quantity: l.confirmedQuantity,
        confirmed_unit_cost_minor: a.includePrices && l.confirmedUnitCostMinor !== null ? l.confirmedUnitCostMinor : "",
      })),
    },
  });
  if (error) throw new Error(`Couldn't apply the supplier's answer: ${error.message}`);
}

export async function rejectResponse(client: SupabaseClient, id: string, userId: string, note: string | null): Promise<boolean> {
  const { data, error } = await client
    .from("supplier_responses")
    .update({ status: "rejected", reviewed_by: userId, reviewed_at: new Date().toISOString(), review_note: note })
    .eq("id", id)
    .eq("status", "needs_review")
    .select("id");
  if (error) throw new Error(`Couldn't reject: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// ── Chases ──────────────────────────────────────────────────────────────────
export interface ChaseRow {
  id: string;
  kind: "supplier" | "internal";
  purchaseOrderId: string | null;
  salesOrderId: string | null;
  orderLineId: string | null;
  note: string | null;
  status: "open" | "resolved";
  openedBy: string | null;
  openedAt: string;
  lastChasedAt: string | null;
  chaseCount: number;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

const CHASE_COLUMNS = "id, kind, purchase_order_id, sales_order_id, order_line_id, note, status, opened_by, opened_at, last_chased_at, chase_count, resolved_by, resolved_at, resolution_note";

interface ChaseDbRow {
  id: string;
  kind: ChaseRow["kind"];
  purchase_order_id: string | null;
  sales_order_id: string | null;
  order_line_id: string | null;
  note: string | null;
  status: ChaseRow["status"];
  opened_by: string | null;
  opened_at: string;
  last_chased_at: string | null;
  chase_count: number;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

function toChase(c: ChaseDbRow): ChaseRow {
  return {
    id: c.id,
    kind: c.kind,
    purchaseOrderId: c.purchase_order_id,
    salesOrderId: c.sales_order_id,
    orderLineId: c.order_line_id,
    note: c.note,
    status: c.status,
    openedBy: c.opened_by,
    openedAt: c.opened_at,
    lastChasedAt: c.last_chased_at,
    chaseCount: c.chase_count,
    resolvedBy: c.resolved_by,
    resolvedAt: c.resolved_at,
    resolutionNote: c.resolution_note,
  };
}

export async function listChases(client: SupabaseClient, filter: { poId?: string; orderId?: string; status?: "open" | "resolved" }): Promise<ChaseRow[]> {
  let q = client.from("chases").select(CHASE_COLUMNS).order("opened_at", { ascending: false }).limit(200);
  if (filter.poId) q = q.eq("purchase_order_id", filter.poId);
  if (filter.orderId) q = q.eq("sales_order_id", filter.orderId);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q.returns<ChaseDbRow[]>();
  if (error) throw new Error(`Couldn't load chases: ${error.message}`);
  return (data ?? []).map(toChase);
}

export async function getChase(client: SupabaseClient, id: string): Promise<ChaseRow | null> {
  const { data, error } = await client.from("chases").select(CHASE_COLUMNS).eq("id", id).maybeSingle<ChaseDbRow>();
  if (error) throw new Error(`Couldn't load the chase: ${error.message}`);
  return data ? toChase(data) : null;
}

export async function openSupplierChase(client: SupabaseClient, orgId: string, poId: string): Promise<ChaseRow> {
  const existing = await client.from("chases").select(CHASE_COLUMNS).eq("purchase_order_id", poId).eq("kind", "supplier").eq("status", "open").maybeSingle<ChaseDbRow>();
  if (existing.data) return toChase(existing.data);
  const { data, error } = await client.from("chases").insert({ org_id: orgId, kind: "supplier", purchase_order_id: poId }).select(CHASE_COLUMNS).single<ChaseDbRow>();
  if (error) throw new Error(`Couldn't open the chase: ${error.message}`);
  return toChase(data);
}

export async function recordChased(client: SupabaseClient, chase: ChaseRow): Promise<void> {
  const { error } = await client.from("chases").update({ chase_count: chase.chaseCount + 1, last_chased_at: new Date().toISOString() }).eq("id", chase.id).eq("chase_count", chase.chaseCount);
  if (error) throw new Error(`Couldn't record the chase: ${error.message}`);
}

export async function openInternalChase(client: SupabaseClient, orgId: string, orderId: string, lineId: string, note: string): Promise<void> {
  const { error } = await client.from("chases").insert({ org_id: orgId, kind: "internal", sales_order_id: orderId, order_line_id: lineId, note });
  if (error) {
    if (error.code === "23505") throw new Error("There's already an open chase for that line.");
    throw new Error(`Couldn't raise the chase: ${error.message}`);
  }
}

export async function resolveChase(client: SupabaseClient, id: string, userId: string, note: string | null): Promise<boolean> {
  const { data, error } = await client
    .from("chases")
    .update({ status: "resolved", resolved_by: userId, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw new Error(`Couldn't resolve the chase: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Resolves any open supplier chase on a PO (when the supplier answers). */
export async function resolveSupplierChases(client: SupabaseClient, poId: string, note: string): Promise<void> {
  await client.from("chases").update({ status: "resolved", resolved_at: new Date().toISOString(), resolution_note: note }).eq("purchase_order_id", poId).eq("kind", "supplier").eq("status", "open");
}

// ── Escalation settings ─────────────────────────────────────────────────────
export interface ChaseSettings {
  thresholds: EscalationThresholds;
  calendar: WorkingCalendar;
  /** How long a supplier's confirmation link works (readiness Task 5B). */
  linkLifetimeDays: number;
}

export async function getChaseSettings(client: SupabaseClient): Promise<ChaseSettings> {
  const { data } = await client
    .from("chase_settings")
    .select("amber_hours, red_hours, alert_hours, day_start_hour, day_end_hour, link_lifetime_days")
    .maybeSingle<{ amber_hours: number; red_hours: number; alert_hours: number; day_start_hour: number; day_end_hour: number; link_lifetime_days: number }>();
  if (!data) return { thresholds: { amberHours: 8, redHours: 16, alertHours: 24 }, calendar: DEFAULT_CALENDAR, linkLifetimeDays: 30 };
  return {
    thresholds: { amberHours: data.amber_hours, redHours: data.red_hours, alertHours: data.alert_hours },
    calendar: { ...DEFAULT_CALENDAR, dayStartHour: data.day_start_hour, dayEndHour: data.day_end_hour },
    linkLifetimeDays: data.link_lifetime_days ?? 30,
  };
}

export async function updateChaseSettings(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  s: { amberHours: number; redHours: number; alertHours: number; dayStartHour: number; dayEndHour: number; linkLifetimeDays: number },
): Promise<void> {
  const { data, error } = await client
    .from("chase_settings")
    .update({ amber_hours: s.amberHours, red_hours: s.redHours, alert_hours: s.alertHours, day_start_hour: s.dayStartHour, day_end_hour: s.dayEndHour, link_lifetime_days: s.linkLifetimeDays, updated_by: userId })
    .eq("org_id", orgId)
    .select("org_id");
  if (error) throw new Error(`Couldn't save: ${error.message}`);
  if (!data?.length) throw new Error("Not allowed to change these settings.");
}
