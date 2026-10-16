import { describe, expect, it } from "vitest";
import { EXPORT_DROP_COLUMNS, EXPORT_TABLES, NOT_EXPORTED, PERSONAL_DATA, personTotal, toCsv } from "./data-protection";

describe("CSV export", () => {
  it("writes a header and escapes commas, quotes and line breaks", () => {
    expect(toCsv([{ a: 1, b: "x, y" }, { a: 2, b: 'say "hi"', c: "line\nbreak" }])).toBe('a,b,c\r\n1,"x, y",\r\n2,"say ""hi""","line\nbreak"\r\n');
    expect(toCsv([])).toBe("");
  });
  it("stops cells being run as spreadsheet formulas", () => {
    expect(toCsv([{ v: "=HYPERLINK(1)" }, { v: "+44 1234" }, { v: "-5" }, { v: "@sum" }])).toBe("v\r\n'=HYPERLINK(1)\r\n'+44 1234\r\n'-5\r\n'@sum\r\n");
  });
  it("writes objects and arrays as JSON, and null as empty", () => {
    expect(toCsv([{ v: { a: 1 }, w: null }])).toBe('v,w\r\n"{""a"":1}",\r\n');
  });
});

describe("what an export contains", () => {
  it("never includes a secret or link code", () => {
    expect(EXPORT_DROP_COLUMNS.integration_credentials).toContain("ciphertext");
    expect(EXPORT_DROP_COLUMNS.po_links).toContain("token_hash");
  });
  it("lists each table once, and never both exported and excluded", () => {
    const names = EXPORT_TABLES.map((t) => t.table);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(NOT_EXPORTED[n]).toBeUndefined();
  });
  it("classifies personal data, and counts a person's records", () => {
    expect(PERSONAL_DATA["customer_notification_prefs.email"]).toBe("person");
    expect(PERSONAL_DATA["sales_orders.delivery_name"]).toBe("order_record");
    expect(personTotal({ a: [1, 2], b: 3, c: [] })).toBe(5);
  });
});
