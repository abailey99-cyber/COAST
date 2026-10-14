import { describe, expect, it } from "vitest";
import { constantTimeEqual, isAuthorisedCronRequest, passwordProblem, safeNextPath } from "./security";

describe("safeNextPath", () => {
  it.each(["/app", "/app/orders?x=1", "/auth/set-password"])("allows %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "app/orders",
    "/app\n/evil",
  ])("rejects %s", (p) => {
    expect(safeNextPath(p)).toBe("/app");
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//x", "/sign-in")).toBe("/sign-in");
  });
});

describe("constantTimeEqual", () => {
  it("compares correctly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "a")).toBe(false);
  });
});

describe("isAuthorisedCronRequest", () => {
  const secret = "s".repeat(40);

  it("accepts the right bearer token", () => {
    expect(isAuthorisedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([null, "", secret, `Bearer ${secret}x`, `bearer ${secret}`, "Bearer "])("rejects header %s", (h) => {
    expect(isAuthorisedCronRequest(h, secret)).toBe(false);
  });

  it("rejects everything when the secret is unset or too short", () => {
    expect(isAuthorisedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorisedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorisedCronRequest("Bearer short", "short")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("accepts a long matching password", () => {
    expect(passwordProblem("correct horse battery", "correct horse battery")).toBeNull();
  });

  it("rejects short, overlong and mismatched passwords", () => {
    expect(passwordProblem("short", "short")).toMatch(/12 characters/);
    expect(passwordProblem("x".repeat(129), "x".repeat(129))).toMatch(/128/);
    expect(passwordProblem("long enough pass", "long enough pasz")).toMatch(/don't match/);
  });
});
