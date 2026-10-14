/**
 * Row-level security for Phase 4: predictions, hand-set dates and lead
 * times, availability and prediction settings.
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
const CUSTOMER = "[RLS prediction customer]";

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("prediction security", () => {
  let service: SupabaseClient;
  let admin: SupabaseClient, adminB: SupabaseClient, procurement: SupabaseClient, sales: SupabaseClient, director: SupabaseClient;
  let ids: Record<string, string>;
  let orgA: string, orderId: string, lineId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    [admin, adminB, procurement, sales, director] = (await Promise.all(
      ["admin@demo-a", "admin@demo-b", "procurement@demo-a", "sales@demo-a", "director@demo-a"].map((u) => signedIn(`${u}.coast.test`)),
    )) as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));
    const { data, error } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: CUSTOMER, customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP", promised_date: "2026-11-02",
        delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB",
        lines: [{ sku: "RLS-PRED-1", description: "Prediction item", quantity: 1, unit_price_minor: 100, route: "direct_ship" }],
      },
    });
    if (error) throw new Error(error.message);
    orderId = data as string;
    lineId = (await service.from("order_lines").select("id").eq("sales_order_id", orderId).single()).data!.id;
  });

  afterAll(async () => {
    if (orderId) await service.from("sales_orders").delete().eq("id", orderId);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    await service.from("product_availability").delete().eq("org_id", orgA).like("sku", "RLS-PRED-%");
    await service.from("prediction_settings").update({ handling_days: 1, delivery_days: 2, spread_days: 2 }).eq("org_id", orgA);
  });

  const prediction = (over: Record<string, unknown> = {}) => ({
    sales_order_id: orderId, predicted_from: "2026-10-20", predicted_to: "2026-10-22", source: "lead_time", confidence: "estimate", at_risk: false, reason: "test", ...over,
  });

  it("only COAST writes predictions; people in the organisation can read them", async () => {
    expect((await procurement.from("order_predictions").insert(prediction())).error).not.toBeNull();
    expect((await admin.from("order_predictions").insert(prediction())).error).not.toBeNull();
    expect((await service.from("order_predictions").upsert(prediction(), { onConflict: "sales_order_id" })).error).toBeNull();
    expect((await sales.from("order_predictions").select("predicted_from").eq("sales_order_id", orderId)).data).toEqual([{ predicted_from: "2026-10-20" }]);
    expect((await adminB.from("order_predictions").select("sales_order_id").eq("sales_order_id", orderId)).data).toEqual([]);
    expect((await createClient(url!, anonKey!, opts).from("order_predictions").select("sales_order_id")).data ?? []).toEqual([]);
    expect((await procurement.from("order_predictions").update({ at_risk: true }).eq("sales_order_id", orderId).select()).data ?? []).toEqual([]);
  });

  it("records meaningful prediction changes in the order's history, but not daily drift", async () => {
    const count = async () => (await service.from("order_events").select("id").eq("sales_order_id", orderId).eq("kind", "prediction_changed")).data!.length;
    const before = await count();
    // A lead-time estimate drifting by a day: not recorded.
    await service.from("order_predictions").update({ predicted_from: "2026-10-21", predicted_to: "2026-10-23" }).eq("sales_order_id", orderId);
    expect(await count()).toBe(before);
    // Turning at risk: recorded.
    await service.from("order_predictions").update({ at_risk: true }).eq("sales_order_id", orderId);
    expect(await count()).toBe(before + 1);
    // A supplier's confirmed date: recorded, and moving it again is recorded too.
    await service.from("order_predictions").update({ source: "supplier_confirmed", confidence: "confirmed", predicted_from: "2026-10-26", predicted_to: "2026-10-26" }).eq("sales_order_id", orderId);
    await service.from("order_predictions").update({ predicted_from: "2026-10-27", predicted_to: "2026-10-27" }).eq("sales_order_id", orderId);
    expect(await count()).toBe(before + 3);
  });

  it("lets order editors set a delivery date by hand, not sales or a view-only director", async () => {
    const set = { predicted_override_from: "2026-10-30", predicted_override_by: ids["procurement@demo-a.coast.test"], predicted_override_at: new Date().toISOString() };
    expect((await sales.from("sales_orders").update(set).eq("id", orderId).select()).data ?? []).toEqual([]);
    expect((await director.from("sales_orders").update(set).eq("id", orderId).select()).data ?? []).toEqual([]);
    expect((await procurement.from("sales_orders").update(set).eq("id", orderId).select("id")).data).toHaveLength(1);
    // A range must run forwards.
    expect((await procurement.from("sales_orders").update({ predicted_override_to: "2026-10-01" }).eq("id", orderId)).error).not.toBeNull();
  });

  it("lets procurement set a line's lead time, within 0–365 days", async () => {
    expect((await sales.from("order_lines").update({ lead_time_override_days: 3 }).eq("id", lineId).select()).data ?? []).toEqual([]);
    expect((await procurement.from("order_lines").update({ lead_time_override_days: 3 }).eq("id", lineId).select("id")).data).toHaveLength(1);
    expect((await procurement.from("order_lines").update({ lead_time_override_days: 400 }).eq("id", lineId)).error).not.toBeNull();
  });

  it("keeps availability per organisation, changed only by procurement", async () => {
    expect((await procurement.from("product_availability").insert({ org_id: orgA, sku: "RLS-PRED-1", available_in_days: 4, source: "manual" })).error).toBeNull();
    expect((await sales.from("product_availability").insert({ org_id: orgA, sku: "RLS-PRED-2", available_in_days: 4, source: "manual" })).error).not.toBeNull();
    expect((await procurement.from("product_availability").insert({ org_id: orgA, sku: "lower case", available_in_days: 4, source: "manual" })).error).not.toBeNull();
    expect((await sales.from("product_availability").select("available_in_days").eq("sku", "RLS-PRED-1")).data).toEqual([{ available_in_days: 4 }]);
    expect((await adminB.from("product_availability").select("sku").eq("org_id", orgA)).data).toEqual([]);
    expect((await sales.from("product_availability").delete().eq("sku", "RLS-PRED-1").select()).data ?? []).toEqual([]);
  });

  it("lets only settings editors change prediction settings, within limits", async () => {
    expect((await sales.from("prediction_settings").update({ delivery_days: 9 }).eq("org_id", orgA).select()).data ?? []).toEqual([]);
    expect((await admin.from("prediction_settings").update({ delivery_days: 3 }).eq("org_id", orgA).select("delivery_days")).data).toEqual([{ delivery_days: 3 }]);
    expect((await admin.from("prediction_settings").update({ delivery_days: 31 }).eq("org_id", orgA)).error).not.toBeNull();
    expect((await adminB.from("prediction_settings").select("org_id").eq("org_id", orgA)).data).toEqual([]);
  });
});
