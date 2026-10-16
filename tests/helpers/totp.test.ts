import { describe, expect, it } from "vitest";
import { totp } from "./totp";

// RFC 6238 appendix B test vector (SHA-1, secret "12345678901234567890"), last 6 digits.
describe("the test TOTP helper", () => {
  it("matches the RFC 6238 test vectors", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totp(secret, new Date(59_000))).toBe("287082");
    expect(totp(secret, new Date(1111111109_000))).toBe("081804");
    expect(totp(secret, new Date(2000000000_000))).toBe("279037");
  });
});
