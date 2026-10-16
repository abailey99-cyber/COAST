import "server-only";
import { fetchCarrierJson, fetchOAuthToken, tokenCache } from "@/lib/carriers/http";

/**
 * Microsoft 365 mailbox reading (readiness plan Task 3, mode 2). COAST has
 * ONE multi-tenant Entra app (M365_CLIENT_ID / M365_CLIENT_SECRET in the
 * hosting settings). Each organisation's admin grants it consent for their
 * own tenant, and scopes it to one mailbox with Exchange RBAC for
 * Applications. Tokens are per tenant (client credentials) and cached per
 * tenant only — never shared across organisations.
 * UNVERIFIED: built from Microsoft's identity-platform and Graph docs; not yet
 * run against a test tenant (readiness Task 3 "done when" needs staging).
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const tokens = tokenCache();

export function platformApp(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.M365_CLIENT_ID?.trim();
  const clientSecret = process.env.M365_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The admin-consent link for one customer tenant. */
export function adminConsentUrl(i: { tenantId: string; clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: i.clientId, redirect_uri: i.redirectUri, state: i.state });
  return `https://login.microsoftonline.com/${encodeURIComponent(i.tenantId)}/v2.0/adminconsent?${q.toString()}&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}`;
}

/** An app-only token for this tenant (client credentials). Cached for this tenant only. */
export async function tenantToken(tenantId: string): Promise<string | null> {
  const app = platformApp();
  if (!app) return null;
  return tokens.get(`tenant:${tenantId}`, () =>
    fetchOAuthToken(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: app.clientId, client_secret: app.clientSecret, scope: "https://graph.microsoft.com/.default" }),
    }),
  );
}

export function forgetTenantToken(tenantId: string): void {
  tokens.clear(`tenant:${tenantId}`);
}

export interface GraphMessage {
  id: string;
  internetMessageId: string;
  subject: string;
  from: string | null;
  text: string;
  receivedAt: string | null;
}

/**
 * New messages in the mailbox's inbox since the last run, via a delta query.
 * Returns the link to resume from next time.
 */
export async function newInboxMessages(token: string, mailbox: string, deltaLink: string | null, max = 50): Promise<{ ok: true; messages: GraphMessage[]; nextDelta: string | null } | { ok: false; error: string }> {
  let url: string | null =
    deltaLink ?? `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages/delta?$select=subject,from,body,internetMessageId,receivedDateTime`;
  const messages: GraphMessage[] = [];
  let nextDelta: string | null = null;
  for (let page = 0; url && page < 10 && messages.length < max; page++) {
    const r = await fetchCarrierJson(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!r.ok) return { ok: false, error: r.outcome.ok === false ? r.outcome.message : "Microsoft 365 didn't answer properly." };
    const body = r.body as { value?: unknown[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    for (const m of (body.value ?? []) as { id?: string; internetMessageId?: string; subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; body?: { content?: string }; receivedDateTime?: string; "@removed"?: unknown }[]) {
      if (!m.id || m["@removed"]) continue;
      messages.push({
        id: m.id,
        internetMessageId: m.internetMessageId ?? `graph:${m.id}`,
        subject: (m.subject ?? "").slice(0, 1000),
        from: m.from?.emailAddress?.address ? `${m.from.emailAddress.name ?? ""} <${m.from.emailAddress.address}>`.trim() : null,
        text: (m.body?.content ?? "").slice(0, 50000),
        receivedAt: m.receivedDateTime ?? null,
      });
    }
    url = body["@odata.nextLink"] ?? null;
    nextDelta = body["@odata.deltaLink"] ?? nextDelta;
  }
  return { ok: true, messages, nextDelta: url ?? nextDelta };
}

/** One message's headers (for its SPF, DKIM and DMARC results). */
export async function messageHeaders(token: string, mailbox: string, id: string): Promise<[string, string][]> {
  const r = await fetchCarrierJson(`${GRAPH}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?$select=internetMessageHeaders`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const list = (r.body as { internetMessageHeaders?: { name?: string; value?: string }[] }).internetMessageHeaders ?? [];
  return list.filter((h) => typeof h.name === "string" && typeof h.value === "string").map((h) => [h.name!, h.value!] as [string, string]).slice(0, 200);
}
