/**
 * Security for Phase 6 goods-in: the narrow "due in" view and check-in
 * function only work for people who check deliveries in, inside their own
 * organisation; receipts are visible to order viewers and goods-in staff.
 */

import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(url && anonKey && serviceKey && password) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const CUSTOMER = "[RLS goods-in customer]";

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("goods-in security", () => {
  let service: SupabaseClient, goodsin: SupabaseClient, sales: SupabaseClient, adminB: SupabaseClient, procurement: SupabaseClient;
  let orgA: string, orderId: string, lineId: string, ids: Record<string, string>;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    [goodsin, sales, adminB, procurement] = (await Promise.all(["goodsin@demo-a", "sales@demo-a", "admin@demo-b", "procurement@demo-a"].map((u) => signedIn(`${u}.coast.test`)))) as SupabaseClient[] as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));
    const { data, error } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: CUSTOMER, customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP", promised_date: "",
        delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB",
        lines: [{ sku: "", description: "Goods-in crate", quantity: 5, unit_price_minor: 100, route: "via_warehouse" }],
      },
    });
    if (error) throw new Error(error.message);
    orderId = data as string;
    lineId = (await service.from("order_lines").select("id").eq("sales_order_id", orderId).single()).data!.id;
    const supplier = (await service.from("suppliers").select("id").eq("org_id", orgA).eq("name", "[Demo Supplier Two]").single()).data!.id;
    await procurement.rpc("create_purchase_order", { p: { supplier_id: supplier, currency: "GBP", lines: [{ order_line_id: lineId, quantity: 5, requested_date: "", unit_cost_minor: "" }] } });
  });

  afterAll(async () => {
    const { data: pls } = await service.from("purchase_order_lines").select("purchase_order_id").eq("order_line_id", lineId);
    for (const p of pls ?? []) await service.from("purchase_orders").delete().eq("id", p.purchase_order_id);
    if (orderId) await service.from("sales_orders").delete().eq("id", orderId);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
  });

  it("shows warehouse staff what's due in — without opening up orders to them", async () => {
    const due = (await goodsin.rpc("goods_in_expected")).data as { order_line_id: string; so_number: string }[];
    expect(due.some((d) => d.order_line_id === lineId)).toBe(true);
    expect((await goodsin.from("sales_orders").select("id").eq("id", orderId)).data).toEqual([]);
    expect((await sales.rpc("goods_in_expected")).data).toEqual([]);
    expect(((await adminB.rpc("goods_in_expected")).data as { order_line_id: string }[]).some((d) => d.order_line_id === lineId)).toBe(false);
    expect((await createClient(url!, anonKey!, opts).rpc("goods_in_expected")).error).not.toBeNull();
  });

  it("lets only goods-in staff check in, and only lines that are waiting", async () => {
    expect((await sales.rpc("record_goods_receipt", { p_line: lineId, p_quantity: 5, p_condition: "ok", p_note: "", p_shipment: null })).error).not.toBeNull();
    expect((await adminB.rpc("record_goods_receipt", { p_line: lineId, p_quantity: 5, p_condition: "ok", p_note: "", p_shipment: null })).error).not.toBeNull();
    // A short delivery is recorded and the line keeps waiting.
    expect((await goodsin.rpc("record_goods_receipt", { p_line: lineId, p_quantity: 2, p_condition: "short", p_note: "", p_shipment: null })).error).toBeNull();
    expect((await service.from("order_lines").select("stage").eq("id", lineId).single()).data!.stage).not.toBe("received");
    // The rest arrives: the line moves to Received.
    expect((await goodsin.rpc("record_goods_receipt", { p_line: lineId, p_quantity: 3, p_condition: "ok", p_note: "", p_shipment: null })).error).toBeNull();
    expect((await service.from("order_lines").select("stage").eq("id", lineId).single()).data!.stage).toBe("received");
    // Now it isn't waiting, so it can't be checked in again.
    expect((await goodsin.rpc("record_goods_receipt", { p_line: lineId, p_quantity: 1, p_condition: "ok", p_note: "", p_shipment: null })).error).not.toBeNull();
    // Bad condition values are refused.
    expect((await service.from("goods_receipts").insert({ org_id: orgA, order_line_id: lineId, quantity_received: 1, condition: "lost" })).error).not.toBeNull();
  });

  it("lets order viewers and goods-in staff see check-ins; nobody writes them directly", async () => {
    expect((await sales.from("goods_receipts").select("condition").eq("order_line_id", lineId)).data).toHaveLength(2);
    expect((await goodsin.from("goods_receipts").select("condition").eq("order_line_id", lineId)).data).toHaveLength(2);
    expect((await adminB.from("goods_receipts").select("id").eq("order_line_id", lineId)).data).toEqual([]);
    expect((await goodsin.from("goods_receipts").insert({ org_id: orgA, order_line_id: lineId, quantity_received: 1, condition: "ok" })).error).not.toBeNull();
    const kinds = (await sales.from("order_events").select("kind").eq("sales_order_id", orderId)).data!.map((e) => e.kind);
    expect(kinds.filter((k) => k === "goods_received")).toHaveLength(2);
  });
});
