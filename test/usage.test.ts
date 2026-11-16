import { describe, expect, it } from "vitest";
import {
  BucketUnit,
  bucketKey,
  bucketKeys,
  busiestEnvironment,
  deltasOfSeries,
  rankTasks,
  Split,
  splitByBucket,
  type TokenTotals,
  totalOf,
  type UsageSample,
  usageDeltas,
  useBetween,
  withBaseEnvironment,
} from "../src/domain/usage";

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
