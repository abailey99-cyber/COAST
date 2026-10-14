import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONFIGURABLE_ROLES, DEFAULT_PERMISSIONS } from "../../src/lib/logic/permissions";

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


export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export async function demoOrgId(service: SupabaseClient): Promise<string> {
  const { data } = await service.from("organisations").select("id").eq("slug", "demo-org-a").single();
  return data!.id as string;
}

/** Put [Demo Org A] back to the default permissions, whatever an earlier failed run left behind. */
export async function resetDemoPermissions(): Promise<void> {
  const service = serviceClient();
  const orgId = await demoOrgId(service);
  const { data: people } = await service.from("staff_users").select("id").eq("org_id", orgId);
  await service.from("staff_permission_overrides").delete().in("user_id", (people ?? []).map((p) => p.id));
  await service.from("role_permissions").delete().eq("org_id", orgId);
  const rows = CONFIGURABLE_ROLES.flatMap((role) => DEFAULT_PERMISSIONS[role].map((permission) => ({ org_id: orgId, role, permission, granted_by: null })));
  const { error } = await service.from("role_permissions").insert(rows);
  if (error) throw new Error(`Couldn't reset permissions: ${error.message}`);
}

export const e2eEnabled =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DEMO_USER_PASSWORD) && process.env.COAST_ENV !== "production";
