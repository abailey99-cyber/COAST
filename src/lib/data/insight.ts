import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderEventKind } from "@/lib/logic/order-list";

/**
 * Reads for Phase 6: the organisation-wide history (the Updates feed),
 * goods-in, and the raw rows behind Metrics and the Chases screen. Reads
 * and writes only; every read uses the signed-in client, so RLS decides
 * what each person can see (supplier rows simply don't come back for
 * people who can't see suppliers).
 */

// ── Feed ────────────────────────────────────────────────────────────────────
export interface FeedEvent {
  id: number;
  orderId: string;
  soNumber: string;
  orderLineId: string | null;
  kind: OrderEventKind;
  detail: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
  lines: { id: string; lineNo: number; route: string }[];
}

export async function listOrgEvents(client: SupabaseClient, filter: { before?: number; limit?: number; kinds?: readonly string[] } = {}): Promise<FeedEvent[]> {
  let q = client
    .from("order_events")
    .select("id, sales_order_id, order_line_id, kind, detail, actor_id, created_at, sales_orders!inner(so_number, order_lines(id, line_no, route))")
    .order("id", { ascending: false })
    .limit(filter.limit ?? 100);
  if (filter.before) q = q.lt("id", filter.before);
  if (filter.kinds) q = q.in("kind", filter.kinds as string[]);
  const { data, error } = await q.returns<
    { id: number; sales_order_id: string; order_line_id: string | null; kind: OrderEventKind; detail: Record<string, unknown> | null; actor_id: string | null; created_at: string; sales_orders: { so_number: string; order_lines: { id: string; line_no: number; route: string }[] | null } | null }[]
  >();
  if (error) throw new Error(`Couldn't load updates: ${error.message}`);
  return (data ?? []).map((e) => ({
    id: e.id,
    orderId: e.sales_order_id,
    soNumber: e.sales_orders?.so_number ?? "",
    orderLineId: e.order_line_id,
    kind: e.kind,
    detail: e.detail ?? {},
    actorId: e.actor_id,
    createdAt: e.created_at,
    lines: (e.sales_orders?.order_lines ?? []).map((l) => ({ id: l.id, lineNo: l.line_no, route: l.route })),
  }));
}

/** PO numbers this person may see, by id (for wording PO events). */
export async function poNumbersById(client: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await client.from("purchase_orders").select("id, po_number").in("id", [...new Set(ids)]).returns<{ id: string; po_number: string }[]>();
  return new Map((data ?? []).map((p) => [p.id, p.po_number]));
}

// ── Goods-in ────────────────────────────────────────────────────────────────
export interface ExpectedLine {
  orderLineId: string;
  soNumber: string;
  customerName: string;
  lineNo: number;
  description: string;
  sku: string | null;
  quantity: number;
  stage: string;
  poNumber: string | null;
  supplierName: string | null;
  confirmedDate: string | null;
  tracking: { carrier: string; tracking: string | null; status: string; eta_from: string | null; eta_to: string | null; shipment_id: string }[];
  receivedSoFar: number;
}

export async function listExpected(client: SupabaseClient): Promise<ExpectedLine[]> {
  const { data, error } = await client.rpc("goods_in_expected");
  if (error) throw new Error(`Couldn't load what's due in: ${error.message}`);
  return ((data ?? []) as {
    order_line_id: string; so_number: string; customer_name: string; line_no: number; description: string; sku: string | null; quantity: number | string; stage: string;
    po_number: string | null; supplier_name: string | null; confirmed_date: string | null; tracking: ExpectedLine["tracking"] | null; received_so_far: number | string;
  }[]).map((r) => ({
    orderLineId: r.order_line_id,
    soNumber: r.so_number,
    customerName: r.customer_name,
    lineNo: r.line_no,
    description: r.description,
    sku: r.sku,
    quantity: Number(r.quantity),
    stage: r.stage,
    poNumber: r.po_number,
    supplierName: r.supplier_name,
    confirmedDate: r.confirmed_date,
    tracking: r.tracking ?? [],
    receivedSoFar: Number(r.received_so_far),
  }));
}

export async function recordReceipt(client: SupabaseClient, r: { lineId: string; quantity: number; condition: string; note: string | null; shipmentId: string | null }): Promise<string> {
  const { data, error } = await client.rpc("record_goods_receipt", { p_line: r.lineId, p_quantity: r.quantity, p_condition: r.condition, p_note: r.note ?? "", p_shipment: r.shipmentId });
  if (error) throw new Error(error.code === "42501" ? "not-allowed" : error.code === "22023" ? "not-waiting" : `Couldn't record the delivery: ${error.message}`);
  return data as string;
}

export interface ReceiptRow {
  id: string;
  orderLineId: string;
  quantity: number;
  condition: string;
  note: string | null;
  receivedBy: string | null;
  receivedAt: string;
}

