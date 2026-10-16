import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthResults } from "@/lib/logic/inbound-email";

/**
 * Supplier replies by email (readiness Task 3). Reads and writes only.
 * Settings and the review screens pass the signed-in client (RLS). The
 * webhook and the mailbox job pass the service role AND an explicit
 * organisation id on every call.
 */

// ── Addresses (Settings) ────────────────────────────────────────────────────
export interface InboundAddress {
  orgId: string;
  localPart: string;
  allowedDomains: string[];
  createdAt: string;
}

export async function getInboundAddress(client: SupabaseClient): Promise<InboundAddress | null> {
  const { data } = await client.from("inbound_addresses").select("org_id, local_part, allowed_domains, created_at").maybeSingle<{ org_id: string; local_part: string; allowed_domains: string[]; created_at: string }>();
  return data ? { orgId: data.org_id, localPart: data.local_part, allowedDomains: data.allowed_domains, createdAt: data.created_at } : null;
}

export async function saveInboundAddress(client: SupabaseClient, orgId: string, allowedDomains: string[]): Promise<void> {
  const { data, error } = await client.from("inbound_addresses").update({ allowed_domains: allowedDomains }).eq("org_id", orgId).select("org_id");
  if (error) throw new Error(`Couldn't save: ${error.message}`);
  if ((data?.length ?? 0) > 0) return;
  const { error: insertError } = await client.from("inbound_addresses").insert({ org_id: orgId, allowed_domains: allowedDomains });
  if (insertError) throw new Error(insertError.code === "42501" ? "not-allowed" : `Couldn't create the address: ${insertError.message}`);
}

