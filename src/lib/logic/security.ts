/**
 * Small, pure security helpers used by routes and actions.
 */

/**
 * Only allow redirects to paths on this site. Anything else (absolute URLs,
 * protocol-relative "//evil.com", backslash tricks) falls back.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/** Length-safe constant-time string comparison (no early exit on mismatch). */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Cron endpoints are called with `Authorization: Bearer <CRON_SECRET>`
 * (decisions B12). An unset or short secret never authorises anything.
 */
export const MIN_CRON_SECRET_LENGTH = 32;

export function isAuthorisedCronRequest(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return false;
  if (!authorizationHeader) return false;
  return constantTimeEqual(authorizationHeader, `Bearer ${secret}`);
}

export const MIN_PASSWORD_LENGTH = 12;

/** Returns a plain-English problem with a new password, or null if it's acceptable. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 128) return "Use 128 characters or fewer.";
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
