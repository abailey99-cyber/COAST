/**
 * Reads configuration from environment variables. Nothing here throws on a
 * missing value: unset integrations report "unconfigured" (CLAUDE.md
 * non-negotiable 5) and the app keeps running.
 */

import { configHealth, type Health } from "@/lib/logic/health";

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

export function supabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export interface IntegrationHealth extends Health {
  key: string;
  label: string;
}

/**
 * Health of what COAST itself owns, set in the hosting settings. Each
 * organisation's own connections (carriers, NetSuite, its Microsoft 365
 * tenant) are in Settings → Integrations instead (readiness Task 2). Never exposes values.
 */
export function integrationHealth(): IntegrationHealth[] {
  const env = process.env;
  const items: Array<[string, string, string[]]> = [
    ["database", "Database and sign-in (Supabase)", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]],
    ["cron", "Scheduled jobs", ["CRON_SECRET"]],
    ["credentials", "Credential encryption key", ["COAST_CREDENTIAL_KEYS"]],
    ["m365", "COAST's Microsoft 365 app", ["M365_CLIENT_ID", "M365_CLIENT_SECRET"]],
    ["inbound", "Supplier replies by email (Mailgun)", ["INBOUND_EMAIL_DOMAIN", "MAILGUN_WEBHOOK_SIGNING_KEY"]],
  ];
  return items.map(([key, label, required]) => ({ key, label, ...configHealth(label, required, env) }));
}
