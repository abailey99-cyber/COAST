import "server-only";
import { createHash } from "node:crypto";
import { recordSecurityEvent } from "@/lib/data/credentials";
import { hitRateLimit } from "@/lib/data/customer-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { visitorKey } from "./customer-view";

/**
 * Sign-in protection for staff and customers (readiness plan Task 5B):
 * a limit per visitor, a lockout per email address after repeated wrong
 * passwords, and a security event for every sign-in, failed sign-in and
 * lockout. Email addresses are only ever stored hashed (in limits) or
 * partly hidden (in events). Any address can be locked, whether or not it
 * has an account, so a lockout reveals nothing.
 */

export const LOCKOUT_AFTER = 5;
export const LOCKOUT_SECONDS = 15 * 60;
// Generous: a whole office can share one internet address. The per-address lockout is the real protection against guessing.
const VISITOR_ATTEMPTS = 100;

type Kind = "staff" | "customer";

const hashed = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
/** "jo.bloggs@example.com" → "j•••@example.com". */
export const hiddenEmail = (email: string) => {
  const [u = "", d = ""] = email.trim().toLowerCase().split("@");
  return `${u.slice(0, 1)}•••@${d}`;
};

export type GuardResult = { ok: true } | { ok: false; error: string };

export const LOCKED_MESSAGE = "Too many attempts. For your security, signing in to this account is paused for 15 minutes.";
const BUSY_MESSAGE = "Too many tries from here. Please wait a few minutes.";

/** Before trying a password: this visitor's limit, and whether the address is locked. */
export async function beforeSignIn(kind: Kind, email: string): Promise<GuardResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: true };
  if (!(await hitRateLimit(admin, `${kind}-sign-in:${await visitorKey()}`, VISITOR_ATTEMPTS, 600))) return { ok: false, error: BUSY_MESSAGE };
  const { data } = await admin.rpc("rate_limit_count", { p_bucket: `signin-fail:${kind}:${hashed(email)}`, p_window_seconds: LOCKOUT_SECONDS });
  return Number(data) >= LOCKOUT_AFTER ? { ok: false, error: LOCKED_MESSAGE } : { ok: true };
}

/** A wrong password (or no such account): counts towards the lockout, and is logged. */
export async function afterFailedSignIn(kind: Kind, email: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const stillAllowed = await hitRateLimit(admin, `signin-fail:${kind}:${hashed(email)}`, LOCKOUT_AFTER - 1, LOCKOUT_SECONDS);
  // A staff address belongs to an organisation: its admins see the event.
  const { data: staff } = kind === "staff" ? await admin.from("staff_users").select("org_id").ilike("email", email.trim()).maybeSingle<{ org_id: string }>() : { data: null };
  const detail = { kind, email: hiddenEmail(email), visitor: (await visitorKey()).replace(/\.\d+$/, ".x") };
  await recordSecurityEvent(admin, { orgId: staff?.org_id ?? null, kind: "sign_in_failed", actorId: null, detail });
  if (!stillAllowed) await recordSecurityEvent(admin, { orgId: staff?.org_id ?? null, kind: "account_locked", actorId: null, detail: { ...detail, minutes: LOCKOUT_SECONDS / 60 } });
}

export async function afterSignIn(kind: Kind, userId: string, orgId: string | null, extra: Record<string, unknown> = {}): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await recordSecurityEvent(admin, { orgId, kind: "sign_in", actorId: userId, detail: { kind, ...extra } });
}

/** Password resets: a few per visitor per hour. */
export async function allowPasswordReset(): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  if (!admin) return true;
  return hitRateLimit(admin, `password-reset:${await visitorKey()}`, 5, 3600);
}
