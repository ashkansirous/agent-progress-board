import { describe, expect, it } from "vitest";
import {
  type CapReading,
  DropReason,
  evaluateAll,
  evaluateReadings,
  newestPlan,
  planAt,
  WEEKLY_WINDOW,
} from "../src/domain/cap";

const LOW_MARK = 2;
const RESET_1 = "2026-11-17T08:00:00.000Z";
const RESET_2 = "2026-11-24T08:00:00.000Z";
const at = (hour: number): string => new Date(Date.UTC(2026, 10, 16, hour)).toISOString();

function reading(hour: number, percent: number, resetAt: string | null = RESET_1, plan = "plan-a"): CapReading {
  return { takenAt: at(hour), plan, windowKind: WEEKLY_WINDOW, percent, resetAt, source: null };
}

describe("cap readings", () => {
  it("starts a new window when 98 falls to 1 with a new reset time", () => {
    const { windows, verdicts } = evaluateReadings([reading(1, 98), reading(2, 1, RESET_2)], LOW_MARK);
    expect(windows).toHaveLength(2);
    expect(verdicts.every((v) => v.accepted)).toBe(true);
    expect(windows[1]?.startedAt).toBe(at(2));
    expect(windows[1]?.peak).toBe(1);
  });

  it("drops 60 then 55 with the same reset time, naming the percent it lost to", () => {
    const { windows, verdicts } = evaluateReadings([reading(1, 60), reading(2, 55)], LOW_MARK);
    expect(windows).toHaveLength(1);
    expect(verdicts[1]).toMatchObject({ accepted: false, reason: DropReason.Stale, lostTo: 60 });
    expect(windows[0]?.readings).toHaveLength(1);
  });

  it("re-orders a late older reading by itself and keeps the line rising", () => {
    const inOrder = evaluateReadings([reading(1, 10), reading(2, 20), reading(3, 30)], LOW_MARK);
    const late = evaluateReadings([reading(1, 10), reading(3, 30), reading(2, 20)], LOW_MARK);
    expect(late.verdicts.map((v) => v.accepted)).toEqual(inOrder.verdicts.map((v) => v.accepted));
    expect(late.windows[0]?.readings.map((r) => r.percent)).toEqual([10, 20, 30]);
  });

  it("starts a new window for a reading taken after the reset time even when it is higher (5 then 6)", () => {
    const afterReset: CapReading = { ...reading(1, 6, RESET_2), takenAt: "2026-11-17T09:00:00.000Z" };
    const { windows, verdicts } = evaluateReadings([reading(1, 5), afterReset], LOW_MARK);
    expect(windows).toHaveLength(2);
    expect(verdicts.every((v) => v.accepted)).toBe(true);
    expect(windows[1]?.startedAt).toBe(RESET_1);
  });

  it("drops a lower reading with a reset time when the window has none, unless it reaches the low mark", () => {
    const noReset = reading(1, 60, null);
    const stale = evaluateReadings([noReset, reading(2, 55, RESET_1)], LOW_MARK);
    expect(stale.windows).toHaveLength(1);
    expect(stale.verdicts[1]).toMatchObject({ accepted: false, reason: DropReason.Stale, lostTo: 60 });
    const reached = evaluateReadings([noReset, reading(2, 1, RESET_2)], LOW_MARK);
    expect(reached.windows).toHaveLength(2);
    expect(reached.verdicts[1]?.accepted).toBe(true);
  });

  it("gives the window the first reset time an accepted reading carries", () => {
    const { windows } = evaluateReadings([reading(1, 10, null), reading(2, 20, RESET_1)], LOW_MARK);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.resetAt).toBe(RESET_1);
  });

  it("drops a late older reading that is higher than a later stored one, as stale", () => {
    const { verdicts } = evaluateReadings([reading(1, 10), reading(3, 30), reading(2, 40)], LOW_MARK);
    const dropped = verdicts.filter((v) => !v.accepted);
    expect(dropped.map((v) => v.reading.percent)).toEqual([30]);
    expect(dropped[0]?.lostTo).toBe(40);
  });

  it("detects a reset with no reset time only when the reading falls to the low mark from above", () => {
    const reset = evaluateReadings([reading(1, 98, null), reading(2, 1, null)], LOW_MARK);
    expect(reset.windows).toHaveLength(2);
    const stale = evaluateReadings([reading(1, 60, null), reading(2, 55, null)], LOW_MARK);
    expect(stale.windows).toHaveLength(1);
    expect(stale.verdicts[1]?.accepted).toBe(false);
    const lowStart = evaluateReadings([reading(1, 2, null), reading(2, 1, null)], LOW_MARK);
    expect(lowStart.verdicts[1]?.accepted).toBe(false);
  });

  it("keeps two plans apart, so a plan change mid-window never drops or resets the other plan's readings", () => {
    const readings = [
      reading(1, 60, RESET_1, "plan-a"),
      reading(2, 5, RESET_1, "plan-b"),
      reading(3, 65, RESET_1, "plan-a"),
      reading(4, 7, RESET_1, "plan-b"),
    ];
    const { windows, verdicts } = evaluateAll(readings, LOW_MARK);
    expect(verdicts.every((v) => v.accepted)).toBe(true);
    expect(windows.map((w) => [w.plan, w.peak])).toEqual([["plan-a", 65], ["plan-b", 7]]);
    expect(planAt(readings, at(2))).toBe("plan-b");
    expect(planAt(readings, at(3))).toBe("plan-a");
    expect(newestPlan(verdicts)).toBe("plan-b");
  });
});
