import { describe, expect, it } from "vitest";
import { arrivingSoon, dueLabel, groupBySupplier, type PortalOrderInput } from "./portal";

const TODAY = "2026-10-14";
const o = (key: string, businessId: string, stage: number | null, from: string | null, to: string | null = from, placedAt = "2026-10-01T09:00:00Z"): PortalOrderInput => ({
  key, businessId, stage, expectedFrom: from, expectedTo: to, placedAt,
});

describe("groupBySupplier", () => {
  it("puts the supplier with the earliest delivery first, and its orders earliest first", () => {
    const groups = groupBySupplier([
      o("a1", "A", 1, "2026-10-20"),
      o("b1", "B", 2, "2026-10-16"),
      o("a2", "A", 3, "2026-10-15"),
      o("b2", "B", 1, null),
    ]);
    expect(groups.map((g) => g.businessId)).toEqual(["A", "B"]);
    expect(groups[0]!.open.map((x) => x.key)).toEqual(["a2", "a1"]);
    expect(groups[0]!.nextExpected).toBe("2026-10-15");
    expect(groups[1]!.open.map((x) => x.key)).toEqual(["b1", "b2"]);
  });
  it("puts suppliers with nothing dated after dated ones, and finished-only suppliers last", () => {
    const groups = groupBySupplier([o("c1", "C", 4, "2026-10-01"), o("d1", "D", 0, null), o("e1", "E", 1, "2026-11-30")]);
    expect(groups.map((g) => g.businessId)).toEqual(["E", "D", "C"]);
    expect(groups[2]!.open).toEqual([]);
    expect(groups[2]!.done.map((x) => x.key)).toEqual(["c1"]);
  });
  it("keeps cancelled orders with the finished ones", () => {
    const [g] = groupBySupplier([o("x", "A", null, null), o("y", "A", 2, "2026-10-15")]);
    expect(g!.open.map((x) => x.key)).toEqual(["y"]);
    expect(g!.done.map((x) => x.key)).toEqual(["x"]);
  });
});

describe("arrivingSoon", () => {
  it("lists the next week across every supplier, soonest first, including anything late", () => {
    const soon = arrivingSoon([o("late", "A", 2, "2026-10-10", "2026-10-12"), o("week", "B", 1, "2026-10-21"), o("later", "A", 1, "2026-10-22"), o("none", "C", 0, null), o("done", "A", 4, "2026-10-15")], TODAY);
    expect(soon.map((x) => x.key)).toEqual(["late", "week"]);
  });
});

describe("dueLabel", () => {
  it("says when it's due in plain words", () => {
    expect(dueLabel("2026-10-14", "2026-10-14", TODAY)).toBe("Due today");
    expect(dueLabel("2026-10-13", "2026-10-15", TODAY)).toBe("Due now");
    expect(dueLabel("2026-10-15", null, TODAY)).toBe("Tomorrow");
    expect(dueLabel("2026-10-17", "2026-10-19", TODAY)).toBe("In 3 days");
    expect(dueLabel("2026-10-10", "2026-10-12", TODAY)).toBe("Later than expected");
    expect(dueLabel(null, null, TODAY)).toBeNull();
  });
});
