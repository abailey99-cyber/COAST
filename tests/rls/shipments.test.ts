/**
 * Row-level security for shipments (Phase 3): shipments and their lines,
 * tracking events, poll state, carrier settings, carrier activity and the
 * scheduled-job log. Runs against the Supabase development project.
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
const CUSTOMER = "[RLS shipment customer]";

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("shipment security", () => {
  let service: SupabaseClient;
  let admin: SupabaseClient, adminB: SupabaseClient, procurement: SupabaseClient, sales: SupabaseClient, sales2: SupabaseClient, director: SupabaseClient;
  let ids: Record<string, string>;
  let orgA: string;
  let orderId: string, directLine: string, stockLine: string, otherOrderLine: string, otherOrderId: string;

  const shipment = (over: Record<string, unknown> = {}) => ({ sales_order_id: orderId, leg: "direct", carrier: "mock", tracking_number: "MOCK-TRANSIT-RLS1", line_ids: [directLine], ...over });
  const block = (who: string, permission: string) =>
    service.from("staff_permission_overrides").upsert({ user_id: ids[who]!, permission, granted: false, set_by: null }, { onConflict: "user_id,permission" });
  const unblock = (who: string) => service.from("staff_permission_overrides").delete().eq("user_id", ids[who]!);

  const newOrder = async (lines: { description: string; route: string }[]) => {
    const { data, error } = await procurement.rpc("create_sales_order", {
      p: {
        customer_name: CUSTOMER, customer_reference: "", so_number: "", sales_rep_id: ids["sales@demo-a.coast.test"], currency: "GBP", promised_date: "",
        delivery_name: "x", delivery_line1: "x", delivery_line2: "", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB",
        lines: lines.map((l) => ({ sku: "", quantity: 1, unit_price_minor: 100, ...l })),
      },
    });
    if (error) throw new Error(error.message);
    return data as string;
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    [admin, adminB, procurement, sales, sales2, director] = (await Promise.all(
      ["admin@demo-a", "admin@demo-b", "procurement@demo-a", "sales@demo-a", "sales2@demo-a", "director@demo-a"].map((u) => signedIn(`${u}.coast.test`)),
    )) as [SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient, SupabaseClient];
    const staff = await service.from("staff_users").select("id, email, org_id").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
    orgA = staff.data!.find((s) => s.email === "admin@demo-a.coast.test")!.org_id;
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids));

    orderId = await newOrder([{ description: "Direct item", route: "direct_ship" }, { description: "Stock item", route: "from_stock" }]);
    const lines = (await service.from("order_lines").select("id, route").eq("sales_order_id", orderId)).data!;
    directLine = lines.find((l) => l.route === "direct_ship")!.id;
    stockLine = lines.find((l) => l.route === "from_stock")!.id;
    otherOrderId = await newOrder([{ description: "Other order item", route: "from_stock" }]);
    otherOrderLine = (await service.from("order_lines").select("id").eq("sales_order_id", otherOrderId).single()).data!.id;
  });

  afterAll(async () => {
    await service.from("staff_permission_overrides").delete().in("user_id", Object.values(ids ?? {}));
    for (const id of [orderId, otherOrderId]) if (id) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    await service.from("carrier_settings").delete().eq("org_id", orgA).eq("carrier", "ups");
  });

  it("lets procurement add a shipment, and starts its checks straight away", async () => {
    const { data: id, error } = await procurement.rpc("create_shipment", { p: shipment() });
    expect(error).toBeNull();
    const poll = (await service.from("shipment_poll_state").select("next_poll_at, carrier").eq("shipment_id", id).single()).data!;
    expect(poll.carrier).toBe("mock");
    expect(poll.next_poll_at).not.toBeNull();
    const kinds = (await sales.from("order_events").select("kind").eq("sales_order_id", orderId)).data!.map((e) => e.kind);
    expect(kinds).toContain("shipment_added");
    // Same tracking number twice on one order is refused.
    expect((await procurement.rpc("create_shipment", { p: shipment() })).error?.code).toBe("23505");
  });

  it("doesn't let sales or a view-only director add shipments", async () => {
    expect((await sales.rpc("create_shipment", { p: shipment({ tracking_number: "MOCK-TRANSIT-RLS2" }) })).error).not.toBeNull();
    expect((await director.rpc("create_shipment", { p: shipment({ tracking_number: "MOCK-TRANSIT-RLS3" }) })).error).not.toBeNull();
  });

  it("won't put another order's line on a shipment", async () => {
    const { error } = await procurement.rpc("create_shipment", { p: shipment({ tracking_number: "MOCK-TRANSIT-RLS4", leg: "outbound", line_ids: [otherOrderLine] }) });
    expect(error).not.toBeNull();
    expect((await service.from("shipments").select("id").eq("tracking_number", "MOCK-TRANSIT-RLS4")).data).toEqual([]);
  });

  it("refuses bad tracking numbers and unknown carriers", async () => {
    expect((await procurement.rpc("create_shipment", { p: shipment({ tracking_number: "<b>x</b>" }) })).error).not.toBeNull();
    expect((await procurement.rpc("create_shipment", { p: shipment({ tracking_number: "ABCD1234", carrier: "pigeon" }) })).error).not.toBeNull();
    // Only "other / own delivery" may go without a tracking number.
    expect((await procurement.rpc("create_shipment", { p: shipment({ tracking_number: "", carrier: "dhl" }) })).error).not.toBeNull();
  });

  it("hides shipments from suppliers from anyone who can't see suppliers, but not the ones to the customer", async () => {
    const { data: outId } = await procurement.rpc("create_shipment", { p: shipment({ leg: "outbound", carrier: "other", tracking_number: "", line_ids: [stockLine] }) });
    expect((await sales.from("shipments").select("id").eq("sales_order_id", orderId)).data).toHaveLength(2);
    await block("sales2@demo-a.coast.test", "supplier.identity.view");
    const seen = (await sales2.from("shipments").select("id, leg").eq("sales_order_id", orderId)).data!;
    expect(seen).toEqual([{ id: outId, leg: "outbound" }]);
    // Searching by a supplier's tracking number finds nothing for them either.
    expect((await sales2.rpc("search_order_ids", { q: "MOCK-TRANSIT-RLS1" })).data).toEqual([]);
    expect((await sales.rpc("search_order_ids", { q: "mock-transit-rls1" })).data).toEqual([orderId]);
    await unblock("sales2@demo-a.coast.test");
  });

  it("keeps shipments, events and poll state inside the organisation", async () => {
    const s = (await service.from("shipments").select("id").eq("tracking_number", "MOCK-TRANSIT-RLS1").single()).data!;
    await service.from("tracking_events").insert({ shipment_id: s.id, event_key: "k1", occurred_at: new Date().toISOString(), status: "in_transit", description: "Collected", source: "carrier" });
    expect((await adminB.from("shipments").select("id").eq("id", s.id)).data).toEqual([]);
    expect((await adminB.from("tracking_events").select("id").eq("shipment_id", s.id)).data).toEqual([]);
    expect((await adminB.from("shipment_poll_state").select("shipment_id").eq("shipment_id", s.id)).data).toEqual([]);
    expect((await adminB.from("shipment_lines").select("shipment_id").eq("shipment_id", s.id)).data).toEqual([]);
    const anon = createClient(url!, anonKey!, opts);
    expect((await anon.from("shipments").select("id")).data ?? []).toEqual([]);
    expect((await sales.from("tracking_events").select("id").eq("shipment_id", s.id)).data).toHaveLength(1);
  });

  it("lets people add only manual tracking events, never pretend carrier ones", async () => {
    const s = (await service.from("shipments").select("id").eq("tracking_number", "MOCK-TRANSIT-RLS1").single()).data!;
    const now = new Date().toISOString();
    expect((await procurement.from("tracking_events").insert({ shipment_id: s.id, event_key: "fake", occurred_at: now, status: "delivered", description: "Delivered", source: "carrier" })).error).not.toBeNull();
    expect((await procurement.from("tracking_events").insert({ shipment_id: s.id, event_key: "m1", occurred_at: now, status: "delivered", description: "Delivered (set by hand)", source: "manual" })).error).toBeNull();
    expect((await sales.from("tracking_events").insert({ shipment_id: s.id, event_key: "m2", occurred_at: now, status: "delivered", description: "x", source: "manual" })).error).not.toBeNull();
    // Nobody but the poll job writes poll state.
    expect((await procurement.from("shipment_poll_state").update({ failures: 99 }).eq("shipment_id", s.id).select()).data ?? []).toEqual([]);
  });

  it("records a status change in the order's history, and a manual 'delivered' stops the checks", async () => {
    const s = (await service.from("shipments").select("id").eq("tracking_number", "MOCK-TRANSIT-RLS1").single()).data!;
    const upd = await procurement.from("shipments").update({ status: "delivered", status_source: "manual", delivered_at: new Date().toISOString() }).eq("id", s.id).select();
    expect(upd.data).toHaveLength(1);
    expect((await service.from("shipment_poll_state").select("next_poll_at").eq("shipment_id", s.id).single()).data!.next_poll_at).toBeNull();
    const events = (await sales.from("order_events").select("kind, detail").eq("sales_order_id", orderId).eq("kind", "shipment_status_changed")).data!;
    expect(events.at(-1)!.detail).toMatchObject({ to: "delivered", source: "manual" });
    // Handing back to the carrier starts checks again.
    await procurement.from("shipments").update({ status_source: "carrier" }).eq("id", s.id);
    expect((await service.from("shipment_poll_state").select("next_poll_at").eq("shipment_id", s.id).single()).data!.next_poll_at).not.toBeNull();
    // Sales and directors can't change shipments.
    expect((await sales.from("shipments").update({ status: "exception" }).eq("id", s.id).select()).data ?? []).toEqual([]);
    expect((await director.from("shipments").update({ status: "exception" }).eq("id", s.id).select()).data ?? []).toEqual([]);
  });

  it("lets only settings editors set a claim window, per organisation", async () => {
    expect((await admin.from("carrier_settings").insert({ org_id: orgA, carrier: "ups", claim_window_days: 30 })).error).toBeNull();
    expect((await sales.from("carrier_settings").update({ claim_window_days: 1 }).eq("org_id", orgA).eq("carrier", "ups").select()).data ?? []).toEqual([]);
    expect((await admin.from("carrier_settings").update({ claim_window_days: 400 }).eq("org_id", orgA).eq("carrier", "ups")).error).not.toBeNull();
    expect((await adminB.from("carrier_settings").select("carrier").eq("org_id", orgA)).data).toEqual([]);
    expect((await sales.from("carrier_settings").select("claim_window_days").eq("carrier", "ups").single()).data!.claim_window_days).toBe(30);
  });

  it("keeps carrier budgets and the job log for the system, readable but not writable by staff", async () => {
    expect((await sales.from("carrier_activity").select("carrier")).error).toBeNull();
    expect((await procurement.from("carrier_activity").insert({ carrier: "mock", calls_today: 0 })).error).not.toBeNull();
    expect((await procurement.rpc("reserve_carrier_calls", { p_carrier: "dhl", p_limit: 1000, p_wanted: 1 })).error).not.toBeNull();
    expect((await procurement.from("cron_runs").insert({ job: "tracking-poll" })).error).not.toBeNull();
    // The run detail (counts across every organisation) stays with the system.
    expect((await sales.from("cron_runs").select("detail").limit(1)).error).not.toBeNull();
    expect((await createClient(url!, anonKey!, opts).from("carrier_activity").select("carrier")).data ?? []).toEqual([]);
  });

  it("never grants more calls than a carrier's daily limit", async () => {
    await service.from("carrier_activity").delete().eq("carrier", "mock");
    expect((await service.rpc("reserve_carrier_calls", { p_carrier: "mock", p_limit: 5, p_wanted: 3 })).data).toBe(3);
    expect((await service.rpc("reserve_carrier_calls", { p_carrier: "mock", p_limit: 5, p_wanted: 3 })).data).toBe(2);
    expect((await service.rpc("reserve_carrier_calls", { p_carrier: "mock", p_limit: 5, p_wanted: 3 })).data).toBe(0);
    expect((await service.rpc("reserve_carrier_calls", { p_carrier: "mock", p_limit: null, p_wanted: 7 })).data).toBe(7);
    await service.from("carrier_activity").delete().eq("carrier", "mock");
  });
});
