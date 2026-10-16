import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProvider, type CredentialKind, type CredentialProvider } from "@/lib/logic/integrations";

/**
 * Integration credentials and security events (readiness Task 2). Reads and
 * writes only. Admin screens pass the signed-in client (RLS: only that
 * organisation's admins can write; nobody signed in can read `ciphertext`).
 * Reading the ciphertext takes the service role AND an explicit
 * organisation id — it's only for src/server/credentials.ts.
 */

export interface ConnectionRow {
  id: string;
  provider: CredentialProvider;
  kind: CredentialKind;
  config: Record<string, string>;
  hasSecret: boolean;
  hint: string | null;
  status: "active" | "error";
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
}

const META = "id, provider, kind, config, key_version, hint, status, last_error, created_by, created_at, rotated_at, last_used_at";

interface RawMeta {
  id: string;
  provider: string;
  kind: CredentialKind;
  config: Record<string, string> | null;
  key_version: number | null;
  hint: string | null;
  status: "active" | "error";
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  rotated_at: string | null;
  last_used_at: string | null;
}

const toRow = (r: RawMeta): ConnectionRow | null =>
  isProvider(r.provider)
    ? {
        id: r.id,
        provider: r.provider,
        kind: r.kind,
        config: r.config ?? {},
        hasSecret: r.key_version !== null,
        hint: r.hint,
        status: r.status,
        lastError: r.last_error,
        createdBy: r.created_by,
        createdAt: r.created_at,
        rotatedAt: r.rotated_at,
        lastUsedAt: r.last_used_at,
      }
    : null;

/** The signed-in organisation's connections (never the secret). */
export async function listConnections(client: SupabaseClient): Promise<ConnectionRow[]> {
  const { data, error } = await client.from("integration_credentials").select(META).returns<RawMeta[]>();
  if (error) throw new Error(`Couldn't load integrations: ${error.message}`);
  return (data ?? []).flatMap((r) => toRow(r) ?? []);
}

export async function insertConnection(
  client: SupabaseClient,
  c: { orgId: string; provider: CredentialProvider; kind: CredentialKind; config: Record<string, string>; ciphertext: string | null; keyVersion: number | null; hint: string | null },
): Promise<void> {
  const { error } = await client
    .from("integration_credentials")
    .insert({ org_id: c.orgId, provider: c.provider, kind: c.kind, config: c.config, ciphertext: c.ciphertext, key_version: c.keyVersion, hint: c.hint })
    .select("id")
    .single();
  if (error) throw new Error(error.code === "42501" ? "not-allowed" : `Couldn't save the connection: ${error.message}`);
}

export async function updateConnection(
  client: SupabaseClient,
  provider: CredentialProvider,
  c: { config: Record<string, string>; secret?: { ciphertext: string; keyVersion: number; hint: string | null } },
): Promise<boolean> {
  const row: Record<string, unknown> = { config: c.config, status: "active", last_error: null };
  if (c.secret) Object.assign(row, { ciphertext: c.secret.ciphertext, key_version: c.secret.keyVersion, hint: c.secret.hint, rotated_at: new Date().toISOString() });
  const { data, error } = await client.from("integration_credentials").update(row).eq("provider", provider).select("id");
  if (error) throw new Error(`Couldn't update the connection: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function deleteConnection(client: SupabaseClient, provider: CredentialProvider): Promise<boolean> {
  const { data, error } = await client.from("integration_credentials").delete().eq("provider", provider).select("id");
  if (error) throw new Error(`Couldn't disconnect: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// ── Service role, one organisation at a time ────────────────────────────────
export interface StoredCredential {
  id: string;
  kind: CredentialKind;
  config: Record<string, string>;
  ciphertext: string | null;
  keyVersion: number | null;
}

export async function readStoredCredential(admin: SupabaseClient, orgId: string, provider: CredentialProvider): Promise<StoredCredential | null> {
  const { data, error } = await admin
    .from("integration_credentials")
    .select("id, kind, config, ciphertext, key_version")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle<{ id: string; kind: CredentialKind; config: Record<string, string> | null; ciphertext: string | null; key_version: number | null }>();
  if (error) throw new Error(`Couldn't read the connection: ${error.message}`);
  return data ? { id: data.id, kind: data.kind, config: data.config ?? {}, ciphertext: data.ciphertext, keyVersion: data.key_version } : null;
}

export async function markCredentialUsed(admin: SupabaseClient, orgId: string, id: string, problem: string | null): Promise<void> {
  await admin
    .from("integration_credentials")
    .update(problem ? { status: "error", last_error: problem.slice(0, 300) } : { last_used_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id);
}

/** Organisations with a connection to this provider (for scheduled jobs). */
export async function orgsConnectedTo(admin: SupabaseClient, provider: CredentialProvider): Promise<string[]> {
  const { data } = await admin.from("integration_credentials").select("org_id").eq("provider", provider).limit(10000).returns<{ org_id: string }[]>();
  return [...new Set((data ?? []).map((r) => r.org_id))];
}

/** For key rotation: every stored secret. Service role. */
export async function listAllCiphertexts(admin: SupabaseClient): Promise<{ id: string; orgId: string; provider: CredentialProvider; kind: CredentialKind; ciphertext: string }[]> {
  const { data, error } = await admin.from("integration_credentials").select("id, org_id, provider, kind, ciphertext").not("ciphertext", "is", null).limit(100000).returns<{ id: string; org_id: string; provider: string; kind: CredentialKind; ciphertext: string }[]>();
  if (error) throw new Error(`Couldn't list credentials: ${error.message}`);
  return (data ?? []).flatMap((r) => (isProvider(r.provider) ? [{ id: r.id, orgId: r.org_id, provider: r.provider, kind: r.kind, ciphertext: r.ciphertext }] : []));
}

export async function saveReencrypted(admin: SupabaseClient, orgId: string, id: string, ciphertext: string, keyVersion: number): Promise<void> {
  const { error } = await admin.from("integration_credentials").update({ ciphertext, key_version: keyVersion }).eq("org_id", orgId).eq("id", id);
  if (error) throw new Error(`Couldn't save the re-encrypted credential: ${error.message}`);
}

// ── Security events ─────────────────────────────────────────────────────────
export async function recordSecurityEvent(admin: SupabaseClient, e: { orgId: string | null; kind: string; actorId: string | null; detail: Record<string, unknown> }): Promise<void> {
  const { error } = await admin.from("security_events").insert({ org_id: e.orgId, kind: e.kind, actor_id: e.actorId, detail: e.detail });
  if (error) console.warn("[security] couldn't record an event", e.kind, error.message);
}

export async function listSecurityEvents(client: SupabaseClient, limit = 50): Promise<{ id: number; kind: string; actorId: string | null; detail: Record<string, unknown>; createdAt: string }[]> {
  const { data, error } = await client.from("security_events").select("id, kind, actor_id, detail, created_at").order("created_at", { ascending: false }).limit(limit).returns<{ id: number; kind: string; actor_id: string | null; detail: Record<string, unknown> | null; created_at: string }[]>();
  if (error) throw new Error(`Couldn't load security events: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, kind: r.kind, actorId: r.actor_id, detail: r.detail ?? {}, createdAt: r.created_at }));
}

/** The signed-in organisation's connected providers (names only; any staff member). */
export async function connectedProviders(client: SupabaseClient): Promise<Set<CredentialProvider>> {
  const { data } = await client.rpc("connected_providers");
  return new Set(((data as string[] | null) ?? []).filter(isProvider));
}
