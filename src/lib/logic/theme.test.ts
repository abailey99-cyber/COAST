import { describe, expect, it } from "vitest";
import { parseTheme } from "./theme";

describe("parseTheme", () => {
  it("defaults to dark", () => {
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTheme("")).toBe("dark");
    expect(parseTheme("blue")).toBe("dark");
  });

  it("accepts light and dark", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("uses the given fallback", () => {
    expect(parseTheme(null, "light")).toBe("light");
  });
});
