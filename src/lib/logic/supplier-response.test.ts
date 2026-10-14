import { describe, expect, it } from "vitest";
import { confirmedLines, decide, detectDiscrepancies, isFullyConfirmed, validateLinkAnswer, type PoLineForCheck } from "./supplier-response";

const lines: PoLineForCheck[] = [
  { poLineId: "a", lineLabel: "Line 1", quantity: 5, requestedDate: "2026-10-20", unitCostMinor: 800 },
  { poLineId: "b", lineLabel: "Line 2", quantity: 2, requestedDate: null, unitCostMinor: null },
];
const po = { currency: "GBP" as const, lines };
const ok = (id: string, over = {}) => ({ poLineId: id, available: true, quantity: id === "a" ? 5 : 2, date: "2026-10-18", unitCostMinor: id === "a" ? 800 : null, ...over });

describe("detectDiscrepancies", () => {
  it("finds nothing when everything matches", () => {
    expect(detectDiscrepancies(po, { currency: null, lines: [ok("a"), ok("b")] })).toEqual([]);
  });

  it("flags quantity, price, late date, unavailable, missing date and missing line", () => {
    const d = detectDiscrepancies(po, { currency: null, lines: [ok("a", { quantity: 4, unitCostMinor: 850, date: "2026-10-22" })] });
    expect(d.map((x) => x.field)).toEqual(["quantity", "price", "date", "missing_line"]);
    expect(d[0]!.message).toBe("Line 1: 4 confirmed, 5 ordered.");
    expect(d[1]!.message).toBe("Line 1: 8.50 each confirmed, 8.00 expected.");

    const d2 = detectDiscrepancies(po, { currency: null, lines: [ok("a", { available: false }), ok("b", { date: null })] });
    expect(d2.map((x) => x.field)).toEqual(["unavailable", "missing_date"]);
  });

  it("flags the wrong currency", () => {
    expect(detectDiscrepancies(po, { currency: "EUR", lines: [ok("a"), ok("b")] }).map((x) => x.field)).toEqual(["currency"]);
  });

  it("doesn't flag a price when the PO has no cost to compare", () => {
    expect(detectDiscrepancies(po, { currency: null, lines: [ok("a"), ok("b", { unitCostMinor: 999 })] })).toEqual([]);
  });

  it("is happy with an earlier date than requested", () => {
    expect(detectDiscrepancies(po, { currency: null, lines: [ok("a", { date: "2026-10-15" }), ok("b")] })).toEqual([]);
  });
});

describe("decide", () => {
  it("applies a matching link answer", () => {
    expect(decide("link", "high", [])).toEqual({ action: "apply" });
  });

  it("applies a matching email only at high confidence", () => {
    expect(decide("paste", "high", [])).toEqual({ action: "apply" });
    expect(decide("paste", "medium", [])).toMatchObject({ action: "review" });
  });

  it("sends any discrepancy to review, with the reasons", () => {
    const r = decide("link", "high", [{ poLineId: "a", field: "quantity", message: "Line 1: 4 confirmed, 5 ordered." }]);
    expect(r).toEqual({ action: "review", reasons: ["Line 1: 4 confirmed, 5 ordered."] });
  });

  it("includes the reader's own reasons", () => {
    const r = decide("paste", "low", [], ["No date found."]);
    expect(r).toEqual({ action: "review", reasons: ["No date found."] });
  });
});

describe("validateLinkAnswer", () => {
  const input = (over = {}) => [
    { poLineId: "a", available: true, quantity: "5", date: "2026-10-18", unitPrice: "8.00", ...over },
    { poLineId: "b", available: false, quantity: "", date: "", unitPrice: "" },
  ];

  it("accepts a full answer, including a line they can't supply", () => {
    const r = validateLinkAnswer(input(), po);
    expect(r).toEqual({
      ok: true,
      answer: {
        currency: null,
        lines: [
          { poLineId: "a", available: true, quantity: 5, date: "2026-10-18", unitCostMinor: 800 },
          { poLineId: "b", available: false, quantity: null, date: null, unitCostMinor: null },
        ],
      },
    });
  });

  it("asks for a quantity, a date and a sensible price", () => {
    const r = validateLinkAnswer(input({ quantity: "", date: "soon", unitPrice: "abc" }), po);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["a.date", "a.quantity", "a.unitPrice"]);
  });

  it("needs every line answered, and ignores lines not on the PO", () => {
    const r = validateLinkAnswer([{ poLineId: "zzz", available: true, quantity: "1", date: "2026-10-18", unitPrice: "" }], po);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["a.missing", "b.missing"]);
  });
});

describe("confirmedLines / isFullyConfirmed", () => {
  it("confirms available lines with dates, and knows when the PO is fully confirmed", () => {
    const answer = { currency: null, lines: [ok("a"), ok("b", { available: false })] };
    const c = confirmedLines(answer, po);
    expect(c).toEqual([{ poLineId: "a", confirmedDate: "2026-10-18", confirmedQuantity: 5, confirmedUnitCostMinor: 800 }]);
    expect(isFullyConfirmed(c, po)).toBe(false);
    expect(isFullyConfirmed(confirmedLines({ currency: null, lines: [ok("a"), ok("b")] }, po), po)).toBe(true);
  });
});
