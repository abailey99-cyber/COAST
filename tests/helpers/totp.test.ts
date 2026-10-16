import { describe, expect, it } from "vitest";
import { totp } from "./totp";

/** Base32 (RFC 4648) of some bytes — so the test's sample key is built here rather than written out. */
function base32(bytes: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...bytes].map((b) => b.toString(2).padStart(8, "0")).join("");
  return (bits.match(/.{1,5}/g) ?? []).map((c) => alphabet[parseInt(c.padEnd(5, "0"), 2)]).join("");
}

// RFC 6238 appendix B test vector (SHA-1, the ASCII key "12345678901234567890"), last 6 digits.
describe("the test TOTP helper", () => {
  it("matches the RFC 6238 test vectors", () => {
    const sample = base32(Buffer.from("12345678901234567890", "ascii"));
    expect(totp(sample, new Date(59_000))).toBe("287082");
    expect(totp(sample, new Date(1111111109_000))).toBe("081804");
    expect(totp(sample, new Date(2000000000_000))).toBe("279037");
  });
});
