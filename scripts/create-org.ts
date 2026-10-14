/**
 * Set up a new customer organisation and its first admin (decisions C1:
 * no self-serve sign-up in v1).
 *
 *   npm run org:create -- --name "Acme Supplies Ltd" --slug acme-supplies --admin-email jo@acme.co.uk --admin-name "Jo Bloggs"
 *
 * Prints a one-time link for the admin to set their own password. No email
 * is sent and no password is ever typed or printed. The link expires
 * (Supabase default: 1 hour) — run again for a fresh one.
 */

import { parseArgs } from "node:util";
import { adminClient, ensureOrganisation, ensureStaffUser, fail } from "./lib/admin";

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
    },
  });
  const name = values.name?.trim();
  const slug = values.slug?.trim();
  const email = values["admin-email"]?.trim();
  const fullName = values["admin-name"]?.trim();
  if (!name || !slug || !email || !fullName) {
    fail('Usage: npm run org:create -- --name "Company Ltd" --slug company --admin-email you@company.co.uk --admin-name "Your Name"');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail("--slug must be lower-case letters, numbers and single dashes, e.g. acme-supplies");

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const admin = adminClient();

  const orgId = await ensureOrganisation(admin, name, slug);
  await ensureStaffUser(admin, { email, fullName, role: "admin", orgId });

  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data.properties?.hashed_token) fail(`Couldn't make a set-password link: ${error?.message}`);

  const link = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/auth/set-password`;
  console.log(`\n✓ ${name} is set up, with ${fullName} <${email}> as admin.`);
  console.log(`\nSend them this link to set their password (it works once and expires soon):\n\n  ${link}\n`);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
