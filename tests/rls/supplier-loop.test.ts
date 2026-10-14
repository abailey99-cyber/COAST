/**
 * Row-level security for the supplier loop (Phase 2): emails, links,
 * supplier answers (and their prices), chases and chase settings.
 */

import { createHash, randomBytes } from "node:crypto";
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
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("supplier loop security", () => {
  let service: SupabaseClient;
  let admin: SupabaseClient, adminB: SupabaseClient, procurement: SupabaseClient, sales: SupabaseClient, sales2: SupabaseClient, director: SupabaseClient;
  let ids: Record<string, string>;
  let orgA: string;
  let orderId: string, lineId: string, poId: string, poLineId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    [admin, adminB, procurement, sales, sales2, director] = (await Promise.all(
      ["admin@demo-a", "admin@demo-b", "procurement@demo-a", "sales@demo-a", "sales2@demo-a", "director@demo-a"].map((u) => signedIn(`${u}.coast.test`)),
    )) as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));

    const { data: oid } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: "[RLS loop customer]", customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP",
        promised_date: "", delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB",
        lines: [{ sku: "", description: "Loop item", quantity: 2, unit_price_minor: 1000, route: "direct_ship" }],
      },
    });
    orderId = oid as string;
    lineId = (await service.from("order_lines").select("id").eq("sales_order_id", orderId).single()).data!.id;
    const supplier = (await procurement.from("suppliers").select("id").eq("name", "[Demo Supplier One]").single()).data!.id;
    const { data: pid } = await procurement.rpc("create_purchase_order", {
      p: { supplier_id: supplier, currency: "GBP", lines: [{ order_line_id: lineId, quantity: 2, requested_date: "", unit_cost_minor: 600 }] },
    });
    poId = pid as string;
    poLineId = (await service.from("purchase_order_lines").select("id").eq("purchase_order_id", poId).single()).data!.id;
  });

  afterAll(async () => {
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids ?? {}));
    if (poId) await service.from("purchase_orders").delete().eq("id", poId);
    if (orderId) await service.from("sales_orders").delete().eq("id", orderId);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", "[RLS loop customer]");
    await service.from("chase_settings").update({ amber_hours: 8, red_hours: 16, alert_hours: 24, day_start_hour: 9, day_end_hour: 17 }).eq("org_id", orgA);
  });

  const block = (who: string, permission: string) =>
    service.from("staff_permission_overrides").upsert({ user_id: ids[who]!, permission, granted: false, set_by: null }, { onConflict: "user_id,permission" });

  it("logs emails for procurement, hides them from anyone who can't see suppliers", async () => {
    const ins = await procurement.from("outbound_emails").insert({
      org_id: orgA, kind: "po", purchase_order_id: poId, to_address: "orders@supplier-one.coast.test", subject: "PO", body_text: "x", body_html: "x", channel: "log", status: "logged",
    });
    expect(ins.error).toBeNull();
    expect((await sales.from("outbound_emails").insert({ org_id: orgA, kind: "po", purchase_order_id: poId, to_address: "a@b.c", subject: "x", body_text: "x", body_html: "x", channel: "log", status: "logged" })).error).not.toBeNull();
    await block("sales2@demo-a.coast.test", "supplier.identity.view");
    expect((await sales2.from("outbound_emails").select("id").eq("purchase_order_id", poId)).data).toEqual([]);
    expect((await adminB.from("outbound_emails").select("id").eq("purchase_order_id", poId)).data).toEqual([]);
    await service.from("staff_permission_overrides").delete().eq("user_id", ids["sales2@demo-a.coast.test"]!);
  });

  it("stores links only as a hash, and only procurement can make or revoke them", async () => {
    const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    expect((await procurement.from("po_links").insert({ purchase_order_id: poId, token_hash: hash, expires_at: expires })).error).toBeNull();
    expect((await procurement.from("po_links").insert({ purchase_order_id: poId, token_hash: "not-a-hash", expires_at: expires })).error).not.toBeNull();
    expect((await sales.from("po_links").insert({ purchase_order_id: poId, token_hash: createHash("sha256").update("x").digest("hex"), expires_at: expires })).error).not.toBeNull();
    const anon = createClient(url!, anonKey!, opts);
    expect((await anon.from("po_links").select("id")).data ?? []).toEqual([]);
    const upd = await sales.from("po_links").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hash).select();
    expect(upd.data ?? []).toEqual([]);
  });

  it("keeps supplier prices behind costs.view, separately from the answer", async () => {
    const { data: r } = await procurement
      .from("supplier_responses")
      .insert({ org_id: orgA, purchase_order_id: poId, source: "paste", raw_text: "x", answer: [{ poLineId, available: true, quantity: 2, date: "2026-11-01" }], confidence: "medium", reasons: ["test"], status: "needs_review" })
      .select("id")
      .single();
    expect((await procurement.from("supplier_response_prices").insert({ supplier_response_id: r!.id, prices: [{ poLineId, unitCostMinor: 650 }] })).error).toBeNull();
    expect((await sales.from("supplier_response_prices").select("prices").eq("supplier_response_id", r!.id)).data).toHaveLength(1);
    await block("sales@demo-a.coast.test", "costs.view");
    expect((await sales.from("supplier_response_prices").select("prices").eq("supplier_response_id", r!.id)).data).toEqual([]);
    expect((await sales.from("supplier_responses").select("id").eq("id", r!.id)).data).toHaveLength(1); // the answer itself is still visible
    await service.from("staff_permission_overrides").delete().eq("user_id", ids["sales@demo-a.coast.test"]!);
  });

  it("only procurement applies a supplier's answer", async () => {
    const p = { purchase_order_id: poId, response_id: "", review_status: "accepted", fully_confirmed: true, lines: [{ po_line_id: poLineId, confirmed_date: "2026-11-01", confirmed_quantity: 2, confirmed_unit_cost_minor: "" }] };
    await director.rpc("apply_supplier_answer", { p });
    expect((await service.from("purchase_orders").select("status").eq("id", poId).single()).data!.status).toBe("draft");
    expect((await createClient(url!, anonKey!, opts).rpc("apply_supplier_answer", { p })).error).not.toBeNull();
    expect((await procurement.rpc("apply_supplier_answer", { p })).error).toBeNull();
    const po = (await service.from("purchase_orders").select("status, sent_at, confirmed_at").eq("id", poId).single()).data!;
    expect(po.status).toBe("confirmed");
    expect(po.sent_at).not.toBeNull();
    expect(po.confirmed_at).not.toBeNull();
    expect((await service.from("order_lines").select("stage").eq("id", lineId).single()).data!.stage).toBe("confirmed");
  });

  it("lets sales chase procurement about a line, but not a view-only director", async () => {
    const ok = await sales.from("chases").insert({ org_id: orgA, kind: "internal", sales_order_id: orderId, order_line_id: lineId, note: "Any news?", opened_by: ids["sales@demo-a.coast.test"] }).select("id").single();
    expect(ok.error).toBeNull();
    expect((await director.from("chases").insert({ org_id: orgA, kind: "internal", sales_order_id: orderId, order_line_id: lineId, note: "x", opened_by: ids["director@demo-a.coast.test"] })).error).not.toBeNull();
    // Only one open chase per line.
    expect((await procurement.from("chases").insert({ org_id: orgA, kind: "internal", sales_order_id: orderId, order_line_id: lineId, note: "dup", opened_by: ids["procurement@demo-a.coast.test"] })).error).not.toBeNull();
    // Sales can't open a supplier chase.
    expect((await sales.from("chases").insert({ org_id: orgA, kind: "supplier", purchase_order_id: poId, opened_by: ids["sales@demo-a.coast.test"] })).error).not.toBeNull();
    // Another organisation sees nothing.
    expect((await adminB.from("chases").select("id").eq("id", ok.data!.id)).data).toEqual([]);
    // Procurement answers it.
    const res = await procurement.from("chases").update({ status: "resolved", resolved_by: ids["procurement@demo-a.coast.test"], resolved_at: new Date().toISOString(), resolution_note: "Due Friday" }).eq("id", ok.data!.id).select();
    expect(res.data).toHaveLength(1);
    const kinds = (await sales.from("order_events").select("kind").eq("sales_order_id", orderId)).data!.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["chase_opened", "chase_resolved"]));
  });

  it("only lets someone with settings.edit change the chase timings, and only sensibly", async () => {
    const before = (await admin.from("chase_settings").select("amber_hours").eq("org_id", orgA).single()).data!.amber_hours;
    expect((await procurement.from("chase_settings").update({ amber_hours: 4 }).eq("org_id", orgA).select()).data ?? []).toEqual([]);
    expect((await admin.from("chase_settings").update({ amber_hours: 30 }).eq("org_id", orgA)).error).not.toBeNull(); // amber must be before red
    expect((await admin.from("chase_settings").update({ amber_hours: 4 }).eq("org_id", orgA).select()).data).toHaveLength(1);
    expect((await adminB.from("chase_settings").select("org_id").eq("org_id", orgA)).data).toEqual([]);
    await admin.from("chase_settings").update({ amber_hours: before }).eq("org_id", orgA);
  });
});
