/**
 * Demo data for a development or staging database (decisions C15).
 *
 *   npm run db:seed-demo
 *
 * Creates two obviously-fake organisations and one sign-in per role, all
 * with the password in DEMO_USER_PASSWORD (.env.local). Safe to run again.
 * Refuses to run when COAST_ENV=production.
 *
 * Emails use the reserved .test domain, so nothing can ever be delivered.
 */

import { MIN_PASSWORD_LENGTH } from "../src/lib/logic/security";
import { adminClient, coastEnv, ensureOrganisation, ensureStaffUser, fail, type StaffSpec } from "./lib/admin";

async function main() {
  if (coastEnv() === "production") fail("Refusing to seed demo data into production.");
  const password = process.env.DEMO_USER_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) fail(`Set DEMO_USER_PASSWORD in .env.local (at least ${MIN_PASSWORD_LENGTH} characters).`);

  const admin = adminClient();
  const orgA = await ensureOrganisation(admin, "[Demo Org A]", "demo-org-a");
  const orgB = await ensureOrganisation(admin, "[Demo Org B]", "demo-org-b");

  const people: StaffSpec[] = [
    { email: "admin@demo-a.coast.test", fullName: "[Admin A]", role: "admin", orgId: orgA },
    { email: "procurement@demo-a.coast.test", fullName: "[Procurement A]", role: "procurement", orgId: orgA },
    { email: "sales@demo-a.coast.test", fullName: "[Sales rep A]", role: "sales", orgId: orgA },
    { email: "director@demo-a.coast.test", fullName: "[Director A]", role: "director", orgId: orgA },
    { email: "goodsin@demo-a.coast.test", fullName: "[Goods-in A]", role: "goods_in", orgId: orgA },
    { email: "admin@demo-b.coast.test", fullName: "[Admin B]", role: "admin", orgId: orgB },
  ];

  for (const person of people) {
    await ensureStaffUser(admin, { ...person, password });
    console.log(`  ✓ ${person.email} (${person.role})`);
  }

  console.log("\nDemo data ready. Sign in with any address above and DEMO_USER_PASSWORD.\n");
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
