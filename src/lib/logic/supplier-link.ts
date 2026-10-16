/**
 * The supplier's no-login confirmation link (spec §5.1, readiness plan Task
 * 5B). Pure. Links are stored only as a hash, expire after the company's
 * chosen lifetime, can be revoked from the PO, and opening one never uses it
 * up: the supplier has to press "Send confirmation", so an email security
 * scanner that opens the link first changes nothing.
 */

export const DEFAULT_LINK_LIFETIME_DAYS = 30;
export const MIN_LINK_LIFETIME_DAYS = 1;
export const MAX_LINK_LIFETIME_DAYS = 90;

export type LinkState = "invalid" | "expired" | "revoked" | "closed" | "open" | "unavailable";

/** Whether a link still works. Revoked beats expired beats closed (a cancelled PO). Opening it is not an input: it never changes the answer. */
export function linkState(link: { revoked: boolean; expiresAt: string; poStatus: string }, now: Date): Exclude<LinkState, "invalid" | "unavailable"> {
  if (link.revoked) return "revoked";
  if (!(Date.parse(link.expiresAt) > now.getTime())) return "expired";
  if (link.poStatus === "cancelled") return "closed";
  return "open";
}

export function linkExpiry(now: Date, lifetimeDays: number): Date {
  const days = Number.isInteger(lifetimeDays) ? Math.min(MAX_LINK_LIFETIME_DAYS, Math.max(MIN_LINK_LIFETIME_DAYS, lifetimeDays)) : DEFAULT_LINK_LIFETIME_DAYS;
  return new Date(now.getTime() + days * 86_400_000);
}

export function linkLifetimeProblem(days: number): string | null {
  return Number.isInteger(days) && days >= MIN_LINK_LIFETIME_DAYS && days <= MAX_LINK_LIFETIME_DAYS ? null : `Links can last from ${MIN_LINK_LIFETIME_DAYS} to ${MAX_LINK_LIFETIME_DAYS} days.`;
}
