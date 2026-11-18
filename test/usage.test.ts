import { describe, expect, it } from "vitest";
import { parseUsageQuery } from "../src/application/usage";
import {
  BucketUnit,
  bucketIndexAt,
  bucketKeys,
  bucketsBetween,
  busiestEnvironment,
  deltasOfSeries,
  offsetForZone,
  offsetOf,
  type OffsetAt,
  rankTasks,
  Split,
  splitByBucket,
  type TokenTotals,
  totalOf,
  type UsageSample,
  usageDeltas,
  useBetween,
  withBaseEnvironment,
  xOfMoment,
  zoneOffsetAt,
} from "../src/domain/usage";

/** The key of the bucket holding a time, from the range's own bucket list (the rule the Worker uses). */
function bucketKey(iso: string, offset: OffsetAt, unit: BucketUnit, from = Date.parse(iso) - 3 * 24 * 3_600_000): string {
  const at = Date.parse(iso);
  const buckets = bucketsBetween(from, at + 3_600_000, offset, unit);
  return buckets[bucketIndexAt(at, buckets)]?.key ?? "";
}

const T = (minute: number): string => new Date(Date.UTC(2026, 10, 16, 8, minute)).toISOString();

function totals(input: number, cacheWrite: number, cacheRead: number, output: number): TokenTotals {
  return { input, cache_write: cacheWrite, cache_read: cacheRead, output };
}

function sample(minute: number, t: TokenTotals, over: Partial<UsageSample> = {}): UsageSample {
  return {
    agentKey: "demo-app/session-1",
    model: "model-large",
    environment: null,
    recordAt: T(minute),
    totals: t,
    taskKey: null,
    agentKind: null,
    step: null,
    ...over,
  };
}

describe("use between two times", () => {
  it("is the difference of running totals, per token kind, the first sample counting from zero", () => {
    const deltas = deltasOfSeries([sample(0, totals(4, 1025, 94256, 56)), sample(5, totals(10, 1025, 100000, 80))]);
    expect(deltas.map((d) => d.used)).toEqual([totals(4, 1025, 94256, 56), totals(6, 0, 5744, 24)]);
    expect(useBetween(deltas, T(0), T(5))).toEqual(totals(6, 0, 5744, 24));
    expect(useBetween(deltas, null, T(5))).toEqual(totals(10, 1025, 100000, 80));
  });

  it("keeps models and agents apart: each series is subtracted from its own previous sample", () => {
    const deltas = usageDeltas([
      sample(0, totals(10, 0, 0, 10)),
      sample(0, totals(50, 0, 0, 50), { model: "model-small" }),
      sample(5, totals(20, 0, 0, 30)),
      sample(5, totals(60, 0, 0, 90), { model: "model-small" }),
    ]);
    const bySmall = deltas.filter((d) => d.sample.model === "model-small");
    expect(bySmall.map((d) => totalOf(d.used))).toEqual([100, 50]);
    expect(useBetween(deltas, T(0), T(5))).toEqual(totals(20, 0, 0, 60));
  });

  it("counts a restart from zero when any running total goes down, never as negative use", () => {
    const deltas = deltasOfSeries([
      sample(0, totals(100, 100, 100, 100)),
      sample(5, totals(150, 100, 100, 120)),
      sample(10, totals(30, 0, 10, 5)),
      sample(15, totals(40, 0, 30, 9)),
    ]);
    expect(deltas.map((d) => d.restart)).toEqual([false, false, true, false]);
    expect(deltas[2]?.used).toEqual(totals(30, 0, 10, 5));
    expect(deltas[3]?.used).toEqual(totals(10, 0, 20, 4));
  });

  it("treats a restart where only one kind went down as a restart of all four", () => {
    const deltas = deltasOfSeries([sample(0, totals(10, 10, 10, 10)), sample(5, totals(50, 50, 5, 50))]);
    expect(deltas[1]?.restart).toBe(true);
    expect(deltas[1]?.used).toEqual(totals(50, 50, 5, 50));
  });

  it("puts a late report in its place in the order, so nothing is counted twice", () => {
    const early = [sample(0, totals(10, 0, 0, 0)), sample(10, totals(30, 0, 0, 0))];
    const withLate = deltasOfSeries([...early, sample(5, totals(20, 0, 0, 0))]);
    expect(useBetween(withLate, null, T(10))).toEqual(useBetween(deltasOfSeries(early), null, T(10)));
    expect(withLate.map((d) => d.used.input)).toEqual([10, 10, 10]);
  });

  it("treats the same series in two environments as two series", () => {
    const deltas = usageDeltas([
      sample(0, totals(10, 0, 0, 0), { environment: "laptop" }),
      sample(0, totals(10, 0, 0, 0), { environment: "cloud-vm" }),
    ]);
    expect(deltas).toHaveLength(2);
    expect(useBetween(deltas, null, T(0)).input).toBe(20);
  });
});

