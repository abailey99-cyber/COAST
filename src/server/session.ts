import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { listPersonOverrides, listRolePermissions } from "@/lib/data/permissions";
import { getStaffProfile, type StaffProfile } from "@/lib/data/staff";
import { canAccessSection, type SectionKey } from "@/lib/logic/navigation";
import { hasPermission, resolvePermissions, type Permission, type PermissionSet } from "@/lib/logic/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Who is signed in and what their organisation lets them do, checked on the
 * server. Every staff page, loader and action goes through these — the
 * sidebar hiding a link is never the check (and RLS checks again below).
 */

export interface StaffContext extends StaffProfile {
  permissions: PermissionSet;
}

export type StaffSession =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | { state: "not-staff" }
  | { state: "staff"; staff: StaffContext };

export const getStaffSession = cache(async (): Promise<StaffSession> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "unconfigured" };

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { state: "signed-out" };

  const profile = await getStaffProfile(supabase, userId);
  if (!profile || !profile.isActive) return { state: "not-staff" };

  if (profile.role === "admin") return { state: "staff", staff: { ...profile, permissions: resolvePermissions("admin", []) } };
  const [roleRows, overrides] = await Promise.all([listRolePermissions(supabase, profile.role), listPersonOverrides(supabase, profile.id)]);
  const permissions = resolvePermissions(profile.role, roleRows.map((r) => r.permission), overrides);
  return { state: "staff", staff: { ...profile, permissions } };
});

/** For pages and layouts: redirects anyone who isn't signed-in active staff. */
export async function requireStaff(options: { section?: SectionKey } = {}): Promise<StaffContext> {
  const session = await getStaffSession();
  if (session.state === "unconfigured") redirect("/sign-in");
  if (session.state === "signed-out") redirect("/sign-in");
  if (session.state === "not-staff") redirect("/sign-in?error=not-staff");
  const { staff } = session;
  if (options.section && !canAccessSection(staff.permissions, options.section)) redirect("/app/home");
  return staff;
}

export class NotAllowedError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "NotAllowedError";
  }
}

export async function requireStaffForAction(): Promise<StaffContext> {
  const session = await getStaffSession();
  if (session.state !== "staff") throw new NotAllowedError("Please sign in again.");
  return session.staff;
}

/** For server actions: throws rather than redirects, so callers can show a message. */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const staff = await requireStaffForAction();
  if (!hasPermission(staff.permissions, permission)) throw new NotAllowedError();
  return staff;
}

/** Team and permission changes are admin-only and can't be delegated (E2). */
export async function requireAdmin(): Promise<StaffContext> {
  const staff = await requireStaffForAction();
  if (staff.role !== "admin") throw new NotAllowedError("Only an admin can do that.");
  return staff;
}
