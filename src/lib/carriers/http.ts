import "server-only";
import { classifyHttpStatus, failure, type TrackOutcome } from "@/lib/logic/carrier-responses";

/** Carrier calls give up after this long, so one slow carrier can't stall a poll run. */
export const CARRIER_TIMEOUT_MS = 15_000;

export type JsonResult = { ok: true; body: unknown } | { ok: false; outcome: TrackOutcome };

/**
 * Fetch JSON from a carrier. Never throws: a timeout, a network failure or
 * a non-JSON answer all become a TrackOutcome the poll job can record.
 * Error messages never include credentials or tracking numbers.
 */
export async function fetchCarrierJson(url: string, init: RequestInit): Promise<JsonResult> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(CARRIER_TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, outcome: failure("unavailable") };
  }
  if (!res.ok) {
    // Some carriers answer "not found" with a 400 and a JSON body the parser understands.
    const kind = classifyHttpStatus(res.status);
    if (kind === "bad_response") {
      const body = await res.json().catch(() => null);
      if (body !== null) return { ok: true, body };
    }
    return { ok: false, outcome: failure(kind) };
  }
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, outcome: failure("bad_response") };
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * OAuth tokens, cached per organisation: each organisation signs in with its
 * own carrier account, so a token is never shared across tenants
 * (readiness Task 2/3).
 */
export function tokenCache() {
  const cached = new Map<string, CachedToken>();
  return {
    async get(owner: string, fetchToken: () => Promise<{ token: string; expiresInSeconds: number } | null>): Promise<string | null> {
      const hit = cached.get(owner);
      if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
      const fresh = await fetchToken();
      if (fresh) cached.set(owner, { token: fresh.token, expiresAt: Date.now() + fresh.expiresInSeconds * 1000 });
      else cached.delete(owner);
      return fresh?.token ?? null;
    },
    clear(owner: string) {
      cached.delete(owner);
    },
  };
}

export async function fetchOAuthToken(url: string, init: RequestInit): Promise<{ token: string; expiresInSeconds: number } | null> {
  const r = await fetchCarrierJson(url, init);
  if (!r.ok) return null;
  const body = r.body as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) return null;
  const expires = Number(body.expires_in);
  return { token: body.access_token, expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : 3000 };
}