export async function listRecentReceipts(client: SupabaseClient, limit = 30): Promise<(ReceiptRow & { soNumber: string | null; description: string | null })[]> {
  const { data, error } = await client
    .from("goods_receipts")
    .select("id, order_line_id, quantity_received, condition, note, received_by, received_at")
    .order("received_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; order_line_id: string; quantity_received: number | string; condition: string; note: string | null; received_by: string | null; received_at: string }[]>();
  if (error) throw new Error(`Couldn't load check-ins: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, orderLineId: r.order_line_id, quantity: Number(r.quantity_received), condition: r.condition, note: r.note, receivedBy: r.received_by, receivedAt: r.received_at, soNumber: null, description: null }));
}

// ── Raw rows for Metrics ────────────────────────────────────────────────────
export async function metricsRows(client: SupabaseClient, sinceIso: string) {
  const [orders, pos, responses, poLines, receipts] = await Promise.all([
    client
      .from("sales_orders")
      .select("id, promised_date, created_at, order_lines(stage, route), order_predictions(at_risk), shipments(leg, carrier, status, delivered_at)")
      .gte("created_at", sinceIso)
      .limit(5000),
    client.from("purchase_orders").select("id, supplier_id, sent_at, created_at, currency, status, suppliers(name, typical_lead_time_days)").gte("created_at", sinceIso).limit(5000),
    client.from("supplier_responses").select("purchase_order_id, source, status, created_at").gte("created_at", sinceIso).limit(10000),
    client
      .from("purchase_order_lines")
      .select("id, purchase_order_id, order_line_id, quantity, confirmed_date, purchase_order_line_costs(unit_cost_minor, confirmed_unit_cost_minor), order_lines(route, stage, sales_order_id)")
      .gte("created_at", sinceIso)
      .limit(10000),
    client.from("goods_receipts").select("order_line_id, received_at, condition").gte("received_at", sinceIso).limit(10000),
  ]);
  for (const r of [orders, pos, responses, poLines, receipts]) if (r.error) throw new Error(`Couldn't load figures: ${r.error.message}`);
  return {
    orders: (orders.data ?? []) as unknown as {
      id: string;
      promised_date: string | null;
      created_at: string;
      order_lines: { stage: string; route: string }[] | null;
      order_predictions: { at_risk: boolean | null } | { at_risk: boolean | null }[] | null;
      shipments: { leg: string; carrier: string; status: string; delivered_at: string | null }[] | null;
    }[],
    pos: (pos.data ?? []) as unknown as { id: string; supplier_id: string; sent_at: string | null; created_at: string; currency: string; status: string; suppliers: { name: string; typical_lead_time_days: number | null } | null }[],
    responses: (responses.data ?? []) as { purchase_order_id: string; source: "link" | "paste" | "inbound"; status: "applied" | "needs_review" | "accepted" | "rejected"; created_at: string }[],
    poLines: (poLines.data ?? []) as unknown as {
      id: string;
      purchase_order_id: string;
      order_line_id: string;
      quantity: number | string;
      confirmed_date: string | null;
      purchase_order_line_costs: { unit_cost_minor: number; confirmed_unit_cost_minor: number | null } | null;
      order_lines: { route: string; stage: string; sales_order_id: string } | null;
    }[],
    receipts: (receipts.data ?? []) as { order_line_id: string; received_at: string; condition: string }[],
  };
}

// ── Raw rows for the Chases screen ──────────────────────────────────────────
export async function waitingRows(client: SupabaseClient) {
  const [pos, chases, reviews, messages, shipments, problems] = await Promise.all([
    client.from("purchase_orders").select("id, po_number, status, sent_at, created_at, suppliers(name)").in("status", ["draft", "sent"]).limit(1000),
    client.from("chases").select("id, kind, purchase_order_id, sales_order_id, order_line_id, note, opened_at, last_chased_at, chase_count, sales_orders(so_number)").eq("status", "open").limit(1000),
    client.from("supplier_responses").select("id, purchase_order_id, created_at, purchase_orders(po_number)").eq("status", "needs_review").limit(500),
    client.from("order_messages").select("id, sales_order_id, created_at, body, sales_orders(so_number)").eq("author_kind", "customer").is("read_at", null).limit(500),
    client.from("shipments").select("id, sales_order_id, carrier, tracking_number, status, updated_at, is_international, customs_status, sales_orders(so_number)").in("status", ["exception", "unknown", "pre_transit", "in_transit", "out_for_delivery"]).limit(1000),
    client.from("delivery_exceptions").select("id, sales_order_id, category, status, waiting_since, shipment_id, sales_orders(so_number)").not("status", "in", "(resolved,closed)").limit(1000),
  ]);
  for (const r of [pos, chases, reviews, messages, shipments, problems]) if (r.error) throw new Error(`Couldn't load what's waiting: ${r.error.message}`);
  return {
    pos: (pos.data ?? []) as unknown as { id: string; po_number: string; status: string; sent_at: string | null; created_at: string; suppliers: { name: string } | null }[],
    chases: (chases.data ?? []) as unknown as { id: string; kind: "supplier" | "internal"; purchase_order_id: string | null; sales_order_id: string | null; order_line_id: string | null; note: string | null; opened_at: string; last_chased_at: string | null; chase_count: number; sales_orders: { so_number: string } | null }[],
    reviews: (reviews.data ?? []) as unknown as { id: string; purchase_order_id: string; created_at: string; purchase_orders: { po_number: string } | null }[],
    messages: (messages.data ?? []) as unknown as { id: string; sales_order_id: string; created_at: string; body: string; sales_orders: { so_number: string } | null }[],
    shipments: (shipments.data ?? []) as unknown as { id: string; sales_order_id: string; carrier: string; tracking_number: string | null; status: string; updated_at: string; is_international: boolean; customs_status: string; sales_orders: { so_number: string } | null }[],
    problems: (problems.data ?? []) as unknown as { id: string; sales_order_id: string; category: string; status: string; waiting_since: string; shipment_id: string | null; sales_orders: { so_number: string } | null }[],
  };
}
