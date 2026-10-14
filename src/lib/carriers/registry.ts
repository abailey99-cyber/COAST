import "server-only";
import { failure, mockTrack, parseDhl, parseFedex, parseRoyalMail, parseUps, type TrackOutcome } from "@/lib/logic/carrier-responses";
import { getCarrier, hasLiveAdapter, isMockAllowed, type CarrierKey } from "@/lib/logic/carriers";
import { fetchCarrierJson, fetchOAuthToken, tokenCache } from "./http";

/**
 * Carrier tracking adapters (spec §9.3: one interface, a registry, health).
 * Each turns a tracking number into a TrackOutcome; parsing lives in
 * src/lib/logic/carrier-responses.ts. A carrier with no credentials returns
 * "unsupported" — never a crash (non-negotiable 5). Adding a carrier is one
 * new adapter here and one parser, nothing else.
 */

export interface TrackRequest {
  trackingNumber: string;
  /** When the shipment was added to COAST (the test carrier's clock starts here). */
  addedAt: Date;
  now: Date;
}

export interface CarrierAdapter {
  key: CarrierKey;
  /** Credentials present (health with live results is in src/lib/logic/carriers.ts). */
  configured(): boolean;
  track(request: TrackRequest): Promise<TrackOutcome>;
}

const env = (name: string) => process.env[name]?.trim() || "";
const allSet = (key: CarrierKey) => getCarrier(key).env.every((n) => env(n) !== "");

// ── DHL: one API key in a header ────────────────────────────────────────────
// UNVERIFIED: endpoint and header from developer.dhl.com (Shipment Tracking – Unified); not yet run against a live key.
const dhl: CarrierAdapter = {
  key: "dhl",
  configured: () => allSet("dhl"),
  async track({ trackingNumber }) {
    const url = `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}&language=en`;
    const r = await fetchCarrierJson(url, { headers: { "DHL-API-Key": env("DHL_API_KEY"), Accept: "application/json" } });
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
    configured: () => allSet("fedex"),
    async track({ trackingNumber }) {
      const token = await fedexToken.get(() =>
        fetchOAuthToken(`${FEDEX_BASE}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("FEDEX_CLIENT_ID"), client_secret: env("FEDEX_CLIENT_SECRET") }),
        }),
      );
      if (!token) return failure("auth");
      const r = await fetchCarrierJson(`${FEDEX_BASE}/track/v1/trackingnumbers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-locale": "en_GB" },
        body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }),
      });
      if (!r.ok && r.outcome.ok === false && r.outcome.kind === "auth") fedexToken.clear();
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
  configured: () => allSet("ups"),
  async track({ trackingNumber }) {
    const basic = Buffer.from(`${env("UPS_CLIENT_ID")}:${env("UPS_CLIENT_SECRET")}`).toString("base64");
    const token = await upsToken.get(() =>
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
    if (!r.ok && r.outcome.ok === false && r.outcome.kind === "auth") upsToken.clear();
    return r.ok ? parseUps(r.body) : r.outcome;
  },
};

// ── Royal Mail / Parcelforce: IBM API Connect client id + secret ────────────
// UNVERIFIED: best-effort reconstruction of Royal Mail Group's Tracking API v2. Shown as "beta".
const royalMail: CarrierAdapter = {
  key: "royal_mail",
  configured: () => allSet("royal_mail"),
  async track({ trackingNumber }) {
    const r = await fetchCarrierJson(`https://api.royalmail.net/mailpieces/v2/${encodeURIComponent(trackingNumber)}/events`, {
      headers: {
        "X-IBM-Client-Id": env("ROYAL_MAIL_CLIENT_ID"),
        "X-IBM-Client-Secret": env("ROYAL_MAIL_CLIENT_SECRET"),
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
  configured: () => isMockAllowed(process.env.COAST_ENV),
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

/** The adapter for a carrier, when COAST can check it by itself right now. */
export function carrierAdapter(key: CarrierKey): CarrierAdapter | null {
  if (!hasLiveAdapter(key)) return null;
  const adapter = ADAPTERS[key];
  return adapter && adapter.configured() ? adapter : null;
}

/** Carriers ready to be polled in this environment. */
export function liveCarriers(): CarrierKey[] {
  return (Object.keys(ADAPTERS) as CarrierKey[]).filter((k) => carrierAdapter(k) !== null);
}
