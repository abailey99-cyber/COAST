/**
 * Supplier replies arriving by email (readiness plan Task 3). Pure.
 *
 * Two ways in:
 * - "forward" (default): the organisation forwards its purchasing mailbox to
 *   its own COAST address. Forwarding breaks the original sender's
 *   authentication, so forwarded mail is ALWAYS checked by a person.
 * - "m365" (opt-in): COAST reads the mailbox itself through Microsoft 365, so
 *   it sees the sender's real SPF, DKIM and DMARC results. Only then may a
 *   confirmed date apply itself, and only when every rule below passes.
 */

// ── Addresses ───────────────────────────────────────────────────────────────
/** An organisation's inbound address local part: random and unguessable (made by the database). */
export const INBOUND_LOCAL_PART = /^r-[0-9a-f]{30}$/;

export function inboundLocalPart(recipient: string, domain: string): string | null {
  const m = recipient.trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m || m[2] !== domain.trim().toLowerCase()) return null;
  return INBOUND_LOCAL_PART.test(m[1]!) ? m[1]! : null;
}

export function emailDomain(address: string | null | undefined): string | null {
  const m = (address ?? "").trim().toLowerCase().match(/<?([^<>@\s]+)@([a-z0-9.-]+\.[a-z]{2,})>?\s*$/);
  return m ? m[2]! : null;
}

/** The bare address from "Jo Bloggs <jo@example.com>". */
export function bareAddress(value: string | null | undefined): string | null {
  const m = (value ?? "").match(/<([^<>\s]+@[^<>\s]+)>/) ?? (value ?? "").match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1]!.toLowerCase() : null;
}

/** A domain someone types into the allowed-forwarders list. */
export function normaliseDomain(input: string): string | null | "invalid" {
  const v = input.trim().toLowerCase().replace(/^@/, "");
  if (!v) return null;
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) ? v : "invalid";
}

const inDomains = (domain: string | null, allowed: readonly string[]) => Boolean(domain) && allowed.some((d) => domain === d || domain!.endsWith(`.${d}`));

/**
 * Microsoft 365 and Google rewrite a forwarded message's envelope sender
 * with SRS: `SRS0=hash=tt=supplier.com=jo@yourco.com`. The rewriting
 * domain (after the last @) is the forwarder's.
 */
export function srsForwarderDomain(envelopeSender: string | null): string | null {
  return emailDomain(envelopeSender);
}

export interface ForwardCheck {
  ok: boolean;
  reason: string;
}

/**
 * Did this mail really come through the organisation's own forwarding
 * (readiness Task 3: reject or quarantine anything else)? The envelope
 * sender — rewritten by the forwarding mailbox — or a forwarding header
 * must be at one of the organisation's own domains.
 * UNVERIFIED: checked against how Microsoft 365 and Google Workspace forward (SRS, X-Forwarded-For); confirm with a real forwarded message in staging.
 */
export function checkForwarder(i: { envelopeSender: string | null; headers: readonly (readonly [string, string])[]; allowedDomains: readonly string[] }): ForwardCheck {
  if (i.allowedDomains.length === 0) return { ok: false, reason: "No forwarding domain is set up for this address yet (Settings → Supplier replies)." };
  if (inDomains(srsForwarderDomain(i.envelopeSender), i.allowedDomains)) return { ok: true, reason: "Forwarded by your mailbox." };
  for (const [name, value] of i.headers) {
    const n = name.toLowerCase();
    if (n === "x-forwarded-for" || n === "x-forwarded-to" || n === "resent-from" || n === "x-ms-exchange-organization-originalenvelopesender") {
      for (const part of value.split(/[\s,]+/)) if (inDomains(emailDomain(part), i.allowedDomains)) return { ok: true, reason: "Forwarded by your mailbox." };
    }
  }
  return { ok: false, reason: `Not forwarded from ${i.allowedDomains.join(" or ")}, so it's held back.` };
}

// ── Sender authentication ───────────────────────────────────────────────────
export type AuthResult = "pass" | "fail" | "none" | "unknown";
export interface AuthResults {
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
}

const toResult = (v: string | undefined): AuthResult => {
  if (!v) return "unknown";
  const s = v.toLowerCase();
  if (s === "pass") return "pass";
  if (s === "none") return "none";
  return "fail"; // fail, softfail, neutral, temperror, permerror, policy: anything but a pass is not a pass
};

/**
 * SPF, DKIM and DMARC from the receiving server's Authentication-Results
 * header (RFC 8601) — the topmost one, added by the mailbox's own provider.
 * Anything missing is "unknown", never assumed to pass.
 */
