import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, describeWait, escalate, escalationLevel, thresholdsProblem } from "./escalation";
import { DEFAULT_CALENDAR, workingHoursBetween, zonedTime } from "./working-time";

const at = (iso: string) => new Date(iso);

describe("zonedTime", () => {
  it("converts UK wall-clock time in summer (BST) and winter (GMT)", () => {
    expect(zonedTime(2026, 7, 1, 9, "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedTime(2026, 12, 1, 9, "Europe/London").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("workingHoursBetween (Mon–Fri, 09:00–17:00 UK)", () => {
  it("counts within one working day", () => {
    // Thu 15 Oct 2026, 10:00 → 14:30 BST
    expect(workingHoursBetween(at("2026-10-15T09:00:00Z"), at("2026-10-15T13:30:00Z"))).toBe(4.5);
  });

  it("ignores time outside the working day", () => {
    // 06:00 → 20:00 BST counts 8h
    expect(workingHoursBetween(at("2026-10-15T05:00:00Z"), at("2026-10-15T19:00:00Z"))).toBe(8);
  });

  it("skips the weekend", () => {
    // Fri 16 Oct 16:00 BST → Mon 19 Oct 10:00 BST = 1h + 1h
    expect(workingHoursBetween(at("2026-10-16T15:00:00Z"), at("2026-10-19T09:00:00Z"))).toBe(2);
  });

  it("is zero across a whole weekend, and when end is before start", () => {
    expect(workingHoursBetween(at("2026-10-17T08:00:00Z"), at("2026-10-18T20:00:00Z"))).toBe(0);
    expect(workingHoursBetween(at("2026-10-15T12:00:00Z"), at("2026-10-15T10:00:00Z"))).toBe(0);
  });

  it("copes with the clocks going back (Sun 25 Oct 2026)", () => {
    // Fri 23 Oct 17:00 BST → Mon 26 Oct 10:00 GMT = 1h on Monday
    expect(workingHoursBetween(at("2026-10-23T16:00:00Z"), at("2026-10-26T10:00:00Z"))).toBe(1);
  });

  it("skips holidays it is given", () => {
    const cal = { ...DEFAULT_CALENDAR, holidays: ["2026-12-25"] };
    // Thu 24 Dec 09:00 → Mon 28 Dec 09:00 (GMT): only Thursday counts
    expect(workingHoursBetween(at("2026-12-24T09:00:00Z"), at("2026-12-28T09:00:00Z"), cal)).toBe(8);
    expect(workingHoursBetween(at("2026-12-24T09:00:00Z"), at("2026-12-28T09:00:00Z"))).toBe(16);
  });

  it("counts long spans correctly (four weeks = 20 working days)", () => {
    expect(workingHoursBetween(at("2026-11-02T00:00:00Z"), at("2026-11-30T00:00:00Z"))).toBe(160);
  });
});

describe("escalationLevel", () => {
  it.each([
    [0, "none"],
    [7.99, "none"],
    [8, "amber"],
    [16, "red"],
    [24, "alert"],
    [500, "alert"],
  ] as const)("%s hours → %s", (h, level) => expect(escalationLevel(h, DEFAULT_THRESHOLDS)).toBe(level));
});

describe("escalate", () => {
  it("uses working time, so a weekend doesn't escalate anything", () => {
    // Sent Fri 16 Oct 16:59 BST, checked Mon 19 Oct 09:00 BST
    expect(escalate(at("2026-10-16T15:59:00Z"), at("2026-10-19T08:00:00Z")).level).toBe("none");
  });

  it("reaches needs attention after three working days", () => {
    // Mon 12 Oct 09:00 → Thu 15 Oct 09:00 BST
    const e = escalate(at("2026-10-12T08:00:00Z"), at("2026-10-15T08:00:00Z"));
    expect(e).toEqual({ level: "alert", waitedHours: 24 });
  });
});

describe("thresholdsProblem", () => {
  it("accepts increasing thresholds and refuses others", () => {
    expect(thresholdsProblem(DEFAULT_THRESHOLDS)).toBeNull();
    expect(thresholdsProblem({ amberHours: 16, redHours: 8, alertHours: 24 })).toMatch(/before/);
    expect(thresholdsProblem({ amberHours: 0, redHours: 8, alertHours: 24 })).toMatch(/between/);
    expect(thresholdsProblem({ amberHours: Number.NaN, redHours: 8, alertHours: 24 })).toMatch(/between/);
  });
});

describe("describeWait", () => {
  it("says it in plain English", () => {
    expect(describeWait(0.5)).toBe("under an hour");
    expect(describeWait(1)).toBe("1 working hour");
    expect(describeWait(7.9)).toBe("7 working hours");
    expect(describeWait(8)).toBe("1 working day");
    expect(describeWait(30)).toBe("3 working days");
  });
});
