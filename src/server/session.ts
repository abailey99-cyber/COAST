import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getStaffProfile, type StaffProfile } from "@/lib/data/staff";
import { canAccessSection, type SectionKey } from "@/lib/logic/navigation";
import { can, type Capability } from "@/lib/logic/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Who is signed in, checked on the server. Every staff page, loader and
 * action goes through these — the sidebar hiding a link is never the check.
 */

export type StaffSession =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | { state: "not-staff" }
  | { state: "staff"; staff: StaffProfile };

export const getStaffSession = cache(async (): Promise<StaffSession> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: "unconfigured" };

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { state: "signed-out" };

  const staff = await getStaffProfile(supabase, userId);
  if (!staff || !staff.isActive) return { state: "not-staff" };
  return { state: "staff", staff };
});

/** For pages and layouts: redirects anyone who isn't signed-in active staff. */
export async function requireStaff(options: { section?: SectionKey } = {}): Promise<StaffProfile> {
  const session = await getStaffSession();
  if (session.state === "unconfigured") redirect("/sign-in");
  if (session.state === "signed-out") redirect("/sign-in");
  if (session.state === "not-staff") redirect("/sign-in?error=not-staff");
  const { staff } = session;
  if (options.section && !canAccessSection(staff.role, options.section)) redirect("/app/home");
  return staff;
}

export class NotAllowedError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "NotAllowedError";
  }
}

/** For server actions: throws rather than redirects, so callers can show a message. */
export async function requireCapability(capability: Capability): Promise<StaffProfile> {
  const session = await getStaffSession();
  if (session.state !== "staff") throw new NotAllowedError("Please sign in again.");
  if (!can(session.staff.role, capability)) throw new NotAllowedError();
  return session.staff;
}
