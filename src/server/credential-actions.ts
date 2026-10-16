"use server";

import { revalidatePath } from "next/cache";
import { deleteConnection, insertConnection, listConnections, updateConnection } from "@/lib/data/credentials";
import { PROVIDERS, isProvider, validateCredentialInput } from "@/lib/logic/integrations";
import { encryptSecret, keyringFromEnv } from "@/lib/secrets/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, requireAdmin } from "./session";

/**
 * Settings → Integrations (readiness Task 2). Admin only (the database checks
 * again). Secrets are encrypted here, written with the admin's own client,
 * and never sent back: results carry only messages and which fields are wrong.
 */

export interface IntegrationResult {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("The database isn't connected.");
  return supabase;
}

function failure(e: unknown, fallback: string): IntegrationResult {
  if (e instanceof NotAllowedError) return { ok: false, error: e.message };
  if (e instanceof Error && e.message === "not-allowed") return { ok: false, error: "Only an admin can change integrations." };
  // Never include the error's details: they could echo what was submitted.
  console.warn("[integrations] couldn't save a connection");
  return { ok: false, error: fallback };
}

/** Connect, or change an existing connection (a blank secret keeps the stored one). */
export async function saveIntegration(provider: string, _prev: IntegrationResult | null, formData: FormData): Promise<IntegrationResult> {
  try {
    const staff = await requireAdmin();
    if (!isProvider(provider)) return { ok: false, error: "Unknown integration." };
    const def = PROVIDERS[provider];
    const supabase = await client();
    const existing = (await listConnections(supabase)).find((c) => c.provider === provider);
    const input = Object.fromEntries([...def.config, ...def.secret].map((f) => [f.key, String(formData.get(f.key) ?? "")]));
    const v = validateCredentialInput(def, input, { rotating: Boolean(existing), consent: formData.get("consent") === "on" });
    if (!v.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: v.errors };

    let sealed: { ciphertext: string; keyVersion: number } | null = null;
    if (v.secret) {
      const ring = keyringFromEnv();
      if (!ring) return { ok: false, error: "COAST can't store secrets yet: COAST_CREDENTIAL_KEYS isn't set in the hosting settings (docs/environments.md)." };
      sealed = encryptSecret(JSON.stringify(v.secret), { orgId: staff.orgId, provider, kind: def.kind }, ring);
    }

    if (existing) {
      await updateConnection(supabase, provider, { config: v.config, secret: sealed ? { ...sealed, hint: v.hint } : undefined });
    } else {
      if (def.secret.length > 0 && !sealed) return { ok: false, error: "Enter the credentials to connect." };
      await insertConnection(supabase, { orgId: staff.orgId, provider, kind: def.kind, config: v.config, ciphertext: sealed?.ciphertext ?? null, keyVersion: sealed?.keyVersion ?? null, hint: v.hint });
    }
    revalidatePath("/app/settings");
    return { ok: true, message: existing ? (sealed ? `${def.label}: new credentials saved.` : `${def.label}: settings saved.`) : `${def.label} connected.` };
  } catch (e) {
    return failure(e, "That couldn't be saved. Try again.");
  }
}

export async function disconnectIntegration(provider: string): Promise<IntegrationResult> {
  try {
    await requireAdmin();
    if (!isProvider(provider)) return { ok: false, error: "Unknown integration." };
    if (!(await deleteConnection(await client(), provider))) return { ok: false, error: "That isn't connected." };
    revalidatePath("/app/settings");
    return { ok: true, message: `${PROVIDERS[provider].label} disconnected. Its credentials have been deleted from COAST.` };
  } catch (e) {
    return failure(e, "That couldn't be disconnected. Try again.");
  }
}
