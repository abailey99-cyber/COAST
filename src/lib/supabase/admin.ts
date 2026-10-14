import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/env";
import { fetchWithTimeout } from "./fetch";

/**
 * A service-role client: bypasses RLS. Only for places with no signed-in
 * user that are scoped some other way — the supplier confirmation page
 * (scoped by a link's hash) and scheduled jobs (scoped by CRON_SECRET) — and
 * for system work a staff action sets off only after that person's own
 * client has proved they may see and change the record (a shipment's
 * "Check now"). Never hand it to the UI.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = supabasePublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key) return null;
  return createClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithTimeout } });
}
