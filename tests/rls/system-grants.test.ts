/**
 * The service role (no-login links, scheduled jobs, customer pages) must be
 * allowed to run every database function COAST calls with it. Newer Supabase
 * projects don't grant this by default, and a missing grant only shows up
 * as "permission denied" on the path that needs it (migrations 0017, 0023).
 */

import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && serviceKey) && process.env.COAST_ENV !== "production";

// Called with the service-role client somewhere in src/. Keep in step when adding one.
const SYSTEM_FUNCTIONS: Record<string, Record<string, unknown>> = {
  apply_supplier_answer: { p: { purchase_order_id: "00000000-0000-0000-0000-000000000000", lines: [], fully_confirmed: false } },
  regenerate_tracking_code: { p_order: "00000000-0000-0000-0000-000000000000" },
  hit_rate_limit: { p_bucket: "system-grants-test", p_limit: 1000, p_window_seconds: 1 },
  reserve_carrier_calls: { p_carrier: "mock", p_limit: null, p_wanted: 0 },
  record_carrier_outcome: { p_carrier: "mock", p_error: null },
};

describe.skipIf(!enabled)("service-role function grants", () => {
  const service = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [fn, args] of Object.entries(SYSTEM_FUNCTIONS)) {
    it(`lets the service role run ${fn}`, async () => {
      const { error } = await service.rpc(fn, args);
      // Any other error (e.g. "no such purchase order") means it got in. A wrong argument name would hide the check, so that fails too.
      expect(error?.message ?? "").not.toMatch(/permission denied|could not find the function/i);
    });
  }
});
