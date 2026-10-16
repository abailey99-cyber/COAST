/**
 * The carriers COAST knows (spec §5.2, docs/integrations/carrier-tracking.md).
 * One list drives the shipment form, the poll job's pacing and the carrier
 * connections screen. Pure: environment values are passed in.
 */

import type { Health } from "./health";
import type { CredentialProvider } from "./integrations";

export const CARRIER_KEYS = ["dhl", "fedex", "tnt", "ups", "royal_mail", "dpd", "evri", "yodel", "other", "unknown", "mock"] as const;
export type CarrierKey = (typeof CARRIER_KEYS)[number];

export function isCarrierKey(value: unknown): value is CarrierKey {
  return typeof value === "string" && (CARRIER_KEYS as readonly string[]).includes(value);
}

/**
 * public      — built against the carrier's public developer documentation
 * best_effort — no open documentation; needs a correction pass once an account exists (shown as "beta")
 * none        — no live tracking (own van, a courier without an API, or not known yet)
 * test        — the mock carrier, for development and tests only
 */
export type CarrierConfidence = "public" | "best_effort" | "none" | "test";

export interface Pacing {
  /** Calls allowed per day across the whole platform; null when the carrier sets no small limit. */
  dailyLimit: number | null;
  /** Minimum gap between two calls, in milliseconds. */
  minGapMs: number;
  /** Most calls one poll run makes (a run must finish inside the hosting time limit). */
  maxPerRun: number;
}

export interface CarrierDef {
  key: CarrierKey;
  label: string;
  /** Initials for the monogram tile (real logos need permission — decisions D). */
  monogram: string;
  confidence: CarrierConfidence;
  /**
   * Whose credentials switch on live tracking: the organisation connects its
   * own account in Settings → Integrations (readiness Task 2). None = no
   * credentials possible (or needed, for the test carrier).
   */
  provider?: CredentialProvider;
  /** Another carrier whose credentials and API this one uses. */
  via?: CarrierKey;
  pacing: Pacing;
  /** Public tracking page, for staff. Never shown to a customer for a direct shipment (masking). */
  trackingUrl?: (trackingNumber: string) => string;
}

const enc = encodeURIComponent;
const NO_PACING: Pacing = { dailyLimit: 0, minGapMs: 0, maxPerRun: 0 };

export const CARRIERS: readonly CarrierDef[] = [
  {
    key: "dhl",
    label: "DHL Express",
    monogram: "DHL",
    confidence: "public",
    provider: "dhl",
    // DHL's free tier: 250 calls a day, no more than one every 5 seconds.
    pacing: { dailyLimit: 250, minGapMs: 5_000, maxPerRun: 9 },
    trackingUrl: (n) => `https://www.dhl.com/gb-en/home/tracking.html?tracking-id=${enc(n)}`,
  },
  {
    key: "fedex",
    label: "FedEx",
    monogram: "FX",
    confidence: "public",
    provider: "fedex",
    pacing: { dailyLimit: null, minGapMs: 500, maxPerRun: 40 },
    trackingUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}`,
  },
  {
    key: "tnt",
    label: "TNT",
    monogram: "TNT",
    confidence: "public",
    provider: "fedex",
    via: "fedex",
    pacing: { dailyLimit: null, minGapMs: 500, maxPerRun: 20 },
    trackingUrl: (n) => `https://www.tnt.com/express/en_gb/site/shipping-tools/tracking.html?searchType=con&cons=${enc(n)}`,
  },
  {
    key: "ups",
    label: "UPS",
    monogram: "UPS",
    confidence: "public",
    provider: "ups",
    pacing: { dailyLimit: null, minGapMs: 500, maxPerRun: 40 },
    trackingUrl: (n) => `https://www.ups.com/track?tracknum=${enc(n)}`,
  },
  {
    key: "royal_mail",
    label: "Royal Mail / Parcelforce",
    monogram: "RM",
    confidence: "best_effort",
    provider: "royal_mail",
    pacing: { dailyLimit: null, minGapMs: 1_000, maxPerRun: 20 },
    trackingUrl: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${enc(n)}`,
  },
  { key: "dpd", label: "DPD", monogram: "DPD", confidence: "best_effort", pacing: NO_PACING },
  { key: "evri", label: "Evri", monogram: "EV", confidence: "best_effort", pacing: NO_PACING },
  { key: "yodel", label: "Yodel", monogram: "YO", confidence: "best_effort", pacing: NO_PACING },
  { key: "other", label: "Other / own delivery", monogram: "—", confidence: "none", pacing: NO_PACING },
  { key: "unknown", label: "Carrier not known yet", monogram: "?", confidence: "none", pacing: NO_PACING },
  { key: "mock", label: "Test carrier", monogram: "T", confidence: "test", pacing: { dailyLimit: null, minGapMs: 0, maxPerRun: 100 } },
];

export function getCarrier(key: CarrierKey): CarrierDef {
  const def = CARRIERS.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown carrier: ${key}`);
  return def;
}

