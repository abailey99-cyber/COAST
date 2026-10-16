import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseKeyring } = await import("./crypto");
const { signState, verifyState } = await import("./state");

const ring = parseKeyring(`1:${randomBytes(32).toString("base64")}`);
const now = new Date("2026-10-16T12:00:00Z");

describe("signed state for the Microsoft consent round trip", () => {
  it("comes back intact", () => {
    expect(verifyState(signState({ orgId: "org-a", userId: "u1" }, ring, now), ring, now)).toMatchObject({ orgId: "org-a", userId: "u1" });
  });
  it("refuses a changed payload, another key, or an expired one", () => {
    const s = signState({ orgId: "org-a" }, ring, now);
    const [, mac] = s.split(".");
    const forged = `${Buffer.from(JSON.stringify({ orgId: "org-b", exp: 9999999999 })).toString("base64url")}.${mac}`;
    expect(verifyState(forged, ring, now)).toBeNull();
    expect(verifyState(s, parseKeyring(`1:${randomBytes(32).toString("base64")}`), now)).toBeNull();
    expect(verifyState(s, ring, new Date(now.getTime() + 16 * 60_000))).toBeNull();
    expect(verifyState("rubbish", ring, now)).toBeNull();
  });
});
