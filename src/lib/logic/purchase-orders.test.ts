import { describe, expect, it } from "vitest";
import { allowedPoStatusChanges, canRaisePoFor, validateNewPo, validateNewSupplier, type PoCandidateLine } from "./purchase-orders";

const line = (over: Partial<PoCandidateLine> = {}): PoCandidateLine => ({
  id: "l1",
  route: "direct_ship",
  stage: "ordered",
  quantity: 5,
  onLivePo: false,
  ...over,
});

describe("canRaisePoFor", () => {
  it("allows supplier-fulfilled lines still needing a PO", () => {
    expect(canRaisePoFor(line())).toBe(true);
    expect(canRaisePoFor(line({ route: "via_warehouse" }))).toBe(true);
  });

  it("refuses stock lines, lines already on a live PO, and lines past ordering", () => {
    expect(canRaisePoFor(line({ route: "from_stock" }))).toBe(false);
    expect(canRaisePoFor(line({ onLivePo: true }))).toBe(false);
    expect(canRaisePoFor(line({ stage: "po_sent" }))).toBe(false);
    expect(canRaisePoFor(line({ stage: "cancelled" }))).toBe(false);
  });
});

describe("allowedPoStatusChanges", () => {
  it("moves draft → sent → confirmed, and can cancel until then", () => {
    expect(allowedPoStatusChanges("draft")).toEqual(["sent", "cancelled"]);
    expect(allowedPoStatusChanges("sent")).toEqual(["confirmed", "cancelled"]);
    expect(allowedPoStatusChanges("confirmed")).toEqual(["cancelled"]);
    expect(allowedPoStatusChanges("cancelled")).toEqual([]);
  });
});

describe("validateNewPo", () => {
  const input = { supplierId: "s1", currency: "GBP", lines: [{ orderLineId: "l1", quantity: "5", unitCost: "8.00", requestedDate: "2026-10-18" }] };

  it("accepts a good PO", () => {
    const r = validateNewPo(input, [line()], true);
    expect(r).toEqual({ ok: true, po: { supplierId: "s1", currency: "GBP", lines: [{ orderLineId: "l1", quantity: 5, unitCostMinor: 800, requestedDate: "2026-10-18" }] } });
  });

  it("ignores costs from someone who can't see costs", () => {
    const r = validateNewPo(input, [line()], false);
    expect(r.ok && r.po.lines[0]!.unitCostMinor).toBeNull();
  });

  it("refuses more than the customer ordered", () => {
    const r = validateNewPo({ ...input, lines: [{ ...input.lines[0]!, quantity: "6" }] }, [line()], true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["lines.0.quantity"]).toMatch(/more than the customer ordered/);
  });

  it("refuses lines from another order, duplicates, and lines that don't need a PO", () => {
    expect(validateNewPo({ ...input, lines: [{ ...input.lines[0]!, orderLineId: "other" }] }, [line()], true).ok).toBe(false);
    expect(validateNewPo({ ...input, lines: [input.lines[0]!, input.lines[0]!] }, [line()], true).ok).toBe(false);
    expect(validateNewPo(input, [line({ route: "from_stock" })], true).ok).toBe(false);
  });

  it("needs a supplier, a currency and at least one line", () => {
    const r = validateNewPo({ supplierId: "", currency: "XXX", lines: [] }, [], true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["currency", "lines", "supplierId"]);
  });
});

describe("validateNewSupplier", () => {
  it("accepts a minimal supplier", () => {
    expect(validateNewSupplier({ name: "[Supplier One]", email: "", phone: "", currency: "GBP", leadTimeDays: "" })).toEqual({
      ok: true,
      supplier: { name: "[Supplier One]", email: null, phone: null, currency: "GBP", leadTimeDays: null },
    });
  });

  it("checks email, currency and lead time", () => {
    const r = validateNewSupplier({ name: "", email: "nope", phone: "", currency: "JPY", leadTimeDays: "2.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["currency", "email", "leadTimeDays", "name"]);
  });
});
