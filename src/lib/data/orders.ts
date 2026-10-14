import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCurrency, type Currency } from "@/lib/logic/format";
import { isFulfilmentRoute, isLineStage, type FulfilmentRoute, type LineStage, type ValidOrder } from "@/lib/logic/orders";
import type { PoStatus } from "@/lib/logic/purchase-orders";

/**
 * Sales orders and their lines. Reads and writes only. Every call uses the
 * signed-in user's client, so RLS decides what comes back — including
 * whether purchase orders, supplier names and costs are visible at all.
 */

export interface OrderListItem {
  id: string;
  soNumber: string;
  customerName: string;
  customerReference: string | null;
  salesRepId: string | null;
  salesRepName: string | null;
  promisedDate: string | null;
  createdAt: string;
  lines: { route: FulfilmentRoute; stage: LineStage }[];
}

interface ListRow {
  id: string;
  so_number: string;
  customer_reference: string | null;
  sales_rep_id: string | null;
  promised_date: string | null;
  created_at: string;
  customers: { name: string } | null;
  staff_users: { full_name: string } | null;
  order_lines: { route: string; stage: string }[];
}

export const ORDER_LIST_LIMIT = 500;

function cleanLines(rows: { route: string; stage: string }[]) {
  return rows.flatMap((l) => (isFulfilmentRoute(l.route) && isLineStage(l.stage) ? [{ route: l.route, stage: l.stage }] : []));
}

