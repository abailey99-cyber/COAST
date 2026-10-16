import "server-only";
import { markCredentialUsed, readStoredCredential, recordSecurityEvent } from "@/lib/data/credentials";
import { PROVIDERS, type CredentialKind, type CredentialProvider } from "@/lib/logic/integrations";
import { DecryptError, decryptSecret, keyringFromEnv } from "@/lib/secrets/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * THE ONE place integration secrets are decrypted (readiness Task 2).
 *
 * `getIntegrationCredentials(orgId, provider)` returns that organisation's
 * own connection — never another's: the row is read by organisation id, and
 * the secret is encrypted bound to that organisation, provider and kind, so
 * a row tampered to point elsewhere won't decrypt. Decrypted values are
 * returned to the caller for the one call that needs them: never stored,
 * never logged, never sent to the browser (this module is server-only and
 * no action returns its result).
 */

export interface IntegrationCredentials {
  kind: CredentialKind;
  config: Readonly<Record<string, string>>;
  /** Null for a provider that keeps no secret (Microsoft 365 tenant settings). */
  secret: Readonly<Record<string, string>> | null;
}

export async function getIntegrationCredentials(orgId: string, provider: CredentialProvider): Promise<IntegrationCredentials | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const stored = await readStoredCredential(admin, orgId, provider);
  if (!stored || stored.kind !== PROVIDERS[provider].kind) return null;
  if (!stored.ciphertext) {
    void markCredentialUsed(admin, orgId, stored.id, null);
    return { kind: stored.kind, config: stored.config, secret: null };
  }
  const ring = keyringFromEnv();
  if (!ring) {
    await failed(orgId, stored.id, provider, "COAST_CREDENTIAL_KEYS isn't set, so stored credentials can't be read.");
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decryptSecret(stored.ciphertext, { orgId, provider, kind: stored.kind }, ring));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new DecryptError("The stored credential isn't in the expected shape.");
    const secret = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
    void markCredentialUsed(admin, orgId, stored.id, null);
    return { kind: stored.kind, config: stored.config, secret };
  } catch (e) {
    await failed(orgId, stored.id, provider, e instanceof DecryptError ? e.message : "The stored credential couldn't be read.");
    return null;
  }
}

/** A failed decryption is a security event, and the connection shows as needing attention. The message never holds a secret. */
async function failed(orgId: string, id: string, provider: CredentialProvider, reason: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await markCredentialUsed(admin, orgId, id, `${reason} Reconnect it in Settings → Integrations.`);
  await recordSecurityEvent(admin, { orgId, kind: "credential_decrypt_failed", actorId: null, detail: { provider, reason } });
  console.warn(`[credentials] couldn't read the ${provider} connection for an organisation: ${reason}`);
}
