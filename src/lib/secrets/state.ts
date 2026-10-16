import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { Keyring } from "./crypto";

/**
 * Signed, expiring "state" for a round trip through someone else's site
 * (Microsoft's admin-consent page): it says which organisation and which
 * admin started it, and can't be forged or reused later. The signing key is
 * derived from the current credential key, never stored.
 */

function signingKey(ring: Keyring): Buffer {
  return Buffer.from(hkdfSync("sha256", ring.keys.get(ring.current)!, Buffer.alloc(0), Buffer.from("coast-signed-state-v1"), 32));
}

export function signState(payload: Record<string, string>, ring: Keyring, now: Date, ttlSeconds = 900): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now.getTime() / 1000) + ttlSeconds })).toString("base64url");
  const mac = createHmac("sha256", signingKey(ring)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The payload, or null if it was tampered with, signed with another key, or has expired. */
export function verifyState(state: string, ring: Keyring, now: Date): Record<string, string> | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", signingKey(ring)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof p.exp !== "number" || p.exp < now.getTime() / 1000) return null;
    return Object.fromEntries(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return null;
  }
}
