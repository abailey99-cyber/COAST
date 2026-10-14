import { describe, expect, it } from "vitest";
import { configHealth } from "./health";

const REQUIRED = ["A_KEY", "B_KEY"];

describe("configHealth", () => {
  it("is unconfigured when nothing is set", () => {
    expect(configHealth("Thing", REQUIRED, {}).status).toBe("unconfigured");
  });

  it("treats blank and whitespace values as unset", () => {
    expect(configHealth("Thing", REQUIRED, { A_KEY: "", B_KEY: "   " }).status).toBe("unconfigured");
  });

  it("is an error when only some values are set, and names what's missing", () => {
    const h = configHealth("Thing", REQUIRED, { A_KEY: "x" });
    expect(h.status).toBe("error");
    expect(h.reason).toContain("B_KEY");
    expect(h.reason).not.toContain("A_KEY");
  });

  it("is ok when everything is set", () => {
    expect(configHealth("Thing", REQUIRED, { A_KEY: "x", B_KEY: "y" })).toEqual({ status: "ok", reason: "Thing is configured." });
  });

  it("never includes a secret value in the reason", () => {
    const h = configHealth("Thing", REQUIRED, { A_KEY: "super-secret-value" });
    expect(h.reason).not.toContain("super-secret-value");
  });
});
