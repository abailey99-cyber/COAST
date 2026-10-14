import { describe, expect, it } from "vitest";
import { SECTIONS, activeSectionKey, canAccessSection, getSection, sectionsForRole } from "./navigation";
import { STAFF_ROLES } from "./roles";

const keys = (role: Parameters<typeof sectionsForRole>[0]) => sectionsForRole(role).map((s) => s.key);

describe("sectionsForRole", () => {
  it.each(STAFF_ROLES)("puts Home first for %s", (role) => {
    expect(keys(role)[0]).toBe("home");
  });

  it("shows goods-in staff only Home and Goods-in (B9)", () => {
    expect(keys("goods_in")).toEqual(["home", "goods-in"]);
  });

  it("shows sales Orders, Chases, Updates and Metrics but no supplier screens (B9, C4)", () => {
    expect(keys("sales")).toEqual(["home", "orders", "chases", "updates", "metrics"]);
  });

  it("shows admin every section", () => {
    expect(keys("admin")).toEqual(SECTIONS.map((s) => s.key));
  });

  it("shows director every section (read-only is enforced elsewhere)", () => {
    expect(keys("director")).toEqual(SECTIONS.map((s) => s.key));
  });

  it("keeps Settings away from procurement", () => {
    expect(keys("procurement")).not.toContain("settings");
  });
});

describe("canAccessSection", () => {
  it("matches the sidebar for every role and section", () => {
    for (const role of STAFF_ROLES) {
      for (const s of SECTIONS) {
        expect(canAccessSection(role, s.key)).toBe(keys(role).includes(s.key));
      }
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
  it("has unique keys and hrefs under /app", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.href)).size).toBe(SECTIONS.length);
    for (const s of SECTIONS) expect(s.href.startsWith("/app/")).toBe(true);
  });
});
