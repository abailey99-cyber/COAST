import { describe, expect, it } from "vitest";
import { CARRIERS, SYSTEMS, carriersAnswer, checkSiteStatus, statusText, type Integration } from "./site-status";

// The website must never say Live for something not seen working (handoff §8, readiness Task 1).
describe("website integration statuses", () => {
  it("marks nothing Live or Beta that hasn't been verified", () => {
    expect(checkSiteStatus()).toEqual([]);
  });

  it("catches an unverified Live or Beta", () => {
    const bad: Integration[] = [
      { key: "x", mono: "X", name: "Example carrier", note: "", status: "live", verified: false },
      { key: "y", mono: "Y", name: "Example ERP", note: "", status: "beta", verified: false },
      { key: "z", mono: "Z", name: "Example mailbox", note: "", status: "in_development", verified: false },
    ];
    expect(checkSiteStatus(bad)).toEqual(["Example carrier is marked Live but not verified", "Example ERP is marked Beta but not verified"]);
  });

  it("keeps every carrier in development until verified, and says so in the FAQ", () => {
    for (const c of CARRIERS) if (!c.verified) expect(c.status).not.toBe("live");
    expect(carriersAnswer()).toMatch(/being verified/);
    expect(carriersAnswer()).not.toMatch(/DHL Express today/);
  });

  it("labels email reading as paste-in, and Microsoft 365, NetSuite and the aggregator as in development", () => {
    const by = Object.fromEntries(SYSTEMS.map((s) => [s.key, statusText(s)]));
    expect(by.email_reading).toBe("Live (paste-in)");
    expect(by.microsoft365).toBe("In development");
    expect(by.netsuite).toBe("In development");
    expect(by.aggregator).toBe("In development");
  });
});
