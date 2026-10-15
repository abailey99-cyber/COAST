import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDocType, type DocType } from "@/lib/logic/customs";
import { isCategory, isProblemStatus, isResolution, type ProblemCategory, type ProblemStatus, type Resolution } from "@/lib/logic/problems";

/**
 * Delivery problems, their photos, and customs (Phase 7). Reads and writes
 * only. Staff calls pass the signed-in client (RLS applies); customer
 * reports, carrier/goods-in drafts and photo uploads pass the service-role
 * client after the caller has checked who's asking.
 */

export type RaisedVia = "customer" | "carrier" | "goods_in" | "staff";

export interface ProblemRow {
  id: string;
  orgId: string;
  salesOrderId: string;
  soNumber: string;
  customerName: string;
  shipmentId: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  raisedVia: RaisedVia;
  category: ProblemCategory;
  description: string | null;
  reporterName: string | null;
  status: ProblemStatus;
  waitingSince: string;
  ownerId: string | null;
  rootCause: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
  rmaReference: string | null;
  replacementLineId: string | null;
  claimDeadline: string | null;
  claimSubmittedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  lines: { orderLineId: string; lineNo: number; description: string; quantity: number | null }[];
  photoCount: number;
}

interface RawProblem {
  id: string;
  org_id: string;
  sales_order_id: string;
  shipment_id: string | null;
  raised_via: string;
  category: string;
  description: string | null;
  reporter_name: string | null;
  status: string;
  waiting_since: string;
  owner_id: string | null;
  root_cause: string | null;
  resolution: string | null;
  resolution_note: string | null;
  rma_reference: string | null;
  replacement_line_id: string | null;
  claim_deadline: string | null;
  claim_submitted_at: string | null;
  created_by: string | null;
  created_at: string;
  resolved_at: string | null;
  sales_orders: { so_number: string; customers: { name: string } | null } | null;
  shipments: { carrier: string; tracking_number: string | null } | null;
  delivery_exception_lines: { order_line_id: string; quantity: number | string | null; order_lines: { line_no: number; description: string } | null }[] | null;
}

const SELECT = `id, org_id, sales_order_id, shipment_id, raised_via, category, description, reporter_name, status, waiting_since, owner_id,
  root_cause, resolution, resolution_note, rma_reference, replacement_line_id, claim_deadline, claim_submitted_at, created_by, created_at, resolved_at,
  sales_orders(so_number, customers(name)), shipments(carrier, tracking_number),
  delivery_exception_lines(order_line_id, quantity, order_lines(line_no, description))`;

function toRow(r: RawProblem, photos: Map<string, number>): ProblemRow {
  return {
    id: r.id,
    orgId: r.org_id,
    salesOrderId: r.sales_order_id,
    soNumber: r.sales_orders?.so_number ?? "",
    customerName: r.sales_orders?.customers?.name ?? "",
    shipmentId: r.shipment_id,
    carrier: r.shipments?.carrier ?? null,
    trackingNumber: r.shipments?.tracking_number ?? null,
    raisedVia: (["customer", "carrier", "goods_in", "staff"] as const).find((v) => v === r.raised_via) ?? "staff",
    category: isCategory(r.category) ? r.category : "other",
    description: r.description,
    reporterName: r.reporter_name,
    status: isProblemStatus(r.status) ? r.status : "raised",
    waitingSince: r.waiting_since,
    ownerId: r.owner_id,
    rootCause: r.root_cause,
    resolution: isResolution(r.resolution) ? r.resolution : null,
    resolutionNote: r.resolution_note,
    rmaReference: r.rma_reference,
    replacementLineId: r.replacement_line_id,
    claimDeadline: r.claim_deadline,
    claimSubmittedAt: r.claim_submitted_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    lines: (r.delivery_exception_lines ?? [])
      .map((l) => ({ orderLineId: l.order_line_id, lineNo: l.order_lines?.line_no ?? 0, description: l.order_lines?.description ?? "", quantity: l.quantity === null ? null : Number(l.quantity) }))
      .sort((a, b) => a.lineNo - b.lineNo),
    photoCount: photos.get(r.id) ?? 0,
  };
}

