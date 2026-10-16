import { describe, expect, it } from "vitest";
import { describeSecurityEvent } from "./security-events";

const names = new Map([["u1", "[Sales rep A]"]]);

describe("the security log", () => {
  it("describes sign-ins, failures and lockouts, flagging what deserves a look", () => {
    expect(describeSecurityEvent("sign_in", { kind: "staff" })).toEqual({ text: "Signed in", attention: false });
    expect(describeSecurityEvent("sign_in_failed", { email: "j•••@example.test" })).toEqual({ text: "Failed sign-in for j•••@example.test", attention: true });
    expect(describeSecurityEvent("account_locked", { email: "j•••@example.test", minutes: 15 }).text).toMatch(/paused .* \(15 minutes\)/);
  });
  it("names people and roles", () => {
    expect(describeSecurityEvent("role_changed", { user_id: "u1", from: "sales", to: "sales_manager" }, names).text).toBe("[Sales rep A]'s role changed from Sales to Sales manager");
    expect(describeSecurityEvent("access_changed", { user_id: "u1", permission: "costs.view", granted: false, change: "insert" }, names).text).toBe("[Sales rep A]'s own access: costs.view blocked");
  });
  it("describes credential changes without any secret", () => {
    expect(describeSecurityEvent("credential_rotated", { provider: "dhl", key_version: 2 }).text).toBe("DHL credentials changed");
    expect(describeSecurityEvent("credential_decrypt_failed", { provider: "netsuite" })).toEqual({ text: "COAST couldn't read the stored NetSuite credentials", attention: true });
  });
  it("falls back to readable words for anything new", () => {
    expect(describeSecurityEvent("something_new", {}).text).toBe("something new");
  });
});
