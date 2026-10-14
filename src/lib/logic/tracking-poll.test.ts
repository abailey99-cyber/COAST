import { describe, expect, it } from "vitest";
import { getCarrier } from "./carriers";
import { MAX_BACKOFF_MS, canCheckNow, nextPollAt, planPollRun, runAllowance, runsLeftToday, type PollCandidate } from "./tracking-poll";

const now = new Date("2026-10-14T12:00:00Z");
const mins = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60_000 : null);

describe("nextPollAt", () => {
  it("stops checking once delivered", () => {
    expect(nextPollAt("delivered", 0, now)).toBeNull();
    expect(nextPollAt("delivered", 5, now)).toBeNull();
  });
  it("checks busier shipments more often", () => {
    expect(mins(nextPollAt("out_for_delivery", 0, now))).toBe(30);
    expect(mins(nextPollAt("in_transit", 0, now))).toBe(120);
    expect(mins(nextPollAt("pre_transit", 0, now))).toBe(240);
  });
  it("backs off by doubling after failures, up to a day", () => {
    expect(mins(nextPollAt("in_transit", 1, now))).toBe(30);
    expect(mins(nextPollAt("in_transit", 2, now))).toBe(60);
    expect(mins(nextPollAt("in_transit", 4, now))).toBe(240);
    expect(mins(nextPollAt("in_transit", 30, now))).toBe(MAX_BACKOFF_MS / 60_000);
  });
});

describe("planPollRun", () => {
  const c = (id: string, status: PollCandidate["status"], lastPolledAt: string | null, carrier: PollCandidate["carrier"] = "dhl"): PollCandidate => ({ id, carrier, status, lastPolledAt });

  it("checks never-checked shipments first, then live movement, then the oldest", () => {
    const due = [
      c("old-transit", "in_transit", "2026-10-14T06:00:00Z"),
      c("newer-transit", "in_transit", "2026-10-14T09:00:00Z"),
      c("out", "out_for_delivery", "2026-10-14T11:00:00Z"),
      c("new", "pre_transit", null),
      c("unknown", "unknown", "2026-10-13T00:00:00Z"),
    ];
    expect(planPollRun(due, { dhl: 4 }).dhl).toEqual(["new", "out", "old-transit", "newer-transit"]);
  });
  it("keeps each carrier inside its own allowance", () => {
    const due = [c("d1", "in_transit", null), c("d2", "in_transit", null), c("u1", "in_transit", null, "ups")];
    expect(planPollRun(due, { dhl: 1, ups: 5 })).toEqual({ dhl: ["d1"], ups: ["u1"] });
  });
  it("leaves out carriers with no allowance and delivered shipments", () => {
    expect(planPollRun([c("x", "in_transit", null, "dpd"), c("y", "delivered", null)], { dhl: 5 })).toEqual({});
  });
});

describe("runAllowance", () => {
  const dhl = getCarrier("dhl").pacing;
  it("spreads DHL's daily calls over the runs left, keeping some back for manual checks", () => {
    // 225 scheduled calls (250 less 10%) over 48 runs ≈ 5 a run.
    expect(runAllowance(dhl, 0, 48)).toBe(5);
    expect(runAllowance(dhl, 0, 1)).toBe(dhl.maxPerRun);
  });
  it("stops at the scheduled share of the limit", () => {
    expect(runAllowance(dhl, 225, 10)).toBe(0);
    expect(runAllowance(dhl, 224, 10)).toBe(1);
  });
  it("gives carriers without a small daily limit their per-run maximum", () => {
    expect(runAllowance(getCarrier("ups").pacing, 9999, 3)).toBe(getCarrier("ups").pacing.maxPerRun);
  });
  it("gives nothing to carriers COAST can't check", () => {
    expect(runAllowance(getCarrier("dpd").pacing, 0, 10)).toBe(0);
  });
  it("never lets a day's runs exceed DHL's 250", () => {
    let used = 0;
    for (let runsLeft = 48; runsLeft >= 1; runsLeft--) used += runAllowance(dhl, used, runsLeft);
    expect(used).toBeLessThanOrEqual(250);
  });
});

describe("runsLeftToday", () => {
  it("counts half-hour runs to midnight UTC", () => {
    expect(runsLeftToday(new Date("2026-10-14T00:00:00Z"))).toBe(48);
    expect(runsLeftToday(new Date("2026-10-14T23:45:00Z"))).toBe(1);
    expect(runsLeftToday(now)).toBe(24);
  });
});

describe("canCheckNow", () => {
  it("allows a manual check until the daily limit itself", () => {
    const dhl = getCarrier("dhl").pacing;
    expect(canCheckNow(dhl, 240)).toBe(true);
    expect(canCheckNow(dhl, 250)).toBe(false);
    expect(canCheckNow(getCarrier("other").pacing, 0)).toBe(false);
    expect(canCheckNow(getCarrier("ups").pacing, 100000)).toBe(true);
  });
});
