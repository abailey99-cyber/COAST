/**
 * Branches (Phase 7b), against the dev database. Step 1: the additive
 * migration — every organisation has exactly one default branch, every order
 * and sales rep is in a branch of their own organisation, and nothing can
 * point across organisations.
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
const CUSTOMER = "[RLS branches customer]";

describe.skipIf(!enabled)("branches", { timeout: 60_000 }, () => {
  let service: SupabaseClient;
  let adminA: SupabaseClient, salesA: SupabaseClient, adminB: SupabaseClient;
  let orgA: string, orgB: string, customerA: string, defaultA: string, defaultB: string, salesAId: string;
  const branchIds: string[] = [];
  const orderIds: string[] = [];

  const signIn = async (email: string) => {
    const c = createClient(url!, anonKey!, opts);
    const { error } = await c.auth.signInWithPassword({ email, password: password! });
    if (error) throw new Error(`Sign in ${email}: ${error.message} (run npm run db:seed-demo)`);
    return c;
  };
  const newOrder = async (extra: Record<string, unknown>) => {
    const { data, error } = await service
      .from("sales_orders")
      .insert({ org_id: orgA, customer_id: customerA, currency: "GBP", delivery_name: "x", delivery_line1: "x", delivery_town: "x", delivery_postcode: "NG24 1AB", delivery_country: "GB", ...extra })
      .select("id, branch_id")
      .single();
    if (error) throw new Error(error.message);
    orderIds.push(data.id);
    return data as { id: string; branch_id: string };
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    orgB = (await service.from("organisations").select("id").eq("slug", "demo-org-b").single()).data!.id;
    defaultA = (await service.from("branches").select("id").eq("org_id", orgA).eq("is_default", true).single()).data!.id;
    defaultB = (await service.from("branches").select("id").eq("org_id", orgB).eq("is_default", true).single()).data!.id;
    customerA = (await service.from("customers").insert({ org_id: orgA, name: CUSTOMER }).select("id").single()).data!.id;
    salesAId = (await service.from("staff_users").select("id").eq("email", "sales@demo-a.coast.test").single()).data!.id;
    [adminA, salesA, adminB] = await Promise.all([signIn("admin@demo-a.coast.test"), signIn("sales@demo-a.coast.test"), signIn("admin@demo-b.coast.test")]);
  });

  afterAll(async () => {
    await service.from("staff_users").update({ home_branch_id: defaultA }).eq("id", salesAId);
    for (const id of orderIds) await service.from("sales_orders").delete().eq("id", id);
    await service.from("customers").delete().eq("org_id", orgA).eq("name", CUSTOMER);
    for (const id of branchIds) await service.from("branches").delete().eq("id", id);
  });

  it("gives every organisation exactly one default branch, active", async () => {
    const { data: orgs } = await service.from("organisations").select("id");
    const { data: defaults } = await service.from("branches").select("org_id, is_active").eq("is_default", true);
    expect(defaults!.length).toBe(orgs!.length);
    expect(new Set(defaults!.map((d) => d.org_id)).size).toBe(orgs!.length);
    expect(defaults!.every((d) => d.is_active)).toBe(true);
  });

  it("puts every order in a branch, and every sales rep in a home branch", async () => {
    expect((await service.from("sales_orders").select("id", { count: "exact", head: true }).is("branch_id", null)).count).toBe(0);
    const { count } = await service.from("staff_users").select("id", { count: "exact", head: true }).in("role", ["sales", "sales_manager"]).is("home_branch_id", null);
    expect(count).toBe(0);
  });

  it("starts a new organisation with its own default branch", async () => {
    const slug = `branch-test-${Date.now()}`;
    const { data: org } = await service.from("organisations").insert({ name: "[Branch test org]", slug }).select("id").single();
    try {
      const { data } = await service.from("branches").select("name, code, is_default").eq("org_id", org!.id);
      expect(data).toEqual([{ name: "Main branch", code: "MAIN", is_default: true }]);
    } finally {
      await service.from("organisations").delete().eq("id", org!.id);
    }
  });

  it("refuses a second default, and refuses to switch the default off", async () => {
    const { data: extra, error } = await service.from("branches").insert({ org_id: orgA, name: "[Test branch]", code: "TST1" }).select("id").single();
    expect(error).toBeNull();
    branchIds.push(extra!.id);
    expect((await service.from("branches").update({ is_default: true }).eq("id", extra!.id)).error).not.toBeNull();
    expect((await service.from("branches").update({ is_default: false }).eq("id", defaultA)).error).not.toBeNull();
    expect((await service.from("branches").update({ is_active: false }).eq("id", defaultA)).error).not.toBeNull();
  });

  it("puts a new order in its creator's home branch, else the default; a chosen branch is kept", async () => {
    const other = branchIds[0]!;
    await service.from("staff_users").update({ home_branch_id: other }).eq("id", salesAId);
    expect((await newOrder({ created_by: salesAId })).branch_id).toBe(other);
    expect((await newOrder({})).branch_id).toBe(defaultA);
    expect((await newOrder({ created_by: salesAId, branch_id: defaultA })).branch_id).toBe(defaultA);
    // An inactive home branch isn't used.
    await service.from("branches").update({ is_active: false }).eq("id", other);
    expect((await newOrder({ created_by: salesAId })).branch_id).toBe(defaultA);
    await service.from("branches").update({ is_active: true }).eq("id", other);
  });

  it("can't point an order, a home branch or a grant at another organisation's branch", async () => {
    expect((await newOrder({ branch_id: defaultA })).branch_id).toBe(defaultA);
    const crossOrder = await service.from("sales_orders").update({ branch_id: defaultB }).eq("id", orderIds.at(-1)!);
    expect(crossOrder.error).not.toBeNull();
    expect((await service.from("staff_users").update({ home_branch_id: defaultB }).eq("id", salesAId)).error).not.toBeNull();
    expect((await service.from("user_branch_access").insert({ org_id: orgA, staff_id: salesAId, branch_id: defaultB })).error).not.toBeNull();
    expect((await service.from("user_branch_access").insert({ org_id: orgB, staff_id: salesAId, branch_id: defaultB })).error).not.toBeNull();
  });

  it("lets only an admin add a branch, and each organisation sees only its own", async () => {
    expect((await salesA.from("branches").insert({ org_id: orgA, name: "[Rep branch]", code: "REP1" }).select()).error).not.toBeNull();
    const { data, error } = await adminA.from("branches").insert({ org_id: orgA, name: "[Admin branch]", code: "ADM1" }).select("id").single();
    expect(error).toBeNull();
    branchIds.push(data!.id);
    expect((await adminB.from("branches").insert({ org_id: orgA, name: "[Wrong org]", code: "BAD1" }).select()).error).not.toBeNull();
    const seenByB = (await adminB.from("branches").select("org_id")).data!;
    expect(seenByB.length).toBeGreaterThan(0);
    expect(seenByB.every((b) => b.org_id === orgB)).toBe(true);
    expect((await salesA.from("branches").select("id")).data!.map((b) => b.id)).toContain(defaultA);
  });

  it("lets a person see their own extra branches but not other people's; only admins grant", async () => {
    const other = branchIds[0]!;
    expect((await salesA.from("user_branch_access").insert({ org_id: orgA, staff_id: salesAId, branch_id: other, granted_by: salesAId })).error).not.toBeNull();
    const adminId = (await service.from("staff_users").select("id").eq("email", "admin@demo-a.coast.test").single()).data!.id;
    expect((await adminA.from("user_branch_access").insert({ org_id: orgA, staff_id: salesAId, branch_id: other, granted_by: adminId })).error).toBeNull();
    expect((await salesA.from("user_branch_access").select("branch_id")).data).toEqual([{ branch_id: other }]);
    expect((await adminB.from("user_branch_access").select("branch_id").eq("staff_id", salesAId)).data).toEqual([]);
    expect((await adminA.from("user_branch_access").delete().eq("staff_id", salesAId).eq("branch_id", other).select()).data).toHaveLength(1);
  });
});
