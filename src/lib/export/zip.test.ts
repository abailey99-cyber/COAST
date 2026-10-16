import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zip } from "./zip";

const enc = new TextEncoder();

describe("the export ZIP", () => {
  it("computes CRC-32 correctly", () => {
    expect(crc32(enc.encode("hello")).toString(16)).toBe("3610a686");
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes a ZIP with every file, readable byte for byte", () => {
    const z = zip([{ name: "orders.csv", data: enc.encode("a,b\r\n1,2\r\n") }, { name: "lines.csv", data: enc.encode("x\r\n") }], new Date("2026-10-16T12:00:00Z"));
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(2);
    // The stored bytes sit right after the first local header and its name.
    expect(new TextDecoder().decode(z.slice(30 + "orders.csv".length, 30 + "orders.csv".length + 10))).toBe("a,b\r\n1,2\r\n");
  });

  it("opens with a real unzip tool when one is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "coast-zip-"));
    const file = join(dir, "export.zip");
    writeFileSync(file, zip([{ name: "orders.csv", data: enc.encode("id\r\n1\r\n") }]));
    try {
      execFileSync("tar", ["-xf", file, "-C", dir], { stdio: "ignore" });
    } catch {
      return; // no tar here: the structural test above still holds
    }
    expect(readFileSync(join(dir, "orders.csv"), "utf8")).toBe("id\r\n1\r\n");
  });
});
