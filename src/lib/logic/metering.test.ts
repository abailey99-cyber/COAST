import { describe, expect, it } from "vitest";
import { countByMonth, meterMonth, monthLabel } from "./metering";

describe("order metering", () => {
  it("counts in the UK calendar month, including just after midnight on the last day", () => {
    // 31 October 2026, 23:30 UK (GMT) is still October; 00:30 on 1 November is November.
    expect(meterMonth("2026-10-31T23:30:00Z")).toBe("2026-10");
    expect(meterMonth("2026-11-01T00:30:00Z")).toBe("2026-11");
    // In summer time, 23:30 UTC on 31 August is already 1 September in the UK.
    expect(meterMonth("2026-08-31T23:30:00Z")).toBe("2026-09");
    expect(meterMonth("2026-08-31T22:59:59Z")).toBe("2026-08");
  });
  it("counts an order synced twice once, in the month it was first seen", () => {
    const counts = countByMonth([
      { id: "a", firstSeenAt: "2026-10-05T10:00:00Z" },
      { id: "a", firstSeenAt: "2026-11-02T10:00:00Z" },
      { id: "b", firstSeenAt: "2026-11-03T10:00:00Z" },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ "2026-10": 1, "2026-11": 1 });
  });
  it("names the month", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});
