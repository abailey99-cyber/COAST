import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** A new link code (256 random bits) and the hash we store. The code itself is never stored. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Link codes are exactly 43 base64url characters; anything else is rejected before any lookup. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** The default; each company can choose its own (Settings → Chasing, readiness Task 5B). */
export const LINK_LIFETIME_DAYS = 30;
