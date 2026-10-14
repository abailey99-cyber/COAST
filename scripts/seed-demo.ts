/**
 * Demo data for a development or staging database (decisions C15).
 *
 *   npm run db:seed-demo
 *
 * Creates two obviously-fake organisations and one sign-in per role, all
 * with the password in DEMO_USER_PASSWORD (.env.local). Safe to run again.
 * Refuses to run when COAST_ENV=production.
 *
 * Emails use the reserved .test domain, so nothing can ever be delivered.
 */

import { MIN_PASSWORD_LENGTH } from "../src/lib/logic/security";
import { adminClient, coastEnv, ensureOrganisation, ensureStaffUser, fail, type StaffSpec } from "./lib/admin";

async function main() {
  if (coastEnv() === "production") fail("Refusing to seed demo data into production.");
  const password = process.env.DEMO_USER_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) fail(`Set DEMO_USER_PASSWORD in .env.local (at least ${MIN_PASSWORD_LENGTH} characters).`);

  const admin = adminClient();
  const orgA = await ensureOrganisation(admin, "[Demo Org A]", "demo-org-a");
  const orgB = await ensureOrganisation(admin, "[Demo Org B]", "demo-org-b");

  const people: StaffSpec[] = [
    { email: "admin@demo-a.coast.test", fullName: "[Admin A]", role: "admin", orgId: orgA },
    { email: "procurement@demo-a.coast.test", fullName: "[Procurement A]", role: "procurement", orgId: orgA },
    { email: "salesmanager@demo-a.coast.test", fullName: "[Sales manager A]", role: "sales_manager", orgId: orgA },
    { email: "sales@demo-a.coast.test", fullName: "[Sales rep A]", role: "sales", orgId: orgA },
    { email: "sales2@demo-a.coast.test", fullName: "[Sales rep A2]", role: "sales", orgId: orgA },
    { email: "director@demo-a.coast.test", fullName: "[Director A]", role: "director", orgId: orgA },
    { email: "goodsin@demo-a.coast.test", fullName: "[Goods-in A]", role: "goods_in", orgId: orgA },
    { email: "admin@demo-b.coast.test", fullName: "[Admin B]", role: "admin", orgId: orgB },
  ];

  const ids: Record<string, string> = {};
  for (const person of people) {
    ids[person.email] = await ensureStaffUser(admin, { ...person, password });
    console.log(`  ✓ ${person.email} (${person.role})`);
  }

  await seedOrders(admin, orgA, ids["sales@demo-a.coast.test"]!, ids["sales2@demo-a.coast.test"]!);
  await seedShipments(admin, orgA);

  console.log("\nDemo data ready. Sign in with any address above and DEMO_USER_PASSWORD.\n");
}

type Admin = ReturnType<typeof adminClient>;

/** Await a Supabase call; stop the script with a clear message if it failed. */
async function must<R = { id: string }>(label: string, p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) fail(`${label}: ${error?.message ?? "no data"}`);
  return data as R;
}

/**
 * Demo orders for [Demo Org A], echoing the Orders mockup. Placeholder names
 * only. Skipped if they already exist (re-running never duplicates them).
 */
