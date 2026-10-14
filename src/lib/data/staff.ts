import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffRole, type StaffRole } from "@/lib/logic/roles";

/**
 * Staff reads. Data layer: reads and writes only, no decisions. Every call
 * takes a user-scoped client, so RLS decides what comes back.
 */

export interface StaffProfile {
  id: string;
  orgId: string;
  orgName: string;
  role: StaffRole;
  fullName: string;
  email: string;
  isActive: boolean;
}

interface StaffRow {
  id: string;
  org_id: string;
  role: string;
  full_name: string;
  email: string;
  is_active: boolean;
  organisations: { name: string } | null;
}

function toProfile(row: StaffRow): StaffProfile | null {
  if (!isStaffRole(row.role)) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    orgName: row.organisations?.name ?? "",
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    isActive: row.is_active,
  };
}

const STAFF_COLUMNS = "id, org_id, role, full_name, email, is_active, organisations(name)";

export async function getStaffProfile(client: SupabaseClient, userId: string): Promise<StaffProfile | null> {
  const { data, error } = await client
    .from("staff_users")
    .select(STAFF_COLUMNS)
    .eq("id", userId)
    .maybeSingle<StaffRow>();
  if (error) throw new Error(`Couldn't load staff profile: ${error.message}`);
  return data ? toProfile(data) : null;
}

export async function listStaffInOrg(client: SupabaseClient): Promise<StaffProfile[]> {
  const { data, error } = await client
    .from("staff_users")
    .select(STAFF_COLUMNS)
    .order("full_name")
    .returns<StaffRow[]>();
  if (error) throw new Error(`Couldn't load team: ${error.message}`);
  return (data ?? []).map(toProfile).filter((p): p is StaffProfile => p !== null);
}
