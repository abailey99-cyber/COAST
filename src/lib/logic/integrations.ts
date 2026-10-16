/**
 * Integration credentials per organisation (readiness plan Task 2). Pure:
 * what each provider needs, and checking what an admin types in. Keep the
 * provider and kind lists in step with
 * supabase/migrations/0027_integration_credentials.sql.
 *
 * Secret fields are encrypted together as one value; config fields are
 * ordinary settings (an account or tenant id), shown back to admins.
 */

export const CREDENTIAL_PROVIDERS = ["dhl", "fedex", "ups", "royal_mail", "netsuite", "microsoft365"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];
export type CredentialKind = "api_key" | "oauth_client" | "netsuite_m2m" | "microsoft365_tenant";

export interface CredentialField {
  key: string;
  label: string;
  hint?: string;
  /** Multi-line (a private key). */
  multiline?: boolean;
  options?: readonly string[];
  /** Checked shape; the message says what's wrong. */
  pattern?: RegExp;
  patternMessage?: string;
}

export interface ProviderDef {
  key: CredentialProvider;
  label: string;
  group: "Carriers" | "Systems";
  kind: CredentialKind;
  config: readonly CredentialField[];
  secret: readonly CredentialField[];
  /** Shown before connecting; when `consentNeeded`, the admin must tick to confirm it. */
  caution?: string;
  consentNeeded?: boolean;
  /** Not used by anything in COAST yet: saved ready for when it is. */
  notLiveYet?: string;
  /** Marked in code with the reason (CLAUDE.md non-negotiable 9). */
  unverified?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROVIDERS: Record<CredentialProvider, ProviderDef> = {
  dhl: {
    key: "dhl",
    label: "DHL Express",
    group: "Carriers",
    kind: "api_key",
    config: [],
    secret: [{ key: "apiKey", label: "API key", hint: "From your app on developer.dhl.com (Shipment Tracking – Unified)." }],
  },
  fedex: {
    key: "fedex",
    label: "FedEx (and TNT)",
    group: "Carriers",
    kind: "oauth_client",
    config: [],
    secret: [
      { key: "clientId", label: "API key (client ID)", hint: "From your project on developer.fedex.com." },
      { key: "clientSecret", label: "Secret key" },
    ],
  },
  ups: {
    key: "ups",
    label: "UPS",
    group: "Carriers",
    kind: "oauth_client",
    config: [],
    secret: [
      { key: "clientId", label: "Client ID", hint: "From your app on developer.ups.com." },
      { key: "clientSecret", label: "Client secret" },
    ],
    caution: "UPS's UK API terms restrict use by intermediaries and for more than one shipper without UPS's written consent. Only connect UPS if UPS has agreed to this in writing.",
    consentNeeded: true,
  },
  royal_mail: {
    key: "royal_mail",
    label: "Royal Mail and Parcelforce",
    group: "Carriers",
    kind: "oauth_client",
    config: [],
    secret: [
      { key: "clientId", label: "Client ID", hint: "From the Royal Mail developer portal (Tracking API)." },
      { key: "clientSecret", label: "Client secret" },
    ],
    unverified: "Built without a live Royal Mail account; expect a correction pass.",
  },
  netsuite: {
    key: "netsuite",
    label: "NetSuite",
    group: "Systems",
    kind: "netsuite_m2m",
    config: [
      { key: "accountId", label: "Account ID", hint: "e.g. 1234567 or 1234567_SB1 for a sandbox.", pattern: /^[0-9A-Za-z_-]{3,30}$/, patternMessage: "An account ID is letters, numbers, - and _ (e.g. 1234567_SB1)." },
      { key: "clientId", label: "Integration client ID", hint: "From the integration record (OAuth 2.0, client credentials)." },
      { key: "certificateId", label: "Certificate ID", hint: "From Setup → Integration → OAuth 2.0 Client Credentials (M2M) Setup." },
      { key: "algorithm", label: "Signing method", options: ["PS256", "ES256", "RS256"], hint: "The one your certificate was made for." },
    ],
    secret: [{ key: "privateKey", label: "Private key (PEM)", multiline: true, pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/, patternMessage: "Paste the whole private key, including the BEGIN and END lines." }],
    notLiveYet: "The NetSuite order sync is in development (Phase 8). Details saved now are used when it's switched on.",
    unverified: "NetSuite's machine-to-machine sign-in uses a certificate and a signed token (checked against vendor guides, not yet against a live account); the signing method and token audience need confirming.",
  },
  microsoft365: {
    key: "microsoft365",
    label: "Microsoft 365 mailbox",
    group: "Systems",
    kind: "microsoft365_tenant",
    config: [
      { key: "tenantId", label: "Tenant ID", hint: "Your Microsoft Entra tenant (directory) ID.", pattern: UUID, patternMessage: "A tenant ID looks like 00000000-0000-0000-0000-000000000000." },
      { key: "mailbox", label: "Purchasing mailbox", hint: "The shared mailbox supplier replies arrive in.", pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: "Enter the mailbox's email address." },
    ],
    // No secret: COAST's own multi-tenant Microsoft app signs in, once your admin has given consent (Task 3).
    secret: [],
    notLiveYet: "Reading the mailbox automatically is in development. Your admin will also need to give consent in Microsoft 365; COAST will show the link when it's ready.",
  },
};

export function isProvider(v: unknown): v is CredentialProvider {
  return typeof v === "string" && (CREDENTIAL_PROVIDERS as readonly string[]).includes(v);
}

export type CredentialInput =
  | { ok: true; config: Record<string, string>; secret: Record<string, string> | null; hint: string | null }
  | { ok: false; errors: Record<string, string> };

/**
 * Check a connect or rotate form. On rotation (`existing`), a blank secret
 * field keeps the stored one — the form never shows secrets back.
 */
export function validateCredentialInput(p: ProviderDef, input: Readonly<Record<string, string>>, options: { rotating?: boolean; consent?: boolean } = {}): CredentialInput {
  const errors: Record<string, string> = {};
  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  const check = (f: CredentialField, value: string, required: boolean) => {
    if (!value) {
      if (required) errors[f.key] = `Enter the ${f.label.toLowerCase()}.`;
      return;
    }
    if (value.length > 8000) errors[f.key] = "That's too long.";
    else if (f.options && !f.options.includes(value)) errors[f.key] = `Choose one of ${f.options.join(", ")}.`;
    else if (f.pattern && !f.pattern.test(value)) errors[f.key] = f.patternMessage ?? "That doesn't look right.";
  };
  for (const f of p.config) {
    const v = (input[f.key] ?? "").trim();
    check(f, v, true);
    config[f.key] = v;
  }
  let anySecret = false;
  for (const f of p.secret) {
    const v = f.multiline ? (input[f.key] ?? "").trim().replace(/\r\n/g, "\n") : (input[f.key] ?? "").trim();
    check(f, v, !options.rotating);
    if (v) {
      anySecret = true;
      secret[f.key] = v;
    }
  }
  if (options.rotating && anySecret && Object.keys(secret).length !== p.secret.length) {
    for (const f of p.secret) if (!secret[f.key]) errors[f.key] = "Changing the secret? Enter every part of it again.";
  }
  if (p.consentNeeded && !options.rotating && !options.consent) errors.consent = "Tick to confirm UPS has agreed in writing.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, config, secret: anySecret ? secret : null, hint: anySecret ? secretHint(secret, p) : null };
}

/** The last four characters of the first secret field, so an admin can recognise it. Never more. */
export function secretHint(secret: Readonly<Record<string, string>>, p: ProviderDef): string | null {
  const first = p.secret[0];
  if (!first || first.multiline) return null;
  const v = secret[first.key] ?? "";
  return v.length >= 12 ? `…${v.slice(-4)}` : null;
}

/** Strings that must never appear in a log line, from a decrypted secret. */
export function secretValues(secret: Readonly<Record<string, string>>): string[] {
  return Object.values(secret).filter((v) => v.length >= 6);
}
