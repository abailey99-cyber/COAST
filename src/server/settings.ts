import "server-only";
import { listPersonOverrides, listRolePermissions } from "@/lib/data/permissions";
import { listStaffInOrg, type StaffProfile } from "@/lib/data/staff";
import { emailChannelHealth } from "@/lib/email/channel";
import { getChaseSettings, type ChaseSettings } from "@/lib/data/supplier-loop";
import { integrationHealth, type IntegrationHealth } from "@/lib/env";
import { DEFAULT_THRESHOLDS } from "@/lib/logic/escalation";
import { DEFAULT_CALENDAR } from "@/lib/logic/working-time";
import {
  CONFIGURABLE_ROLES,
  canManagePersonAccess,
  grantablePermissions,
  hasPermission,
  isPermission,
  resolvePermissions,
  type Permission,
} from "@/lib/logic/permissions";
import type { StaffRole } from "@/lib/logic/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "./session";
import { loadCarrierConnections, type CarrierConnectionsView } from "./shipments";
import { getPredictionSettings } from "@/lib/data/predictions";
import { getCustomsSettings, type CustomsSettings } from "@/lib/data/problems";
import { getCustomerPageSettings, type CustomerPageSettings } from "@/lib/data/customer-portal";
import { DEFAULT_PREDICTION_SETTINGS, type PredictionSettings } from "@/lib/logic/prediction";

export type OverrideState = "allow" | "block";

export interface PersonAccess extends StaffProfile {
  /** What their role gives them. */
  roleGrants: Permission[];
  /** Their individual exceptions. */
  overrides: Partial<Record<Permission, OverrideState>>;
  /** Role + exceptions. */
  effective: Permission[];
  /** Whether the viewer may change this person, and which permissions. */
  editable: boolean;
  grantable: Permission[];
}

export interface SettingsView {
  canEditSettings: boolean;
  canManagePermissions: boolean;
  integrations: IntegrationHealth[];
  chase: ChaseSettings;
  carriers: CarrierConnectionsView | null;
  prediction: PredictionSettings;
  customerPage: CustomerPageSettings;
  customs: CustomsSettings;
  orgName: string;
  team: PersonAccess[];
  /** role → granted permissions, for every role except admin (always everything). */
  grants: Record<Exclude<StaffRole, "admin">, Permission[]>;
}

export async function loadSettings(): Promise<SettingsView> {
  const staff = await requireStaff({ section: "settings" });
  const supabase = await createSupabaseServerClient();
  const [team, roleRows, overrideRows] = supabase
    ? await Promise.all([listStaffInOrg(supabase), listRolePermissions(supabase), listPersonOverrides(supabase)])
    : [[], [], []];
  const chase: ChaseSettings = supabase ? await getChaseSettings(supabase) : { thresholds: DEFAULT_THRESHOLDS, calendar: DEFAULT_CALENDAR };
  const carriers = supabase ? await loadCarrierConnections(staff) : null;
  const prediction = supabase ? await getPredictionSettings(supabase) : DEFAULT_PREDICTION_SETTINGS;
  const customs = supabase ? await getCustomsSettings(supabase) : { eori: null, territoriesNeedCustoms: true };
  const customerPage = supabase ? await getCustomerPageSettings(supabase) : { displayName: null, logoUrl: null, supplierWord: "shipper", showDirectCarrier: false, minGapHours: 4, dateShiftDays: 2 };

  const grants = Object.fromEntries(CONFIGURABLE_ROLES.map((r) => [r, [] as Permission[]])) as SettingsView["grants"];
  for (const row of roleRows) {
    if (row.role !== "admin" && row.role in grants && isPermission(row.permission)) {
      grants[row.role as keyof SettingsView["grants"]].push(row.permission);
    }
  }

  const viewerGrantable = grantablePermissions(staff);
  const people: PersonAccess[] = team.map((person) => {
    const roleGrants = person.role === "admin" ? [] : grants[person.role];
    const mine = overrideRows.filter((o) => o.user_id === person.id);
    const overrides: PersonAccess["overrides"] = {};
    for (const o of mine) if (isPermission(o.permission)) overrides[o.permission] = o.granted ? "allow" : "block";
    const editable = canManagePersonAccess(staff, person);
    return {
      ...person,
      roleGrants,
      overrides,
      effective: [...resolvePermissions(person.role, roleGrants, mine)],
      editable,
      grantable: editable ? viewerGrantable : [],
    };
  });

  return {
    canEditSettings: hasPermission(staff.permissions, "settings.edit"),
    canManagePermissions: staff.role === "admin",
    integrations: [{ key: "email", label: "Sending email", ...emailChannelHealth() }, ...integrationHealth()],
    chase,
    carriers,
    prediction,
    customerPage,
    customs,
    orgName: staff.orgName,
    team: people,
    grants,
  };
}
export type { CustomerPageSettings };
