/**
 * Supplier replies by email (readiness plan Task 3), against the dev
 * database: the Mailgun webhook refuses anything unsigned, stale or replayed;
 * forwarded mail is held back unless it came through the organisation's own
 * mailbox, and is never applied automatically; a reply to organisation B's
 * address can never attach to organisation A's PO, even with the same PO
 * number; Microsoft 365 mail applies a date only when every rule passes, and
 * the date can be undone in one click.
 */

import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Deferred work runs straight away (and quietly) in tests.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn).catch(() => undefined) }));
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(url && anonKey && serviceKey && password) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

// Made up for the test.
const SIGNING_KEY = "test-signing-key-xxxxxxxx";
const DOMAIN = "replies.coast.test";
const CUSTOMER = "[RLS inbound customer]";
const SUPPLIER_EMAIL = "orders@supplier-one.coast.test";
const PASS_HEADERS: [string, string][] = [["Authentication-Results", "mx.microsoft.com; spf=pass smtp.mailfrom=supplier-one.coast.test; dkim=pass; dmarc=pass action=none"]];

describe.skipIf(!enabled)("supplier replies by email", { timeout: 30_000 }, () => {
  let service: SupabaseClient, procurementA: SupabaseClient, salesA: SupabaseClient, adminB: SupabaseClient;
  let orgA: string, orgB: string, poA: string, poB: string, poNumber: string, lineA: string;
  let localA: string, localB: string;
  const createdAddresses: string[] = [];
  const created: { orders: string[]; pos: string[]; responses: string[] } = { orders: [], pos: [], responses: [] };
  let webhook: typeof import("@/server/inbound-webhook");
  let pipeline: typeof import("@/server/inbound");

  const post = (fields: Record<string, string>, opts2: { key?: string; token?: string; ts?: string } = {}) => {
    const ts = opts2.ts ?? String(Math.floor(Date.now() / 1000));
    const token = opts2.token ?? `tok-${Math.random().toString(36).slice(2)}`;
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    f.set("timestamp", ts);
    f.set("token", token);
    f.set("signature", createHmac("sha256", opts2.key ?? SIGNING_KEY).update(ts + token).digest("hex"));
    return { request: new Request("http://localhost/api/inbound/mailgun", { method: "POST", body: f }), token };
  };
  const email = (to: string, extra: Record<string, string> = {}) => ({
    recipient: `${to}@${DOMAIN}`,
    sender: "SRS0=Ab12=QZ=supplier-one.coast.test=purchasing@yourco-a.test",
    from: `Supplier One <${SUPPLIER_EMAIL}>`,
    subject: `RE: Purchase order ${poNumber}`,
    "body-plain": `Hi, we confirm ${poNumber} for delivery on Friday 30 October 2026. Thanks`,
    "message-headers": JSON.stringify([...PASS_HEADERS, ["Message-Id", `<${Math.random().toString(36).slice(2)}@supplier.test>`]]),
    ...extra,
  });
  const responsesFor = async (po: string) => (await service.from("supplier_responses").select("id, status, source").eq("purchase_order_id", po)).data ?? [];

  beforeAll(async () => {
    process.env.MAILGUN_WEBHOOK_SIGNING_KEY = SIGNING_KEY;
    process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
    webhook = await import("@/server/inbound-webhook");
    pipeline = await import("@/server/inbound");
    service = createClient(url!, serviceKey!, opts);
    const signIn = async (e: string) => {
      const c = createClient(url!, anonKey!, opts);
      const { error } = await c.auth.signInWithPassword({ email: e, password: password! });
      if (error) throw new Error(error.message);
      return c;
    };
    [procurementA, salesA, adminB] = (await Promise.all(["procurement@demo-a", "sales@demo-a", "admin@demo-b"].map((u) => signIn(`${u}.coast.test`)))) as [SupabaseClient, SupabaseClient, SupabaseClient];
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    orgB = (await service.from("organisations").select("id").eq("slug", "demo-org-b").single()).data!.id;

    for (const [org, domain] of [[orgA, "yourco-a.test"], [orgB, "yourco-b.test"]] as const) {
      const had = (await service.from("inbound_addresses").select("local_part").eq("org_id", org).maybeSingle()).data;
      if (had) await service.from("inbound_addresses").update({ allowed_domains: [domain] }).eq("org_id", org);
      else {
        await service.from("inbound_addresses").insert({ org_id: org, allowed_domains: [domain] });
        createdAddresses.push(org);
      }
    }
    localA = (await service.from("inbound_addresses").select("local_part").eq("org_id", orgA).single()).data!.local_part;
    localB = (await service.from("inbound_addresses").select("local_part").eq("org_id", orgB).single()).data!.local_part;

    // One PO in A, and one in B with the SAME number.
    const supplierA = (await service.from("suppliers").select("id").eq("org_id", orgA).eq("email", SUPPLIER_EMAIL).single()).data!.id;
    const customer = (await service.from("customers").insert({ org_id: orgA, name: CUSTOMER }).select("id").single()).data!.id;
    const order = (await service.from("sales_orders").insert({ org_id: orgA, customer_id: customer, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB" }).select("id").single()).data!.id;
    created.orders.push(order);
    lineA = (await service.from("order_lines").insert({ sales_order_id: order, line_no: 1, description: "Inbound widget", quantity: 2, unit_price_minor: 100, route: "direct_ship" }).select("id").single()).data!.id;
    const po = (await service.from("purchase_orders").insert({ org_id: orgA, supplier_id: supplierA, currency: "GBP", status: "sent" }).select("id, po_number").single()).data!;
    poA = po.id;
    poNumber = po.po_number;
    created.pos.push(poA);
    await service.from("purchase_order_lines").insert({ purchase_order_id: poA, order_line_id: lineA, quantity: 2 });

    const supplierB = (await service.from("suppliers").select("id").eq("org_id", orgB).limit(1).single()).data!.id;
    const b = await service.from("purchase_orders").insert({ org_id: orgB, supplier_id: supplierB, currency: "GBP", status: "sent", po_number: poNumber }).select("id").single();
    poB = b.data!.id;
    created.pos.push(poB);
  });

  afterAll(async () => {
    await service.from("inbound_messages").delete().in("org_id", [orgA, orgB]).like("message_id", "%supplier.test%");
    for (const id of created.pos) await service.from("purchase_orders").delete().eq("id", id);
    for (const id of created.orders) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    for (const org of createdAddresses) await service.from("inbound_addresses").delete().eq("org_id", org);
  });

  it("refuses unsigned, wrongly signed and stale webhooks", async () => {
    expect((await webhook.receiveMailgunWebhook(post(email(localA), { key: "not-the-key-xxxxxxxx" }).request)).status).toBe(401);
    expect((await webhook.receiveMailgunWebhook(post(email(localA), { ts: String(Math.floor(Date.now() / 1000) - 3600) }).request)).status).toBe(401);
    const unsigned = new FormData();
    unsigned.set("recipient", `${localA}@${DOMAIN}`);
    expect((await webhook.receiveMailgunWebhook(new Request("http://localhost/x", { method: "POST", body: unsigned }))).status).toBe(401);
  });

  it("refuses an address that doesn't exist, without saying more", async () => {
    expect((await webhook.receiveMailgunWebhook(post(email("r-000000000000000000000000000000")).request)).status).toBe(406);
  });

  it("holds back mail that wasn't forwarded by the organisation's own mailbox", async () => {
    const res = await webhook.receiveMailgunWebhook(post(email(localA, { sender: "jo@supplier-one.coast.test" })).request);
    expect(await res.json()).toEqual({ status: "quarantined" });
    expect(await responsesFor(poA)).toEqual([]);
  });

  it("sends forwarded mail to review — never applies it — even with perfect authentication from a known sender", async () => {
    const res = await webhook.receiveMailgunWebhook(post(email(localA)).request);
    expect(await res.json()).toEqual({ status: "review" });
    const r = await responsesFor(poA);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: "needs_review", source: "inbound" });
    created.responses.push(r[0]!.id);
    const line = (await service.from("purchase_order_lines").select("confirmed_date").eq("order_line_id", lineA).single()).data!;
    expect(line.confirmed_date).toBeNull();
  });

  it("uses each signed request once", async () => {
    const { request, token } = post(email(localA));
    await webhook.receiveMailgunWebhook(request);
    const again = await webhook.receiveMailgunWebhook(post(email(localA), { token }).request);
    expect(await again.text()).toBe("Already received.");
  });

  it("never attaches a reply sent to organisation B's address to organisation A's PO, even with the same PO number", async () => {
    const before = (await responsesFor(poA)).length;
    const res = await webhook.receiveMailgunWebhook(post(email(localB, { sender: "SRS0=x=yy=supplier-one.coast.test=po@yourco-b.test" })).request);
    expect(await res.json()).toEqual({ status: "review" });
    expect((await responsesFor(poA)).length).toBe(before);
    expect((await responsesFor(poB)).length).toBe(1);
  });

  it("keeps each organisation's emails to itself, and to procurement", async () => {
    expect(((await procurementA.from("inbound_messages").select("id")).data ?? []).length).toBeGreaterThan(0);
    expect((await salesA.from("inbound_messages").select("id")).data).toEqual([]);
    expect((await adminB.from("inbound_messages").select("id").eq("org_id", orgA)).data).toEqual([]);
    expect((await adminB.from("inbound_addresses").select("local_part").eq("org_id", orgA)).data).toEqual([]);
  });

  it("applies a Microsoft 365 date only when every rule passes, and lets procurement undo it", async () => {
    const m365 = (id: string, headers: [string, string][]) =>
      pipeline.handleInboundEmail(service, {
        orgId: orgA,
        channel: "m365",
        messageId: `<${id}-${Date.now()}@supplier.test>`,
        from: `Supplier One <${SUPPLIER_EMAIL}>`,
        envelopeSender: null,
        subject: `RE: Purchase order ${poNumber}`,
        text: `Hi, we confirm ${poNumber} for delivery on Friday 30 October 2026. Thanks`,
        headers,
      });
    // DMARC failing: a person checks.
    expect((await m365("dmarc", [["Authentication-Results", "spf=pass; dkim=pass; dmarc=fail"]])).status).toBe("review");

    // Three clean earlier answers from this supplier make its emails "proven".
    const { data: seeded } = await service
      .from("supplier_responses")
      .insert([1, 2, 3].map(() => ({ org_id: orgA, purchase_order_id: poA, source: "paste", confidence: "high", status: "applied" })))
      .select("id");
    created.responses.push(...(seeded ?? []).map((r) => r.id));

    const applied = await m365("good", PASS_HEADERS);
    expect(applied.status).toBe("applied");
    expect((await service.from("purchase_order_lines").select("confirmed_date").eq("order_line_id", lineA).single()).data!.confirmed_date).toBe("2026-10-30");

    const response = (await service.from("supplier_responses").select("id").eq("purchase_order_id", poA).eq("source", "inbound").eq("status", "applied").single()).data!;
    expect((await salesA.rpc("undo_supplier_answer", { p_response: response.id })).error).not.toBeNull();
    expect((await procurementA.rpc("undo_supplier_answer", { p_response: response.id })).error).toBeNull();
    expect((await service.from("purchase_order_lines").select("confirmed_date").eq("order_line_id", lineA).single()).data!.confirmed_date).toBeNull();
    expect((await service.from("purchase_orders").select("status").eq("id", poA).single()).data!.status).toBe("sent");
    expect((await service.from("supplier_responses").select("status, undone_at").eq("id", response.id).single()).data).toMatchObject({ status: "rejected" });
    expect((await procurementA.rpc("undo_supplier_answer", { p_response: response.id })).error?.message).toMatch(/already undone/);
  });
});
