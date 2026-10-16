import { describe, expect, it } from "vitest";
import { CARRIERS, CARRIER_KEYS, carrierHealth, directAllowed, getCarrier, guessCarrier, hasLiveAdapter, selectableCarriers, trackableCarriers } from "./carriers";

describe("carrier list", () => {
  it("has one definition per key", () => {
    expect(CARRIERS.map((c) => c.key)).toEqual([...CARRIER_KEYS]);
  });
  it("keeps DHL inside its free-tier limits: 250 a day, one per 5 seconds", () => {
    const dhl = getCarrier("dhl");
    expect(dhl.pacing.dailyLimit).toBe(250);
    expect(dhl.pacing.minGapMs).toBeGreaterThanOrEqual(5000);
    // A run must finish inside a 60-second hosting limit.
    expect(dhl.pacing.maxPerRun * dhl.pacing.minGapMs).toBeLessThanOrEqual(50_000);
  });
  it("lets TNT reuse the FedEx credentials", () => {
    expect(getCarrier("tnt").provider).toBe("fedex");
    expect(getCarrier("fedex").provider).toBe("fedex");
  });
  it("hides the test carrier in production", () => {
    expect(selectableCarriers("production").some((c) => c.key === "mock")).toBe(false);
    expect(selectableCarriers("development").some((c) => c.key === "mock")).toBe(true);
    expect(trackableCarriers("production").some((c) => c.key === "mock")).toBe(false);
  });
  it("lists only carriers COAST could check on the connections screen", () => {
    const keys = trackableCarriers("production").map((c) => c.key);
    expect(keys).toEqual(["dhl", "fedex", "tnt", "ups", "royal_mail", "dpd", "evri", "yodel"]);
  });
  it("throws for a key that doesn't exist", () => {
    expect(() => getCarrier("pigeon" as never)).toThrow();
  });
});

describe("guessCarrier", () => {
  it("recognises shapes that belong to one carrier", () => {
    expect(guessCarrier("1Z999AA10123456784")).toBe("ups");
    expect(guessCarrier("AB123456789GB")).toBe("royal_mail");
    expect(guessCarrier("1234567890")).toBe("dhl");
    expect(guessCarrier("123456789012")).toBe("fedex");
    expect(guessCarrier("mock-transit-1")).toBe("mock");
  });
  it("returns null when it can't tell", () => {
    expect(guessCarrier("ABC123")).toBeNull();
    expect(guessCarrier("12345678901234")).toBeNull();
    expect(guessCarrier("")).toBeNull();
  });
});

describe("carrierHealth", () => {
  const dhl = getCarrier("dhl");
  const ok = { lastSuccessAt: "2026-10-14T10:00:00Z", lastErrorAt: null, lastErrorKind: null, consecutiveFailures: 0, callsToday: 10 };

  it("is unconfigured, not an error, until the organisation connects its own account", () => {
    const h = carrierHealth(dhl, false);
    expect(h.status).toBe("unconfigured");
    expect(h.reason).toContain("Settings → Integrations");
  });
  it("is ok once set up, before any checks", () => {
    expect(carrierHealth(dhl, true)).toEqual({ status: "ok", reason: "Set up. No shipments checked yet." });
  });
  it("is ok when the last check worked", () => {
    expect(carrierHealth(dhl, true, ok).status).toBe("ok");
  });
  it("points to the connection when the carrier turns the credentials down", () => {
    const h = carrierHealth(dhl, true, { ...ok, lastErrorKind: "auth", consecutiveFailures: 1 });
    expect(h.status).toBe("error");
    expect(h.reason).toContain("Settings → Integrations");
  });
  it("warns after one failure and errors after three", () => {
    expect(carrierHealth(dhl, true, { ...ok, lastErrorKind: "unavailable", consecutiveFailures: 1 }).status).toBe("warn");
    expect(carrierHealth(dhl, true, { ...ok, lastErrorKind: "unavailable", consecutiveFailures: 3 }).status).toBe("error");
  });
  it("warns when today's limit is used up", () => {
    const h = carrierHealth(dhl, true, { ...ok, callsToday: 250 });
    expect(h.status).toBe("warn");
    expect(h.reason).toContain("250");
  });
  it("marks best-effort carriers as beta", () => {
    expect(carrierHealth(getCarrier("royal_mail"), true, ok)).toMatchObject({ status: "warn" });
    expect(carrierHealth(getCarrier("royal_mail"), true, ok).reason).toMatch(/^Beta/);
  });
  it("says a carrier without a public API waits for its integration pack", () => {
    const h = carrierHealth(getCarrier("dpd"), false);
    expect(h.status).toBe("unconfigured");
    expect(h.reason).toContain("integration pack");
    expect(hasLiveAdapter("dpd")).toBe(false);
  });
  it("mentions the FedEx connection for TNT", () => {
    expect(carrierHealth(getCarrier("tnt"), false).reason).toContain("FedEx");
  });
});

describe("direct connections (readiness Task 4)", () => {
  it("freezes the carriers built without their own documentation", () => {
    for (const k of ["royal_mail", "dpd", "evri", "yodel"] as const) expect(directAllowed(k, {})).toBe(false);
    expect(directAllowed("royal_mail", { COAST_ENABLE_FROZEN_CARRIERS: "true" })).toBe(true);
  });
  it("keeps UPS direct off unless switched on, and DHL and FedEx on", () => {
    expect(directAllowed("ups", {})).toBe(false);
    expect(directAllowed("ups", { COAST_ALLOW_UPS_DIRECT: "true" })).toBe(true);
    expect(directAllowed("dhl", {})).toBe(true);
    expect(directAllowed("fedex", {})).toBe(true);
  });
});
