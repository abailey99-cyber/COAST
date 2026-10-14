import "server-only";
import { listStaffInOrg, type StaffProfile } from "@/lib/data/staff";
import { integrationHealth, type IntegrationHealth } from "@/lib/env";
import { can } from "@/lib/logic/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "./session";

export interface SettingsView {
  canEdit: boolean;
  integrations: IntegrationHealth[];
  team: StaffProfile[];
}

export async function loadSettings(): Promise<SettingsView> {
  const staff = await requireStaff({ section: "settings" });
  const supabase = await createSupabaseServerClient();
  const team = supabase ? await listStaffInOrg(supabase) : [];
  return {
    canEdit: can(staff.role, "settings.edit"),
    integrations: integrationHealth(),
    team,
  };
}
