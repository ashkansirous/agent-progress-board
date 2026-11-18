import { barWidth } from "../web/src/usageFormat";
import { describe, expect, it } from "vitest";
import { BucketUnit, UsageRange } from "../src/domain/usage";
import { capAxisTop, capTicks, labelEvery, roundedTopPath, stackSegments, xForReset, xForTime, yForValue } from "../web/src/chartGeometry";
import { Route, routeOf } from "../web/src/route";
import { usageQuery } from "../web/src/usageQuery";
import {
  bucketLabel, bucketLetter, clockAt, longReset, millionsText, niceScale, costPercentText, percentText, shortTaskTitle, timeUntil, tokenText, weekdayClock,
} from "../web/src/usageFormat";
import { INITIAL_USAGE_STATE, usageReducer } from "../web/src/usageState";
import { demoUsage } from "../e2e/usageFixture";

const FRAME = { x0: 48, x1: 976, yTop: 20, yBottom: 240 };
const DAYS = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];

describe("number and time text", () => {
  it("shows a cost-page cap percent with one decimal", () => {
    expect(costPercentText(4)).toBe("4.0%");
    expect(costPercentText(8.6)).toBe("8.6%");
    expect(costPercentText(0)).toBe("0.0%");
    expect(costPercentText(8.6, "de-DE")).toBe("8,6%");
    expect(barWidth(-3, 10)).toBe(0);
  });

  it("shows a whole percent without a decimal and others with one", () => {
    expect(percentText(41)).toBe("41%");
    expect(percentText(34.2)).toBe("34.2%");
    expect(percentText(34.249)).toBe("34.2%");
    expect(percentText(0)).toBe("0%");
  });

  it("writes tokens as millions, thousands or plain", () => {
    expect(tokenText(7_100_000, "en-US")).toBe("7.1 M");
    expect(tokenText(12_300, "en-US")).toBe("12.3 k");
    expect(tokenText(950, "en-US")).toBe("950");
    expect(millionsText(9_630_000, 2, "en-US")).toBe("9.63");
    expect(millionsText(10_700_000, 1, "en-US")).toBe("10.7");
  });

  it("writes the viewer's clock from a UTC offset", () => {
    expect(clockAt("2026-11-16T13:46:00.000Z", 0)).toBe("13:46");
    expect(clockAt("2026-11-16T23:30:00.000Z", 120)).toBe("01:30");
    expect(weekdayClock("en-US", "2026-11-17T08:00:00.000Z", 0)).toBe("Tue 08:00");
    expect(longReset("en-US", "2026-11-17T08:00:00.000Z", 0)).toBe("Tue 17 Nov, 08:00");
    expect(weekdayClock("en-US", "2026-11-16T23:30:00.000Z", 120)).toBe("Tue 01:30");
  });

  it("labels buckets", () => {
    expect(bucketLabel("en-US", "2026-11-10")).toBe("Tue 10");
    expect(bucketLabel("en-US", "2026-11-10T13")).toBe("13:00");
    expect(bucketLetter("en-US", "2026-11-10")).toBe("T");
  });

  it("counts the time to a reset, or none once it passed", () => {
    expect(timeUntil("2026-11-16T15:58:00.000Z", "2026-11-16T13:48:00.000Z")).toEqual({ hours: 2, minutes: 10 });
    expect(timeUntil("2026-11-16T13:00:00.000Z", "2026-11-16T13:48:00.000Z")).toBeNull();
  });

  it("shortens a task title to its first two parts", () => {
    expect(shortTaskTitle("Slice 9 · Part C · Notification channel")).toBe("Slice 9 · Part C");
    expect(shortTaskTitle("CI failing on main")).toBe("CI failing on main");
  });
});

describe("axes", () => {
  it("picks a round top whose steps reach the biggest value", () => {
    expect(niceScale(9_800_000, 4)).toEqual({ top: 10_000_000, step: 2_500_000 });
    expect(niceScale(5_100_000, 4)).toEqual({ top: 8_000_000, step: 2_000_000 });
    expect(niceScale(0, 4).top).toBeGreaterThan(0);
    expect(niceScale(10_000_000, 2)).toEqual({ top: 10_000_000, step: 5_000_000 });
  });

  it("never picks a top below the data", () => {
    for (const max of [1, 7, 130, 4_900, 5_100_000, 23_000_000, 777_777_777]) {
      expect(niceScale(max, 4).top).toBeGreaterThanOrEqual(max);
      expect(niceScale(max, 2).top).toBeGreaterThanOrEqual(max);
    }
  });

  it("puts the phone cap axis at the next quarter above the highest reading", () => {
    expect(capAxisTop(34.2)).toBe(50);
    expect(capAxisTop(20)).toBe(25);
    expect(capAxisTop(25)).toBe(50);
    expect(capAxisTop(0)).toBe(25);
    expect(capTicks(50)).toEqual([0, 25, 50]);
  });

  it("thins labels to the most allowed", () => {
    expect(labelEvery(7, 12)).toBe(1);
    expect(labelEvery(31, 12)).toBe(3);
    expect(labelEvery(25, 12)).toBe(3);
  });
});

