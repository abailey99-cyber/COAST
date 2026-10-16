/**
 * Aggregator tracking (readiness plan Task 4), with the test aggregator,
 * against the dev database: shipments register once and cost is counted
 * per organisation; one with the organisation's own carrier account stays
 * direct; webhooks must be signed, duplicates and out-of-order events are
 * handled; each update reaches only the shipments registered for that
 * parcel; near the cost cap checks slow down and the founder is told.
 */

import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn).catch(() => undefined) }));
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && serviceKey) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const SECRET = "test-webhook-secret-xxxxxxxx"; // made up for the test
const CUSTOMER = "[RLS aggregator customer]";

describe.skipIf(!enabled)("aggregator tracking", { timeout: 60_000 }, () => {
  let service: SupabaseClient;
  let orgA: string, orgB: string, shipA: string, shipB: string, shipA2: string;
  const number = `TAGG${Date.now()}`;
  const orders: string[] = [];
  let agg: typeof import("@/server/aggregator");
  let provider: import("@/lib/carriers/aggregator").AggregatorProvider;
  const warnings: string[] = [];

  const signed = (body: unknown, secret = SECRET) => {
    const raw = JSON.stringify(body);
    return new Request("http://localhost/api/tracking/webhook/mock", { method: "POST", body: raw, headers: { "x-aggregator-signature": createHmac("sha256", secret).update(raw).digest("hex"), "content-type": "application/json" } });
  };
  const shipmentFor = async (org: string, trackingNumber: string) => {
    const { data: cust } = await service.from("customers").select("id").eq("org_id", org).eq("name", CUSTOMER).maybeSingle();
    const customer = cust?.id ?? (await service.from("customers").insert({ org_id: org, name: CUSTOMER }).select("id").single()).data!.id;
    const order = (await service.from("sales_orders").insert({ org_id: org, customer_id: customer, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB" }).select("id").single()).data!.id;
    orders.push(order);
    return (await service.from("shipments").insert({ org_id: org, sales_order_id: order, leg: "outbound", carrier: "dhl", tracking_number: trackingNumber, status: "in_transit" }).select("id").single()).data!.id as string;
  };

  beforeAll(async () => {
    process.env.AGGREGATOR_PROVIDER = "mock";
    process.env.AGGREGATOR_WEBHOOK_SECRET = SECRET;
    process.env.AGGREGATOR_COST_PER_SHIPMENT_MINOR = "4";
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warnings.push(a.map(String).join(" ")));
    agg = await import("@/server/aggregator");
    provider = (await import("@/lib/carriers/aggregator")).aggregator()!;
    service = createClient(url!, serviceKey!, opts);
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    orgB = (await service.from("organisations").select("id").eq("slug", "demo-org-b").single()).data!.id;
    await service.from("integration_credentials").delete().eq("org_id", orgA).eq("provider", "dhl");
    // Organisation B brings its own DHL account; A doesn't.
    await service.from("integration_credentials").delete().eq("org_id", orgB).eq("provider", "dhl");
    await service.from("integration_credentials").insert({ org_id: orgB, provider: "dhl", kind: "api_key" });
    // A's plan is small, so two registrations cross its 5% cap (cap = 5p).
    await service.from("org_plans").upsert({ org_id: orgA, plan_price_minor: 100 });
    await service.from("tracking_usage").delete().eq("org_id", orgA);
    shipA = await shipmentFor(orgA, number);
    shipA2 = await shipmentFor(orgA, `${number}X`);
    shipB = await shipmentFor(orgB, number);
  });

  afterAll(async () => {
    for (const id of orders) await service.from("sales_orders").delete().eq("id", id);
    for (const org of [orgA, orgB]) await service.from("customers").delete().eq("org_id", org).eq("name", CUSTOMER);
    await service.from("integration_credentials").delete().eq("org_id", orgB).eq("provider", "dhl");
    await service.from("org_plans").delete().eq("org_id", orgA);
    await service.from("tracking_usage").delete().eq("org_id", orgA);
    vi.restoreAllMocks();
  });

  it("registers shipments once, counts the cost, and leaves one on the organisation's own account direct", async () => {
    await agg.registerNewShipments(service, provider, new Date(), 100, [shipA, shipA2, shipB]);
    await agg.registerNewShipments(service, provider, new Date(), 100, [shipA, shipA2, shipB]);
    const regs = (await service.from("tracking_registrations").select("shipment_id").in("shipment_id", [shipA, shipA2, shipB])).data!.map((r) => r.shipment_id);
    expect(regs.sort()).toEqual([shipA, shipA2].sort());
    const usage = (await service.from("tracking_usage").select("shipments_registered, cost_minor, alerted_level").eq("org_id", orgA).single()).data!;
    expect(usage).toMatchObject({ shipments_registered: 2, cost_minor: 8 });
  });

  it("tells the founder when an organisation goes over its tracking budget, and slows checks without stopping", async () => {
    const usage = (await service.from("tracking_usage").select("alerted_level").eq("org_id", orgA).single()).data!;
    expect(usage.alerted_level).toBe("over");
    expect(warnings.some((w) => /used \d+% of its tracking budget/.test(w))).toBe(true);
    const reg = (await service.from("tracking_registrations").select("next_check_at").eq("shipment_id", shipA2).single()).data!;
    expect(reg.next_check_at).not.toBeNull();
  });

  it("refuses unsigned or wrongly signed webhooks", async () => {
    expect((await agg.receiveAggregatorWebhook(signed({ events: [] }, "wrong-secret-xxxxxxxx"), "mock")).status).toBe(401);
    expect((await agg.receiveAggregatorWebhook(new Request("http://localhost/x", { method: "POST", body: "{}" }), "mock")).status).toBe(401);
    expect((await agg.receiveAggregatorWebhook(signed({ events: [] }), "someone-else")).status).toBe(404);
  });

  it("applies events in time order, once each, to only the shipments registered for that parcel", async () => {
    const delivered = { id: "e2", tracking_number: number, carrier: "dhl-express", status: "delivered", description: "Delivered", occurred_at: "2026-10-16T09:00:00Z" };
    const transit = { id: "e1", tracking_number: number, carrier: "dhl-express", status: "in_transit", description: "In transit", occurred_at: "2026-10-15T10:00:00Z" };
    // Out of order, with a duplicate.
    const res = await agg.receiveAggregatorWebhook(signed({ events: [delivered, transit, delivered] }), "mock");
    expect(res.status).toBe(200);
    expect((await service.from("shipments").select("status").eq("id", shipA).single()).data!.status).toBe("delivered");
    expect((await service.from("aggregator_events").select("event_id").eq("shipment_id", shipA)).data!.length).toBe(2);
    // B tracks the same parcel with its own DHL account: not registered here, so untouched.
    expect((await service.from("shipments").select("status").eq("id", shipB).single()).data!.status).toBe("in_transit");
    // Another of A's shipments, a different parcel: untouched.
    expect((await service.from("shipments").select("status").eq("id", shipA2).single()).data!.status).toBe("in_transit");

    // The same webhook again changes nothing.
    await agg.receiveAggregatorWebhook(signed({ events: [transit] }), "mock");
    expect((await service.from("shipments").select("status").eq("id", shipA).single()).data!.status).toBe("delivered");
    expect((await service.from("aggregator_events").select("event_id").eq("shipment_id", shipA)).data!.length).toBe(2);
  });

  it("stops checking a delivered shipment", async () => {
    expect((await service.from("tracking_registrations").select("next_check_at").eq("shipment_id", shipA).single()).data!.next_check_at).toBeNull();
  });
});
