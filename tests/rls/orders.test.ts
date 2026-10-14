/**
 * Row-level security for orders, suppliers, purchase orders, costs, history
 * and the audit log (Phase 1). Runs against the Supabase development project
 * as the demo users; skipped when it isn't configured (see KNOWN-GAPS.md).
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

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} — run npm run db:seed-demo first. (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("orders and procurement security", () => {
  let service: SupabaseClient;
  let adminA: SupabaseClient, adminB: SupabaseClient, procurement: SupabaseClient, sales: SupabaseClient, sales2: SupabaseClient, director: SupabaseClient;
  let ids: Record<string, string>;
  let orgA: string;
  const created: string[] = [];

  const newOrder = (overrides: Record<string, unknown> = {}) => ({
    customer_name: "[RLS test customer]",
    customer_reference: "RLS-REF-1",
    so_number: "",
    sales_rep_id: ids["sales@demo-a.coast.test"],
    currency: "GBP",
    promised_date: "2026-11-02",
    delivery_name: "[RLS test] Goods In",
    delivery_line1: "1 Test Street",
    delivery_line2: "",
    delivery_town: "Newark",
    delivery_postcode: "NG24 1AB",
    delivery_country: "GB",
    lines: [{ sku: "RLS-1", description: "RLS test item", quantity: 3, unit_price_minor: 1000, route: "direct_ship" }],
    ...overrides,
  });

  const block = (who: string, permission: string) =>
    service.from("staff_permission_overrides").upsert({ user_id: ids[who]!, permission, granted: false, set_by: null }, { onConflict: "user_id,permission" });

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    [adminA, adminB, procurement, sales, sales2, director] = (await Promise.all(
      ["admin@demo-a", "admin@demo-b", "procurement@demo-a", "sales@demo-a", "sales2@demo-a", "director@demo-a"].map((u) => signedIn(`${u}.coast.test`)),
    )) as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));
  });

  afterAll(async () => {
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));
    if (created.length) {
      const lines = await service.from("order_lines").select("id").in("sales_order_id", created);
      const lineIds = (lines.data ?? []).map((l) => l.id);
      if (lineIds.length) {
        const pols = await service.from("purchase_order_lines").select("purchase_order_id").in("order_line_id", lineIds);
        const poIds = [...new Set((pols.data ?? []).map((p) => p.purchase_order_id))];
        if (poIds.length) await service.from("purchase_orders").delete().in("id", poIds);
      }
      await service.from("sales_orders").delete().in("id", created);
    }
    await service.from("customers").delete().eq("org_id", orgA).like("name", "[RLS test%");
  });

  it("creates an order in one step, numbered and with a random tracking code", async () => {
    const { data: id, error } = await procurement.rpc("create_sales_order", { p: newOrder() });
    expect(error).toBeNull();
    created.push(id as string);
    const { data } = await procurement.from("sales_orders").select("so_number, tracking_code, order_lines(stage, route)").eq("id", id).single();
    expect(data!.so_number).toMatch(/^SO-\d{5,}$/);
    expect(data!.tracking_code).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
    expect(data!.order_lines).toEqual([{ stage: "ordered", route: "direct_ship" }]);

    const events = await procurement.from("order_events").select("kind").eq("sales_order_id", id);
    expect(events.data!.map((e) => e.kind)).toContain("order_created");
  });

  it("keeps every order table away from another organisation", async () => {
    for (const table of ["sales_orders", "customers", "suppliers", "purchase_orders", "order_events", "audit_log"]) {
      const { data } = await adminB.from(table).select("*").limit(50);
      const rows = (data ?? []) as Record<string, unknown>[];
      expect(rows.every((r) => !("org_id" in r) || r.org_id !== orgA), table).toBe(true);
    }
    const lines = await adminB.from("order_lines").select("id").eq("sales_order_id", created[0]!);
    expect(lines.data).toEqual([]);
  });

  it("refuses an order placed in another organisation", async () => {
    const cust = await adminA.from("customers").select("id").eq("name", "[RLS test customer]").single();
    const res = await adminB.from("sales_orders").insert({
      org_id: orgA, so_number: "SO-HACK-1", customer_id: cust.data!.id, currency: "GBP",
      delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "x",
    });
    expect(res.error).not.toBeNull();
  });

  it("stops a director (view-only) changing orders", async () => {
    const r1 = await director.rpc("create_sales_order", { p: newOrder() });
    expect(r1.error).not.toBeNull();
    const line = await service.from("order_lines").select("id").eq("sales_order_id", created[0]!).single();
    const r2 = await director.from("order_lines").update({ stage: "dispatched" }).eq("id", line.data!.id).select();
    expect(r2.data ?? []).toEqual([]);
  });

  it("lets sales see everyone's orders by default, and only their own when switched off (E1)", async () => {
    const mine = await sales2.from("sales_orders").select("id").eq("id", created[0]!);
    expect(mine.data).toHaveLength(1); // belongs to the other rep, visible by default

    await block("sales2@demo-a.coast.test", "orders.view_all");
    const after = await sales2.from("sales_orders").select("id, sales_rep_id");
    expect(after.data!.length).toBeGreaterThan(0);
    expect(after.data!.every((o) => o.sales_rep_id === ids["sales2@demo-a.coast.test"])).toBe(true);
    await service.from("staff_permission_overrides").delete().eq("user_id", ids["sales2@demo-a.coast.test"]!);
  });

  it("raising a PO moves the line to Awaiting supplier; cancelling moves it back", async () => {
    const supplier = await procurement.from("suppliers").select("id").eq("name", "[Demo Supplier One]").single();
    const line = await procurement.from("order_lines").select("id").eq("sales_order_id", created[0]!).single();
    const { data: poId, error } = await procurement.rpc("create_purchase_order", {
      p: { supplier_id: supplier.data!.id, currency: "GBP", lines: [{ order_line_id: line.data!.id, quantity: 3, requested_date: "", unit_cost_minor: 650 }] },
    });
    expect(error).toBeNull();
    const po = await procurement.from("purchase_orders").select("po_number, status").eq("id", poId).single();
    expect(po.data!.po_number).toMatch(/^PO-\d{4,}$/);
    expect((await procurement.from("order_lines").select("stage").eq("id", line.data!.id).single()).data!.stage).toBe("po_sent");

    await procurement.from("purchase_orders").update({ status: "cancelled" }).eq("id", poId);
    expect((await procurement.from("order_lines").select("stage").eq("id", line.data!.id).single()).data!.stage).toBe("ordered");

    const kinds = (await procurement.from("order_events").select("kind").eq("sales_order_id", created[0]!)).data!.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["order_created", "po_raised", "po_status_changed", "line_stage_changed"]));
  });

  it("hides suppliers and PO numbers from anyone not allowed to see them — even in search (E1)", async () => {
    await block("sales2@demo-a.coast.test", "supplier.identity.view");
    expect((await sales2.from("suppliers").select("id")).data).toEqual([]);
    expect((await sales2.from("purchase_orders").select("id")).data).toEqual([]);
    const line = await sales2.from("order_lines").select("id, purchase_order_lines(id)").eq("sales_order_id", created[0]!).single();
    expect(line.data!.purchase_order_lines).toEqual([]);

    const po = await service.from("purchase_orders").select("po_number").eq("org_id", orgA).limit(1).single();
    const bySupplier = await sales2.rpc("search_order_ids", { q: "Demo Supplier" });
    const byPo = await sales2.rpc("search_order_ids", { q: po.data!.po_number });
    expect(bySupplier.data).toEqual([]);
    expect(byPo.data).toEqual([]);
    // Still finds orders by their own details.
    expect(((await sales2.rpc("search_order_ids", { q: "RLS-REF-1" })).data as string[]).length).toBeGreaterThan(0);
    await service.from("staff_permission_overrides").delete().eq("user_id", ids["sales2@demo-a.coast.test"]!);
  });

  it("hides costs from anyone not allowed to see them (E1)", async () => {
    expect(((await sales.from("purchase_order_line_costs").select("unit_cost_minor")).data ?? []).length).toBeGreaterThan(0);
    await block("sales@demo-a.coast.test", "costs.view");
    expect((await sales.from("purchase_order_line_costs").select("unit_cost_minor")).data).toEqual([]);
    await service.from("staff_permission_overrides").delete().eq("user_id", ids["sales@demo-a.coast.test"]!);
  });

  it("only lets procurement add suppliers", async () => {
    expect((await sales.from("suppliers").insert({ org_id: orgA, name: "[RLS test supplier]" })).error).not.toBeNull();
    const ok = await procurement.from("suppliers").insert({ org_id: orgA, name: "[RLS test supplier]" }).select("id").single();
    expect(ok.error).toBeNull();
    await service.from("suppliers").delete().eq("id", ok.data!.id);
  });

  it("records every change in an audit log nobody can edit or delete", async () => {
    const entries = await adminA.from("audit_log").select("id, table_name, action").eq("table_name", "sales_orders").order("id", { ascending: false }).limit(5);
    expect(entries.data!.length).toBeGreaterThan(0);
    const id = entries.data![0]!.id;

    expect((await sales.from("audit_log").select("id")).data).toEqual([]);
    expect((await director.from("audit_log").select("id").limit(1)).data!.length).toBe(1); // directors have audit.view by default

    const del = await adminA.from("audit_log").delete().eq("id", id).select();
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    const upd = await adminA.from("audit_log").update({ action: "delete" }).eq("id", id).select();
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const ins = await adminA.from("audit_log").insert({ org_id: orgA, table_name: "x", row_key: "x", action: "insert", changes: {} });
    expect(ins.error).not.toBeNull();
    expect((await service.from("audit_log").select("id").eq("id", id)).data).toHaveLength(1);
  });
});