async function photoCounts(client: SupabaseClient, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data } = await client.from("attachments").select("entity_id").eq("entity_type", "delivery_exception").in("entity_id", ids.slice(0, 500)).returns<{ entity_id: string }[]>();
  for (const a of data ?? []) out.set(a.entity_id, (out.get(a.entity_id) ?? 0) + 1);
  return out;
}

export const PROBLEM_LIST_LIMIT = 500;

export async function listProblems(client: SupabaseClient, filter: { orderId?: string; open?: boolean } = {}): Promise<ProblemRow[]> {
  let q = client.from("delivery_exceptions").select(SELECT).order("created_at", { ascending: false }).limit(PROBLEM_LIST_LIMIT);
  if (filter.orderId) q = q.eq("sales_order_id", filter.orderId);
  if (filter.open === true) q = q.not("status", "in", "(resolved,closed)");
  if (filter.open === false) q = q.in("status", ["resolved", "closed"]);
  const { data, error } = await q.returns<RawProblem[]>();
  if (error) throw new Error(`Couldn't load delivery problems: ${error.message}`);
  const rows = data ?? [];
  const photos = await photoCounts(client, rows.map((r) => r.id));
  return rows.map((r) => toRow(r, photos));
}

export async function getProblem(client: SupabaseClient, id: string): Promise<ProblemRow | null> {
  const { data, error } = await client.from("delivery_exceptions").select(SELECT).eq("id", id).maybeSingle<RawProblem>();
  if (error) throw new Error(`Couldn't load the delivery problem: ${error.message}`);
  if (!data) return null;
  return toRow(data, await photoCounts(client, [id]));
}

export interface NewProblem {
  orgId: string;
  orderId: string;
  shipmentId: string | null;
  raisedVia: RaisedVia;
  category: ProblemCategory;
  description: string | null;
  reporterName: string | null;
  claimDeadline: string | null;
  lines: { orderLineId: string; quantity: number | null }[];
}

export class DuplicateProblemError extends Error {}

/** Raise a problem and attach its lines. Staff pass their own client (raised_via 'staff' only); everything else the admin client. */
export async function insertProblem(db: SupabaseClient, p: NewProblem): Promise<string> {
  const { data, error } = await db
    .from("delivery_exceptions")
    .insert({
      org_id: p.orgId,
      sales_order_id: p.orderId,
      shipment_id: p.shipmentId,
      raised_via: p.raisedVia,
      category: p.category,
      description: p.description,
      reporter_name: p.reporterName,
      claim_deadline: p.claimDeadline,
    })
    .select("id")
    .single<{ id: string }>();
  if (error?.code === "23505") throw new DuplicateProblemError("open-carrier-problem");
  if (error || !data) throw new Error(`Couldn't raise the problem: ${error?.message ?? "no id"}`);
  if (p.lines.length > 0) {
    const { error: linesError } = await db.from("delivery_exception_lines").insert(p.lines.map((l) => ({ exception_id: data.id, order_line_id: l.orderLineId, quantity: l.quantity })));
    if (linesError) throw new Error(`Couldn't attach the lines: ${linesError.message}`);
  }
  return data.id;
}

export interface ProblemPatch {
  status?: ProblemStatus;
  ownerId?: string | null;
  category?: ProblemCategory;
  rootCause?: string | null;
  resolution?: Resolution | null;
  resolutionNote?: string | null;
  rmaReference?: string | null;
  replacementLineId?: string | null;
  claimDeadline?: string | null;
  claimSubmittedAt?: string | null;
}

