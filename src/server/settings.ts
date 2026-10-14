import "server-only";
import { listRolePermissions } from "@/lib/data/permissions";
import { listStaffInOrg, type StaffProfile } from "@/lib/data/staff";
import { integrationHealth, type IntegrationHealth } from "@/lib/env";
import { CONFIGURABLE_ROLES, hasPermission, isPermission, type Permission } from "@/lib/logic/permissions";
import type { StaffRole } from "@/lib/logic/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "./session";

export interface SettingsView {
  canEditSettings: boolean;
  canManagePermissions: boolean;
  integrations: IntegrationHealth[];
  team: StaffProfile[];
  /** role → granted permissions, for every role except admin (always everything). */
  grants: Record<Exclude<StaffRole, "admin">, Permission[]>;
}

export async function loadSettings(): Promise<SettingsView> {
  const staff = await requireStaff({ section: "settings" });
  const supabase = await createSupabaseServerClient();
  const [team, rows] = supabase ? await Promise.all([listStaffInOrg(supabase), listRolePermissions(supabase)]) : [[], []];

  const grants = Object.fromEntries(CONFIGURABLE_ROLES.map((r) => [r, [] as Permission[]])) as SettingsView["grants"];
  for (const row of rows) {
    if (row.role !== "admin" && row.role in grants && isPermission(row.permission)) {
      grants[row.role as keyof SettingsView["grants"]].push(row.permission);
    }
  }

  return {
    canEditSettings: hasPermission(staff.permissions, "settings.edit"),
    canManagePermissions: staff.role === "admin",
    integrations: integrationHealth(),
    team,
    grants,
  };
}
