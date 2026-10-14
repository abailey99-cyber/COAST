import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/logic/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Handlers behind the links in sign-in emails. Both return a path to send
 * the browser to; the route handlers just redirect.
 */

const ALLOWED_OTP_TYPES: readonly EmailOtpType[] = ["recovery", "invite", "email"];

/** PKCE links (password reset requested from the sign-in page). */
export async function completeCodeLink(code: string | null, next: string | null): Promise<string> {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !code) return "/sign-in?error=link";
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? "/sign-in?error=link" : safeNextPath(next);
}

/** Token-hash links (set-password links made by the create-org script). */
export async function completeTokenLink(tokenHash: string | null, type: string | null, next: string | null): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const otpType = ALLOWED_OTP_TYPES.find((t) => t === type);
  if (!supabase || !tokenHash || !otpType) return "/sign-in?error=link";
  const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash });
  return error ? "/sign-in?error=link" : safeNextPath(next);
}
