import "server-only";
import { failure, mockTrack, parseDhl, parseFedex, parseRoyalMail, parseUps, type TrackOutcome } from "@/lib/logic/carrier-responses";
import { directAllowed, getCarrier, hasLiveAdapter, isMockAllowed, type CarrierKey } from "@/lib/logic/carriers";
import { fetchCarrierJson, fetchOAuthToken, tokenCache } from "./http";

/**
 * Carrier tracking adapters (spec §9.3: one interface, a registry, health).
 * Each turns a tracking number into a TrackOutcome; parsing lives in
 * src/lib/logic/carrier-responses.ts. Each organisation brings its own
 * carrier account (readiness Task 2): the poll job fetches that
 * organisation's credentials with getIntegrationCredentials and passes them
 * in for the one call. No credentials → the shipment isn't checked, never a
 * crash (non-negotiable 5). Adding a carrier is one adapter here and one
 * parser, nothing else.
 */

export interface TrackRequest {
  trackingNumber: string;
  /** When the shipment was added to COAST (the test carrier's clock starts here). */
  addedAt: Date;
  now: Date;
}

/** Whose account the call is made with: the organisation's own decrypted credentials, for this call only. */
export interface CarrierCredentials {
  orgId: string;
  secret: Readonly<Record<string, string>>;
}

export interface CarrierAdapter {
  key: CarrierKey;
  /** Needs an organisation's own credentials (everything but the test carrier). */
  needsCredentials: boolean;
  track(request: TrackRequest, credentials: CarrierCredentials | null): Promise<TrackOutcome>;
}

const field = (c: CarrierCredentials | null, name: string) => c?.secret[name]?.trim() || "";

// ── DHL: one API key in a header ────────────────────────────────────────────
// UNVERIFIED: endpoint and header from developer.dhl.com (Shipment Tracking – Unified); not yet run against a live key.
const dhl: CarrierAdapter = {
  key: "dhl",
  needsCredentials: true,
  async track({ trackingNumber }, c) {
    if (!field(c, "apiKey")) return failure("auth");
    const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}&language=en`;
    const r = await fetchCarrierJson(url, { headers: { "DHL-API-Key": field(c, "apiKey"), Accept: "application/json" } });
    return r.ok ? parseDhl(r.body) : r.outcome;
  },
};

// ── FedEx (and TNT): OAuth client credentials ───────────────────────────────
// UNVERIFIED: endpoints from developer.fedex.com (OAuth + Track API v1); not yet run against live credentials.
const FEDEX_BASE = "https://apis.fedex.com";
const fedexToken = tokenCache();

function fedexAdapter(key: "fedex" | "tnt"): CarrierAdapter {
  return {
    key,
    needsCredentials: true,
    async track({ trackingNumber }, c) {
      if (!c || !field(c, "clientId") || !field(c, "clientSecret")) return failure("auth");
      const token = await fedexToken.get(c.orgId, () =>
        fetchOAuthToken(`${FEDEX_BASE}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: field(c, "clientId"), client_secret: field(c, "clientSecret") }),
        }),
      );
      if (!token) return failure("auth");
      const r = await fetchCarrierJson(`${FEDEX_BASE}/track/v1/trackingnumbers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-locale": "en_GB" },
        body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }),
      });
      if (!r.ok && r.outcome.ok === false && r.outcome.kind === "auth") fedexToken.clear(c.orgId);
      return r.ok ? parseFedex(r.body) : r.outcome;
    },
  };
}

// ── UPS: OAuth client credentials ───────────────────────────────────────────
// UNVERIFIED: endpoints from developer.ups.com (OAuth + Tracking API v1); not yet run against live credentials.
const UPS_BASE = "https://onlinetools.ups.com";
const upsToken = tokenCache();

const ups: CarrierAdapter = {
  key: "ups",
  needsCredentials: true,
  async track({ trackingNumber }, c) {
    if (!c || !field(c, "clientId") || !field(c, "clientSecret")) return failure("auth");
    const basic = Buffer.from(`${field(c, "clientId")}:${field(c, "clientSecret")}`).toString("base64");
    const token = await upsToken.get(c.orgId, () =>
      fetchOAuthToken(`${UPS_BASE}/security/v1/oauth/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      }),
    );
    if (!token) return failure("auth");
    const transId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    const r = await fetchCarrierJson(`${UPS_BASE}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_GB`, {
      headers: { Authorization: `Bearer ${token}`, transId, transactionSrc: "coast", Accept: "application/json" },
    });
    if (!r.ok && r.outcome.ok === false && r.outcome.kind === "auth") upsToken.clear(c.orgId);
    return r.ok ? parseUps(r.body) : r.outcome;
  },
};

// ── Royal Mail / Parcelforce: IBM API Connect client id + secret ────────────
// UNVERIFIED: best-effort reconstruction of Royal Mail Group's Tracking API v2. Shown as "beta".
const royalMail: CarrierAdapter = {
  key: "royal_mail",
  needsCredentials: true,
  async track({ trackingNumber }, c) {
    if (!field(c, "clientId") || !field(c, "clientSecret")) return failure("auth");
    const r = await fetchCarrierJson(`https://api.royalmail.net/mailpieces/v2/${encodeURIComponent(trackingNumber)}/events`, {
      headers: {
        "X-IBM-Client-Id": field(c, "clientId"),
        "X-IBM-Client-Secret": field(c, "clientSecret"),
        "X-Accept-RMG-Terms": "yes",
        Accept: "application/json",
      },
    });
    return r.ok ? parseRoyalMail(r.body) : r.outcome;
  },
};

// ── The test carrier ────────────────────────────────────────────────────────
const mock: CarrierAdapter = {
  key: "mock",
  needsCredentials: false,
  track: async ({ trackingNumber, addedAt, now }) => mockTrack(trackingNumber, addedAt, now),
};

// DPD, Evri and Yodel publish no tracking API, so there's nothing safe to call
// yet — COAST won't send a customer's key to a guessed address. They report
// "unsupported" until their integration packs arrive (KNOWN-GAPS.md).
const ADAPTERS: Partial<Record<CarrierKey, CarrierAdapter>> = {
  dhl,
  fedex: fedexAdapter("fedex"),
  tnt: fedexAdapter("tnt"),
  ups,
  royal_mail: royalMail,
  mock,
};

/** The adapter for a carrier, when COAST can check it by itself in this build and environment. */
export function carrierAdapter(key: CarrierKey): CarrierAdapter | null {
  if (!hasLiveAdapter(key)) return null;
  if (key === "mock" && !isMockAllowed(process.env.COAST_ENV)) return null;
  // Frozen carriers, and UPS unless switched on, are never called directly (readiness Task 4).
  if (key !== "mock" && !directAllowed(key, process.env)) return null;
  return ADAPTERS[key] ?? null;
}

/** Carriers COAST can poll in this environment (each organisation still needs its own connection, except the test carrier). */
export function liveCarriers(): CarrierKey[] {
  return (Object.keys(ADAPTERS) as CarrierKey[]).filter((k) => carrierAdapter(k) !== null);
}

/** The credential provider behind a carrier (TNT uses FedEx's). */
export function providerFor(key: CarrierKey) {
  return getCarrier(key).provider ?? null;
}
