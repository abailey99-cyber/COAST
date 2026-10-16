"use server";

import { redirect } from "next/navigation";
import { recordSecurityEvent } from "@/lib/data/credentials";
import { hitRateLimit } from "@/lib/data/customer-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotAllowedError, getStaffSession, requireAdmin } from "./session";

/**
 * Two-step sign-in with an authenticator app (readiness plan Task 5B), via
 * Supabase Auth's TOTP factors. The secret is shown once, to the person
 * setting it up, and never stored by COAST.
 */

export interface MfaResult {
  ok: boolean;
  error?: string;
}

const CODE = /^\d{6}$/;

async function signedInUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("not-connected");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new NotAllowedError("Please sign in again.");
  return { supabase, user: data.user };
}

/** Too many wrong codes: a pause, like passwords. */
async function allowCodeAttempt(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  return admin ? hitRateLimit(admin, `mfa-code:${userId}`, 10, 900) : true;
}

/** Start setting up an authenticator app: a QR code and the secret to type in by hand. */
export async function startMfaSetup(): Promise<{ ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string }> {
  try {
    const session = await getStaffSession();
    if (session.state !== "needs-mfa" && session.state !== "staff") return { ok: false, error: "Please sign in again." };
    const { supabase } = await signedInUser();
    // Tidy away any half-finished set-up first.
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `COAST ${new Date().toISOString().slice(0, 10)}`, issuer: "COAST" });
    if (error || !data) return { ok: false, error: "Your authenticator app couldn't be set up. Try again." };
    return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be started. Try again." };
  }
}

/** Finish set-up with the first code from the app. */
export async function confirmMfaSetup(factorId: string, _prev: MfaResult | null, formData: FormData): Promise<MfaResult> {
  const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
  if (!CODE.test(code)) return { ok: false, error: "Enter the 6-digit code from your app." };
  try {
    const { supabase, user } = await signedInUser();
    if (!(await allowCodeAttempt(user.id))) return { ok: false, error: "Too many wrong codes. Wait 15 minutes and try again." };
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) return { ok: false, error: "That code didn't work. Codes change every 30 seconds — try the newest one." };
    const admin = createSupabaseAdminClient();
    const { data: staff } = await supabase.from("staff_users").select("org_id").eq("id", user.id).maybeSingle<{ org_id: string }>();
    if (admin) await recordSecurityEvent(admin, { orgId: staff?.org_id ?? null, kind: "mfa_enrolled", actorId: user.id, detail: {} });
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be checked. Try again." };
  }
  redirect("/app/home");
}

/** The second step at each sign-in. */
export async function verifyMfaCode(_prev: MfaResult | null, formData: FormData): Promise<MfaResult> {
  const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
  if (!CODE.test(code)) return { ok: false, error: "Enter the 6-digit code from your app." };
  try {
    const { supabase, user } = await signedInUser();
    if (!(await allowCodeAttempt(user.id))) return { ok: false, error: "Too many wrong codes. Wait 15 minutes and try again." };
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors?.totp ?? []).find((f) => f.status === "verified");
    if (!factor) return { ok: false, error: "You haven't set up an authenticator app yet." };
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) return { ok: false, error: "That code didn't work. Codes change every 30 seconds — try the newest one." };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be checked. Try again." };
  }
  redirect("/app/home");
}

/** An admin resets someone's authenticator app (a lost phone). They set up a new one at their next sign-in. */
export async function resetStaffMfa(userId: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const me = await requireAdmin();
    if (userId === me.id) return { ok: false, error: "Ask another admin to reset your own." };
    const supabase = await createSupabaseServerClient();
    // RLS: only someone in the admin's own organisation is visible here.
    const { data: target } = supabase ? await supabase.from("staff_users").select("id, org_id, full_name").eq("id", userId).maybeSingle<{ id: string; org_id: string; full_name: string }>() : { data: null };
    if (!target || target.org_id !== me.orgId) return { ok: false, error: "That person isn't in your organisation." };
    const admin = createSupabaseAdminClient();
    if (!admin) return { ok: false, error: "This isn't available right now." };
    const { data } = await admin.auth.admin.mfa.listFactors({ userId });
    for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    await recordSecurityEvent(admin, { orgId: me.orgId, kind: "mfa_removed", actorId: me.id, detail: { user_id: userId } });
    return { ok: true, message: `${target.full_name} will set up a new authenticator app the next time they sign in.` };
  } catch (e) {
    return { ok: false, error: e instanceof NotAllowedError ? e.message : "That couldn't be reset. Try again." };
  }
}