describe("geometry", () => {
  it("places a time on the day axis, clamped to the plot", () => {
    expect(xForTime("2026-11-10T00:00:00.000Z", 0, DAYS, BucketUnit.Day, FRAME)).toBe(48);
    expect(xForTime("2026-11-10T12:00:00.000Z", 0, DAYS, BucketUnit.Day, FRAME)).toBeCloseTo(48 + 928 / 14);
    expect(xForTime("2026-11-09T00:00:00.000Z", 0, DAYS, BucketUnit.Day, FRAME)).toBe(48);
    expect(xForTime("2026-12-01T00:00:00.000Z", 0, DAYS, BucketUnit.Day, FRAME)).toBe(976);
    expect(xForTime("2026-11-10T00:00:00.000Z", 120, DAYS, BucketUnit.Day, FRAME)).toBeCloseTo(48 + 928 / 84);
  });

  it("draws the reset that begins the first bucket at the left edge, and later resets at their time", () => {
    expect(xForReset("2026-11-10T08:00:00.000Z", 0, DAYS, BucketUnit.Day, FRAME)).toBe(48);
    expect(xForReset("2026-11-11T08:00:00.000Z", 0, DAYS, BucketUnit.Day, FRAME)).toBeCloseTo(48 + (928 * (32 / 24)) / 7);
  });

  it("maps a value onto the y axis", () => {
    expect(yForValue(0, 100, FRAME)).toBe(240);
    expect(yForValue(100, 100, FRAME)).toBe(20);
    expect(yForValue(34.2, 100, FRAME)).toBeCloseTo(164.76);
  });

  it("stacks segments bottom up with 2 units between them and marks the top one", () => {
    const frame = { x0: 0, x1: 100, yTop: 16, yBottom: 260 };
    const [first, second, third] = stackSegments([1.2, 3.1, 0.8], { top: 10, step: 2.5 }, frame);
    expect(first?.y).toBeCloseTo(230.7, 1);
    expect(first?.height).toBeCloseTo(27.3, 1);
    expect(second?.y).toBeCloseTo(155.1, 1);
    expect(second?.height).toBeCloseTo(73.6, 1);
    expect([first?.top, second?.top, third?.top]).toEqual([false, false, true]);
  });

  it("skips empty segments and leaves nothing for an empty bar", () => {
    const frame = { x0: 0, x1: 100, yTop: 0, yBottom: 100 };
    expect(stackSegments([0, 5, 0], { top: 10, step: 5 }, frame).map((s) => s.series)).toEqual([1]);
    expect(stackSegments([0, 0], { top: 10, step: 5 }, frame)).toEqual([]);
  });

  it("rounds only the top corners of a segment", () => {
    expect(roundedTopPath(80.5, 135.6, 55.3, 17.5, 4)).toBe("M80.5,153.1 V139.6 Q80.5,135.6 84.5,135.6 H131.8 Q135.8,135.6 135.8,139.6 V153.1 Z");
  });
});

describe("routes and requests", () => {
  it("shows the board unless the hash names the usage view", () => {
    expect(routeOf("")).toBe(Route.Board);
    expect(routeOf("#/")).toBe(Route.Board);
    expect(routeOf("#/usage")).toBe(Route.Usage);
    expect(routeOf("#/other")).toBe(Route.Board);
  });

  it("asks only for what was chosen", () => {
    expect(usageQuery({ range: UsageRange.Window, plan: null, environment: null }, 0)).toBe("range=window&utc_offset=0");
    expect(usageQuery({ range: UsageRange.Day, plan: "Plan One", environment: "box-two" }, -330)).toBe("range=24h&utc_offset=-330&plan=Plan+One&environment=box-two");
  });
});

describe("usage load state", () => {
  it("keeps the data on a refresh of the same question and clears it for another", () => {
    const loaded = usageReducer(usageReducer(INITIAL_USAGE_STATE, { type: "start", question: "a" }), { type: "success", data: demoUsage(), at: new Date(0) });
    expect(usageReducer(loaded, { type: "start", question: "a" }).data).not.toBeNull();
    const other = usageReducer(loaded, { type: "start", question: "b" });
    expect(other.data).toBeNull();
    expect(other.controls?.plans).toEqual(loaded.controls?.plans);
  });

  it("keeps the data and the controls on a failed refresh, and has none after a failed first load", () => {
    const loaded = usageReducer(INITIAL_USAGE_STATE, { type: "success", data: demoUsage(), at: new Date(0) });
    const failed = usageReducer(loaded, { type: "failure", status: 503 });
    expect(failed.data).toBe(loaded.data);
    expect(usageReducer(INITIAL_USAGE_STATE, { type: "failure", status: 503 }).data).toBeNull();
    expect(failed.error).toEqual({ status: 503 });
    expect(failed.controls?.palettes).toEqual(loaded.controls?.palettes);
  });

  it("shows the loading state only while a load is running", () => {
    const running = usageReducer(INITIAL_USAGE_STATE, { type: "start", question: "a" });
    expect(usageReducer(running, { type: "slow" }).slow).toBe(true);
    const done = usageReducer(running, { type: "success", data: demoUsage(), at: new Date(0) });
    expect(usageReducer(done, { type: "slow" }).slow).toBe(false);
  });
});
