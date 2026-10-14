/**
 * Writes DEMO-LOGINS.local.md: every demo sign-in, what the role does, and
 * the demo password — one place for the product owner.
 *
 *   npm run demo:logins
 *
 * The file is git-ignored (*.local.md) and must never be committed: the
 * repository is public. Development data only — never real accounts.
 */

import { writeFileSync } from "node:fs";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type StaffRole } from "../src/lib/logic/roles";
import { adminClient, coastEnv, fail } from "./lib/admin";

const ORDER: StaffRole[] = ["admin", "procurement", "sales_manager", "sales", "director", "goods_in"];

async function main() {
  if (coastEnv() === "production") fail("Refusing to list logins for production.");
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password) fail("DEMO_USER_PASSWORD isn't set in .env.local.");
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");

  const admin = adminClient();
  const { data, error } = await admin
    .from("staff_users")
    .select("full_name, email, role, is_active, organisations(name)")
    .like("email", "%.coast.test")
    .returns<{ full_name: string; email: string; role: StaffRole; is_active: boolean; organisations: { name: string } | null }[]>();
  if (error) fail(`Couldn't read the demo users: ${error.message}`);

  const rows = [...(data ?? [])].sort(
    (a, b) => (a.organisations?.name ?? "").localeCompare(b.organisations?.name ?? "") || ORDER.indexOf(a.role) - ORDER.indexOf(b.role) || a.email.localeCompare(b.email),
  );

  const lines = [
    "# COAST demo logins",
    "",
    "> **Private — on this computer only.** This file is ignored by git and must never be uploaded or shared.",
    "> These are demo accounts in the development database. Regenerate with `npm run demo:logins`.",
    "",
    `**Sign in at:** ${appUrl}/sign-in (run \`npm run dev\` first)`,
    "",
    `**Password for every demo account:** \`${password}\``,
    "",
    "| Name | Email (username) | Role | What they can do | Organisation | Status |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.full_name} | ${r.email} | ${ROLE_LABELS[r.role] ?? r.role} | ${ROLE_DESCRIPTIONS[r.role] ?? ""} | ${r.organisations?.name ?? ""} | ${r.is_active ? "Active" : "Deactivated"} |`,
    ),
    "",
    "What each role sees by default can be changed by an admin in Settings → Who sees what, and for individual people in Settings → Team and individual access.",
    "",
    `_Generated ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })}._`,
    "",
  ];

  writeFileSync("DEMO-LOGINS.local.md", lines.join("\n"));
  console.log(`✓ Wrote DEMO-LOGINS.local.md (${rows.length} accounts).`);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
