import { describe, expect, it } from "vitest";
import { linkExpiry, linkLifetimeProblem, linkState } from "./supplier-link";

const now = new Date("2026-10-16T12:00:00Z");
const open = { revoked: false, expiresAt: "2026-11-15T12:00:00Z", poStatus: "sent" };

describe("supplier confirmation links", () => {
  it("works until it expires, and not a moment after", () => {
    expect(linkState(open, now)).toBe("open");
    expect(linkState({ ...open, expiresAt: "2026-10-16T12:00:00Z" }, now)).toBe("expired");
    expect(linkState({ ...open, expiresAt: "2026-10-16T11:59:59Z" }, now)).toBe("expired");
    expect(linkState({ ...open, expiresAt: "not a date" }, now)).toBe("expired");
  });
  it("stops working when revoked, whatever else is true", () => {
    expect(linkState({ ...open, revoked: true }, now)).toBe("revoked");
    expect(linkState({ ...open, revoked: true, expiresAt: "2020-01-01T00:00:00Z" }, now)).toBe("revoked");
  });
  it("closes when the PO is cancelled", () => {
    expect(linkState({ ...open, poStatus: "cancelled" }, now)).toBe("closed");
  });
  it("isn't used up by being opened: the same link reads the same however often it's checked", () => {
    expect([linkState(open, now), linkState(open, now), linkState(open, now)]).toEqual(["open", "open", "open"]);
  });
  it("lasts the company's chosen number of days, within 1 to 90", () => {
    expect(linkExpiry(now, 30).toISOString()).toBe("2026-11-15T12:00:00.000Z");
    expect(linkExpiry(now, 7).toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(linkExpiry(now, 365).toISOString()).toBe(linkExpiry(now, 90).toISOString());
    expect(linkLifetimeProblem(14)).toBeNull();
    expect(linkLifetimeProblem(0)).toMatch(/1 to 90/);
    expect(linkLifetimeProblem(91)).toMatch(/1 to 90/);
  });
});
