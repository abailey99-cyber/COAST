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