/** A new address replaces the old one: mail to the old one stops being accepted. */
export async function deleteInboundAddress(client: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await client.from("inbound_addresses").delete().eq("org_id", orgId).select("org_id");
  if (error) throw new Error(`Couldn't remove the address: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// ── Arriving mail (service role) ────────────────────────────────────────────
export async function findAddress(admin: SupabaseClient, localPart: string): Promise<{ orgId: string; allowedDomains: string[] } | null> {
  const { data } = await admin.from("inbound_addresses").select("org_id, allowed_domains").eq("local_part", localPart).maybeSingle<{ org_id: string; allowed_domains: string[] }>();
  return data ? { orgId: data.org_id, allowedDomains: data.allowed_domains } : null;
}

export interface NewInboundMessage {
  orgId: string;
  channel: "forward" | "m365";
  messageId: string;
  fromAddress: string | null;
  envelopeSender: string | null;
  subject: string | null;
  body: string | null;
  auth: AuthResults | Record<string, never>;
  status: "applied" | "review" | "quarantined" | "unmatched" | "ignored";
  reason: string | null;
  purchaseOrderId?: string | null;
  supplierResponseId?: string | null;
}

/** Records an email once. Returns null when this message was already recorded (a retry, or seen twice). */
export async function insertInboundMessage(admin: SupabaseClient, m: NewInboundMessage): Promise<string | null> {
  const { data, error } = await admin
    .from("inbound_messages")
    .insert({
      org_id: m.orgId,
      channel: m.channel,
      message_id: m.messageId.slice(0, 500),
      from_address: m.fromAddress?.slice(0, 320) ?? null,
      envelope_sender: m.envelopeSender?.slice(0, 320) ?? null,
      subject: m.subject?.slice(0, 1000) ?? null,
      body: m.body?.slice(0, 50000) ?? null,
      auth: m.auth,
      status: m.status,
      reason: m.reason?.slice(0, 1000) ?? null,
      purchase_order_id: m.purchaseOrderId ?? null,
      supplier_response_id: m.supplierResponseId ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error?.code === "23505") return null;
  if (error || !data) throw new Error(`Couldn't record the email: ${error?.message ?? "no id"}`);
  return data.id;
}

export async function updateInboundMessage(
  db: SupabaseClient,
  orgId: string,
  id: string,
  patch: { status: NewInboundMessage["status"]; reason?: string | null; purchaseOrderId?: string | null; supplierResponseId?: string | null },
): Promise<boolean> {
  const row: Record<string, unknown> = { status: patch.status };
  if (patch.reason !== undefined) row.reason = patch.reason?.slice(0, 1000) ?? null;
  if (patch.purchaseOrderId !== undefined) row.purchase_order_id = patch.purchaseOrderId;
  if (patch.supplierResponseId !== undefined) row.supplier_response_id = patch.supplierResponseId;
  const { data, error } = await db.from("inbound_messages").update(row).eq("org_id", orgId).eq("id", id).select("id");
  if (error) throw new Error(`Couldn't update the email: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** This organisation's POs with these numbers — never another organisation's. */
export async function findOrgPos(admin: SupabaseClient, orgId: string, poNumbers: readonly string[]): Promise<{ id: string; poNumber: string; supplierId: string }[]> {
  if (poNumbers.length === 0) return [];
  const { data, error } = await admin
    .from("purchase_orders")
    .select("id, po_number, supplier_id")
    .eq("org_id", orgId)
    .in("po_number", [...new Set(poNumbers)].slice(0, 20))
    .returns<{ id: string; po_number: string; supplier_id: string }[]>();
  if (error) throw new Error(`Couldn't look up POs: ${error.message}`);
  return (data ?? []).map((p) => ({ id: p.id, poNumber: p.po_number, supplierId: p.supplier_id }));
}

export async function supplierSenders(admin: SupabaseClient, orgId: string, supplierId: string): Promise<{ email: string | null; knownSenders: string[] }> {
  const { data } = await admin.from("suppliers").select("email, known_senders").eq("org_id", orgId).eq("id", supplierId).maybeSingle<{ email: string | null; known_senders: string[] }>();
  return { email: data?.email ?? null, knownSenders: data?.known_senders ?? [] };
}

/** Clean answers from this supplier's emails in the last 180 days: read with certainty and applied, or accepted at review with no note. */
export async function provenAnswers(admin: SupabaseClient, orgId: string, supplierId: string): Promise<number> {
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data: pos } = await admin.from("purchase_orders").select("id").eq("org_id", orgId).eq("supplier_id", supplierId).limit(2000).returns<{ id: string }[]>();
  const ids = (pos ?? []).map((p) => p.id);
  if (ids.length === 0) return 0;
  const { data } = await admin
    .from("supplier_responses")
    .select("status, review_note, undone_at")
    .eq("org_id", orgId)
    .in("purchase_order_id", ids.slice(0, 500))
    .in("source", ["paste", "inbound"])
    .in("status", ["applied", "accepted"])
    .gte("created_at", since)
    .limit(100)
    .returns<{ status: string; review_note: string | null; undone_at: string | null }[]>();
  return (data ?? []).filter((r) => !r.undone_at && (r.status === "applied" || !r.review_note)).length;
}

// ── Review screens (signed-in client) ───────────────────────────────────────
export interface InboundRow {
  id: string;
  channel: "forward" | "m365";
  receivedAt: string;
  fromAddress: string | null;
  subject: string | null;
  body: string | null;
  status: NewInboundMessage["status"];
  reason: string | null;
  purchaseOrderId: string | null;
}

export async function listInboundMessages(client: SupabaseClient, statuses: readonly NewInboundMessage["status"][], limit = 100): Promise<InboundRow[]> {
  const { data, error } = await client
    .from("inbound_messages")
    .select("id, channel, received_at, from_address, subject, body, status, reason, purchase_order_id")
    .in("status", [...statuses])
    .order("received_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; channel: "forward" | "m365"; received_at: string; from_address: string | null; subject: string | null; body: string | null; status: NewInboundMessage["status"]; reason: string | null; purchase_order_id: string | null }[]>();
  if (error) throw new Error(`Couldn't load emails: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, channel: r.channel, receivedAt: r.received_at, fromAddress: r.from_address, subject: r.subject, body: r.body, status: r.status, reason: r.reason, purchaseOrderId: r.purchase_order_id }));
}

export async function getInboundMessage(client: SupabaseClient, id: string): Promise<(InboundRow & { orgId: string; envelopeSender: string | null; auth: AuthResults | Record<string, never> }) | null> {
  const { data } = await client
    .from("inbound_messages")
    .select("id, org_id, channel, received_at, from_address, envelope_sender, subject, body, status, reason, purchase_order_id, auth")
    .eq("id", id)
    .maybeSingle<{ id: string; org_id: string; channel: "forward" | "m365"; received_at: string; from_address: string | null; envelope_sender: string | null; subject: string | null; body: string | null; status: NewInboundMessage["status"]; reason: string | null; purchase_order_id: string | null; auth: AuthResults }>();
  return data
    ? { id: data.id, orgId: data.org_id, channel: data.channel, receivedAt: data.received_at, fromAddress: data.from_address, envelopeSender: data.envelope_sender, subject: data.subject, body: data.body, status: data.status, reason: data.reason, purchaseOrderId: data.purchase_order_id, auth: data.auth }
    : null;
}

// ── Microsoft 365 mailbox reading (service role) ────────────────────────────
export async function getSyncState(admin: SupabaseClient, orgId: string): Promise<{ deltaLink: string | null }> {
  const { data } = await admin.from("m365_sync_state").select("delta_link").eq("org_id", orgId).maybeSingle<{ delta_link: string | null }>();
  return { deltaLink: data?.delta_link ?? null };
}

export async function saveSyncState(admin: SupabaseClient, orgId: string, s: { deltaLink: string | null; error: string | null }): Promise<void> {
  await admin.from("m365_sync_state").upsert({ org_id: orgId, delta_link: s.deltaLink, last_run_at: new Date().toISOString(), last_error: s.error?.slice(0, 500) ?? null }, { onConflict: "org_id" });
}