describe("environments", () => {
  const deltas = usageDeltas([
    sample(0, totals(100, 0, 0, 0), { environment: "laptop" }),
    sample(0, totals(10, 0, 0, 0), { environment: "cloud-vm", agentKey: "demo-app/session-2" }),
    sample(0, totals(5, 0, 0, 0), { agentKey: "demo-app/session-3" }),
  ]);

  it("finds the busiest named environment and moves unnamed reports to the base", () => {
    expect(busiestEnvironment(deltas)).toBe("laptop");
    const moved = withBaseEnvironment(deltas, "laptop");
    expect(moved.filter((d) => d.sample.environment === "laptop")).toHaveLength(2);
  });

  it("leaves unnamed reports alone when no base is known", () => {
    expect(withBaseEnvironment(deltas, null)).toBe(deltas);
    expect(busiestEnvironment(usageDeltas([sample(0, totals(1, 0, 0, 0))]))).toBeNull();
  });
});

describe("buckets and splits", () => {
  it("buckets in the viewer's time", () => {
    expect(bucketKey("2026-11-16T23:30:00.000Z", 60, BucketUnit.Day)).toBe("2026-11-17");
    expect(bucketKey("2026-11-16T23:30:00.000Z", 0, BucketUnit.Hour)).toBe("2026-11-16T23");
    expect(bucketKeys("2026-11-14T10:00:00.000Z", "2026-11-16T01:00:00.000Z", 0, BucketUnit.Day)).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
    ]);
  });

  it("works the offset out per bucket across a daylight-saving change (Slice 35 #1)", () => {
    const berlin = zoneOffsetAt("Europe/Berlin") as (ms: number) => number;
    expect(berlin(Date.parse("2026-10-24T12:00:00Z"))).toBe(120);
    expect(berlin(Date.parse("2026-10-26T12:00:00Z"))).toBe(60);
    // 22:30 UTC is already the next day under +02:00 before the change and not yet under +01:00 after it.
    expect(bucketKey("2026-10-24T22:30:00.000Z", berlin, BucketUnit.Day)).toBe("2026-10-25");
    expect(bucketKey("2026-10-25T22:30:00.000Z", berlin, BucketUnit.Day)).toBe("2026-10-25");
    expect(bucketKey("2026-10-25T23:30:00.000Z", berlin, BucketUnit.Day)).toBe("2026-10-26");
    const buckets = bucketsBetween(Date.parse("2026-10-20T10:00:00.000Z"), Date.parse("2026-11-05T10:00:00.000Z"), berlin, BucketUnit.Day);
    const keys = buckets.map((b) => b.key);
    expect(keys).toHaveLength(17);
    const hours = (key: string): number => {
      const b = buckets.find((x) => x.key === key) as { startMs: number; endMs: number };
      return (b.endMs - b.startMs) / 3_600_000;
    };
    expect(hours("2026-10-25")).toBe(25);
    expect(hours("2026-10-24")).toBe(24);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(4, 8)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });

  it("never skips a short day at the spring change, and knows no zone it cannot read", () => {
    const berlin = zoneOffsetAt("Europe/Berlin") as (ms: number) => number;
    const keys = bucketKeys("2026-03-28T22:30:00.000Z", "2026-03-30T22:30:00.000Z", berlin, BucketUnit.Day);
    expect(keys).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    const spring = bucketsBetween(Date.parse("2026-03-28T22:30:00.000Z"), Date.parse("2026-03-30T22:30:00.000Z"), berlin, BucketUnit.Day);
    expect(((spring[1]?.endMs ?? 0) - (spring[1]?.startMs ?? 0)) / 3_600_000).toBe(23);
    expect(zoneOffsetAt("Not/AZone")).toBeNull();
  });

  it("keys hours by the real hour across both clock changes (review finding 3)", () => {
    const berlin = offsetForZone("Europe/Berlin", 0);
    // Fall back on 2026-10-25: 02:xx happens twice (00:30Z in +02:00, 01:30Z in +01:00).
    const fall = bucketKeys("2026-10-24T23:10:00.000Z", "2026-10-25T03:10:00.000Z", berlin, BucketUnit.Hour);
    expect(fall).toEqual(["2026-10-25T01", "2026-10-25T02", "2026-10-25T02#2", "2026-10-25T03", "2026-10-25T04"]);
    expect(bucketKey("2026-10-25T00:30:00.000Z", berlin, BucketUnit.Hour)).toBe("2026-10-25T02");
    expect(bucketKey("2026-10-25T01:30:00.000Z", berlin, BucketUnit.Hour)).toBe("2026-10-25T02#2");
    // Spring forward on 2026-03-29: 02:xx never happens.
    const spring = bucketKeys("2026-03-29T00:10:00.000Z", "2026-03-29T02:10:00.000Z", berlin, BucketUnit.Hour);
    expect(spring).toEqual(["2026-03-29T01", "2026-03-29T03", "2026-03-29T04"]);
    // Hours are consecutive real hours: no gap and no overlap.
    const walked = bucketsBetween(Date.parse("2026-10-24T23:10:00.000Z"), Date.parse("2026-10-25T03:10:00.000Z"), berlin, BucketUnit.Hour);
    walked.slice(1).forEach((b, i) => expect(b.startMs).toBe((walked[i] as { endMs: number }).endMs));
    // A fixed offset never repeats an hour.
    expect(bucketKeys("2026-10-25T00:00:00.000Z", "2026-10-25T03:00:00.000Z", 120, BucketUnit.Hour)).toHaveLength(4);
  });

  it("walks a 30-minute shift zone by real hours and keeps every key distinct (review finding 4)", () => {
    const lordHowe = offsetForZone("Australia/Lord_Howe", 0);
    // Fall back on 2026-04-05 at 02:00 local (+11:00 -> +10:30): the clocks repeat half an hour.
    const buckets = bucketsBetween(Date.parse("2026-04-04T13:00:00.000Z"), Date.parse("2026-04-05T00:00:00.000Z"), lordHowe, BucketUnit.Hour);
    const keys = buckets.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(buckets).toHaveLength(12);
    buckets.slice(1).forEach((b, i) => expect(b.startMs).toBe((buckets[i] as { endMs: number }).endMs));
  });

  it("ends a walk on milliseconds even when the end falls in a skipped hour or a skipped day", () => {
    const berlin = offsetForZone("Europe/Berlin", 0);
    const toSkipped = bucketsBetween(Date.parse("2026-03-29T00:10:00.000Z"), Date.parse("2026-03-29T01:00:00.000Z"), berlin, BucketUnit.Hour);
    expect(toSkipped.map((b) => b.key)).toEqual(["2026-03-29T01", "2026-03-29T03"]);
    const apia = offsetForZone("Pacific/Apia", 0);
    const days = bucketsBetween(Date.parse("2011-12-28T12:00:00.000Z"), Date.parse("2012-01-02T12:00:00.000Z"), apia, BucketUnit.Day);
    expect(new Set(days.map((b) => b.key)).size).toBe(days.length);
    days.slice(1).forEach((b, i) => expect(b.startMs).toBeGreaterThanOrEqual((days[i] as { endMs: number }).endMs));
  });

  it("finds the bucket holding a moment, and its position along the buckets", () => {
    const berlin = offsetForZone("Europe/Berlin", 0);
    const hours = bucketsBetween(Date.parse("2026-10-24T23:10:00.000Z"), Date.parse("2026-10-25T03:10:00.000Z"), berlin, BucketUnit.Hour);
    expect(hours.map((b) => b.key)).toEqual(["2026-10-25T01", "2026-10-25T02", "2026-10-25T02#2", "2026-10-25T03", "2026-10-25T04"]);
    // 00:30Z is 02:30 CEST (bar 1, half way); 01:30Z is 02:30 CET (bar 2, half way): two bars, one wall time.
    expect(xOfMoment(Date.parse("2026-10-25T00:30:00.000Z"), hours)).toBeCloseTo(1.5, 9);
    expect(xOfMoment(Date.parse("2026-10-25T01:30:00.000Z"), hours)).toBeCloseTo(2.5, 9);
    expect(xOfMoment(Date.parse("2020-01-01T00:00:00.000Z"), hours)).toBe(0);
    expect(xOfMoment(Date.parse("2030-01-01T00:00:00.000Z"), hours)).toBe(hours.length);
    expect(bucketIndexAt(Date.parse("2026-10-25T01:30:00.000Z"), hours)).toBe(2);
    expect(bucketIndexAt(Date.parse("2020-01-01T00:00:00.000Z"), hours)).toBe(-1);
    // A 25 hour day: 10:30Z is 12.5 hours after local midnight (22:00Z), of 25.
    const days = bucketsBetween(Date.parse("2026-10-24T10:00:00.000Z"), Date.parse("2026-10-26T10:00:00.000Z"), berlin, BucketUnit.Day);
    expect(xOfMoment(Date.parse("2026-10-25T10:30:00.000Z"), days)).toBeCloseTo(1 + 12.5 / 25, 9);
  });

  it("uses one offset rule: the zone when one is known, else the fixed offset", () => {
    expect(offsetForZone(null, 90)).toBe(90);
    expect(offsetForZone("Not/AZone", 90)).toBe(90);
    const berlin = offsetForZone("Europe/Berlin", 0);
    expect(offsetOf(berlin, Date.parse("2026-07-01T00:00:00Z"))).toBe(120);
    expect(offsetOf(berlin, Date.parse("2026-12-01T00:00:00Z"))).toBe(60);
    // The same answer for every moment of a quarter hour, and across a repeated lookup.
    expect(offsetOf(berlin, Date.parse("2026-12-01T00:07:00Z"))).toBe(60);
    expect(offsetOf(berlin, Date.parse("2026-12-01T00:07:00Z"))).toBe(60);
  });

  it("keeps working when callers name more zone spellings than the formatter cache holds", () => {
    const names = Array.from({ length: 14 }, (_, i) => [`Etc/GMT-${i + 1}`, `etc/gmt-${i + 1}`, `ETC/GMT-${i + 1}`]).flat();
    for (const name of names) {
      const zone = zoneOffsetAt(name);
      expect(zone).not.toBeNull();
    }
    expect(offsetOf(zoneOffsetAt("Etc/GMT-5") as OffsetAt, Date.parse("2026-07-01T00:00:00Z"))).toBe(300);
  });

  it("reads a time zone from the query and refuses one it cannot read", () => {
    expect(parseUsageQuery(new URLSearchParams("time_zone=Europe/Berlin")).timeZone).toBe("Europe/Berlin");
    expect(parseUsageQuery(new URLSearchParams("")).timeZone).toBeNull();
    expect(() => parseUsageQuery(new URLSearchParams("time_zone=Not/AZone"))).toThrow(/time_zone/);
  });

  it("puts a day with a far-off time in a bucket once, and sums a large series at once", () => {
    const keys = bucketKeys("2026-11-14T10:00:00.000Z", "2026-11-16T01:00:00.000Z", 0, BucketUnit.Day);
    const deltas = usageDeltas([sample(0, totals(0, 0, 0, 0)), sample(10, totals(5, 0, 0, 0))]);
    const [series] = splitByBucket(deltas, keys, () => keys[1] as string, Split.Model);
    expect(series?.values).toEqual([0, 5, 0]);
  });

  it("splits tokens by model and by token kind into aligned series", () => {
    const deltas = usageDeltas([
      sample(0, totals(1, 2, 3, 4)),
      sample(0, totals(10, 0, 0, 0), { model: "model-small" }),
    ]);
    const buckets = ["2026-11-16"];
    const bucketOf = (): string => "2026-11-16";
    const byModel = splitByBucket(deltas, buckets, bucketOf, Split.Model);
    expect(byModel.map((s) => [s.name, s.values])).toEqual([
      ["model-large", [10]],
      ["model-small", [10]],
    ]);
    const byKind = splitByBucket(deltas, buckets, bucketOf, Split.TokenKind);
    expect(byKind.find((s) => s.name === "cache_read")?.values).toEqual([3]);
  });

  it("ranks tasks by tokens with the rest apart", () => {
    const ranked = rankTasks(new Map([["a", 5], ["b", 9], ["c", 5], ["d", 1]]), 2);
    expect(ranked.top).toEqual([["b", 9], ["a", 5]]);
    expect(ranked.rest).toEqual([["c", 5], ["d", 1]]);
  });
});
