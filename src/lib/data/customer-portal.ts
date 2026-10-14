import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CarrierKey } from "@/lib/logic/carriers";
import type { RawCustomerOrder } from "@/lib/logic/masking";
import { isNotifyLevel, type NotificationKind, type NotifyLevel, type Prefs, type Topic } from "@/lib/logic/notifications";
import { isFulfilmentRoute, isLineStage, type FulfilmentRoute, type LineStage } from "@/lib/logic/orders";
import type { ShipmentLeg, ShipmentStatus } from "@/lib/logic/shipments";

/**
 * Data for the customer side: the raw order the masking function reads,
 * tracking codes, customer page settings, messages, notification
 * preferences and log, customer accounts, rate limits. Reads and writes
 * only. Customer pages pass the service-role client, scoped by a tracking
 * code or a signed-in customer's own account; staff pages pass their own.
 */

// ── Tracking codes ──────────────────────────────────────────────────────────
/** "k7q 4m2-xp9" → "K7Q-4M2-XP9"; null if it can't be a code. */
export function normaliseTrackingCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{9}$/.test(raw)) return null;
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
}

export async function findOrderByTrackingCode(admin: SupabaseClient, code: string): Promise<{ orderId: string; orgId: string } | null> {
  const { data, error } = await admin.from("sales_orders").select("id, org_id").eq("tracking_code", code).maybeSingle<{ id: string; org_id: string }>();
  if (error) throw new Error(`Couldn't look up the tracking code: ${error.message}`);
  return data ? { orderId: data.id, orgId: data.org_id } : null;
}

export async function regenerateTrackingCode(admin: SupabaseClient, orderId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("regenerate_tracking_code", { p_order: orderId });
  if (error) throw new Error(`Couldn't make a new tracking code: ${error.message}`);
  return (data as string | null) ?? null;
}

// ── Customer page settings ──────────────────────────────────────────────────
export interface CustomerPageSettings {
  displayName: string | null;
  logoUrl: string | null;
  supplierWord: string;
  showDirectCarrier: boolean;
  minGapHours: number;
  dateShiftDays: number;
}

const SETTINGS_COLUMNS = "display_name, logo_url, supplier_word, show_direct_carrier, notify_min_gap_hours, notify_date_shift_days";

interface RawSettings {
  display_name: string | null;
  logo_url: string | null;
  supplier_word: string;
  show_direct_carrier: boolean;
  notify_min_gap_hours: number;
  notify_date_shift_days: number;
}

const toSettings = (r: RawSettings | null): CustomerPageSettings => ({
  displayName: r?.display_name ?? null,
  logoUrl: r?.logo_url ?? null,
  supplierWord: r?.supplier_word ?? "shipper",
  showDirectCarrier: r?.show_direct_carrier ?? false,
  minGapHours: r?.notify_min_gap_hours ?? 4,
  dateShiftDays: r?.notify_date_shift_days ?? 2,
});

export async function getCustomerPageSettings(client: SupabaseClient, orgId?: string): Promise<CustomerPageSettings> {
  let q = client.from("customer_page_settings").select(SETTINGS_COLUMNS);
  if (orgId) q = q.eq("org_id", orgId);
  const { data } = await q.limit(1).maybeSingle<RawSettings>();
  return toSettings(data ?? null);
}

export async function updateCustomerPageSettings(client: SupabaseClient, orgId: string, userId: string, s: CustomerPageSettings): Promise<void> {
  const { data, error } = await client
    .from("customer_page_settings")
    .update({
      display_name: s.displayName,
      logo_url: s.logoUrl,
      supplier_word: s.supplierWord,
      show_direct_carrier: s.showDirectCarrier,
      notify_min_gap_hours: s.minGapHours,
      notify_date_shift_days: s.dateShiftDays,
      updated_by: userId,
    })
    .eq("org_id", orgId)
    .select("org_id");
  if (error) throw new Error(`Couldn't save the customer page settings: ${error.message}`);
  if ((data?.length ?? 0) === 0) throw new Error("Couldn't save the customer page settings.");
}