export async function updateProblem(client: SupabaseClient, id: string, p: ProblemPatch): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.ownerId !== undefined) row.owner_id = p.ownerId;
  if (p.category !== undefined) row.category = p.category;
  if (p.rootCause !== undefined) row.root_cause = p.rootCause;
  if (p.resolution !== undefined) row.resolution = p.resolution;
  if (p.resolutionNote !== undefined) row.resolution_note = p.resolutionNote;
  if (p.rmaReference !== undefined) row.rma_reference = p.rmaReference;
  if (p.replacementLineId !== undefined) row.replacement_line_id = p.replacementLineId;
  if (p.claimDeadline !== undefined) row.claim_deadline = p.claimDeadline;
  if (p.claimSubmittedAt !== undefined) row.claim_submitted_at = p.claimSubmittedAt;
  const { data, error } = await client.from("delivery_exceptions").update(row).eq("id", id).select("id");
  if (error) throw new Error(`Couldn't update the problem: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export interface ProblemEvent {
  id: number;
  kind: "raised" | "status" | "owner" | "note" | "resolution" | "claim" | "photo";
  detail: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

export async function listProblemEvents(client: SupabaseClient, id: string): Promise<ProblemEvent[]> {
  const { data, error } = await client
    .from("delivery_exception_events")
    .select("id, kind, detail, actor_id, created_at")
    .eq("exception_id", id)
    .order("created_at", { ascending: true })
    .limit(500)
    .returns<{ id: number; kind: ProblemEvent["kind"]; detail: Record<string, unknown> | null; actor_id: string | null; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load the problem's history: ${error.message}`);
  return (data ?? []).map((e) => ({ id: e.id, kind: e.kind, detail: e.detail ?? {}, actorId: e.actor_id, createdAt: e.created_at }));
}

export async function insertProblemNote(client: SupabaseClient, id: string, actorId: string, text: string): Promise<void> {
  const { error } = await client.from("delivery_exception_events").insert({ exception_id: id, kind: "note", detail: { text }, actor_id: actorId });
  if (error) throw new Error(`Couldn't add the note: ${error.message}`);
}

/** System-written history (photos, resolutions): service-role only. */
export async function insertProblemEvent(admin: SupabaseClient, id: string, kind: "photo" | "resolution", detail: Record<string, unknown>, actorId: string | null): Promise<void> {
  const { error } = await admin.from("delivery_exception_events").insert({ exception_id: id, kind, detail, actor_id: actorId });
  if (error) throw new Error(`Couldn't record the problem's history: ${error.message}`);
}

