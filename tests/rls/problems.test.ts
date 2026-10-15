/**
 * Row-level security for delivery problems and customs (Phase 7): problems
 * and their lines, history and photos; customs settings and documents.
 * Runs against the Supabase development project.
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
const CUSTOMER = "[RLS problems customer]";

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("delivery problem and customs security", () => {
  let service: SupabaseClient;
  let procurement: SupabaseClient, sales: SupabaseClient, sales2: SupabaseClient, director: SupabaseClient, goodsin: SupabaseClient, adminB: SupabaseClient;
  let ids: Record<string, string>;
  let orgA: string, orgB: string;
  let orderId: string, lineId: string, otherOrderLine: string, otherOrderId: string, shipmentId: string, problemId: string;

  const block = (who: string, permission: string) =>
    service.from("staff_permission_overrides").upsert({ user_id: ids[who]!, permission, granted: false, set_by: null }, { onConflict: "user_id,permission" });

  const newOrder = async () => {
    const { data, error } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: CUSTOMER, customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP", promised_date: "",
        delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "BT1 5GS", delivery_country: "GB",
        lines: [{ sku: "", quantity: 2, unit_price_minor: 100, description: "Direct item", route: "direct_ship" }],
      },
    });
    if (error) throw new Error(error.message);
    return data as string;
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    [procurement, sales, sales2, director, goodsin, adminB] = (await Promise.all(
      ["procurement@demo-a", "sales@demo-a", "sales2@demo-a", "director@demo-a", "goodsin@demo-a", "admin@demo-b"].map((u) => signedIn(`${u}.coast.test`)),
    )) as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    orgB = staff.data!.find((s) => s.email === "admin@demo-b.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));

    orderId = await newOrder();
    lineId = (await service.from("order_lines").select("id").eq("sales_order_id", orderId).single()).data!.id;
    otherOrderId = await newOrder();
    otherOrderLine = (await service.from("order_lines").select("id").eq("sales_order_id", otherOrderId).single()).data!.id;
    const { data: sid, error } = await procurement.rpc("create_shipment", { p: { sales_order_id: orderId, leg: "direct", carrier: "mock", tracking_number: "MOCK-TRANSIT-RLSP1", line_ids: [lineId], is_international: true, customs_status: "unknown" } });
    if (error) throw new Error(error.message);
    shipmentId = sid as string;
  });

  afterAll(async () => {
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids ?? {}));
    for (const id of [orderId, otherOrderId]) if (id) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    if (orgA) await service.from("customs_settings").update({ eori: null, territories_need_customs: true }).eq("org_id", orgA);
  });

  it("lets sales report a problem on an order and attach its lines; the history writes itself", async () => {
    const { data, error } = await sales.from("delivery_exceptions").insert({ org_id: orgA, sales_order_id: orderId, raised_via: "staff", category: "damaged", description: "Box crushed" }).select("id").single();
    expect(error).toBeNull();
    problemId = data!.id;
    expect((await sales.from("delivery_exception_lines").insert({ exception_id: problemId, order_line_id: lineId })).error).toBeNull();
    const events = (await service.from("delivery_exception_events").select("kind").eq("exception_id", problemId)).data!.map((e) => e.kind);
    expect(events).toContain("raised");
    const orderEvents = (await service.from("order_events").select("kind").eq("sales_order_id", orderId).eq("kind", "problem_raised")).data!;
    expect(orderEvents.length).toBe(1);
  });

  it("won't let staff pretend a customer or carrier raised it, or attach another order's line", async () => {
    expect((await sales.from("delivery_exceptions").insert({ org_id: orgA, sales_order_id: orderId, raised_via: "customer", category: "damaged" })).error).not.toBeNull();
    expect((await sales.from("delivery_exceptions").insert({ org_id: orgA, sales_order_id: orderId, raised_via: "carrier", category: "damaged" })).error).not.toBeNull();
    expect((await sales.from("delivery_exception_lines").insert({ exception_id: problemId, order_line_id: otherOrderLine })).error).not.toBeNull();
  });

  it("keeps problems inside the organisation", async () => {
    expect((await adminB.from("delivery_exceptions").select("id").eq("id", problemId)).data).toEqual([]);
    expect((await adminB.from("delivery_exception_events").select("id").eq("exception_id", problemId)).data).toEqual([]);
    expect((await adminB.from("delivery_exception_lines").select("order_line_id").eq("exception_id", problemId)).data).toEqual([]);
    expect((await adminB.from("delivery_exceptions").insert({ org_id: orgA, sales_order_id: orderId, raised_via: "staff", category: "other" })).error).not.toBeNull();
    const { data: changed } = await adminB.from("delivery_exceptions").update({ status: "closed" }).eq("id", problemId).select("id");
    expect(changed ?? []).toEqual([]);
    expect((await adminB.from("customs_settings").select("org_id").eq("org_id", orgA)).data).toEqual([]);
    expect((await adminB.from("customs_documents").select("doc_type").eq("shipment_id", shipmentId)).data).toEqual([]);
    void orgB;
  });

  it("needs 'Handle delivery problems' to report or change one; directors only look", async () => {
    expect((await director.from("delivery_exceptions").select("id").eq("id", problemId)).data!.length).toBe(1);
    expect((await director.from("delivery_exceptions").insert({ org_id: orgA, sales_order_id: orderId, raised_via: "staff", category: "other", description: "x" })).error).not.toBeNull();
    const { data: changed } = await director.from("delivery_exceptions").update({ status: "triage" }).eq("id", problemId).select("id");
    expect(changed ?? []).toEqual([]);
    await block("sales2@demo-a.coast.test", "problems.manage");
    expect((await sales2.from("delivery_exceptions").insert({ org_id: orgA, sales_order_id: orderId, raised_via: "staff", category: "other" })).error).not.toBeNull();
  });

  it("restarts the wait and stamps resolved, and needs a resolution to resolve", async () => {
    const before = (await service.from("delivery_exceptions").select("waiting_since").eq("id", problemId).single()).data!.waiting_since;
    await new Promise((r) => setTimeout(r, 20));
    expect((await procurement.from("delivery_exceptions").update({ status: "waiting_supplier" }).eq("id", problemId)).error).toBeNull();
    const after = (await service.from("delivery_exceptions").select("waiting_since").eq("id", problemId).single()).data!.waiting_since;
    expect(after > before).toBe(true);
    expect((await procurement.from("delivery_exceptions").update({ status: "resolved" }).eq("id", problemId)).error).not.toBeNull();
    expect((await procurement.from("delivery_exceptions").update({ status: "resolved", resolution: "credit" }).eq("id", problemId)).error).toBeNull();
    const row = (await service.from("delivery_exceptions").select("resolved_at").eq("id", problemId).single()).data!;
    expect(row.resolved_at).not.toBeNull();
  });

  it("lets staff add notes but not forge other history, and keeps warehouse staff out of problems", async () => {
    expect((await procurement.from("delivery_exception_events").insert({ exception_id: problemId, kind: "note", detail: { text: "Rang the carrier" }, actor_id: ids["procurement@demo-a.coast.test"] })).error).toBeNull();
    expect((await procurement.from("delivery_exception_events").insert({ exception_id: problemId, kind: "status", detail: {}, actor_id: ids["procurement@demo-a.coast.test"] })).error).not.toBeNull();
    expect((await procurement.from("delivery_exception_events").insert({ exception_id: problemId, kind: "note", detail: { text: "as someone else" }, actor_id: ids["sales@demo-a.coast.test"] })).error).not.toBeNull();
    // Goods-in staff can't see orders, so they can't see the problems on them either.
    expect((await goodsin.from("delivery_exceptions").select("id").eq("id", problemId)).data).toEqual([]);
  });

  it("allows only one open carrier problem per shipment", async () => {
    const draft = { org_id: orgA, sales_order_id: orderId, shipment_id: shipmentId, raised_via: "carrier", category: "other" };
    expect((await service.from("delivery_exceptions").insert(draft)).error).toBeNull();
    expect((await service.from("delivery_exceptions").insert(draft)).error?.code).toBe("23505");
  });

  it("only lets people see photo records for problems they can see, and never write them", async () => {
    const path = `${orgA}/delivery_exception/${problemId}/${crypto.randomUUID()}.jpg`;
    expect((await service.from("attachments").insert({ org_id: orgA, entity_type: "delivery_exception", entity_id: problemId, storage_path: path, file_name: "box.jpg", content_type: "image/jpeg", size_bytes: 100, uploaded_by_kind: "staff" })).error).toBeNull();
    expect((await procurement.from("attachments").select("id").eq("entity_id", problemId)).data!.length).toBe(1);
    expect((await adminB.from("attachments").select("id").eq("entity_id", problemId)).data).toEqual([]);
    expect((await procurement.from("attachments").insert({ org_id: orgA, entity_type: "delivery_exception", entity_id: problemId, storage_path: path.replace(".jpg", ".png"), file_name: "x.png", content_type: "image/png", size_bytes: 1, uploaded_by_kind: "staff" })).error).not.toBeNull();
    // Only photos, by path shape.
    expect((await service.from("attachments").insert({ org_id: orgA, entity_type: "delivery_exception", entity_id: problemId, storage_path: "../../etc/passwd", file_name: "x", content_type: "image/jpeg", size_bytes: 1, uploaded_by_kind: "staff" })).error).not.toBeNull();
    // The bucket itself is private.
    expect((await procurement.storage.from("attachments").download(path)).data).toBeNull();
  });

  it("lets shipment managers keep the customs checklist; sales only read it", async () => {
    expect((await procurement.from("customs_documents").insert({ shipment_id: shipmentId, doc_type: "commercial_invoice" })).error).toBeNull();
    expect((await procurement.from("customs_documents").update({ received_at: new Date().toISOString(), received_by: ids["procurement@demo-a.coast.test"] }).eq("shipment_id", shipmentId).eq("doc_type", "commercial_invoice")).error).toBeNull();
    expect((await sales.from("customs_documents").select("doc_type").eq("shipment_id", shipmentId)).data!.length).toBe(1);
    expect((await sales.from("customs_documents").insert({ shipment_id: shipmentId, doc_type: "packing_list" })).error).not.toBeNull();
    expect((await procurement.from("shipments").update({ is_international: true, customs_confirmed: true }).eq("id", shipmentId)).error).toBeNull();
  });

  it("needs 'Change company settings' for customs settings, and checks the EORI shape", async () => {
    const { data: none } = await sales.from("customs_settings").update({ eori: "GB123456789000" }).eq("org_id", orgA).select("org_id");
    expect(none ?? []).toEqual([]);
    const admin = await signedIn("admin@demo-a.coast.test");
    expect((await admin.from("customs_settings").update({ eori: "GB123456789000" }).eq("org_id", orgA)).error).toBeNull();
    expect((await admin.from("customs_settings").update({ eori: "not an eori" }).eq("org_id", orgA)).error).not.toBeNull();
    expect((await sales.from("customs_settings").select("territories_need_customs").eq("org_id", orgA).single()).data!.territories_need_customs).toBe(true);
  });
});
