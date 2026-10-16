"use server";

import { adminConsentUrl, platformApp } from "@/lib/inbound/m365";
import { keyringFromEnv } from "@/lib/secrets/crypto";
import { signState } from "@/lib/secrets/state";
import { getIntegrationCredentials } from "./credentials";
import { consentRedirectUri } from "./m365";
import { NotAllowedError, requireAdmin } from "./session";

/** Settings → Integrations → Microsoft 365: send the admin to Microsoft to grant consent for their own tenant. */
export async function startMicrosoftConsent(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const staff = await requireAdmin();
    const app = platformApp();
    if (!app) return { ok: false, error: "COAST's Microsoft 365 app isn't set up yet (M365_CLIENT_ID and M365_CLIENT_SECRET in the hosting settings)." };
    const ring = keyringFromEnv();
    if (!ring) return { ok: false, error: "COAST can't store credentials yet (COAST_CREDENTIAL_KEYS)." };
    const creds = await getIntegrationCredentials(staff.orgId, "microsoft365");
    const tenantId = creds?.config.tenantId;
    if (!tenantId) return { ok: false, error: "Save your tenant ID and mailbox first." };
    const state = signState({ orgId: staff.orgId, userId: staff.id }, ring, new Date());
    return { ok: true, url: adminConsentUrl({ tenantId, clientId: app.clientId, redirectUri: consentRedirectUri(), state }) };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be started. Try again." };
  }
}
