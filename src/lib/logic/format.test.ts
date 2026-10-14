import { describe, expect, it } from "vitest";
import { formatLongDate, formatMoney, formatShortDate, isCurrency } from "./format";

describe("formatShortDate", () => {
  it('formats like "Thu 15 Oct"', () => {
    expect(formatShortDate(new Date("2026-10-15T09:00:00Z"))).toBe("Thu 15 Oct");
  });

  it("uses UK time, not UTC, near midnight (BST)", () => {
    // 23:30 UTC on 14 Oct is 00:30 on 15 Oct in London (BST).
    expect(formatShortDate(new Date("2026-10-14T23:30:00Z"))).toBe("Thu 15 Oct");
  });

  it("uses UK time in winter (GMT)", () => {
    expect(formatShortDate(new Date("2026-12-24T23:30:00Z"))).toBe("Thu 24 Dec");
  });

  it('says "Unknown date" rather than "Invalid Date"', () => {
    expect(formatShortDate(new Date("not a date"))).toBe("Unknown date");
    expect(formatLongDate(new Date(Number.NaN))).toBe("Unknown date");
  });
});

describe("formatLongDate", () => {
  it('formats like "Thursday 15 October"', () => {
    expect(formatLongDate(new Date("2026-10-15T09:00:00Z"))).toBe("Thursday 15 October");
  });
});

describe("formatMoney", () => {
  it.each([
    [125000, "GBP", "£1,250.00"],
    [125000, "EUR", "€1,250.00"],
    [125000, "USD", "$1,250.00"],
    [5, "GBP", "£0.05"],
    [0, "GBP", "£0.00"],
    [-1999, "GBP", "-£19.99"],
  ] as const)("%i %s → %s", (minor, currency, expected) => {
    expect(formatMoney(minor, currency)).toBe(expected);
  });

  it("rejects fractional minor units", () => {
    expect(() => formatMoney(12.5, "GBP")).toThrow(RangeError);
  });
});

describe("isCurrency", () => {
  it("accepts the supported list only", () => {
    expect(isCurrency("GBP")).toBe(true);
    expect(isCurrency("gbp")).toBe(false);
    expect(isCurrency("JPY")).toBe(false);
  });
});
