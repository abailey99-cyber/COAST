/**
 * Per-organisation encrypted credentials (readiness plan Task 2), against the
 * dev database: only that organisation's admin can create, change or delete
 * them; nobody signed in can read the encrypted value; the resolver (what
 * background jobs use) only ever returns an organisation's own credentials;
 * a secret copied into another organisation's row won't decrypt; every
 * change is a security event; and no decrypted secret reaches the logs.
 */

import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const enabled = Boolean(url && anonKey && serviceKey && password && process.env.COAST_CREDENTIAL_KEYS) && process.env.COAST_ENV !== "production";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

// Made up for the test, long enough to be recognisable if it ever leaked.
const SECRET = `test-dhl-key-${Math.random().toString(36).slice(2)}-never-log-me`;

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url!, anonKey!, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: password! });
  if (error) throw new Error(`Couldn't sign in as ${email} (${error.message})`);
  return c;
}

describe.skipIf(!enabled)("integration credentials", () => {
  let service: SupabaseClient, adminA: SupabaseClient, adminB: SupabaseClient, procurementA: SupabaseClient;
  let orgA: string, orgB: string;
  const logged: string[] = [];
  const spies: { mockRestore(): void }[] = [];
  let resolver: typeof import("@/server/credentials");
  let crypto: typeof import("@/lib/secrets/crypto");

  const sealFor = (orgId: string, secret: Record<string, string>) =>
    crypto.encryptSecret(JSON.stringify(secret), { orgId, provider: "dhl", kind: "api_key" }, crypto.keyringFromEnv()!);

  beforeAll(async () => {
    for (const level of ["log", "info", "warn", "error"] as const) {
      spies.push(vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))));
    }
    resolver = await import("@/server/credentials");
    crypto = await import("@/lib/secrets/crypto");
    service = createClient(url!, serviceKey!, opts);
    [adminA, adminB, procurementA] = (await Promise.all(["admin@demo-a", "admin@demo-b", "procurement@demo-a"].map((u) => signedIn(`${u}.coast.test`)))) as [SupabaseClient, SupabaseClient, SupabaseClient];
    orgA = (await service.from("organisations").select("id").eq("slug", "demo-org-a").single()).data!.id;
    orgB = (await service.from("organisations").select("id").eq("slug", "demo-org-b").single()).data!.id;
    await service.from("integration_credentials").delete().in("org_id", [orgA, orgB]).eq("provider", "dhl");
  });

  afterAll(async () => {
    await service.from("integration_credentials").delete().in("org_id", [orgA, orgB]).eq("provider", "dhl");
    for (const s of spies) s.mockRestore();
  });

  it("lets an organisation's admin connect, but nobody signed in can read the secret back", async () => {
    const sealed = sealFor(orgA, { apiKey: SECRET });
    const { error } = await adminA.from("integration_credentials").insert({ org_id: orgA, provider: "dhl", kind: "api_key", ciphertext: sealed.ciphertext, key_version: sealed.keyVersion, hint: "…" + SECRET.slice(-4) }).select("id").single();
    expect(error).toBeNull();
    expect((await adminA.from("integration_credentials").select("ciphertext").eq("provider", "dhl")).error?.message).toMatch(/permission denied/);
    expect((await adminA.from("integration_credentials").select("*").eq("provider", "dhl")).error?.message).toMatch(/permission denied/);
    const meta = await adminA.from("integration_credentials").select("provider, hint, key_version").eq("provider", "dhl").single();
    expect(meta.data).toMatchObject({ provider: "dhl", key_version: 1 });
    // The stored value is ciphertext, not the key.
    const raw = (await service.from("integration_credentials").select("ciphertext").eq("org_id", orgA).eq("provider", "dhl").single()).data!;
    expect(raw.ciphertext).not.toContain(SECRET);
  });

  it("doesn't let anyone but that organisation's admin change it", async () => {
    expect((await procurementA.from("integration_credentials").insert({ org_id: orgA, provider: "fedex", kind: "oauth_client" })).error).not.toBeNull();
    const p = await procurementA.from("integration_credentials").update({ hint: "x" }).eq("org_id", orgA).eq("provider", "dhl").select("id");
    expect(p.data ?? []).toEqual([]);
    expect((await procurementA.from("integration_credentials").delete().eq("org_id", orgA).eq("provider", "dhl").select("id")).data ?? []).toEqual([]);

    expect((await adminB.from("integration_credentials").insert({ org_id: orgA, provider: "fedex", kind: "oauth_client" })).error).not.toBeNull();
    expect((await adminB.from("integration_credentials").select("id").eq("org_id", orgA)).data).toEqual([]);
    expect((await adminB.from("integration_credentials").update({ hint: "x" }).eq("org_id", orgA).select("id")).data ?? []).toEqual([]);
    expect((await adminB.from("integration_credentials").delete().eq("org_id", orgA).select("id")).data ?? []).toEqual([]);
  });

  it("gives a job each organisation's own credentials, and nothing for an organisation that hasn't connected", async () => {
    expect((await resolver.getIntegrationCredentials(orgA, "dhl"))?.secret).toEqual({ apiKey: SECRET });
    expect(await resolver.getIntegrationCredentials(orgB, "dhl")).toBeNull();
    expect(await resolver.getIntegrationCredentials(orgA, "fedex")).toBeNull();
    const used = (await service.from("integration_credentials").select("last_used_at").eq("org_id", orgA).eq("provider", "dhl").single()).data!;
    await new Promise((r) => setTimeout(r, 300));
    expect(used.last_used_at ?? (await service.from("integration_credentials").select("last_used_at").eq("org_id", orgA).eq("provider", "dhl").single()).data!.last_used_at).not.toBeNull();
  });

  it("won't decrypt organisation A's secret copied into organisation B's row, and logs it as a security event", async () => {
    const a = (await service.from("integration_credentials").select("ciphertext, key_version").eq("org_id", orgA).eq("provider", "dhl").single()).data!;
    await service.from("integration_credentials").insert({ org_id: orgB, provider: "dhl", kind: "api_key", ciphertext: a.ciphertext, key_version: a.key_version });
    expect(await resolver.getIntegrationCredentials(orgB, "dhl")).toBeNull();
    const row = (await service.from("integration_credentials").select("status, last_error").eq("org_id", orgB).eq("provider", "dhl").single()).data!;
    expect(row.status).toBe("error");
    const { data: events } = await service.from("security_events").select("kind, detail").eq("org_id", orgB).eq("kind", "credential_decrypt_failed").order("created_at", { ascending: false }).limit(1);
    expect(events?.[0]?.detail).toMatchObject({ provider: "dhl" });
  });

  it("records create, change and delete as security events only that organisation's admin can read", async () => {
    const next = sealFor(orgA, { apiKey: `${SECRET}-2` });
    expect((await adminA.from("integration_credentials").update({ ciphertext: next.ciphertext, key_version: next.keyVersion, rotated_at: new Date().toISOString() }).eq("provider", "dhl").select("id")).data?.length).toBe(1);
    const kinds = ((await adminA.from("security_events").select("kind, detail").order("created_at", { ascending: false }).limit(10)).data ?? []).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["credential_created", "credential_rotated"]));
    expect((await adminB.from("security_events").select("id").eq("org_id", orgA)).data).toEqual([]);
    expect((await procurementA.from("security_events").select("id")).data).toEqual([]);
    expect((await adminA.from("integration_credentials").delete().eq("provider", "dhl").select("id")).data?.length).toBe(1);
    const last = (await adminA.from("security_events").select("kind").order("created_at", { ascending: false }).limit(1)).data!;
    expect(last[0]!.kind).toBe("credential_deleted");
    // Security events never carry the secret either.
    const all = JSON.stringify((await service.from("security_events").select("detail").in("org_id", [orgA, orgB]).order("created_at", { ascending: false }).limit(50)).data);
    expect(all).not.toContain(SECRET);
  });

  it("never wrote a decrypted secret to the logs", () => {
    expect(logged.some((l) => l.includes("couldn't read the dhl connection"))).toBe(true);
    expect(logged.filter((l) => l.includes(SECRET) || l.includes(SECRET.slice(0, 20)))).toEqual([]);
  });
});
