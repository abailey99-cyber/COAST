/**
 * Readiness plan Task 2: no integration code reads an organisation's own
 * credentials from environment variables — they come from
 * getIntegrationCredentials(orgId, provider). Only what COAST itself owns
 * stays in the hosting settings.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TENANT_VARS = /\b(DHL_API_KEY|FEDEX_CLIENT_(ID|SECRET)|UPS_CLIENT_(ID|SECRET)|ROYAL_MAIL_CLIENT_(ID|SECRET)|DPD_API_KEY|HERMES_API_KEY|YODEL_API_KEY|NETSUITE_[A-Z_]+|M365_TENANT_ID|M365_MAILBOX)\b/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(name) ? [p.replace(/\\/g, "/")] : [];
  });
}

describe("per-organisation credentials", () => {
  it("are never read from environment variables", () => {
    const offenders = filesUnder("src").filter((f) => !f.endsWith(".test.ts") && TENANT_VARS.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("aren't offered in .env.example", () => {
    expect(readFileSync(".env.example", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l) && TENANT_VARS.test(l))).toEqual([]);
  });
});
