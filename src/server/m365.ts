import "server-only";
import { orgsConnectedTo, recordSecurityEvent } from "@/lib/data/credentials";
import { getSyncState, saveSyncState } from "@/lib/data/inbound";
import { appUrl } from "@/lib/env";
import { forgetTenantToken, messageHeaders, newInboxMessages, platformApp, tenantToken } from "@/lib/inbound/m365";
import { keyringFromEnv } from "@/lib/secrets/crypto";
import { verifyState } from "@/lib/secrets/state";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getIntegrationCredentials } from "./credentials";
import { handleInboundEmail } from "./inbound";
import { getStaffSession } from "./session";

/**
 * Microsoft 365 mode (readiness plan Task 3): finishing the admin's consent,
 * and reading each connected mailbox on a schedule. Every organisation is
 * read with its own tenant's token, and its mail is handled as its own.
 */

export const CONSENT_PATH = "/api/integrations/m365/consent";
export const consentRedirectUri = () => `${appUrl()}${CONSENT_PATH}`;

/** GET /api/integrations/m365/consent — Microsoft sends the admin back here. */
export async function completeMicrosoftConsent(request: Request, now: Date = new Date()): Promise<Response> {
  const url = new URL(request.url);
  const back = (outcome: string) => Response.redirect(`${appUrl()}/app/settings?m365=${outcome}#integrations`, 303);
  const ring = keyringFromEnv();
  const state = ring ? verifyState(url.searchParams.get("state") ?? "", ring, now) : null;
  if (!state?.orgId || !state.userId) return back("expired");

  // The same admin who started it, still signed in to the same organisation.
  const session = await getStaffSession();
  if (session.state !== "staff" || session.staff.id !== state.userId || session.staff.orgId !== state.orgId || session.staff.role !== "admin") return back("not-allowed");
  if (url.searchParams.get("admin_consent")?.toLowerCase() !== "true") return back("declined");

  const creds = await getIntegrationCredentials(state.orgId, "microsoft365");
  const tenant = url.searchParams.get("tenant") ?? "";
  if (!creds || creds.config.tenantId?.toLowerCase() !== tenant.toLowerCase()) return back("wrong-tenant");

  const admin = createSupabaseAdminClient();
  if (!admin) return back("unavailable");
  await admin
    .from("integration_credentials")
    .update({ config: { ...creds.config, consentedAt: now.toISOString() }, status: "active", last_error: null })
    .eq("org_id", state.orgId)
    .eq("provider", "microsoft365");
  await recordSecurityEvent(admin, { orgId: state.orgId, kind: "m365_consent_granted", actorId: state.userId, detail: { tenant } });
  return back("connected");
}

/** /api/cron/inbound-mailbox: read every connected mailbox once. */
export async function scheduledMailboxRead(now: Date = new Date()): Promise<{ outcome: "ok" | "partial" | "error"; mailboxes?: number; emails?: number }> {
  const admin = createSupabaseAdminClient();
  if (!admin || !platformApp()) return { outcome: "ok", mailboxes: 0, emails: 0 };
  let mailboxes = 0;
  let emails = 0;
  let failed = 0;
  for (const orgId of await orgsConnectedTo(admin, "microsoft365")) {
    const creds = await getIntegrationCredentials(orgId, "microsoft365");
    const { tenantId, mailbox, consentedAt } = creds?.config ?? {};
    if (!tenantId || !mailbox || !consentedAt) continue;
    mailboxes++;
    const state = await getSyncState(admin, orgId);
    const token = await tenantToken(tenantId);
    if (!token) {
      failed++;
      await saveSyncState(admin, orgId, { deltaLink: state.deltaLink, error: "Microsoft 365 turned down COAST's sign-in. Check consent in Settings → Integrations." });
      continue;
    }
    const page = await newInboxMessages(token, mailbox, state.deltaLink);
    if (!page.ok) {
      failed++;
      forgetTenantToken(tenantId);
      await saveSyncState(admin, orgId, { deltaLink: state.deltaLink, error: page.error });
      continue;
    }
    for (const m of page.messages) {
      // Only mail that arrived after consent: never sweep up an old inbox.
      if (m.receivedAt && m.receivedAt < consentedAt) continue;
      try {
        await handleInboundEmail(
          admin,
          { orgId, channel: "m365", messageId: m.internetMessageId, from: m.from, envelopeSender: null, subject: m.subject, text: m.text, headers: await messageHeaders(token, mailbox, m.id) },
          now,
        );
        emails++;
      } catch (e) {
        failed++;
        console.warn("[m365] couldn't handle an email", e instanceof Error ? e.message : e);
      }
    }
    await saveSyncState(admin, orgId, { deltaLink: page.nextDelta, error: null });
  }
  return { outcome: failed === 0 ? "ok" : mailboxes > 0 && failed < mailboxes ? "partial" : "error", mailboxes, emails };
}