/** The test carrier never appears in production. */
export function isMockAllowed(coastEnv: string | undefined): boolean {
  return coastEnv !== "production";
}

/** Carriers staff can pick for a new shipment. */
export function selectableCarriers(coastEnv: string | undefined): CarrierDef[] {
  return CARRIERS.filter((c) => c.key !== "mock" || isMockAllowed(coastEnv));
}

/** Carriers COAST can (or one day could) check by itself — the connections screen lists these. */
export function trackableCarriers(coastEnv: string | undefined): CarrierDef[] {
  return CARRIERS.filter((c) => c.confidence === "public" || c.confidence === "best_effort" || (c.confidence === "test" && isMockAllowed(coastEnv)));
}

/**
 * A suggestion for the shipment form — only for shapes that belong to one
 * carrier. Anything ambiguous returns null and staff choose.
 */
export function guessCarrier(trackingNumber: string): CarrierKey | null {
  const n = trackingNumber.replace(/\s+/g, "").toUpperCase();
  if (/^MOCK-/.test(n)) return "mock";
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  if (/^[A-Z]{2}\d{9}GB$/.test(n)) return "royal_mail";
  if (/^\d{10}$/.test(n)) return "dhl";
  if (/^(\d{12}|\d{15}|\d{20}|\d{22})$/.test(n)) return "fedex";
  return null;
}

// ── Health (non-negotiable 5) ───────────────────────────────────────────────


export type CarrierErrorKind = "auth" | "rate_limited" | "unavailable" | "bad_response" | "unsupported";

export interface CarrierActivity {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorKind: CarrierErrorKind | null;
  consecutiveFailures: number;
  /** Calls made today against a daily limit. */
  callsToday: number;
}

export const NO_ACTIVITY: CarrierActivity = { lastSuccessAt: null, lastErrorAt: null, lastErrorKind: null, consecutiveFailures: 0, callsToday: 0 };

/** Does this carrier have a working adapter in this build? */
export function hasLiveAdapter(key: CarrierKey): boolean {
  return key === "dhl" || key === "fedex" || key === "tnt" || key === "ups" || key === "royal_mail" || key === "mock";
}

/**
 * One carrier's connection health for the settings screen. Credentials
 * missing → "unconfigured", never an error. Configured → judged on what the
 * last checks actually did.
 */
export function carrierHealth(def: CarrierDef, connected: boolean, activity: CarrierActivity = NO_ACTIVITY): Health {
  if (def.confidence === "none") return { status: "unconfigured", reason: "No live tracking for this option." };
  if (def.confidence === "test") return { status: "ok", reason: "Test carrier for development: invents tracking from the tracking number." };

  const via = def.via ? ` (uses the ${getCarrier(def.via).label} connection)` : "";
  if (!def.provider) {
    return { status: "unconfigured", reason: `${def.label} hasn't published a tracking API, so live checks wait for their integration pack. Update these shipments by hand.` };
  }
  if (!connected) return { status: "unconfigured", reason: `Not connected. An admin can connect your own ${def.label} account in Settings → Integrations${via}.` };

  if (!hasLiveAdapter(def.key)) {
    return { status: "warn", reason: `Beta: ${def.label} hasn't published its tracking API, so live checks wait for their integration pack.` };
  }

  const beta = def.confidence === "best_effort" ? "Beta: built without a live account, so expect a correction pass. " : "";
  if (activity.lastErrorKind === "auth" && activity.consecutiveFailures > 0) {
    return { status: "error", reason: `${beta}${def.label} turned down the credentials. Check them in Settings → Integrations.` };
  }
  if (activity.consecutiveFailures >= 3) {
    return { status: "error", reason: `${beta}The last ${activity.consecutiveFailures} checks failed. COAST is backing off and will keep trying.` };
  }
  if (def.pacing.dailyLimit !== null && activity.callsToday >= def.pacing.dailyLimit) {
    return { status: "warn", reason: `${beta}Today's limit of ${def.pacing.dailyLimit} checks is used up. Checks start again tomorrow.` };
  }
  if (activity.consecutiveFailures > 0) {
    const why = activity.lastErrorKind === "rate_limited" ? "asked COAST to slow down" : "didn't answer properly";
    return { status: "warn", reason: `${beta}${def.label} ${why} on the last check. COAST will try again.` };
  }
  if (!activity.lastSuccessAt) return { status: "ok", reason: `${beta}Set up. No shipments checked yet${via}.` };
  return { status: def.confidence === "best_effort" ? "warn" : "ok", reason: `${beta}Working${via}.` };
}
