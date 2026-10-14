/** Demo sign-ins created by `npm run db:seed-demo`. */
export const DEMO_USERS = [
  "admin@demo-a.coast.test",
  "procurement@demo-a.coast.test",
  "salesmanager@demo-a.coast.test",
  "sales@demo-a.coast.test",
  "sales2@demo-a.coast.test",
  "director@demo-a.coast.test",
  "goodsin@demo-a.coast.test",
  "admin@demo-b.coast.test",
] as const;

export type DemoUser = (typeof DEMO_USERS)[number];

/** Saved session for a demo user (inside test-results/, which git ignores). */
export function sessionFile(email: string): string {
  return `test-results/.auth/${email.replace(/[^a-z0-9]/gi, "_")}.json`;
}