export async function listOrders(client: SupabaseClient, filter: { repId?: string; ids?: string[] } = {}): Promise<OrderListItem[]> {
  let query = client
    .from("sales_orders")
    .select("id, so_number, customer_reference, sales_rep_id, promised_date, created_at, customers(name), staff_users(full_name), order_lines(route, stage)")
    .order("created_at", { ascending: false })
    .limit(ORDER_LIST_LIMIT);
  if (filter.repId) query = query.eq("sales_rep_id", filter.repId);
  if (filter.ids) query = query.in("id", filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query.returns<ListRow[]>();
  if (error) throw new Error(`Couldn't load orders: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    soNumber: r.so_number,
    customerName: r.customers?.name ?? "",
    customerReference: r.customer_reference,
    salesRepId: r.sales_rep_id,
    salesRepName: r.staff_users?.full_name ?? null,
    promisedDate: r.promised_date,
    createdAt: r.created_at,
    lines: cleanLines(r.order_lines ?? []),
  }));
}

export async function searchOrderIds(client: SupabaseClient, q: string): Promise<string[]> {
  const { data, error } = await client.rpc("search_order_ids", { q });
  if (error) throw new Error(`Couldn't search orders: ${error.message}`);
  return ((data ?? []) as string[]).slice(0, ORDER_LIST_LIMIT);
}

export interface PoLink {
  poLineId: string;
  purchaseOrderId: string;
  poNumber: string;
  status: PoStatus;
  supplierName: string;
  quantity: number;
  requestedDate: string | null;
  /** null when not set, or when the viewer can't see costs (RLS returns nothing). */
  unitCostMinor: number | null;
}

export interface OrderLineDetail {
  id: string;
  lineNo: number;
  sku: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number | null;
  route: FulfilmentRoute;
  stage: LineStage;
  poLinks: PoLink[];
}

export interface OrderDetail extends Omit<OrderListItem, "lines"> {
  currency: Currency;
  trackingCode: string;
  delivery: { name: string; line1: string; line2: string | null; town: string; postcode: string; country: string };
  lines: OrderLineDetail[];
}

interface DetailRow {
  id: string;
  so_number: string;
  customer_reference: string | null;
  sales_rep_id: string | null;
  promised_date: string | null;
  created_at: string;
  currency: string;
  tracking_code: string;
  delivery_name: string;
  delivery_line1: string;
  delivery_line2: string | null;
  delivery_town: string;
  delivery_postcode: string;
  delivery_country: string;
  customers: { name: string } | null;
  staff_users: { full_name: string } | null;
  order_lines: {
    id: string;
    line_no: number;
    sku: string | null;
    description: string;
    quantity: number | string;
    unit_price_minor: number | null;
    route: string;
    stage: string;
    purchase_order_lines: {
      id: string;
      quantity: number | string;
      requested_date: string | null;
      purchase_orders: { id: string; po_number: string; status: PoStatus; suppliers: { name: string } | null } | null;
      purchase_order_line_costs: { unit_cost_minor: number } | null;
    }[];
  }[];
}

export async function getOrder(client: SupabaseClient, id: string): Promise<OrderDetail | null> {
  const { data, error } = await client
    .from("sales_orders")
    .select(
      `id, so_number, customer_reference, sales_rep_id, promised_date, created_at, currency, tracking_code,
       delivery_name, delivery_line1, delivery_line2, delivery_town, delivery_postcode, delivery_country,
       customers(name), staff_users(full_name),
       order_lines(id, line_no, sku, description, quantity, unit_price_minor, route, stage,
         purchase_order_lines(id, quantity, requested_date,
           purchase_orders(id, po_number, status, suppliers(name)),
           purchase_order_line_costs(unit_cost_minor)))`,
    )
    .eq("id", id)
    .maybeSingle<DetailRow>();
  if (error) throw new Error(`Couldn't load order: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    soNumber: data.so_number,
    customerName: data.customers?.name ?? "",
    customerReference: data.customer_reference,
    salesRepId: data.sales_rep_id,
    salesRepName: data.staff_users?.full_name ?? null,
    promisedDate: data.promised_date,
    createdAt: data.created_at,
    currency: isCurrency(data.currency) ? data.currency : "GBP",
    trackingCode: data.tracking_code,
    delivery: {
      name: data.delivery_name,
      line1: data.delivery_line1,
      line2: data.delivery_line2,
      town: data.delivery_town,
      postcode: data.delivery_postcode,
      country: data.delivery_country,
    },
    lines: (data.order_lines ?? [])
      .filter((l) => isFulfilmentRoute(l.route) && isLineStage(l.stage))
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        sku: l.sku,
        description: l.description,
        quantity: Number(l.quantity),
        unitPriceMinor: l.unit_price_minor,
        route: l.route as FulfilmentRoute,
        stage: l.stage as LineStage,
        poLinks: (l.purchase_order_lines ?? []).flatMap((pl) =>
          pl.purchase_orders
            ? [
                {
                  poLineId: pl.id,
                  purchaseOrderId: pl.purchase_orders.id,
                  poNumber: pl.purchase_orders.po_number,
                  status: pl.purchase_orders.status,
                  supplierName: pl.purchase_orders.suppliers?.name ?? "",
                  quantity: Number(pl.quantity),
                  requestedDate: pl.requested_date,
                  unitCostMinor: pl.purchase_order_line_costs?.unit_cost_minor ?? null,
                },
              ]
            : [],
        ),
      })),
  };
}

export async function createOrder(client: SupabaseClient, order: ValidOrder): Promise<string> {
  const { data, error } = await client.rpc("create_sales_order", {
    p: {
      customer_name: order.customerName,
      customer_reference: order.customerReference ?? "",
      so_number: order.soNumber ?? "",
      sales_rep_id: order.salesRepId ?? "",
      currency: order.currency,
      promised_date: order.promisedDate ?? "",
      delivery_name: order.delivery.name,
      delivery_line1: order.delivery.line1,
      delivery_line2: order.delivery.line2 ?? "",
      delivery_town: order.delivery.town,
      delivery_postcode: order.delivery.postcode,
      delivery_country: order.delivery.country,
      lines: order.lines.map((l) => ({
        sku: l.sku ?? "",
        description: l.description,
        quantity: l.quantity,
        unit_price_minor: l.unitPriceMinor ?? "",
        route: l.route,
      })),
    },
  });
  if (error) {
    if (error.code === "23505") throw new DuplicateError("That SO number is already used.");
    throw new Error(`Couldn't create order: ${error.message}`);
  }
  return data as string;
}

export class DuplicateError extends Error {}

export async function getLineForStageChange(client: SupabaseClient, lineId: string): Promise<{ id: string; salesOrderId: string; route: FulfilmentRoute; stage: LineStage } | null> {
  const { data, error } = await client.from("order_lines").select("id, sales_order_id, route, stage").eq("id", lineId).maybeSingle<{ id: string; sales_order_id: string; route: string; stage: string }>();
  if (error) throw new Error(`Couldn't load line: ${error.message}`);
  if (!data || !isFulfilmentRoute(data.route) || !isLineStage(data.stage)) return null;
  return { id: data.id, salesOrderId: data.sales_order_id, route: data.route, stage: data.stage };
}

/** Only updates if the line is still at `from`, so two people can't race each other. */
export async function updateLineStage(client: SupabaseClient, lineId: string, from: LineStage, to: LineStage): Promise<boolean> {
  const { data, error } = await client.from("order_lines").update({ stage: to }).eq("id", lineId).eq("stage", from).select("id");
  if (error) throw new Error(`Couldn't change stage: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export interface OrderEvent {
  id: number;
  kind: "order_created" | "line_stage_changed" | "po_raised" | "po_status_changed";
  orderLineId: string | null;
  detail: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
}

export async function listOrderEvents(client: SupabaseClient, orderId: string): Promise<OrderEvent[]> {
  const { data, error } = await client
    .from("order_events")
    .select("id, kind, order_line_id, detail, actor_id, created_at")
    .eq("sales_order_id", orderId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200)
    .returns<{ id: number; kind: OrderEvent["kind"]; order_line_id: string | null; detail: Record<string, unknown>; actor_id: string | null; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load order history: ${error.message}`);
  return (data ?? []).map((e) => ({ id: e.id, kind: e.kind, orderLineId: e.order_line_id, detail: e.detail ?? {}, actorId: e.actor_id, createdAt: e.created_at }));
}
