import { describe, expect, it } from "vitest";
import { SECTIONS, activeSectionKey, canAccessSection, getSection, visibleSections } from "./navigation";
import { DEFAULT_PERMISSIONS, resolvePermissions, type Permission } from "./permissions";
import { STAFF_ROLES, type StaffRole } from "./roles";

const perms = (role: StaffRole) => resolvePermissions(role, DEFAULT_PERMISSIONS[role]);
const keys = (role: StaffRole) => visibleSections(perms(role)).map((s) => s.key);

describe("visibleSections with default permissions", () => {
  it.each(STAFF_ROLES)("puts Home first and shows Settings for %s", (role) => {
    expect(keys(role)[0]).toBe("home");
    expect(keys(role)).toContain("settings");
  });

  it("shows goods-in staff Home, Goods-in and Settings", () => {
    expect(keys("goods_in")).toEqual(["home", "goods-in", "settings"]);
  });

  it("shows sales Orders, Chases, Delivery problems, Updates, Metrics and Settings", () => {
    expect(keys("sales")).toEqual(["home", "orders", "chases", "problems", "updates", "metrics", "settings"]);
  });

  it.each(["admin", "director", "procurement"] as const)("shows %s every section", (role) => {
    expect(keys(role)).toEqual(SECTIONS.map((s) => s.key));
  });
});

describe("visibleSections with custom permissions", () => {
  it("always shows Home, even with nothing granted", () => {
    expect(visibleSections(new Set()).map((s) => s.key)).toEqual(["home"]);
  });

  it("follows exactly what the admin switched on", () => {
    const custom = new Set<Permission>(["section.suppliers", "section.metrics"]);
    expect(visibleSections(custom).map((s) => s.key)).toEqual(["home", "suppliers", "metrics"]);
  });
});

describe("canAccessSection", () => {
  it("matches the sidebar for every role and section", () => {
    for (const role of STAFF_ROLES) {
      for (const s of SECTIONS) expect(canAccessSection(perms(role), s.key)).toBe(keys(role).includes(s.key));
    }
  });
});

describe("getSection", () => {
  it("throws on an unknown key", () => {
    // @ts-expect-error deliberately invalid
    expect(() => getSection("nope")).toThrow();
  });
});

describe("activeSectionKey", () => {
  it.each([
    ["/app/orders", "orders"],
    ["/app/orders/SO-10421", "orders"],
    ["/app/settings/team", "settings"],
    ["/app/home", "home"],
  ])("%s → %s", (path, key) => expect(activeSectionKey(path)).toBe(key));

  it.each(["/", "/app", "/app/ordersx", "/sign-in"])("returns null for %s", (path) => {
    expect(activeSectionKey(path)).toBeNull();
  });
});

describe("section table", () => {
  it("has unique keys and hrefs under /app, and a permission for every section but Home", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.href)).size).toBe(SECTIONS.length);
    for (const s of SECTIONS) {
      expect(s.href.startsWith("/app/")).toBe(true);
      expect(s.permission === null).toBe(s.key === "home");
    }
  });
});
