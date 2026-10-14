import { describe, expect, it } from "vitest";
import {
  CONFIGURABLE_ROLES,
  DEFAULT_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  canManagePersonAccess,
  grantablePermissions,
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

describe("per-person overrides", () => {
  it("adds and blocks on top of the role", () => {
    const p = resolvePermissions("sales", DEFAULT_PERMISSIONS.sales, [
      { permission: "section.suppliers", granted: true },
      { permission: "costs.view", granted: false },
    ]);
    expect(hasPermission(p, "section.suppliers")).toBe(true);
    expect(hasPermission(p, "costs.view")).toBe(false);
    expect(hasPermission(p, "orders.view_all")).toBe(true);
  });

  it("ignores unknown keys in overrides", () => {
    const p = resolvePermissions("sales", [], [{ permission: "made.up", granted: true }]);
    expect(p.size).toBe(0);
  });

  it("never reduces an admin", () => {
    const p = resolvePermissions("admin", [], [{ permission: "costs.view", granted: false }]);
    expect(hasPermission(p, "costs.view")).toBe(true);
  });
});

describe("canManagePersonAccess (E7)", () => {
  const admin = { id: "a", role: "admin" as const, permissions: resolvePermissions("admin", []) };
  const manager = { id: "m", role: "sales_manager" as const, permissions: resolvePermissions("sales_manager", DEFAULT_PERMISSIONS.sales_manager) };
  const rep = { id: "r", role: "sales" as const, permissions: resolvePermissions("sales", DEFAULT_PERMISSIONS.sales) };

  it("lets admins change anyone except admins and themselves", () => {
    expect(canManagePersonAccess(admin, { id: "r", role: "sales" })).toBe(true);
    expect(canManagePersonAccess(admin, { id: "p", role: "procurement" })).toBe(true);
    expect(canManagePersonAccess(admin, { id: "m", role: "sales_manager" })).toBe(true);
    expect(canManagePersonAccess(admin, { id: "a2", role: "admin" })).toBe(false);
    expect(canManagePersonAccess(admin, { id: "a", role: "admin" })).toBe(false);
  });

  it("lets a sales manager change sales reps only", () => {
    expect(canManagePersonAccess(manager, { id: "r", role: "sales" })).toBe(true);
    for (const role of ["procurement", "director", "goods_in", "sales_manager", "admin"] as const) {
      expect(canManagePersonAccess(manager, { id: "x", role })).toBe(false);
    }
  });

  it("stops a sales manager changing their own access", () => {
    expect(canManagePersonAccess({ ...manager, role: "sales_manager" }, { id: "m", role: "sales_manager" })).toBe(false);
  });

  it("gives a plain sales rep no say over anyone", () => {
    expect(canManagePersonAccess(rep, { id: "r2", role: "sales" })).toBe(false);
  });

  it("follows the permission, not the role name", () => {
    const managerWithoutPower = { ...manager, permissions: resolvePermissions("sales_manager", DEFAULT_PERMISSIONS.sales) };
    expect(canManagePersonAccess(managerWithoutPower, { id: "r", role: "sales" })).toBe(false);
  });
});

describe("grantablePermissions (E7)", () => {
  it("lets admins switch everything", () => {
    expect(grantablePermissions({ id: "a", role: "admin", permissions: resolvePermissions("admin", []) })).toHaveLength(PERMISSION_KEYS.length);
  });

  it("limits a sales manager to what they hold, minus managing others", () => {
    const manager = { id: "m", role: "sales_manager" as const, permissions: resolvePermissions("sales_manager", DEFAULT_PERMISSIONS.sales_manager) };
    const g = grantablePermissions(manager);
    expect(g).toContain("costs.view");
    expect(g).not.toContain("orders.edit");
    expect(g).not.toContain("procurement.manage");
    expect(g).not.toContain("people.manage_sales");
  });
});

describe("sales manager defaults (E7)", () => {
  it("is everything sales has, plus managing reps", () => {
    expect([...DEFAULT_PERMISSIONS.sales_manager].sort()).toEqual([...DEFAULT_PERMISSIONS.sales, "people.manage_sales"].sort());
  });

  it("is a configurable role", () => {
    expect(CONFIGURABLE_ROLES).toContain("sales_manager");
  });
});
