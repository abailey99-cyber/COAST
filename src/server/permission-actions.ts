"use server";

import { revalidatePath } from "next/cache";
import { grantRolePermission, revokeRolePermission } from "@/lib/data/permissions";
import { isPermission } from "@/lib/logic/permissions";
import { isStaffRole } from "@/lib/logic/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, requireAdmin } from "./session";

export interface PermissionChangeResult {
  ok: boolean;
  error?: string;
}

/** Switch one permission on or off for one role in the admin's organisation. */
export async function setRolePermission(role: string, permission: string, granted: boolean): Promise<PermissionChangeResult> {
  try {
    const admin = await requireAdmin();
    if (!isStaffRole(role) || role === "admin") return { ok: false, error: "Admin permissions can't be changed." };
    if (!isPermission(permission)) return { ok: false, error: "Unknown permission." };

    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, error: "The database isn't connected." };

    if (granted) await grantRolePermission(supabase, admin.orgId, admin.id, role, permission);
    else await revokeRolePermission(supabase, admin.orgId, role, permission);

    // TODO(Phase 1): write to the audit log once it exists (decisions B4).
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, error: e.message };
    return { ok: false, error: "That change couldn't be saved. Try again." };
  }
}
