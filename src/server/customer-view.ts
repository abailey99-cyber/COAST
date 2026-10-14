import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { accountHasOrder, findOrderByTrackingCode, getPrefs, hitRateLimit, loadRawCustomerOrder, normaliseTrackingCode } from "@/lib/data/customer-portal";
import { appUrl } from "@/lib/env";
import { assertViewIsClean, toCustomerView, type CustomerOrderView } from "@/lib/logic/masking";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Building what a customer sees. Every customer page and email goes through
 * `customerViewFor`: raw order → the one masking function → a final leak
 * scan that refuses the view if a supplier name or PO number got through.
 * It uses the service-role client, so callers must have scoped the order
 * already (a valid tracking code, or the customer's own account).
 */

export async function customerViewFor(admin: SupabaseClient, orderId: string, now: Date = new Date()): Promise<{ orgId: string; view: CustomerOrderView } | null> {
  const loaded = await loadRawCustomerOrder(admin, orderId);
  if (!loaded) return null;
  const view = toCustomerView(loaded.raw, now);
  assertViewIsClean(view, loaded.raw.secrets);
  return { orgId: loaded.orgId, view };
}

export function trackingUrl(code: string): string {
  return `${appUrl()}/track/${code}`;
}

/** The visitor's address, for rate limits. Behind Vercel, the first x-forwarded-for entry. */
export async function visitorKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown").slice(0, 64);
}

/** Public lookups: per visitor, and per code (B7, spec §11). */
const LOOKUPS_PER_10_MIN = 60;
const MISSES_PER_10_MIN = 15;

export type TrackLookup =
  | { state: "ok"; orderId: string; orgId: string; code: string; view: CustomerOrderView }
  | { state: "not_found" }
  | { state: "slow_down" }
  | { state: "unavailable" };

/**
 * A tracking code → the customer's view of that order. "No such order" and
 * "that code is wrong" look identical, and guessing is rate-limited.
 */
export async function lookUpTrackingCode(input: string): Promise<TrackLookup> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { state: "unavailable" };
  const who = await visitorKey();
  if (!(await hitRateLimit(admin, `track:${who}`, LOOKUPS_PER_10_MIN, 600))) return { state: "slow_down" };
  const code = normaliseTrackingCode(input);
  const found = code ? await findOrderByTrackingCode(admin, code) : null;
  if (!found || !code) {
    if (!(await hitRateLimit(admin, `track-miss:${who}`, MISSES_PER_10_MIN, 600))) return { state: "slow_down" };
    return { state: "not_found" };
  }
  if (!(await hitRateLimit(admin, `track-code:${code}`, LOOKUPS_PER_10_MIN * 2, 600))) return { state: "slow_down" };
  const built = await customerViewFor(admin, found.orderId);
  if (!built) return { state: "not_found" };
  return { state: "ok", orderId: found.orderId, orgId: found.orgId, code, view: built.view };
}

export interface TrackingPage {
  code: string;
  view: CustomerOrderView;
  /** The customer's own update settings; the email is partly hidden on screen. */
  updates: { emailHint: string | null; level: string; dailyDigest: boolean };
  /** For "Get COAST for your business" — which business's page sent them. */
  businessSlug: string | null;
  /** The signed-in customer already has this order in their account. */
  inAccount: boolean;
}

/** "jo.bloggs@example.com" → "j•••@example.com". */
function hintEmail(email: string | null): string | null {
  if (!email) return null;
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain}`;
}

export async function loadTrackingPage(code: string, customerUserId: string | null = null): Promise<TrackLookup["state"] | TrackingPage> {
  const r = await lookUpTrackingCode(code);
  if (r.state !== "ok") return r.state;
  const admin = createSupabaseAdminClient()!;
  const [prefs, org, inAccount] = await Promise.all([
    getPrefs(admin, r.orderId),
    admin.from("organisations").select("slug").eq("id", r.orgId).maybeSingle<{ slug: string }>(),
    customerUserId ? accountHasOrder(admin, customerUserId, r.orderId) : Promise.resolve(false),
  ]);
  return {
    code: r.code,
    view: r.view,
    updates: { emailHint: hintEmail(prefs?.email ?? null), level: prefs?.level ?? "milestones", dailyDigest: prefs?.dailyDigest ?? false },
    businessSlug: org.data?.slug ?? null,
    inAccount,
  };
}
