import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/env";

/**
 * A service-role client: bypasses RLS. Only for places with no signed-in
 * user that are scoped some other way — the supplier confirmation page
 * (scoped by a link's hash) and, later, cron jobs (scoped by CRON_SECRET).
 * Never pass it to anything a signed-in staff member drives.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = supabasePublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !key) return null;
  return createClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
