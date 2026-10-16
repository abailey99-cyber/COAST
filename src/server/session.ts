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
  /** Signed in with a password, but the organisation requires two-step sign-in and it isn't done yet (readiness Task 5B). */
  | { state: "needs-mfa"; enrolled: boolean }
  | { state: "staff"; staff: StaffContext };

export const getStaffSession = cache(async (): Promise<StaffSession> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "unconfigured" };

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { state: "signed-out" };

  const profile = await getStaffProfile(supabase, userId);
  if (!profile || !profile.isActive) return { state: "not-staff" };

  // Two-step sign-in: until it's passed, the database shows this person nothing (0036).
  const mfa = await mfaStatus(supabase);
  if (mfa.required && !mfa.passed) return { state: "needs-mfa", enrolled: mfa.enrolled };

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
  if (session.state === "needs-mfa") redirect("/sign-in/two-step");
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
  if (session.state === "needs-mfa") throw new NotAllowedError("Finish signing in with your authenticator app first.");
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

/** Whether this person's organisation requires two-step sign-in, whether this session has passed it, and whether they've set up an app. */
export async function mfaStatus(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>): Promise<{ required: boolean; passed: boolean; enrolled: boolean }> {
  const { data } = await supabase.rpc("staff_mfa_status").maybeSingle<{ required: boolean; passed: boolean }>();
  const required = data?.required ?? true;
  const passed = data?.passed ?? false;
  if (!required || passed) return { required, passed, enrolled: true };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  return { required, passed, enrolled: (factors?.totp ?? []).some((f) => f.status === "verified") };
}
