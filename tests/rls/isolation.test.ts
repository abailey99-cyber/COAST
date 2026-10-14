/**
 * Row-level security tests against a real Supabase database (CLAUDE.md
 * non-negotiable 7: "org A can't read org B").
 *
 * They sign in as the demo users from `npm run db:seed-demo` and go through
 * the public API exactly as the app does, so they test the real path.
 * Skipped (not failed) when the database or demo password isn't configured —
 * see KNOWN-GAPS.md. Never point these at production.
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

function anon(): SupabaseClient {
  return createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const client = anon();
  const { error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} — run npm run db:seed-demo first. (${error.message})`);
  return client;
}

describe.skipIf(!enabled)("row-level security", () => {
  let service: SupabaseClient;
  let adminA: SupabaseClient;
  let adminB: SupabaseClient;
  let salesA: SupabaseClient;
  let orgA: string;
  let orgB: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    [adminA, adminB, salesA] = await Promise.all([
      signedIn("admin@demo-a.coast.test"),
      signedIn("admin@demo-b.coast.test"),
      signedIn("sales@demo-a.coast.test"),
    ]);
    const orgs = await service.from("organisations").select("id, slug").in("slug", ["demo-org-a", "demo-org-b"]);
    orgA = orgs.data!.find((o) => o.slug === "demo-org-a")!.id;
    orgB = orgs.data!.find((o) => o.slug === "demo-org-b")!.id;
    const staff = await service.from("staff_users").select("id, email").like("email", "%.coast.test");
    ids = Object.fromEntries(staff.data!.map((s) => [s.email, s.id]));
  });

  afterAll(async () => {
    // Put back anything a test changed.
    if (service && ids) {
      await service.from("staff_users").update({ is_active: true }).eq("id", ids["goodsin@demo-a.coast.test"]!);
      await service.from("staff_users").update({ full_name: "[Procurement A]" }).eq("id", ids["procurement@demo-a.coast.test"]!);
    }
  });

  it("shows each admin only their own organisation", async () => {
    const a = await adminA.from("organisations").select("id");
    const b = await adminB.from("organisations").select("id");
    expect(a.data?.map((o) => o.id)).toEqual([orgA]);
    expect(b.data?.map((o) => o.id)).toEqual([orgB]);
  });

  it("never returns another organisation's staff", async () => {
    const a = await adminA.from("staff_users").select("org_id");
    expect(a.data!.length).toBeGreaterThanOrEqual(5);
    expect(a.data!.every((s) => s.org_id === orgA)).toBe(true);

    const b = await adminB.from("staff_users").select("org_id");
    expect(b.data!.every((s) => s.org_id === orgB)).toBe(true);
  });

  it("refuses a direct lookup of another organisation's row by id", async () => {
    const res = await adminA.from("staff_users").select("id").eq("id", ids["admin@demo-b.coast.test"]!);
    expect(res.data).toEqual([]);
    const org = await adminA.from("organisations").select("id").eq("id", orgB);
    expect(org.data).toEqual([]);
  });

  it("gives a signed-out visitor nothing", async () => {
    const client = anon();
    const orgs = await client.from("organisations").select("id");
    const staff = await client.from("staff_users").select("id");
    expect(orgs.data ?? []).toEqual([]);
    expect(staff.data ?? []).toEqual([]);
  });

  it("stops an admin editing another organisation's staff", async () => {
    const res = await adminA.from("staff_users").update({ full_name: "Hacked" }).eq("id", ids["admin@demo-b.coast.test"]!).select();
    expect(res.data ?? []).toEqual([]);
    const check = await service.from("staff_users").select("full_name").eq("id", ids["admin@demo-b.coast.test"]!).single();
    expect(check.data!.full_name).toBe("[Admin B]");
  });

  it("stops sales editing anyone", async () => {
    const res = await salesA.from("staff_users").update({ full_name: "Hacked" }).eq("id", ids["procurement@demo-a.coast.test"]!).select();
    expect(res.data ?? []).toEqual([]);
  });

  it("stops an admin editing their own row (no self-lockout)", async () => {
    const res = await adminA.from("staff_users").update({ role: "sales" }).eq("id", ids["admin@demo-a.coast.test"]!).select();
    expect(res.data ?? []).toEqual([]);
  });

  it("lets an admin edit a teammate's name", async () => {
    const res = await adminA.from("staff_users").update({ full_name: "[Procurement A renamed]" }).eq("id", ids["procurement@demo-a.coast.test"]!).select("full_name");
    expect(res.data).toEqual([{ full_name: "[Procurement A renamed]" }]);
  });

  it("never lets anyone move a person to another organisation", async () => {
    const res = await adminA.from("staff_users").update({ org_id: orgB }).eq("id", ids["sales@demo-a.coast.test"]!).select();
    expect(res.error).not.toBeNull(); // column isn't updatable at all
  });

  it("cuts off a deactivated user immediately", async () => {
    const goodsIn = await signedIn("goodsin@demo-a.coast.test");
    expect((await goodsIn.from("organisations").select("id")).data).toEqual([{ id: orgA }]);

    await service.from("staff_users").update({ is_active: false }).eq("id", ids["goodsin@demo-a.coast.test"]!);
    expect((await goodsIn.from("organisations").select("id")).data).toEqual([]);
    expect((await goodsIn.from("staff_users").select("id")).data).toEqual([]);
  });
});
