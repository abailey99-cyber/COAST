import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AggregatorEvent, ProviderMapping } from "@/lib/logic/aggregator";
import { mockTrack } from "@/lib/logic/carrier-responses";
import { isMockAllowed } from "@/lib/logic/carriers";
import type { Health } from "@/lib/logic/health";

/**
 * The tracking aggregator (readiness plan Task 4). One provider for all of
 * COAST, priced per shipment; which one is a setting (AGGREGATOR_PROVIDER).
 * Everything provider-specific lives in its own entry below: how to
 * register a tracking number, check it, verify and read its webhooks, and its
 * mapping of carrier and status codes. Adding the founder's chosen provider
 * is one more entry here — nothing else changes.
 */

export interface AggregatorProvider {
  key: string;
  label: string;
  mapping: ProviderMapping;
  /** Sends updates by webhook (otherwise COAST checks adaptively). */
  webhooks: boolean;
  /** Ready to use in this environment (keys present). */
  configured(): boolean;
  register(trackingNumber: string, carrierHint: string | null): Promise<{ ok: true; ref: string } | { ok: false; error: string }>;
  check(ref: string, trackingNumber: string, registeredAt: Date, now: Date): Promise<{ ok: true; events: AggregatorEvent[] } | { ok: false; error: string }>;
  /** True only for a request the provider really signed. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string): AggregatorEvent[];
}

const env = (n: string) => process.env[n]?.trim() || "";

/** HMAC-SHA256 of the raw body, hex, compared in constant time. */
export function hmacMatches(secret: string, rawBody: string, signature: string | null): boolean {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Codes shared by the stand-in provider. A real provider brings its own. */
const STANDARD_MAPPING: ProviderMapping = {
  carriers: { dhl: "dhl", "dhl-express": "dhl", fedex: "fedex", tnt: "tnt", ups: "ups", "royal-mail": "royal_mail", parcelforce: "royal_mail", dpd: "dpd", evri: "evri", yodel: "yodel" },
  statuses: { pre_transit: "pre_transit", info_received: "pre_transit", in_transit: "in_transit", out_for_delivery: "out_for_delivery", delivered: "delivered", exception: "exception", failed_attempt: "exception" },
};

interface StandardWebhook {
  events?: { id?: unknown; tracking_number?: unknown; carrier?: unknown; status?: unknown; description?: unknown; occurred_at?: unknown; location?: unknown; eta_from?: unknown; eta_to?: unknown }[];
}
const s = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * The stand-in provider for development and tests (never in production):
 * registration always works, checks invent progress from the tracking
 * number like the test carrier, and webhooks are signed with
 * AGGREGATOR_WEBHOOK_SECRET in a simple JSON shape.
 */
const mockProvider: AggregatorProvider = {
  key: "mock",
  label: "Test aggregator",
  mapping: STANDARD_MAPPING,
  webhooks: true,
  configured: () => isMockAllowed(process.env.COAST_ENV),
  register: async (trackingNumber) => ({ ok: true, ref: `mock:${trackingNumber}` }),
  async check(_ref, trackingNumber, registeredAt, now) {
    const t = mockTrack(`MOCK-${trackingNumber.replace(/^MOCK-/i, "")}`, registeredAt, now);
    if (!t.ok) return { ok: false, error: t.message };
    return {
      ok: true,
      events: t.snapshot.events.map((e) => ({ eventId: `${e.occurredAt}|${e.status}`, trackingNumber, carrierCode: null, statusCode: e.status, description: e.description, occurredAt: e.occurredAt, location: e.location, estimatedFrom: t.snapshot.estimatedFrom, estimatedTo: t.snapshot.estimatedTo })),
    };
  },
  verifyWebhook: (rawBody, headers) => hmacMatches(env("AGGREGATOR_WEBHOOK_SECRET"), rawBody, headers.get("x-aggregator-signature")),
  parseWebhook(rawBody) {
    let body: StandardWebhook;
    try {
      body = JSON.parse(rawBody) as StandardWebhook;
    } catch {
      return [];
    }
    return (body.events ?? []).slice(0, 500).flatMap((e) => {
      const trackingNumber = s(e.tracking_number);
      const occurredAt = s(e.occurred_at);
      const statusCode = s(e.status);
      if (!trackingNumber || !occurredAt || !statusCode) return [];
      return [{ eventId: s(e.id) ?? `${occurredAt}|${statusCode}`, trackingNumber, carrierCode: s(e.carrier), statusCode, description: (s(e.description) ?? statusCode).slice(0, 500), occurredAt, location: s(e.location), estimatedFrom: s(e.eta_from), estimatedTo: s(e.eta_to) }];
    });
  },
};

// The founder's chosen provider is added here (decision pending, readiness Task 4).
const PROVIDERS: Record<string, AggregatorProvider> = { mock: mockProvider };

/** The aggregator in use here, or null (shipments then use an organisation's own carrier account, or are updated by hand). */
export function aggregator(): AggregatorProvider | null {
  const p = PROVIDERS[env("AGGREGATOR_PROVIDER")];
  return p && p.configured() ? p : null;
}

/** For one provider by key (webhook route). */
export function aggregatorByKey(key: string): AggregatorProvider | null {
  const p = aggregator();
  return p && p.key === key ? p : null;
}

/** What one registration costs, in pence (DEFAULT — CONFIRM: set to the chosen provider's price). */
export function costPerShipmentMinor(): number {
  const n = Number(env("AGGREGATOR_COST_PER_SHIPMENT_MINOR"));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 5;
}

export function aggregatorHealth(lastError: string | null): Health {
  const name = env("AGGREGATOR_PROVIDER");
  if (!name) return { status: "unconfigured", reason: "No tracking aggregator chosen yet (AGGREGATOR_PROVIDER). Shipments use your own carrier accounts, or are updated by hand." };
  const p = aggregator();
  if (!p) return { status: "unconfigured", reason: `The ${name} aggregator isn't available here (missing its keys${name === "mock" ? ", or this is production" : ""}).` };
  if (lastError) return { status: "warn", reason: `${p.label}: ${lastError}` };
  return { status: p.key === "mock" ? "warn" : "ok", reason: p.key === "mock" ? "Test aggregator: invents tracking for development." : `${p.label}: working.` };
}
