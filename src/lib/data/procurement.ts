import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCurrency, type Currency } from "@/lib/logic/format";
import type { PoStatus, ValidPo, ValidSupplier } from "@/lib/logic/purchase-orders";
import { DuplicateError } from "./orders";

/**
 * Suppliers and purchase orders. RLS returns nothing at all to people who
 * can't see supplier identity, and no cost rows to people who can't see costs.
 */

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  currency: Currency;
  leadTimeDays: number | null;
  isActive: boolean;
}

interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  currency: string;
  typical_lead_time_days: number | null;
  is_active: boolean;
}

export async function listSuppliers(client: SupabaseClient): Promise<Supplier[]> {
  const { data, error } = await client
    .from("suppliers")
    .select("id, name, email, phone, currency, typical_lead_time_days, is_active")
    .order("name")
    .returns<SupplierRow[]>();
  if (error) throw new Error(`Couldn't load suppliers: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    currency: isCurrency(s.currency) ? s.currency : "GBP",
    leadTimeDays: s.typical_lead_time_days,
    isActive: s.is_active,
  }));
}

export async function createSupplier(client: SupabaseClient, orgId: string, s: ValidSupplier): Promise<string> {
  const { data, error } = await client
    .from("suppliers")
    .insert({ org_id: orgId, name: s.name, email: s.email, phone: s.phone, currency: s.currency, typical_lead_time_days: s.leadTimeDays })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if (error.code === "23505") throw new DuplicateError("There's already a supplier with that name.");
    throw new Error(`Couldn't add supplier: ${error.message}`);
  }
  return data.id;
}

export interface PoListItem {
  id: string;
  poNumber: string;
  status: PoStatus;
  currency: Currency;
  supplierName: string;
  createdAt: string;
  orders: { id: string; soNumber: string }[];
  lineCount: number;
}

interface PoListRow {
  id: string;
  po_number: string;
  status: PoStatus;
  currency: string;
  created_at: string;
  suppliers: { name: string } | null;
  purchase_order_lines: { order_lines: { sales_orders: { id: string; so_number: string } | null } | null }[];
}

export async function listPurchaseOrders(client: SupabaseClient): Promise<PoListItem[]> {
  const { data, error } = await client
    .from("purchase_orders")
    .select("id, po_number, status, currency, created_at, suppliers(name), purchase_order_lines(order_lines(sales_orders(id, so_number)))")
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<PoListRow[]>();
  if (error) throw new Error(`Couldn't load purchase orders: ${error.message}`);
  return (data ?? []).map((p) => {
    const orders = new Map<string, string>();
    for (const pl of p.purchase_order_lines ?? []) {
      const so = pl.order_lines?.sales_orders;
      if (so) orders.set(so.id, so.so_number);
    }
    return {
      id: p.id,
      poNumber: p.po_number,
      status: p.status,
      currency: isCurrency(p.currency) ? p.currency : "GBP",
      supplierName: p.suppliers?.name ?? "",
      createdAt: p.created_at,
      orders: [...orders].map(([id, soNumber]) => ({ id, soNumber })),
      lineCount: p.purchase_order_lines?.length ?? 0,
    };
  });
}

export interface PoDetail extends Omit<PoListItem, "orders" | "lineCount"> {
  supplierEmail: string | null;
  lines: {
    id: string;
    quantity: number;
    requestedDate: string | null;
    unitCostMinor: number | null;
    description: string;
    sku: string | null;
    orderId: string;
    soNumber: string;
    customerName: string;
  }[];
}

interface PoDetailRow {
  id: string;
  po_number: string;
  status: PoStatus;
  currency: string;
  created_at: string;
  suppliers: { name: string; email: string | null } | null;
  purchase_order_lines: {
    id: string;
    quantity: number | string;
    requested_date: string | null;
    purchase_order_line_costs: { unit_cost_minor: number } | null;
    order_lines: { description: string; sku: string | null; sales_orders: { id: string; so_number: string; customers: { name: string } | null } | null } | null;
  }[];
}

export async function getPurchaseOrder(client: SupabaseClient, id: string): Promise<PoDetail | null> {
  const { data, error } = await client
    .from("purchase_orders")
    .select(
      `id, po_number, status, currency, created_at, suppliers(name, email),
       purchase_order_lines(id, quantity, requested_date, purchase_order_line_costs(unit_cost_minor),
         order_lines(description, sku, sales_orders(id, so_number, customers(name))))`,
    )
    .eq("id", id)
    .maybeSingle<PoDetailRow>();
  if (error) throw new Error(`Couldn't load purchase order: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    poNumber: data.po_number,
    status: data.status,
    currency: isCurrency(data.currency) ? data.currency : "GBP",
    supplierName: data.suppliers?.name ?? "",
    supplierEmail: data.suppliers?.email ?? null,
    createdAt: data.created_at,
    lines: (data.purchase_order_lines ?? []).map((pl) => ({
      id: pl.id,
      quantity: Number(pl.quantity),
      requestedDate: pl.requested_date,
      unitCostMinor: pl.purchase_order_line_costs?.unit_cost_minor ?? null,
      description: pl.order_lines?.description ?? "",
      sku: pl.order_lines?.sku ?? null,
      orderId: pl.order_lines?.sales_orders?.id ?? "",
      soNumber: pl.order_lines?.sales_orders?.so_number ?? "",
      customerName: pl.order_lines?.sales_orders?.customers?.name ?? "",
    })),
  };
}

export async function createPurchaseOrder(client: SupabaseClient, po: ValidPo): Promise<string> {
  const { data, error } = await client.rpc("create_purchase_order", {
    p: {
      supplier_id: po.supplierId,
      currency: po.currency,
      lines: po.lines.map((l) => ({
        order_line_id: l.orderLineId,
        quantity: l.quantity,
        requested_date: l.requestedDate ?? "",
        unit_cost_minor: l.unitCostMinor ?? "",
      })),
    },
  });
  if (error) throw new Error(`Couldn't create purchase order: ${error.message}`);
  return data as string;
}

/** Only updates if the PO is still at `from`. */
export async function updatePoStatus(client: SupabaseClient, id: string, from: PoStatus, to: PoStatus): Promise<boolean> {
  const { data, error } = await client.from("purchase_orders").update({ status: to }).eq("id", id).eq("status", from).select("id");
  if (error) throw new Error(`Couldn't change status: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function getPoStatus(client: SupabaseClient, id: string): Promise<PoStatus | null> {
  const { data, error } = await client.from("purchase_orders").select("status").eq("id", id).maybeSingle<{ status: PoStatus }>();
  if (error) throw new Error(`Couldn't load purchase order: ${error.message}`);
  return data?.status ?? null;
}