// ── The raw order for the masking function ──────────────────────────────────
interface RawOrderRow {
  id: string;
  org_id: string;
  so_number: string;
  customer_reference: string | null;
  created_at: string;
  promised_date: string | null;
  delivery_name: string;
  delivery_line1: string;
  delivery_line2: string | null;
  delivery_town: string;
  delivery_postcode: string;
  delivery_country: string;
  customers: { name: string } | null;
  staff_users: { full_name: string } | null;
  organisations: { name: string } | null;
  order_lines: {
    line_no: number;
    description: string;
    quantity: number | string;
    route: string;
    stage: string;
    purchase_order_lines: { purchase_orders: { po_number: string; notes: string | null; suppliers: { name: string } | null } | null; purchase_order_line_costs: { unit_cost_minor: number } | null }[] | null;
  }[] | null;
  order_predictions: RawPred | RawPred[] | null;
  shipments: { leg: string; carrier: string; tracking_number: string | null; status: string; delivered_at: string | null }[] | null;
}

interface RawPred {
  predicted_from: string | null;
  predicted_to: string | null;
  confidence: "confirmed" | "estimate" | "unknown";
  source: string;
  at_risk: boolean | null;
}

/** Everything the masking function may read about one order. The service-role client, after the caller has scoped it. */
export async function loadRawCustomerOrder(admin: SupabaseClient, orderId: string): Promise<{ orgId: string; raw: RawCustomerOrder } | null> {
  const { data, error } = await admin
    .from("sales_orders")
    .select(
      `id, org_id, so_number, customer_reference, created_at, promised_date,
       delivery_name, delivery_line1, delivery_line2, delivery_town, delivery_postcode, delivery_country,
       customers(name), staff_users(full_name), organisations(name),
       order_lines(line_no, description, quantity, route, stage,
         purchase_order_lines(purchase_orders(po_number, notes, suppliers(name)), purchase_order_line_costs(unit_cost_minor))),
       order_predictions(predicted_from, predicted_to, confidence, source, at_risk),
       shipments(leg, carrier, tracking_number, status, delivered_at)`,
    )
    .eq("id", orderId)
    .maybeSingle<RawOrderRow>();
  if (error) throw new Error(`Couldn't load the order: ${error.message}`);
  if (!data) return null;

  const [settings, events, messages, suppliers] = await Promise.all([
    getCustomerPageSettings(admin, data.org_id),
    admin.from("order_events").select("id, kind, detail, created_at").eq("sales_order_id", orderId).order("created_at").limit(500),
    admin.from("order_messages").select("id, author_kind, body, created_at, staff_users(full_name)").eq("sales_order_id", orderId).order("created_at").limit(500),
    admin.from("suppliers").select("name").eq("org_id", data.org_id).limit(5000),
  ]);
  if (events.error || messages.error || suppliers.error) throw new Error("Couldn't load the order's history.");

  const pred = Array.isArray(data.order_predictions) ? data.order_predictions[0] : data.order_predictions;
  const lines = (data.order_lines ?? []).filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage));
  const pos = lines.flatMap((l) => (l.purchase_order_lines ?? []).flatMap((pl) => (pl.purchase_orders ? [pl.purchase_orders] : [])));

  const raw: RawCustomerOrder = {
    org: {
      displayName: settings.displayName ?? data.organisations?.name ?? "",
      logoUrl: settings.logoUrl,
      supplierWord: settings.supplierWord,
      showDirectCarrier: settings.showDirectCarrier,
    },
    order: {
      soNumber: data.so_number,
      customerName: data.customers?.name ?? "",
      customerReference: data.customer_reference,
      createdAt: data.created_at,
      promisedDate: data.promised_date,
      salesRepName: data.staff_users?.full_name ?? null,
      delivery: {
        name: data.delivery_name,
        line1: data.delivery_line1,
        line2: data.delivery_line2,
        town: data.delivery_town,
        postcode: data.delivery_postcode,
        country: data.delivery_country,
      },
      internalNotes: pos.map((p) => p.notes).filter(Boolean).join("\n") || null,
    },
    lines: lines.map((l) => {
      const pl = (l.purchase_order_lines ?? [])[0];
      return {
        lineNo: l.line_no,
        description: l.description,
        quantity: Number(l.quantity),
        route: l.route as FulfilmentRoute,
        stage: l.stage as LineStage,
        supplierName: pl?.purchase_orders?.suppliers?.name ?? null,
        poNumber: pl?.purchase_orders?.po_number ?? null,
        unitCostMinor: pl?.purchase_order_line_costs?.unit_cost_minor ?? null,
      };
    }),
    prediction: pred ? { from: pred.predicted_from, to: pred.predicted_to, confidence: pred.confidence, source: pred.source, atRisk: pred.at_risk } : null,
    shipments: (data.shipments ?? []).map((s) => ({
      leg: s.leg as ShipmentLeg,
      carrier: s.carrier as CarrierKey,
      trackingNumber: s.tracking_number,
      status: s.status as ShipmentStatus,
      deliveredAt: s.delivered_at,
    })),
    events: ((events.data ?? []) as { id: number; kind: string; detail: Record<string, unknown>; created_at: string }[]).map((e) => ({ id: e.id, kind: e.kind, detail: e.detail ?? {}, createdAt: e.created_at })),
    messages: ((messages.data ?? []) as unknown as { id: string; author_kind: "customer" | "staff"; body: string; created_at: string; staff_users: { full_name: string } | null }[]).map((m) => ({
      id: m.id,
      from: m.author_kind,
      authorName: m.author_kind === "staff" ? (m.staff_users?.full_name ?? null) : null,
      body: m.body,
      createdAt: m.created_at,
    })),
    secrets: {
      supplierNames: ((suppliers.data ?? []) as { name: string }[]).map((s) => s.name),
      poNumbers: pos.map((p) => p.po_number),
    },
  };
  return { orgId: data.org_id, raw };
}

