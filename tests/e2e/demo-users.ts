import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONFIGURABLE_ROLES, DEFAULT_PERMISSIONS } from "../../src/lib/logic/permissions";

/** Demo sign-ins created by `npm run db:seed-demo`. */
export const DEMO_USERS = [
  "admin@demo-a.coast.test",
  "procurement@demo-a.coast.test",
  "salesmanager@demo-a.coast.test",
  "sales@demo-a.coast.test",
  "sales2@demo-a.coast.test",
  "director@demo-a.coast.test",
  "goodsin@demo-a.coast.test",
  "admin@demo-b.coast.test",
] as const;

export type DemoUser = (typeof DEMO_USERS)[number];

/** Saved session for a demo user (inside test-results/, which git ignores). */
export function sessionFile(email: string): string {
  return `test-results/.auth/${email.replace(/[^a-z0-9]/gi, "_")}.json`;
}


export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export async function demoOrgId(service: SupabaseClient): Promise<string> {
  const { data } = await service.from("organisations").select("id").eq("slug", "demo-org-a").single();
  return data!.id as string;
}

/** Put [Demo Org A] back to the default permissions, whatever an earlier failed run left behind. */
export async function resetDemoPermissions(): Promise<void> {
  const service = serviceClient();
  const orgId = await demoOrgId(service);
  const { data: people } = await service.from("staff_users").select("id").eq("org_id", orgId);
  await service.from("staff_permission_overrides").delete().in("user_id", (people ?? []).map((p) => p.id));
  await service.from("role_permissions").delete().eq("org_id", orgId);
  const rows = CONFIGURABLE_ROLES.flatMap((role) => DEFAULT_PERMISSIONS[role].map((permission) => ({ org_id: orgId, role, permission, granted_by: null })));
  const { error } = await service.from("role_permissions").insert(rows);
  if (error) throw new Error(`Couldn't reset permissions: ${error.message}`);
  // Every test signs in from this one computer: start each run with clean sign-in counters (readiness Task 5B limits).
  for (const prefix of ["staff-sign-in:", "customer-sign-in:", "signin-fail:", "mfa-code:", "confirm-"]) await service.from("rate_limit_hits").delete().like("bucket", `${prefix}%`);
}

export const e2eEnabled =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DEMO_USER_PASSWORD) && process.env.COAST_ENV !== "production";

export interface TestOrder {
  orderId: string;
  soNumber: string;
  lineIds: string[];
}

/** A throwaway order for [Demo Org A], so tests never change the demo orders. */
export async function createTestOrder(service: SupabaseClient, customerName: string, lines: { description: string; quantity: number; route: string }[]): Promise<TestOrder> {
  const orgId = await demoOrgId(service);
  let { data: cust } = await service.from("customers").select("id").eq("org_id", orgId).eq("name", customerName).maybeSingle();
  if (!cust) cust = (await service.from("customers").insert({ org_id: orgId, name: customerName }).select("id").single()).data;
  const { data: rep } = await service.from("staff_users").select("id").eq("email", "sales@demo-a.coast.test").single();
  const { data: order, error } = await service
    .from("sales_orders")
    .insert({ org_id: orgId, customer_id: cust!.id, sales_rep_id: rep!.id, currency: "GBP", delivery_name: `${customerName} Goods In`, delivery_line1: "3 Test Way", delivery_town: "Newark", delivery_postcode: "NG24 1AB", delivery_country: "GB" })
    .select("id, so_number")
    .single();
  if (error) throw new Error(`Couldn't create test order: ${error.message}`);
  const lineIds: string[] = [];
  for (const [i, l] of lines.entries()) {
    const { data } = await service.from("order_lines").insert({ sales_order_id: order!.id, line_no: i + 1, description: l.description, quantity: l.quantity, unit_price_minor: 1500, route: l.route }).select("id").single();
    lineIds.push(data!.id);
  }
  return { orderId: order!.id, soNumber: order!.so_number, lineIds };
}

/** Removes everything a test made for a customer: POs (and their emails, links, answers, chases), orders, the customer. */
export async function deleteTestCustomer(service: SupabaseClient, customerName: string): Promise<void> {
  const orgId = await demoOrgId(service);
  const { data: cust } = await service.from("customers").select("id").eq("org_id", orgId).eq("name", customerName);
  const custIds = (cust ?? []).map((c) => c.id);
  if (!custIds.length) return;
  const { data: orders } = await service.from("sales_orders").select("id").in("customer_id", custIds);
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length) {
    const { data: lines } = await service.from("order_lines").select("id").in("sales_order_id", orderIds);
    const { data: pols } = await service.from("purchase_order_lines").select("purchase_order_id").in("order_line_id", (lines ?? []).map((l) => l.id));
    const poIds = [...new Set((pols ?? []).map((p) => p.purchase_order_id))];
    if (poIds.length) await service.from("purchase_orders").delete().in("id", poIds);
    await service.from("sales_orders").delete().in("id", orderIds);
  }
  await service.from("customers").delete().in("id", custIds);
}

/** Opens the main menu (the COAST logo at the top). */
export async function openMenu(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Open menu" }).click();
}
