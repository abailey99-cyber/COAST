import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Permission } from "@/lib/logic/permissions";
import type { StaffRole } from "@/lib/logic/roles";

/** Permission reads and writes. RLS limits every call to the caller's organisation, and writes to admins. */

export interface RolePermissionRow {
  role: string;
  permission: string;
}

export async function listRolePermissions(client: SupabaseClient, role?: StaffRole): Promise<RolePermissionRow[]> {
  let query = client.from("role_permissions").select("role, permission");
  if (role) query = query.eq("role", role);
  const { data, error } = await query.returns<RolePermissionRow[]>();
  if (error) throw new Error(`Couldn't load permissions: ${error.message}`);
  return data ?? [];
}

export async function grantRolePermission(client: SupabaseClient, orgId: string, userId: string, role: StaffRole, permission: Permission): Promise<void> {
  const { error } = await client
    .from("role_permissions")
    .upsert({ org_id: orgId, role, permission, granted_by: userId }, { onConflict: "org_id,role,permission", ignoreDuplicates: true });
  if (error) throw new Error(`Couldn't grant permission: ${error.message}`);
}

export async function revokeRolePermission(client: SupabaseClient, orgId: string, role: StaffRole, permission: Permission): Promise<void> {
  const { error } = await client.from("role_permissions").delete().match({ org_id: orgId, role, permission });
  if (error) throw new Error(`Couldn't remove permission: ${error.message}`);
}

export interface OverrideRow {
  user_id: string;
  permission: string;
  granted: boolean;
}

export async function listPersonOverrides(client: SupabaseClient, userId?: string): Promise<OverrideRow[]> {
  let query = client.from("staff_permission_overrides").select("user_id, permission, granted");
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.returns<OverrideRow[]>();
  if (error) throw new Error(`Couldn't load individual access: ${error.message}`);
  return data ?? [];
}

/** granted: true = allow, false = block, null = back to the role's setting. */
export async function setPersonOverride(client: SupabaseClient, actorId: string, userId: string, permission: Permission, granted: boolean | null): Promise<void> {
  if (granted === null) {
    const { error } = await client.from("staff_permission_overrides").delete().match({ user_id: userId, permission });
    if (error) throw new Error(`Couldn't reset access: ${error.message}`);
    return;
  }
  // Update an existing exception if there is one, otherwise add it. (Not an
  // upsert: that would also try to rewrite the key columns, which RLS forbids.)
  const updated = await client
    .from("staff_permission_overrides")
    .update({ granted, set_by: actorId, set_at: new Date().toISOString() })
    .match({ user_id: userId, permission })
    .select("user_id");
  if (updated.error) throw new Error(`Couldn't change access: ${updated.error.message}`);
  if (updated.data?.length) return;

  const inserted = await client
    .from("staff_permission_overrides")
    .insert({ user_id: userId, permission, granted, set_by: actorId })
    .select("user_id");
  if (inserted.error) throw new Error(`Couldn't change access: ${inserted.error.message}`);
  if (!inserted.data?.length) throw new Error("Not allowed to change that person's access.");
}
