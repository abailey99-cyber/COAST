"use server";

import { redirect } from "next/navigation";
import { getStaffProfile } from "@/lib/data/staff";
import { appUrl } from "@/lib/env";
import { passwordProblem, safeNextPath } from "@/lib/logic/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  message?: string;
}

const NOT_CONNECTED = "Sign-in isn't connected yet. Your administrator needs to finish setting COAST up.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signInStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  const next = safeNextPath(field(formData, "next"), "/app/home");
  if (!email || !password) return { error: "Enter your work email and password." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // Same message whatever went wrong, so the form doesn't reveal which emails exist.
    return { error: "That email and password don't match. Check them, or reset your password." };
  }

  const staff = await getStaffProfile(supabase, data.user.id);
  if (!staff || !staff.isActive) {
    await supabase.auth.signOut();
    return { error: "This account isn't set up as a COAST team member. Ask your COAST admin." };
  }

  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // "local": signs out this browser only, not the person's other devices.
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email").trim();
  if (!email) return { error: "Enter your work email." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONNECTED };

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/auth/callback?next=/auth/set-password`,
  });
  // Always the same answer, whether or not the address has an account.
  return { message: "If that address has a COAST account, we've emailed it a link to set a new password. The link works once." };
}

export async function setNewPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = field(formData, "password");
  const confirm = field(formData, "confirm");
  const problem = passwordProblem(password, confirm);
  if (problem) return { error: problem };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NOT_CONNECTED };

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { error: "Your link has expired. Ask for a new one from the sign-in page." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "That password couldn't be saved. Try a different one." };

  // Staff go to the app; customer accounts (Phase 5) to their orders.
  const staff = await getStaffProfile(supabase, data.claims.sub);
  redirect(staff ? "/app/home" : "/portal");
}
