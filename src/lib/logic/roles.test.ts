import { describe, expect, it } from "vitest";
import { STAFF_ROLES, can, isReadOnlyRole, isStaffRole, type Capability } from "./roles";

const MUTATIONS: Capability[] = ["orders.edit", "procurement.manage", "settings.edit", "team.manage", "goods_in.check"];

describe("isStaffRole", () => {
  it.each(STAFF_ROLES)("accepts %s", (role) => expect(isStaffRole(role)).toBe(true));
  it.each([undefined, null, "", "Admin", "customer", "supplier", 1, {}])("rejects %s", (value) => {
    expect(isStaffRole(value)).toBe(false);
  });
});

describe("can", () => {
  it("gives admin every capability", () => {
    for (const c of [...MUTATIONS, "supplier.identity.view", "costs.view", "settings.view"] as Capability[]) {
      expect(can("admin", c)).toBe(true);
    }
  });

  it("never lets a director change anything", () => {
    for (const c of MUTATIONS) expect(can("director", c)).toBe(false);
    expect(isReadOnlyRole("director")).toBe(true);
  });

  it("lets a director see supplier identity, costs and settings", () => {
    expect(can("director", "supplier.identity.view")).toBe(true);
    expect(can("director", "costs.view")).toBe(true);
    expect(can("director", "settings.view")).toBe(true);
  });

  it("hides supplier identity and costs from sales (C4)", () => {
    expect(can("sales", "supplier.identity.view")).toBe(false);
    expect(can("sales", "costs.view")).toBe(false);
  });

  it("keeps procurement out of settings and team", () => {
    expect(can("procurement", "settings.view")).toBe(false);
    expect(can("procurement", "team.manage")).toBe(false);
    expect(can("procurement", "procurement.manage")).toBe(true);
  });

  it("limits goods-in to checking deliveries", () => {
    for (const c of ["orders.edit", "procurement.manage", "supplier.identity.view", "costs.view", "settings.view"] as Capability[]) {
      expect(can("goods_in", c)).toBe(false);
    }
    expect(can("goods_in", "goods_in.check")).toBe(true);
  });

  it("treats only director as a read-only role", () => {
    expect(STAFF_ROLES.filter(isReadOnlyRole)).toEqual(["director"]);
  });
});