// ── Lookups the system needs ────────────────────────────────────────────────
export async function openCarrierProblemFor(admin: SupabaseClient, shipmentId: string): Promise<string | null> {
  const { data } = await admin
    .from("delivery_exceptions")
    .select("id")
    .eq("shipment_id", shipmentId)
    .eq("raised_via", "carrier")
    .not("status", "in", "(resolved,closed)")
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/** What a customer sees of their order's problems: three fields only, the rest is masked out here and in toCustomerView. */
export async function listCustomerProblems(admin: SupabaseClient, orderId: string): Promise<{ id: string; category: string; status: string; createdAt: string; raisedVia: string }[]> {
  const { data, error } = await admin
    .from("delivery_exceptions")
    .select("id, category, status, created_at, raised_via")
    .eq("sales_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<{ id: string; category: string; status: string; created_at: string; raised_via: string }[]>();
  if (error) throw new Error(`Couldn't load problems: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, category: r.category, status: r.status, createdAt: r.created_at, raisedVia: r.raised_via }));
}

export async function countCustomerReportsToday(admin: SupabaseClient, orderId: string, sinceIso: string): Promise<number> {
  const { count } = await admin.from("delivery_exceptions").select("id", { count: "exact", head: true }).eq("sales_order_id", orderId).eq("raised_via", "customer").gte("created_at", sinceIso);
  return count ?? 0;
}

/** Add a replacement line to the order, copying the faulty one (service role, after the caller's permission check). */
export async function addReplacementLine(admin: SupabaseClient, orderLineId: string, quantity: number | null): Promise<{ id: string; lineNo: number } | null> {
  const { data: line } = await admin
    .from("order_lines")
    .select("sales_order_id, sku, description, quantity, route, hs_code, country_of_origin, dangerous_goods")
    .eq("id", orderLineId)
    .maybeSingle<{ sales_order_id: string; sku: string | null; description: string; quantity: number | string; route: string; hs_code: string | null; country_of_origin: string | null; dangerous_goods: string | null }>();
  if (!line) return null;
  const { data: last } = await admin.from("order_lines").select("line_no").eq("sales_order_id", line.sales_order_id).order("line_no", { ascending: false }).limit(1).maybeSingle<{ line_no: number }>();
  const lineNo = (last?.line_no ?? 0) + 1;
  if (lineNo > 999) return null;
  const description = `Replacement: ${line.description}`.slice(0, 500);
  const { data, error } = await admin
    .from("order_lines")
    .insert({
      sales_order_id: line.sales_order_id,
      line_no: lineNo,
      sku: line.sku,
      description,
      quantity: quantity ?? Number(line.quantity),
      route: line.route,
      hs_code: line.hs_code,
      country_of_origin: line.country_of_origin,
      dangerous_goods: line.dangerous_goods,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`Couldn't add the replacement line: ${error?.message ?? "no id"}`);
  return { id: data.id, lineNo };
}

// ── Photos ──────────────────────────────────────────────────────────────────
export const ATTACHMENTS_BUCKET = "attachments";

export interface AttachmentRow {
  id: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByKind: "customer" | "staff";
  uploadedBy: string | null;
  createdAt: string;
}

export async function listPhotos(client: SupabaseClient, problemId: string): Promise<AttachmentRow[]> {
  const { data, error } = await client
    .from("attachments")
    .select("id, storage_path, file_name, content_type, size_bytes, uploaded_by_kind, uploaded_by, created_at")
    .eq("entity_type", "delivery_exception")
    .eq("entity_id", problemId)
    .order("created_at")
    .returns<{ id: string; storage_path: string; file_name: string; content_type: string; size_bytes: number; uploaded_by_kind: "customer" | "staff"; uploaded_by: string | null; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load photos: ${error.message}`);
  return (data ?? []).map((a) => ({ id: a.id, storagePath: a.storage_path, fileName: a.file_name, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedByKind: a.uploaded_by_kind, uploadedBy: a.uploaded_by, createdAt: a.created_at }));
}

/** Store the file privately, then record it. Removes the file again if the record can't be written. */
export async function storePhoto(
  admin: SupabaseClient,
  p: { orgId: string; problemId: string; bytes: Uint8Array; contentType: string; extension: string; fileName: string; uploadedByKind: "customer" | "staff"; uploadedBy: string | null },
): Promise<void> {
  const id = crypto.randomUUID();
  const path = `${p.orgId}/delivery_exception/${p.problemId}/${id}.${p.extension}`;
  const { error: upError } = await admin.storage.from(ATTACHMENTS_BUCKET).upload(path, p.bytes, { contentType: p.contentType, upsert: false });
  if (upError) throw new Error(`Couldn't store the photo: ${upError.message}`);
  const { error } = await admin.from("attachments").insert({
    id,
    org_id: p.orgId,
    entity_type: "delivery_exception",
    entity_id: p.problemId,
    storage_path: path,
    file_name: p.fileName,
    content_type: p.contentType,
    size_bytes: p.bytes.byteLength,
    uploaded_by_kind: p.uploadedByKind,
    uploaded_by: p.uploadedBy,
  });
  if (error) {
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    throw new Error(`Couldn't record the photo: ${error.message}`);
  }
}

/** Short-lived links to view photos (the bucket is private). */
export async function signedPhotoUrls(admin: SupabaseClient, paths: readonly string[], seconds = 600): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await admin.storage.from(ATTACHMENTS_BUCKET).createSignedUrls([...paths], seconds);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

// ── Metrics ─────────────────────────────────────────────────────────────────
export async function problemRows(client: SupabaseClient, sinceIso: string) {
  const { data, error } = await client
    .from("delivery_exceptions")
    .select("id, category, raised_via, created_at, shipments(carrier), delivery_exception_lines(order_line_id)")
    .gte("created_at", sinceIso)
    .limit(5000)
    .returns<{ id: string; category: string; raised_via: string; created_at: string; shipments: { carrier: string } | null; delivery_exception_lines: { order_line_id: string }[] | null }[]>();
  if (error) throw new Error(`Couldn't load problem figures: ${error.message}`);
  return data ?? [];
}

// ── Customs ─────────────────────────────────────────────────────────────────
export interface CustomsSettings {
  eori: string | null;
  territoriesNeedCustoms: boolean;
}

export async function getCustomsSettings(client: SupabaseClient, orgId?: string): Promise<CustomsSettings> {
  let q = client.from("customs_settings").select("eori, territories_need_customs");
  if (orgId) q = q.eq("org_id", orgId);
  const { data } = await q.limit(1).maybeSingle<{ eori: string | null; territories_need_customs: boolean }>();
  return { eori: data?.eori ?? null, territoriesNeedCustoms: data?.territories_need_customs ?? true };
}

export async function saveCustomsSettings(client: SupabaseClient, orgId: string, userId: string, s: CustomsSettings): Promise<void> {
  const { data, error } = await client.from("customs_settings").update({ eori: s.eori, territories_need_customs: s.territoriesNeedCustoms, updated_by: userId }).eq("org_id", orgId).select("org_id");
  if (error) throw new Error(`Couldn't save customs settings: ${error.message}`);
  if ((data?.length ?? 0) === 0) throw new Error("not-allowed");
}

export interface CustomsDocRow {
  docType: DocType;
  required: boolean;
  receivedAt: string | null;
  receivedBy: string | null;
  note: string | null;
}

export async function listCustomsDocuments(client: SupabaseClient, shipmentId: string): Promise<CustomsDocRow[]> {
  const { data, error } = await client
    .from("customs_documents")
    .select("doc_type, required, received_at, received_by, note")
    .eq("shipment_id", shipmentId)
    .returns<{ doc_type: string; required: boolean; received_at: string | null; received_by: string | null; note: string | null }[]>();
  if (error) throw new Error(`Couldn't load customs documents: ${error.message}`);
  return (data ?? []).flatMap((d) => (isDocType(d.doc_type) ? [{ docType: d.doc_type, required: d.required, receivedAt: d.received_at, receivedBy: d.received_by, note: d.note }] : []));
}

export async function updateCustomsDocument(client: SupabaseClient, shipmentId: string, docType: DocType, p: { required?: boolean; received?: { at: string; by: string } | null; note?: string | null }): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (p.required !== undefined) row.required = p.required;
  if (p.received !== undefined) {
    row.received_at = p.received?.at ?? null;
    row.received_by = p.received?.by ?? null;
  }
  if (p.note !== undefined) row.note = p.note;
  const { data, error } = await client.from("customs_documents").update(row).eq("shipment_id", shipmentId).eq("doc_type", docType).select("doc_type");
  if (error) throw new Error(`Couldn't update the document: ${error.message}`);
  if ((data?.length ?? 0) > 0) return true;
  const { error: insertError } = await client.from("customs_documents").insert({ shipment_id: shipmentId, doc_type: docType, ...row });
  if (insertError) throw new Error(`Couldn't update the document: ${insertError.message}`);
  return true;
}

export async function setShipmentCustomsBorder(client: SupabaseClient, shipmentId: string, international: boolean): Promise<boolean> {
  const { data, error } = await client.from("shipments").update({ is_international: international, customs_confirmed: true }).eq("id", shipmentId).select("id");
  if (error) throw new Error(`Couldn't save: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function saveCustomerEori(client: SupabaseClient, customerId: string, eori: string | null): Promise<boolean> {
  const { data, error } = await client.from("customers").update({ eori }).eq("id", customerId).select("id");
  if (error) throw new Error(`Couldn't save the customs number: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