export function parseAuthResults(headers: readonly (readonly [string, string])[]): AuthResults {
  const header = headers.find(([n]) => n.toLowerCase() === "authentication-results")?.[1] ?? "";
  const get = (method: string) => header.match(new RegExp(`(?:^|[;\\s])${method}=([a-z]+)`, "i"))?.[1];
  return { spf: toResult(get("spf")), dkim: toResult(get("dkim")), dmarc: toResult(get("dmarc")) };
}

// ── Auto-apply (Microsoft 365 only) ─────────────────────────────────────────
/** Answers from a supplier, read and applied without changes, before their emails count as a proven template. */
export const PROVEN_AFTER = 3;

export interface AutoApplyInput {
  mode: "forward" | "m365";
  auth: AuthResults;
  /** The From address is a known contact for the PO's supplier. */
  senderKnown: boolean;
  /** Earlier answers from this supplier read cleanly and stood (PROVEN_AFTER or more). */
  provenAnswers: number;
  /** The reply mentions a price or a quantity. */
  mentionsPriceOrQuantity: boolean;
}

/**
 * The extra reasons a reply must go to a person. Empty means it may apply
 * itself — and then only a confirmed date, and only if the usual reading
 * rules are also certain. Pure, so every rule is unit-tested.
 */
export function autoApplyBlockers(i: AutoApplyInput): string[] {
  if (i.mode === "forward") return ["Forwarded email: always checked by a person."];
  const reasons: string[] = [];
  const failing = (["spf", "dkim", "dmarc"] as const).filter((k) => i.auth[k] !== "pass");
  if (failing.length) reasons.push(`The sender's ${failing.map((k) => k.toUpperCase()).join(", ")} ${failing.length === 1 ? "check didn't" : "checks didn't"} pass.`);
  if (!i.senderKnown) reasons.push("It isn't from an address COAST knows for this supplier.");
  if (i.provenAnswers < PROVEN_AFTER) reasons.push(`COAST hasn't yet seen ${PROVEN_AFTER} clean answers from this supplier.`);
  if (i.mentionsPriceOrQuantity) reasons.push("It mentions a price or quantity, which a person always checks.");
  return reasons;
}

export function isKnownSender(from: string | null, supplier: { email: string | null; knownSenders: readonly string[] }): boolean {
  const a = bareAddress(from);
  if (!a) return false;
  return [supplier.email, ...supplier.knownSenders].some((k) => k && k.trim().toLowerCase() === a);
}

// ── Mailgun webhooks ────────────────────────────────────────────────────────
/** How old a signed webhook may be (Mailgun signs timestamp + token). */
export const WEBHOOK_MAX_AGE_SECONDS = 15 * 60;

export function webhookFresh(timestamp: string, now: Date): boolean {
  const t = Number(timestamp);
  return Number.isFinite(t) && Math.abs(now.getTime() / 1000 - t) <= WEBHOOK_MAX_AGE_SECONDS;
}

/** Microsoft 365 PowerShell to scope COAST's app to one mailbox (Exchange Online RBAC for Applications). */
export function exchangeScopingCommands(i: { appId: string; servicePrincipalObjectId: string; mailbox: string }): string {
  const q = (s: string) => s.replace(/'/g, "''");
  return [
    "# Run in Exchange Online PowerShell as an Exchange administrator.",
    "Connect-ExchangeOnline",
    "",
    "# 1. Tell Exchange about COAST's app (once).",
    `New-ServicePrincipal -AppId '${q(i.appId)}' -ObjectId '${q(i.servicePrincipalObjectId)}' -DisplayName 'COAST'`,
    "",
    "# 2. A scope containing only the purchasing mailbox.",
    `New-ManagementScope -Name 'COAST purchasing mailbox' -RecipientRestrictionFilter "PrimarySmtpAddress -eq '${q(i.mailbox)}'"`,
    "",
    "# 3. Let COAST read and send mail for that mailbox only.",
    `New-ManagementRoleAssignment -App '${q(i.appId)}' -Role 'Application Mail.Read' -CustomResourceScope 'COAST purchasing mailbox'`,
    `New-ManagementRoleAssignment -App '${q(i.appId)}' -Role 'Application Mail.Send' -CustomResourceScope 'COAST purchasing mailbox'`,
    "",
    "# 4. Check: should say InScope True for the mailbox, False for anyone else.",
    `Test-ServicePrincipalAuthorization -Identity '${q(i.appId)}' -Resource '${q(i.mailbox)}'`,
  ].join("\n");
}