/** Every supplier name and this order's PO numbers, for checking a staff reply. */
export async function leakSecretsForOrder(client: SupabaseClient, orgId: string, orderId: string): Promise<{ supplierNames: string[]; poNumbers: string[] }> {
  const [suppliers, pos] = await Promise.all([
    client.from("suppliers").select("name").eq("org_id", orgId).limit(5000),
    client.from("purchase_orders").select("po_number").eq("org_id", orgId).limit(20000),
  ]);
  if (suppliers.error || pos.error) throw new Error("Couldn't load supplier details to check the message.");
  void orderId;
  return {
    supplierNames: ((suppliers.data ?? []) as { name: string }[]).map((s) => s.name),
    poNumbers: ((pos.data ?? []) as { po_number: string }[]).map((p) => p.po_number),
  };
}

// ── Messages ────────────────────────────────────────────────────────────────
export interface MessageRow {
  id: string;
  authorKind: "customer" | "staff";
  staffName: string | null;
  customerName: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export async function listMessages(client: SupabaseClient, orderId: string): Promise<MessageRow[]> {
  const { data, error } = await client
    .from("order_messages")
    .select("id, author_kind, customer_name, body, read_at, created_at, staff_users(full_name)")
    .eq("sales_order_id", orderId)
    .order("created_at")
    .limit(500)
    .returns<{ id: string; author_kind: "customer" | "staff"; customer_name: string | null; body: string; read_at: string | null; created_at: string; staff_users: { full_name: string } | null }[]>();
  if (error) throw new Error(`Couldn't load messages: ${error.message}`);
  return (data ?? []).map((m) => ({ id: m.id, authorKind: m.author_kind, staffName: m.staff_users?.full_name ?? null, customerName: m.customer_name, body: m.body, readAt: m.read_at, createdAt: m.created_at }));
}

export async function insertCustomerMessage(admin: SupabaseClient, orgId: string, orderId: string, name: string | null, body: string): Promise<string> {
  const { data, error } = await admin.from("order_messages").insert({ org_id: orgId, sales_order_id: orderId, author_kind: "customer", customer_name: name, body }).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't save the message: ${error.message}`);
  return data.id;
}

export async function insertStaffMessage(client: SupabaseClient, orgId: string, orderId: string, staffId: string, body: string): Promise<string> {
  const { data, error } = await client.from("order_messages").insert({ org_id: orgId, sales_order_id: orderId, author_kind: "staff", staff_id: staffId, body }).select("id").single<{ id: string }>();
  if (error) throw new Error(`Couldn't save the reply: ${error.message}`);
  return data.id;
}

export async function markCustomerMessagesRead(client: SupabaseClient, orderId: string, userId: string): Promise<void> {
  await client.from("order_messages").update({ read_at: new Date().toISOString(), read_by: userId }).eq("sales_order_id", orderId).eq("author_kind", "customer").is("read_at", null);
}

/** Customer messages nobody has read yet, per order. */
export async function unreadCustomerMessages(client: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await client.from("order_messages").select("sales_order_id").eq("author_kind", "customer").is("read_at", null).limit(2000).returns<{ sales_order_id: string }[]>();
  const out = new Map<string, number>();
  for (const r of data ?? []) out.set(r.sales_order_id, (out.get(r.sales_order_id) ?? 0) + 1);
  return out;
}

// ── Notification preferences ────────────────────────────────────────────────
export async function getPrefs(client: SupabaseClient, orderId: string): Promise<Prefs | null> {
  const { data } = await client.from("customer_notification_prefs").select("email, level, daily_digest").eq("sales_order_id", orderId).maybeSingle<{ email: string | null; level: string; daily_digest: boolean }>();
  if (!data) return null;
  return { email: data.email, level: isNotifyLevel(data.level) ? data.level : "milestones", dailyDigest: data.daily_digest };
}

export async function savePrefs(client: SupabaseClient, orderId: string, userId: string | null, p: { email?: string | null; level: NotifyLevel; dailyDigest: boolean }): Promise<void> {
  const patch: Record<string, unknown> = { level: p.level, daily_digest: p.dailyDigest, updated_by: userId };
  if (p.email !== undefined) patch.email = p.email;
  const { data, error } = await client.from("customer_notification_prefs").update(patch).eq("sales_order_id", orderId).select("sales_order_id");
  if (error) throw new Error(`Couldn't save the update settings: ${error.message}`);
  if ((data?.length ?? 0) > 0) return;
  const { error: insertError } = await client.from("customer_notification_prefs").insert({ sales_order_id: orderId, ...patch });
  if (insertError) throw new Error(`Couldn't save the update settings: ${insertError.message}`);
}

// ── Notification log ────────────────────────────────────────────────────────
export interface NotificationRow {
  id: string;
  kind: NotificationKind | "digest";
  topic: string;
  summary: string;
  toAddress: string | null;
  subject: string | null;
  status: "logged" | "sent" | "failed" | "held" | "folded" | "skipped";
  reason: string | null;
  createdAt: string;
}

export async function recordNotification(
  admin: SupabaseClient,
  n: { orgId: string; orderId: string; kind: NotificationKind | "digest"; topic: Topic | "digest"; summary: string; status: NotificationRow["status"]; reason?: string | null; email?: { to: string; subject: string; text: string; html: string; channel: "log" | "m365" } },
): Promise<string> {
  const { data, error } = await admin
    .from("customer_notifications")
    .insert({
      org_id: n.orgId,
      sales_order_id: n.orderId,
      kind: n.kind,
      topic: n.topic,
      summary: n.summary.slice(0, 500),
      status: n.status,
      reason: n.reason?.slice(0, 300) ?? null,
      to_address: n.email?.to ?? null,
      subject: n.email?.subject ?? null,
      body_text: n.email?.text ?? null,
      body_html: n.email?.html ?? null,
      channel: n.email?.channel ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Couldn't record the notification: ${error.message}`);
  return data.id;
}

export async function markFolded(admin: SupabaseClient, ids: readonly string[]): Promise<void> {
  if (ids.length) await admin.from("customer_notifications").update({ status: "folded", reason: "Included in a later update" }).in("id", ids);
}

export async function listHeld(admin: SupabaseClient, orderId?: string): Promise<{ id: string; orgId: string; orderId: string; summary: string; createdAt: string }[]> {
  let q = admin.from("customer_notifications").select("id, org_id, sales_order_id, summary, created_at").eq("status", "held").order("created_at").limit(2000);
  if (orderId) q = q.eq("sales_order_id", orderId);
  const { data, error } = await q.returns<{ id: string; org_id: string; sales_order_id: string; summary: string; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load held notifications: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, orgId: r.org_id, orderId: r.sales_order_id, summary: r.summary, createdAt: r.created_at }));
}

/** When the last routine (not urgent) update went to this order's customer. */
export async function lastRoutineSentAt(admin: SupabaseClient, orderId: string): Promise<string | null> {
  const { data } = await admin
    .from("customer_notifications")
    .select("created_at")
    .eq("sales_order_id", orderId)
    .in("status", ["logged", "sent"])
    .in("kind", ["milestone", "date_change", "digest"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  return data?.created_at ?? null;
}

export async function listNotifications(client: SupabaseClient, orderId: string): Promise<NotificationRow[]> {
  const { data, error } = await client
    .from("customer_notifications")
    .select("id, kind, topic, summary, to_address, subject, status, reason, created_at")
    .eq("sales_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<{ id: string; kind: NotificationRow["kind"]; topic: string; summary: string; to_address: string | null; subject: string | null; status: NotificationRow["status"]; reason: string | null; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load notifications: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, kind: r.kind, topic: r.topic, summary: r.summary, toAddress: r.to_address, subject: r.subject, status: r.status, reason: r.reason, createdAt: r.created_at }));
}

// ── Customer accounts ───────────────────────────────────────────────────────
export interface CustomerAccount {
  userId: string;
  orgId: string;
  customerId: string;
  fullName: string;
  email: string;
}

export async function getCustomerAccount(admin: SupabaseClient, userId: string): Promise<CustomerAccount | null> {
  const { data } = await admin.from("customer_accounts").select("user_id, org_id, customer_id, full_name, email").eq("user_id", userId).maybeSingle<{ user_id: string; org_id: string; customer_id: string; full_name: string; email: string }>();
  return data ? { userId: data.user_id, orgId: data.org_id, customerId: data.customer_id, fullName: data.full_name, email: data.email } : null;
}

export async function createCustomerAccount(admin: SupabaseClient, a: CustomerAccount & { invitedBy: string }): Promise<void> {
  const { error } = await admin.from("customer_accounts").insert({ user_id: a.userId, org_id: a.orgId, customer_id: a.customerId, full_name: a.fullName, email: a.email, invited_by: a.invitedBy });
  if (error) throw new Error(`Couldn't create the customer account: ${error.message}`);
}

export async function addOrderToAccount(admin: SupabaseClient, userId: string, orderId: string): Promise<void> {
  const { error } = await admin.from("customer_account_orders").upsert({ user_id: userId, sales_order_id: orderId }, { onConflict: "user_id,sales_order_id", ignoreDuplicates: true });
  if (error) throw new Error(`Couldn't add the order: ${error.message}`);
}

export async function accountHasOrder(admin: SupabaseClient, userId: string, orderId: string): Promise<boolean> {
  const { data } = await admin.from("customer_account_orders").select("sales_order_id").eq("user_id", userId).eq("sales_order_id", orderId).maybeSingle();
  return Boolean(data);
}

export async function listAccountOrderIds(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("customer_account_orders").select("sales_order_id, added_at").eq("user_id", userId).order("added_at", { ascending: false }).limit(1000).returns<{ sales_order_id: string }[]>();
  if (error) throw new Error(`Couldn't load your orders: ${error.message}`);
  return (data ?? []).map((r) => r.sales_order_id);
}

/** For the account dashboard: the order fields a customer may see (no supplier data is selected at all). */
export async function listAccountOrderSummaries(admin: SupabaseClient, orderIds: readonly string[]) {
  if (orderIds.length === 0) return [];
  const { data, error } = await admin
    .from("sales_orders")
    .select("id, so_number, customer_reference, created_at, currency, tracking_code, order_lines(stage, route, quantity, unit_price_minor), order_predictions(predicted_from, predicted_to, confidence)")
    .in("id", orderIds as string[])
    .returns<{
      id: string;
      so_number: string;
      customer_reference: string | null;
      created_at: string;
      currency: string;
      tracking_code: string;
      order_lines: { stage: string; route: string; quantity: number | string; unit_price_minor: number | null }[] | null;
      order_predictions: { predicted_from: string | null; predicted_to: string | null; confidence: string } | { predicted_from: string | null; predicted_to: string | null; confidence: string }[] | null;
    }[]>();
  if (error) throw new Error(`Couldn't load your orders: ${error.message}`);
  return data ?? [];
}

// ── Rate limits ─────────────────────────────────────────────────────────────
/** Counts a hit; false once the bucket is over its limit in this window. Fails open only if the database can't be reached. */
export async function hitRateLimit(admin: SupabaseClient, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("hit_rate_limit", { p_bucket: bucket.slice(0, 200), p_limit: limit, p_window_seconds: windowSeconds });
  if (error) return true;
  return data === true;
}
