/**
 * Data protection (readiness plan Task 6), against the dev database.
 */

import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXPORT_TABLES, NOT_EXPORTED, PERSONAL_DATA, personTotal } from "@/lib/logic/data-protection";

vi.mock("server-only", () => ({}));
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && serviceKey) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const CUSTOMER = "[RLS data-protection customer]";
const PERSON = `jo.${Date.now()}@example.test`;
const NAME = "Jo Testperson";

describe.skipIf(!enabled)("data protection", { timeout: 60_000 }, () => {
  let service: SupabaseClient;
  let orgA: string, orgB: string, customerA: string;
  const orders: string[] = [];
  let dp: typeof import("@/lib/data/data-protection");

  const order = async (org: string, customer: string, createdAt: string, stage = "delivered") => {
    const o = (await service.from("sales_orders").insert({ org_id: org, customer_id: customer, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB", created_at: createdAt }).select("id").single()).data!.id as string;
    orders.push(o);
    await service.from("order_lines").insert({ sales_order_id: o, line_no: 1, description: "Thing", quantity: 1, unit_price_minor: 100, route: "from_stock", stage });
    return o;
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    dp = await import("@/lib/data/data-protection");
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    orgB = (await service.from("organisations").select("id").eq("slug", "demo-org-b").single()).data!.id;
    customerA = (await service.from("customers").insert({ org_id: orgA, name: CUSTOMER }).select("id").single()).data!.id;
  });

  afterAll(async () => {
    for (const id of orders) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    await service.from("inbound_messages").delete().eq("org_id", orgA).like("message_id", "%dp-test%");
  });

  it("classifies every column that could hold personal data — a new one must be added", async () => {
    const { data } = await service.rpc("security_text_columns");
    const unclassified = (data as { table_name: string; column_name: string }[]).map((r) => `${r.table_name}.${r.column_name}`).filter((k) => !(k in PERSONAL_DATA));
    expect(unclassified, "classify these in src/lib/logic/data-protection.ts").toEqual([]);
  });

  it("exports every table, or says why not", async () => {
    const { data } = await service.rpc("security_table_report");
    const listed = new Set([...EXPORT_TABLES.map((t) => t.table), ...Object.keys(NOT_EXPORTED)]);
    expect((data as { table_name: string }[]).map((t) => t.table_name).filter((t) => !listed.has(t)), "add to EXPORT_TABLES or NOT_EXPORTED").toEqual([]);
  });

  it("counts an order once, in the UK month it was first seen, across midnight and summer time", async () => {
    const a = await order(orgA, customerA, "2026-10-31T23:30:00Z");
    const b = await order(orgA, customerA, "2026-08-31T23:30:00Z");
    const months = Object.fromEntries(((await service.from("order_meter").select("sales_order_id, month").in("sales_order_id", [a, b])).data ?? []).map((r) => [r.sales_order_id, r.month]));
    expect(months).toEqual({ [a]: "2026-10", [b]: "2026-09" });
    // Seen again (a re-sync): still once.
    await service.from("order_meter").upsert({ sales_order_id: a, org_id: orgA, month: "2026-11", first_seen_at: "2026-11-02T00:00:00Z" }, { onConflict: "sales_order_id", ignoreDuplicates: true });
    expect((await service.from("order_meter").select("month").eq("sales_order_id", a)).data).toEqual([{ month: "2026-10" }]);
  });

  it("finds a person across every place their details can be, in one organisation only, and removes them keeping the orders", async () => {
    const o = await order(orgA, customerA, new Date().toISOString(), "ordered");
    const supplier = (await service.from("suppliers").select("id").eq("org_id", orgA).limit(1).single()).data!.id;
    await service.from("customer_notification_prefs").upsert({ sales_order_id: o, email: PERSON, level: "milestones" });
    await service.from("customer_notifications").insert({ org_id: orgA, sales_order_id: o, kind: "milestone", topic: "dispatched", summary: "x", status: "logged", to_address: PERSON, subject: "s", body_text: "b", body_html: "b" });
    await service.from("inbound_messages").insert({ org_id: orgA, channel: "forward", message_id: `<dp-test-${Date.now()}>`, from_address: `Jo <${PERSON}>`, subject: "Hi", body: "text", status: "ignored" });
    await service.from("order_messages").insert({ org_id: orgA, sales_order_id: o, author_kind: "customer", customer_name: NAME, body: "Where is it?" });
    await service.from("suppliers").update({ known_senders: [PERSON] }).eq("id", supplier);

    const found = await dp.findPerson(service, orgA, PERSON, NAME);
    expect(found.order_update_emails!.length).toBe(1);
    expect(found.emails_sent_to_them!.length).toBe(1);
    expect(found.emails_from_them!.length).toBe(1);
    expect(found.supplier_contact!.length).toBe(1);
    expect(found.messages_they_wrote!.length).toBe(1);
    // Another organisation finds nothing of A's.
    expect(personTotal(await dp.findPerson(service, orgB, PERSON, NAME))).toBe(0);

    const cleared = await dp.forgetPerson(service, orgA, PERSON, NAME);
    expect(personTotal(cleared)).toBeGreaterThanOrEqual(5);
    expect(personTotal(await dp.findPerson(service, orgA, PERSON, NAME))).toBe(0);
    expect((await service.from("sales_orders").select("id").eq("id", o)).data).toHaveLength(1);
    expect((await service.from("order_messages").select("body, customer_name").eq("sales_order_id", o).single()).data).toEqual({ body: "[removed at the person's request]", customer_name: null });
  });

  it("reports what retention would clear, then clears only old closed orders", async () => {
    const old = await order(orgA, customerA, "2024-01-10T10:00:00Z", "delivered");
    const recent = await order(orgA, customerA, new Date().toISOString(), "delivered");
    for (const id of [old, recent]) {
      await service.from("customer_notification_prefs").upsert({ sales_order_id: id, email: `r-${id.slice(0, 8)}@example.test`, level: "milestones" });
      await service.from("order_messages").insert({ org_id: orgA, sales_order_id: id, author_kind: "customer", customer_name: "R", body: "hello" });
    }
    // Nothing has happened on the old one for two years.
    await service.from("order_events").update({ created_at: "2024-01-10T10:00:00Z" }).eq("sales_order_id", old);

    const report = await dp.retentionReport(service, orgA, 12);
    expect(report.orders).toBeGreaterThanOrEqual(1);
    // The dry run changes nothing.
    expect((await service.from("order_messages").select("body").eq("sales_order_id", old).single()).data!.body).toBe("hello");

    await dp.applyRetention(service, orgA, 12);
    expect((await service.from("order_messages").select("body").eq("sales_order_id", old).single()).data!.body).toBe("[cleared under the retention policy]");
    expect((await service.from("customer_notification_prefs").select("email").eq("sales_order_id", old).single()).data!.email).toBeNull();
    expect((await service.from("order_messages").select("body").eq("sales_order_id", recent).single()).data!.body).toBe("hello");
    expect((await service.from("sales_orders").select("id").eq("id", old)).data).toHaveLength(1);
  });

  it("exports only the organisation's own rows, and never a secret", async () => {
    await service.from("integration_credentials").delete().eq("org_id", orgA).eq("provider", "netsuite");
    await service.from("integration_credentials").insert({ org_id: orgA, provider: "netsuite", kind: "netsuite_m2m", config: { accountId: "1234" } });
    const creds = await dp.exportTableRows(service, "integration_credentials", { kind: "org" }, orgA, new Map());
    expect(creds.length).toBeGreaterThan(0);
    for (const r of creds) expect(r).not.toHaveProperty("ciphertext");
    await service.from("integration_credentials").delete().eq("org_id", orgA).eq("provider", "netsuite");

    const bOrders = await dp.exportTableRows(service, "sales_orders", { kind: "org" }, orgB, new Map());
    expect(bOrders.some((r) => orders.includes(r.id as string))).toBe(false);
    const lines = await dp.exportTableRows(service, "order_lines", { kind: "via", column: "sales_order_id", parent: "sales_orders" }, orgB, new Map([["sales_orders", bOrders.map((r) => r.id as string)]]));
    expect(lines.every((l) => bOrders.some((o) => o.id === l.sales_order_id))).toBe(true);
  });
});
