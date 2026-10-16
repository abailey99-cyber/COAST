/**
 * Staff sign-in security (readiness plan Task 5B), against the dev database:
 * - two-step sign-in is enforced by the database: in an organisation that
 *   requires it, a password-only session sees nothing but its own staff
 *   record until the authenticator code is passed;
 * - repeated wrong passwords lock an address for 15 minutes, and both the
 *   failures and the lockout are security events.
 */

import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { totp } from "../helpers/totp";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77" }), cookies: async () => ({ getAll: () => [], set: () => undefined }) }));
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(url && anonKey && serviceKey && password) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const MFA_USER = "admin@demo-c.coast.test";

describe.skipIf(!enabled)("staff sign-in security", { timeout: 60_000 }, () => {
  let service: SupabaseClient;
  let userId: string;
  let orgC: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, opts);
    const staff = (await service.from("staff_users").select("id, org_id").eq("email", MFA_USER).maybeSingle()).data;
    if (!staff) throw new Error("Run npm run db:seed-demo first (it adds [Demo Org C], which requires two-step sign-in).");
    userId = staff.id;
    orgC = staff.org_id;
    const { data } = await service.auth.admin.mfa.listFactors({ userId });
    for (const f of data?.factors ?? []) await service.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  });

  afterAll(async () => {
    const { data } = await service.auth.admin.mfa.listFactors({ userId });
    for (const f of data?.factors ?? []) await service.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    await service.from("rate_limit_hits").delete().like("bucket", "signin-fail:staff:%");
    await service.from("rate_limit_hits").delete().like("bucket", "staff-sign-in:203.0.113.77");
  });

  it("shows a password-only session nothing but its own record, then everything after the code", async () => {
    const c = createClient(url!, anonKey!, opts);
    expect((await c.auth.signInWithPassword({ email: MFA_USER, password: password! })).error).toBeNull();
    expect((await c.from("organisations").select("id")).data).toEqual([]);
    expect((await c.from("staff_users").select("id")).data).toEqual([{ id: userId }]);
    expect((await c.rpc("staff_mfa_status").single()).data).toEqual({ required: true, passed: false });

    const { data: enrolled, error } = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: "test" });
    expect(error).toBeNull();
    expect((await c.auth.mfa.challengeAndVerify({ factorId: enrolled!.id, code: "000000" })).error).not.toBeNull();
    expect((await c.auth.mfa.challengeAndVerify({ factorId: enrolled!.id, code: totp(enrolled!.totp.secret) })).error).toBeNull();

    expect((await c.from("organisations").select("id")).data).toEqual([{ id: orgC }]);
    expect((await c.rpc("staff_mfa_status").single()).data).toEqual({ required: true, passed: true });
  });

  it("doesn't ask demo organisations used by automated tests for a code", async () => {
    const c = createClient(url!, anonKey!, opts);
    await c.auth.signInWithPassword({ email: "procurement@demo-a.coast.test", password: password! });
    expect((await c.rpc("staff_mfa_status").single()).data).toEqual({ required: false, passed: false });
    expect(((await c.from("organisations").select("id")).data ?? []).length).toBe(1);
  });

  it("locks an address after 5 wrong passwords, and logs the failures and the lockout", async () => {
    const guard = await import("@/server/sign-in-guard");
    const email = `nobody-${Date.now()}@demo-c.coast.test`;
    expect(await guard.beforeSignIn("staff", email)).toEqual({ ok: true });
    for (let i = 0; i < 5; i++) await guard.afterFailedSignIn("staff", email);
    expect(await guard.beforeSignIn("staff", email)).toEqual({ ok: false, error: guard.LOCKED_MESSAGE });
    // Another address isn't affected.
    expect(await guard.beforeSignIn("staff", `other-${Date.now()}@demo-c.coast.test`)).toEqual({ ok: true });

    // A real staff address: its organisation's admins see the events.
    for (let i = 0; i < 5; i++) await guard.afterFailedSignIn("staff", MFA_USER);
    const { data: events } = await service.from("security_events").select("kind, detail").eq("org_id", orgC).in("kind", ["sign_in_failed", "account_locked"]).order("created_at", { ascending: false }).limit(10);
    expect(events!.map((e) => e.kind)).toEqual(expect.arrayContaining(["sign_in_failed", "account_locked"]));
    expect(JSON.stringify(events)).not.toContain(MFA_USER);
    expect(events![0]!.detail).toMatchObject({ email: "a•••@demo-c.coast.test" });
  });
});