async function seedOrders(admin: Admin, orgId: string, repA: string, repA2: string) {
  const existing = await admin.from("sales_orders").select("id").eq("org_id", orgId).eq("so_number", "SO-10421").maybeSingle();
  if (existing.data) {
    console.log("  · demo orders already present");
    return;
  }

  const supplierRows: { org_id: string; name: string; email: string | null; currency: string; typical_lead_time_days: number | null }[] = [
    { org_id: orgId, name: "[Demo Supplier One]", email: "orders@supplier-one.coast.test", currency: "GBP", typical_lead_time_days: 5 },
    { org_id: orgId, name: "[Demo Supplier Two]", email: "sales@supplier-two.coast.test", currency: "EUR", typical_lead_time_days: 10 },
    { org_id: orgId, name: "[Demo Supplier Three]", email: null, currency: "GBP", typical_lead_time_days: null },
  ];
  for (const row of supplierRows) {
    const found = await admin.from("suppliers").select("id").eq("org_id", orgId).eq("name", row.name).maybeSingle();
    if (!found.data) await must("supplier", admin.from("suppliers").insert(row).select("id").single());
  }
  const suppliers = await must<{ id: string; name: string }[]>("suppliers", admin.from("suppliers").select("id, name").eq("org_id", orgId));
  const supplier = (n: string) => suppliers.find((s) => s.name === n)!.id;

  const customerNames = ["[Customer A]", "[Customer B]", "[Customer C]", "[Customer D]", "[Customer E]", "[Customer F]"];
  for (const name of customerNames) {
    const found = await admin.from("customers").select("id").eq("org_id", orgId).eq("name", name).maybeSingle();
    if (!found.data) await must("customer", admin.from("customers").insert({ org_id: orgId, name }).select("id").single());
  }
  const customers = await must<{ id: string; name: string }[]>("customers", admin.from("customers").select("id, name").eq("org_id", orgId));
  const customer = (n: string) => customers.find((c) => c.name === n)!.id;

  const address = (who: string) => ({
    delivery_name: `${who} Goods In`,
    delivery_line1: "1 Example Business Park",
    delivery_town: "Newark",
    delivery_postcode: "NG24 1AB",
    delivery_country: "GB",
  });

  type Line = { description: string; sku: string; quantity: number; price: number; route: string; stage: string; po?: string };
  const orders: { so: string; cust: string; ref?: string; rep: string; promised: string | null; lines: Line[] }[] = [
    { so: "SO-10421", cust: "[Customer A]", ref: "CA-PO-7781", rep: repA, promised: "2026-10-22", lines: [{ description: "Industrial shelving unit", sku: "SHF-200", quantity: 4, price: 18900, route: "direct_ship", stage: "confirmed", po: "one" }] },
    { so: "SO-10418", cust: "[Customer B]", rep: repA2, promised: "2026-10-20", lines: [{ description: "Pallet racking beams", sku: "PRB-90", quantity: 20, price: 2450, route: "via_warehouse", stage: "inbound", po: "two" }] },
    { so: "SO-10409", cust: "[Customer C]", ref: "4500021", rep: repA, promised: "2026-10-27", lines: [{ description: "Safety barrier, 2m", sku: "BAR-2M", quantity: 12, price: 6400, route: "direct_ship", stage: "ordered", po: "one" }] },
    { so: "SO-10402", cust: "[Customer D]", rep: repA2, promised: "2026-10-15", lines: [{ description: "Floor marking tape", sku: "TAPE-Y", quantity: 30, price: 899, route: "from_stock", stage: "in_transit" }] },
    {
      so: "SO-10396",
      cust: "[Customer E]",
      rep: repA,
      promised: "2026-10-23",
      lines: [
        { description: "Mesh partition panel", sku: "MPP-1", quantity: 6, price: 12500, route: "via_warehouse", stage: "ordered" },
        { description: "Partition door kit", sku: "MPD-1", quantity: 1, price: 34000, route: "via_warehouse", stage: "ordered" },
      ],
    },
    { so: "SO-10388", cust: "[Customer F]", rep: repA2, promised: "2026-10-10", lines: [{ description: "Anti-fatigue mat", sku: "MAT-3", quantity: 8, price: 4200, route: "direct_ship", stage: "delivered", po: "three" }] },
  ];

  for (const o of orders) {
    const order = await must(
      `order ${o.so}`,
      admin
        .from("sales_orders")
        .insert({ org_id: orgId, so_number: o.so, customer_id: customer(o.cust), customer_reference: o.ref ?? null, sales_rep_id: o.rep, currency: "GBP", promised_date: o.promised, ...address(o.cust) })
        .select("id")
        .single(),
    );
    for (const [i, l] of o.lines.entries()) {
      const line = await must(
        `line ${o.so}/${i + 1}`,
        admin
          .from("order_lines")
          .insert({ sales_order_id: order.id, line_no: i + 1, sku: l.sku, description: l.description, quantity: l.quantity, unit_price_minor: l.price, route: l.route, stage: l.stage })
          .select("id")
          .single(),
      );
      if (l.po) {
        const status = l.stage === "ordered" ? "draft" : l.stage === "po_sent" ? "sent" : "confirmed";
        const po = await must(
          `PO for ${o.so}`,
          admin.from("purchase_orders").insert({ org_id: orgId, supplier_id: supplier(`[Demo Supplier ${l.po[0]!.toUpperCase()}${l.po.slice(1)}]`), currency: "GBP", status }).select("id").single(),
        );
        const pol = await must(`PO line for ${o.so}`, admin.from("purchase_order_lines").insert({ purchase_order_id: po.id, order_line_id: line.id, quantity: l.quantity }).select("id").single());
        await must(`PO cost for ${o.so}`, admin.from("purchase_order_line_costs").insert({ purchase_order_line_id: pol.id, unit_cost_minor: Math.round(l.price * 0.62) }).select("purchase_order_line_id").single());
      }
    }
  }
  console.log(`  ✓ ${orders.length} demo orders, 3 demo suppliers`);
}

/**
 * Demo shipments on the test carrier (Phase 3), so the Shipments screen and
 * order pages have something to show. The next tracking poll fills in their
 * events. Safe to run again: existing tracking numbers are skipped.
 */
async function seedShipments(admin: Admin, orgId: string) {
  const plan = [
    { so: "SO-10418", leg: "inbound", tracking: "MOCK-TRANSIT-10418" },
    { so: "SO-10402", leg: "outbound", tracking: "MOCK-TRANSIT-10402" },
    { so: "SO-10388", leg: "direct", tracking: "MOCK-DELIVERED-10388" },
  ];
  let added = 0;
  for (const s of plan) {
    const order = await admin.from("sales_orders").select("id").eq("org_id", orgId).eq("so_number", s.so).maybeSingle();
    if (!order.data) continue;
    const exists = await admin.from("shipments").select("id").eq("sales_order_id", order.data.id).eq("tracking_number", s.tracking).maybeSingle();
    if (exists.data) continue;
    const shipment = await must(
      `shipment for ${s.so}`,
      admin.from("shipments").insert({ org_id: orgId, sales_order_id: order.data.id, leg: s.leg, carrier: "mock", tracking_number: s.tracking }).select("id").single(),
    );
    const lines = await must<{ id: string }[]>(`lines of ${s.so}`, admin.from("order_lines").select("id").eq("sales_order_id", order.data.id));
    for (const l of lines) await must(`shipment line for ${s.so}`, admin.from("shipment_lines").insert({ shipment_id: shipment.id, order_line_id: l.id }).select("shipment_id").single());
    added++;
  }
  console.log(added ? `  ✓ ${added} demo shipments on the test carrier` : "  · demo shipments already present");
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
