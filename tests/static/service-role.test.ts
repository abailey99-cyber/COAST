/**
 * Every file that creates the service-role client must be listed, with how
 * it's scoped, in docs/security/service-role-uses.md (readiness Task 5A).
 * The client bypasses row-level security, so a new use needs a deliberate look.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(name) ? [p.replace(/\\/g, "/")] : [];
  });
}

describe("service-role use", () => {
  const users = filesUnder("src")
    .filter((f) => f !== "src/lib/supabase/admin.ts" && !f.endsWith(".test.ts"))
    .filter((f) => /createSupabaseAdminClient\s*\(/.test(readFileSync(f, "utf8")));
  const listed = [...readFileSync("docs/security/service-role-uses.md", "utf8").matchAll(/^\| `(src\/[^`]+)`/gm)].map((m) => m[1]!);

  it("is listed for every file that uses it", () => {
    expect(users.filter((f) => !listed.includes(f)), "add these to docs/security/service-role-uses.md").toEqual([]);
  });

  it("has no stale entries in the list", () => {
    expect(listed.filter((f) => !users.includes(f)), "remove these from docs/security/service-role-uses.md").toEqual([]);
  });

  it("is only ever used from the server layer", () => {
    expect(users.filter((f) => !f.startsWith("src/server/"))).toEqual([]);
  });
});
