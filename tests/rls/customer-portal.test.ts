/**
 * Row-level security for Phase 5: customer page settings, messages,
 * notification preferences and log, customer accounts, rate limits and
 * tracking codes — and proof that a signed-in customer can read nothing
 * directly (their pages are built on the server, through masking).
 */

import { randomBytes } from "node:crypto";
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
const CUSTOMER = "[RLS portal customer]";
const CUSTOMER_EMAIL = `rls-customer-${Date.now()}@customer.coast.test`;
const CUSTOMER_PASSWORD = randomBytes(18).toString("base64url");

async function signedIn(email: string, pw = password!): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("customer portal security", () => {
  let service: SupabaseClient, anon: SupabaseClient;
  let admin: SupabaseClient, adminB: SupabaseClient, procurement: SupabaseClient, sales: SupabaseClient, director: SupabaseClient;
  let ids: Record<string, string>;
  let orgA: string, orderId: string, customerId: string, customerUserId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    anon = createClient(url!, anonKey!, opts);
    [admin, adminB, procurement, sales, director] = (await Promise.all(
      ["admin@demo-a", "admin@demo-b", "procurement@demo-a", "sales@demo-a", "director@demo-a"].map((u) => signedIn(`${u}.coast.test`)),
    )) as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));
    const { data, error } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: CUSTOMER, customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP", promised_date: "",
        delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB",
        lines: [{ sku: "", description: "Portal item", quantity: 1, unit_price_minor: 100, route: "from_stock" }],
      },
    });
    if (error) throw new Error(error.message);
    orderId = data as string;
    customerId = (await service.from("sales_orders").select("customer_id").eq("id", orderId).single()).data!.customer_id;
    const created = await service.auth.admin.createUser({ email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD, email_confirm: true });
    if (created.error) throw new Error(created.error.message);
    customerUserId = created.data.user!.id;
  });

  afterAll(async () => {
    if (customerUserId) await service.auth.admin.deleteUser(customerUserId);
    if (orderId) await service.from("sales_orders").delete().eq("id", orderId);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    await service.from("customer_page_settings").update({ supplier_word: "shipper", show_direct_carrier: false, display_name: null }).eq("org_id", orgA);
  });

  it("lets staff with customers.manage reply on an order, not directors, and never as the customer", async () => {
    expect((await sales.from("order_messages").insert({ org_id: orgA, sales_order_id: orderId, author_kind: "staff", staff_id: ids["sales@demo-a.coast.test"], body: "Hello" })).error).toBeNull();
    expect((await director.from("order_messages").insert({ org_id: orgA, sales_order_id: orderId, author_kind: "staff", staff_id: ids["director@demo-a.coast.test"], body: "x" })).error).not.toBeNull();
    expect((await sales.from("order_messages").insert({ org_id: orgA, sales_order_id: orderId, author_kind: "customer", body: "pretend customer" })).error).not.toBeNull();
    expect((await sales.from("order_messages").insert({ org_id: orgA, sales_order_id: orderId, author_kind: "staff", staff_id: ids["procurement@demo-a.coast.test"], body: "as someone else" })).error).not.toBeNull();
    expect((await adminB.from("order_messages").select("id").eq("sales_order_id", orderId)).data).toEqual([]);
    const kinds = (await service.from("order_events").select("kind").eq("sales_order_id", orderId)).data!.map((e) => e.kind);
    expect(kinds).toContain("staff_reply");
  });

  it("lets staff set who hears about an order; only COAST writes the notification log", async () => {
    expect((await sales.from("customer_notification_prefs").insert({ sales_order_id: orderId, email: "jo@customer.coast.test", level: "everything" })).error).toBeNull();
    expect((await director.from("customer_notification_prefs").update({ level: "replies" }).eq("sales_order_id", orderId).select()).data ?? []).toEqual([]);
    expect((await sales.from("customer_notification_prefs").update({ level: "loud" }).eq("sales_order_id", orderId)).error).not.toBeNull();
    expect((await procurement.from("customer_notifications").insert({ org_id: orgA, sales_order_id: orderId, kind: "reply", topic: "reply", summary: "x", status: "logged" })).error).not.toBeNull();
    expect((await service.from("customer_notifications").insert({ org_id: orgA, sales_order_id: orderId, kind: "reply", topic: "reply", summary: "Reply", status: "logged" })).error).toBeNull();
    expect((await sales.from("customer_notifications").select("summary").eq("sales_order_id", orderId)).data).toEqual([{ summary: "Reply" }]);
    expect((await adminB.from("customer_notifications").select("id").eq("sales_order_id", orderId)).data).toEqual([]);
  });

  it("lets only settings editors change the customer page, within limits", async () => {
    expect((await sales.from("customer_page_settings").update({ supplier_word: "partner" }).eq("org_id", orgA).select()).data ?? []).toEqual([]);
    expect((await admin.from("customer_page_settings").update({ supplier_word: "partner" }).eq("org_id", orgA).select("supplier_word")).data).toEqual([{ supplier_word: "partner" }]);
    expect((await admin.from("customer_page_settings").update({ supplier_word: "<b>" }).eq("org_id", orgA)).error).not.toBeNull();
    expect((await admin.from("customer_page_settings").update({ logo_url: "http://insecure.example/logo.png" }).eq("org_id", orgA)).error).not.toBeNull();
    expect((await adminB.from("customer_page_settings").select("org_id").eq("org_id", orgA)).data).toEqual([]);
  });

  it("issues new tracking codes only for order editors, and the old code stops matching", async () => {
    const before = (await service.from("sales_orders").select("tracking_code").eq("id", orderId).single()).data!.tracking_code;
    await director.rpc("regenerate_tracking_code", { p_order: orderId });
    expect((await service.from("sales_orders").select("tracking_code").eq("id", orderId).single()).data!.tracking_code).toBe(before);
    const { data: fresh } = await procurement.rpc("regenerate_tracking_code", { p_order: orderId });
    expect(fresh).not.toBe(before);
    expect((await service.from("sales_orders").select("id").eq("tracking_code", before)).data).toEqual([]);
  });

  it("keeps rate limits for the system only", async () => {
    expect((await anon.rpc("hit_rate_limit", { p_bucket: "x", p_limit: 1, p_window_seconds: 60 })).error).not.toBeNull();
    expect((await sales.rpc("hit_rate_limit", { p_bucket: "x", p_limit: 1, p_window_seconds: 60 })).error).not.toBeNull();
    const bucket = `rls-test-${Date.now()}`;
    expect((await service.rpc("hit_rate_limit", { p_bucket: bucket, p_limit: 2, p_window_seconds: 600 })).data).toBe(true);
    expect((await service.rpc("hit_rate_limit", { p_bucket: bucket, p_limit: 2, p_window_seconds: 600 })).data).toBe(true);
    expect((await service.rpc("hit_rate_limit", { p_bucket: bucket, p_limit: 2, p_window_seconds: 600 })).data).toBe(false);
    await service.from("rate_limit_hits").delete().eq("bucket", bucket);
  });

  it("never lets a staff login become a customer account", async () => {
    const { error } = await service.from("customer_accounts").insert({ user_id: ids["sales@demo-a.coast.test"], full_name: "x", email: "sales@demo-a.coast.test" });
    expect(error).not.toBeNull();
  });

  it("gives a signed-in customer nothing to read directly — not even their own order", async () => {
    expect((await service.from("customer_accounts").insert({ user_id: customerUserId, full_name: "[RLS customer]", email: CUSTOMER_EMAIL })).error).toBeNull();
    expect((await service.from("customer_account_orders").insert({ user_id: customerUserId, sales_order_id: orderId })).error).toBeNull();
    const customer = await signedIn(CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    for (const table of ["sales_orders", "order_lines", "suppliers", "purchase_orders", "purchase_order_line_costs", "shipments", "order_messages", "customer_accounts", "customer_account_orders", "customer_account_links", "customer_notifications", "order_predictions", "staff_users", "audit_log", "leads"]) {
      const { data } = await customer.from(table).select("*").limit(5);
      expect(data ?? [], table).toEqual([]);
    }
    expect((await customer.rpc("search_order_ids", { q: "SO" })).data ?? []).toEqual([]);
    expect((await customer.from("order_messages").insert({ org_id: orgA, sales_order_id: orderId, author_kind: "customer", body: "x" })).error).not.toBeNull();
    // Staff in the business can see the account; another business can't.
    expect((await sales.from("customer_accounts").select("email").eq("user_id", customerUserId)).data).toEqual([{ email: CUSTOMER_EMAIL }]);
    expect((await adminB.from("customer_accounts").select("email").eq("user_id", customerUserId)).data).toEqual([]);
  });

  it("adds a vouched-for customer's orders automatically — new ones too — and only for that business", async () => {
    // (The account exists from the test above.) Staff can't write links themselves; COAST does, after checking.
    expect((await sales.from("customer_account_links").insert({ user_id: customerUserId, org_id: orgA, customer_id: customerId })).error).not.toBeNull();
    expect((await service.from("customer_account_links").insert({ user_id: customerUserId, org_id: orgA, customer_id: customerId, vouched_by: ids["sales@demo-a.coast.test"] })).error).toBeNull();
    // A new order for that customer goes straight into the account.
    const { data: newId } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: CUSTOMER, customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP", promised_date: "",
        delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB",
        lines: [{ sku: "", description: "Auto-added item", quantity: 1, unit_price_minor: 100, route: "from_stock" }],
      },
    });
    const added = (await service.from("customer_account_orders").select("sales_order_id").eq("user_id", customerUserId)).data!.map((r) => r.sales_order_id);
    expect(added).toEqual(expect.arrayContaining([orderId, newId]));
    // The business sees the link; another business doesn't.
    expect((await sales.from("customer_account_links").select("user_id").eq("user_id", customerUserId)).data).toHaveLength(1);
    expect((await adminB.from("customer_account_links").select("user_id").eq("user_id", customerUserId)).data).toEqual([]);
    await service.from("sales_orders").delete().eq("id", newId as string);
  });

  it("keeps register-interest leads away from every business", async () => {
    expect((await service.from("leads").insert({ name: "x", company: "x", email: "lead@example.test", source: "website" })).error).toBeNull();
    expect((await admin.from("leads").select("id")).data ?? []).toEqual([]);
    expect((await anon.from("leads").insert({ name: "x", company: "x", email: "a@b.c", source: "website" })).error).not.toBeNull();
    await service.from("leads").delete().eq("email", "lead@example.test");
  });

  it("lets nobody signed out read any of it", async () => {
    for (const table of ["customer_page_settings", "order_messages", "customer_notification_prefs", "customer_notifications", "customer_accounts", "customer_account_orders", "customer_account_links", "rate_limit_hits", "leads"]) {
      expect((await anon.from(table).select("*").limit(1)).data ?? [], table).toEqual([]);
    }
  });
});
