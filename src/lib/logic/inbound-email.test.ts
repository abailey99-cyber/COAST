import { describe, expect, it } from "vitest";
import {
  autoApplyBlockers,
  bareAddress,
  checkForwarder,
  exchangeScopingCommands,
  inboundLocalPart,
  isKnownSender,
  normaliseDomain,
  parseAuthResults,
  webhookFresh,
  type AutoApplyInput,
} from "./inbound-email";

const LOCAL = "r-0123456789abcdef0123456789abcd";
const PASS = { spf: "pass", dkim: "pass", dmarc: "pass" } as const;
const ok: AutoApplyInput = { mode: "m365", auth: PASS, senderKnown: true, provenAnswers: 5, mentionsPriceOrQuantity: false };

describe("inbound addresses", () => {
  it("only recognises a COAST address on COAST's own domain", () => {
    expect(inboundLocalPart(`${LOCAL}@replies.coast.test`, "replies.coast.test")).toBe(LOCAL);
    expect(inboundLocalPart(`${LOCAL.toUpperCase()}@REPLIES.coast.test`, "replies.coast.test")).toBe(LOCAL);
    expect(inboundLocalPart(`${LOCAL}@evil.test`, "replies.coast.test")).toBeNull();
    expect(inboundLocalPart("r-guess@replies.coast.test", "replies.coast.test")).toBeNull();
  });
  it("tidies forwarding domains", () => {
    expect(normaliseDomain(" @YourCo.co.uk ")).toBe("yourco.co.uk");
    expect(normaliseDomain("")).toBeNull();
    expect(normaliseDomain("not a domain")).toBe("invalid");
  });
  it("reads a bare address", () => {
    expect(bareAddress("Jo Bloggs <Jo@Supplier.test>")).toBe("jo@supplier.test");
    expect(bareAddress("jo@supplier.test")).toBe("jo@supplier.test");
    expect(bareAddress("nobody")).toBeNull();
  });
});

describe("forwarded mail must come through the organisation's own mailbox", () => {
  const allowed = ["yourco.co.uk"];
  it("accepts the SRS-rewritten envelope sender from the organisation's domain", () => {
    expect(checkForwarder({ envelopeSender: "SRS0=Ab12=QZ=supplier.test=jo@yourco.co.uk", headers: [], allowedDomains: allowed }).ok).toBe(true);
    expect(checkForwarder({ envelopeSender: "bounces@mail.yourco.co.uk", headers: [], allowedDomains: allowed }).ok).toBe(true);
  });
  it("accepts a forwarding header from the organisation's domain", () => {
    expect(checkForwarder({ envelopeSender: "jo@supplier.test", headers: [["X-Forwarded-For", "purchasing@yourco.co.uk po@coast.test"]], allowedDomains: allowed }).ok).toBe(true);
  });
  it("holds back mail sent straight to the address, or forwarded from elsewhere", () => {
    expect(checkForwarder({ envelopeSender: "jo@supplier.test", headers: [], allowedDomains: allowed })).toMatchObject({ ok: false, reason: expect.stringMatching(/held back/) });
    expect(checkForwarder({ envelopeSender: "x@yourco.co.uk.evil.test", headers: [], allowedDomains: allowed }).ok).toBe(false);
    expect(checkForwarder({ envelopeSender: "x@notyourco.co.uk", headers: [], allowedDomains: allowed }).ok).toBe(false);
    expect(checkForwarder({ envelopeSender: "x@yourco.co.uk", headers: [], allowedDomains: [] }).ok).toBe(false);
  });
});

describe("sender authentication", () => {
  it("reads the topmost Authentication-Results header", () => {
    expect(parseAuthResults([["Authentication-Results", "mx.microsoft.com; spf=pass smtp.mailfrom=supplier.test; dkim=pass header.d=supplier.test; dmarc=pass action=none"]])).toEqual(PASS);
    expect(parseAuthResults([["Authentication-Results", "spf=softfail; dkim=none; dmarc=fail"]])).toEqual({ spf: "fail", dkim: "none", dmarc: "fail" });
  });
  it("treats anything missing as unknown, never as a pass", () => {
    expect(parseAuthResults([])).toEqual({ spf: "unknown", dkim: "unknown", dmarc: "unknown" });
    expect(parseAuthResults([["Authentication-Results", "spf=pass"]])).toEqual({ spf: "pass", dkim: "unknown", dmarc: "unknown" });
  });
});

describe("auto-applying a date (Microsoft 365 only)", () => {
  it("allows it only when every rule passes", () => {
    expect(autoApplyBlockers(ok)).toEqual([]);
  });
  it("never auto-applies forwarded mail", () => {
    expect(autoApplyBlockers({ ...ok, mode: "forward" })).toEqual(["Forwarded email: always checked by a person."]);
  });
  it("stops a spoofed sender or a DMARC failure", () => {
    expect(autoApplyBlockers({ ...ok, auth: { ...PASS, dmarc: "fail" } })).toEqual(["The sender's DMARC check didn't pass."]);
    expect(autoApplyBlockers({ ...ok, auth: { spf: "fail", dkim: "unknown", dmarc: "fail" } })[0]).toMatch(/SPF, DKIM, DMARC checks didn't pass/);
  });
  it("stops an unknown sender, even with perfect authentication", () => {
    expect(autoApplyBlockers({ ...ok, senderKnown: false })).toEqual(["It isn't from an address COAST knows for this supplier."]);
  });
  it("waits until the supplier's emails are proven", () => {
    expect(autoApplyBlockers({ ...ok, provenAnswers: 2 })[0]).toMatch(/3 clean answers/);
  });
  it("never auto-applies a price or quantity", () => {
    expect(autoApplyBlockers({ ...ok, mentionsPriceOrQuantity: true })).toEqual(["It mentions a price or quantity, which a person always checks."]);
  });
  it("knows a supplier's contacts", () => {
    expect(isKnownSender("Jo <JO@supplier.test>", { email: "jo@supplier.test", knownSenders: [] })).toBe(true);
    expect(isKnownSender("sales@supplier.test", { email: "jo@supplier.test", knownSenders: ["sales@supplier.test"] })).toBe(true);
    expect(isKnownSender("jo@supplier.test.evil.test", { email: "jo@supplier.test", knownSenders: [] })).toBe(false);
    expect(isKnownSender(null, { email: "jo@supplier.test", knownSenders: [] })).toBe(false);
  });
});

describe("webhooks and Microsoft 365 set-up", () => {
  it("refuses stale webhooks", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(webhookFresh(String(now.getTime() / 1000 - 60), now)).toBe(true);
    expect(webhookFresh(String(now.getTime() / 1000 - 3600), now)).toBe(false);
    expect(webhookFresh("nonsense", now)).toBe(false);
  });
  it("writes the mailbox-scoping commands for the customer's own tenant", () => {
    const ps = exchangeScopingCommands({ appId: "app-id", servicePrincipalObjectId: "sp-id", mailbox: "po@yourco.co.uk" });
    expect(ps).toContain("New-ManagementScope -Name 'COAST purchasing mailbox' -RecipientRestrictionFilter \"PrimarySmtpAddress -eq 'po@yourco.co.uk'\"");
    expect(ps).toContain("-Role 'Application Mail.Read' -CustomResourceScope 'COAST purchasing mailbox'");
    expect(exchangeScopingCommands({ appId: "a", servicePrincipalObjectId: "b", mailbox: "o'neil@yourco.co.uk" })).toContain("o''neil@yourco.co.uk");
  });
});
