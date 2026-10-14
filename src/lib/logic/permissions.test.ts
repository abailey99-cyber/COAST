import { describe, expect, it } from "vitest";
import {
  CONFIGURABLE_ROLES,
  DEFAULT_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  hasPermission,
  isPermission,
  isViewOnly,
  resolvePermissions,
  type Permission,
} from "./permissions";
import { STAFF_ROLES } from "./roles";

const defaults = (role: Parameters<typeof resolvePermissions>[0]) => resolvePermissions(role, DEFAULT_PERMISSIONS[role]);
const ACTIONS = PERMISSIONS.filter((p) => p.group === "Actions").map((p) => p.key);

describe("permission list", () => {
  it("has unique keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("only uses known keys in the defaults", () => {
    for (const role of STAFF_ROLES) for (const k of DEFAULT_PERMISSIONS[role]) expect(isPermission(k)).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isPermission("section.nope")).toBe(false);
    expect(isPermission(undefined)).toBe(false);
  });
});

describe("resolvePermissions", () => {
  it("always gives admin everything, whatever is stored", () => {
    expect(resolvePermissions("admin", []).size).toBe(PERMISSION_KEYS.length);
  });

  it("denies anything not granted", () => {
    const p = resolvePermissions("sales", ["section.orders"]);
    expect(hasPermission(p, "section.orders")).toBe(true);
    expect(hasPermission(p, "costs.view")).toBe(false);
  });

  it("ignores unknown keys from storage", () => {
    expect([...resolvePermissions("sales", ["section.orders", "made.up"])]).toEqual(["section.orders"]);
  });

  it("admin isn't a configurable role", () => {
    expect(CONFIGURABLE_ROLES).not.toContain("admin");
    expect(CONFIGURABLE_ROLES).toHaveLength(STAFF_ROLES.length - 1);
  });
});

describe("defaults (product-owner decisions E1–E3)", () => {
  it("lets everyone open Settings, but only admin change settings by default", () => {
    for (const role of STAFF_ROLES) expect(hasPermission(defaults(role), "section.settings")).toBe(true);
    for (const role of CONFIGURABLE_ROLES) expect(hasPermission(defaults(role), "settings.edit")).toBe(false);
  });

  it("lets sales see every order, supplier names and costs, but not edit", () => {
    const s = defaults("sales");
    for (const k of ["orders.view_all", "supplier.identity.view", "costs.view"] as Permission[]) expect(hasPermission(s, k)).toBe(true);
    for (const k of ACTIONS) expect(hasPermission(s, k)).toBe(false);
  });

  it("makes directors see everything but change nothing", () => {
    const d = defaults("director");
    for (const p of PERMISSIONS.filter((x) => x.group !== "Actions")) expect(hasPermission(d, p.key)).toBe(true);
    expect(isViewOnly(d)).toBe(true);
  });

  it("gives procurement the procurement actions", () => {
    const p = defaults("procurement");
    expect(hasPermission(p, "procurement.manage")).toBe(true);
    expect(hasPermission(p, "orders.edit")).toBe(true);
  });

  it("keeps goods-in focused: Goods-in screen, check-in, no costs", () => {
    const g = defaults("goods_in");
    expect(hasPermission(g, "section.goods-in")).toBe(true);
    expect(hasPermission(g, "goods_in.check")).toBe(true);
    expect(hasPermission(g, "costs.view")).toBe(false);
    expect(hasPermission(g, "section.orders")).toBe(false);
  });
});

describe("isViewOnly", () => {
  it("is true with no action permissions and false with any", () => {
    expect(isViewOnly(new Set())).toBe(true);
    expect(isViewOnly(new Set<Permission>(["costs.view"]))).toBe(true);
    expect(isViewOnly(new Set<Permission>(["orders.edit"]))).toBe(false);
  });
});
