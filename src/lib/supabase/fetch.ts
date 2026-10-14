/**
 * fetch for Supabase clients with a time limit. supabase-js has no timeout of
 * its own, so one stalled request to the hosted database could leave a page
 * loading indefinitely; this makes it fail after 20 seconds instead, showing
 * an error the person can retry. Observability for these arrives in Phase 9.
 */
export const SUPABASE_REQUEST_TIMEOUT_MS = 20_000;

export const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
