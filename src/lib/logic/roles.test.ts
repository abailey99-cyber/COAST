import { describe, expect, it } from "vitest";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, STAFF_ROLES, isStaffRole } from "./roles";

describe("isStaffRole", () => {
  it.each(STAFF_ROLES)("accepts %s", (role) => expect(isStaffRole(role)).toBe(true));
  it.each([undefined, null, "", "Admin", "customer", "supplier", 1, {}])("rejects %s", (value) => {
    expect(isStaffRole(value)).toBe(false);
  });
});

describe("role copy", () => {
  it("has a label and description for every role", () => {
    for (const role of STAFF_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });
});
