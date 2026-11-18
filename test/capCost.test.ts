import { describe, expect, it } from "vitest";
import { type CapReading, type CapWindow, evaluateAll, WEEKLY_WINDOW } from "../src/domain/cap";
import {
  buildStretches,
  chooseMixWindow,
  MixSource,
  YOUNG_WINDOW_HOURS,
  costByKey,
  type CapCostFit,
  costOf,
  FitMode,
  fitCapCost,
  HowSure,
  MultiplierState,
  placeInWindows,
  type Stretch,
  tokensPerPercent,
  unexplainedRest,
  unexplainedStretches,
  unexplainedTotals,
} from "../src/domain/capCost";
import { DEFAULT_CAP_COST } from "../src/config";
import { type TokenTotals, type UsageDelta, type UsageSample, usageDeltas, zeroTotals } from "../src/domain/usage";

const CONFIG = DEFAULT_CAP_COST;
const BASE = "laptop";
const CLOUD = "cloud";
const MILLION = 1_000_000;
const RESET_1 = "2026-11-17T08:00:00.000Z";
const RESET_2 = "2026-11-24T08:00:00.000Z";
const T = (minute: number): string => new Date(Date.UTC(2026, 10, 16, 0, minute)).toISOString();

/** A small repeatable noise source so the tests need no random seed. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function totals(input: number, cacheWrite = 0, cacheRead = 0, output = 0): TokenTotals {
  return { input, cache_write: cacheWrite, cache_read: cacheRead, output };
}

function stretch(index: number, growth: number, uses: Stretch["uses"]): Stretch {
  return { plan: "plan-a", start: T(index * 60), end: T(index * 60 + 30), growth, uses };
}

/** Growth from known weights (points per million tokens, per kind) and multipliers. */
function growthOf(uses: Stretch["uses"], weights: Record<string, TokenTotals>, multipliers: Record<string, number> = {}): number {
  return uses.reduce((sum, use) => {
    const w = weights[use.model] ?? zeroTotals();
    const points = (w.input * use.totals.input + w.cache_write * use.totals.cache_write + w.cache_read * use.totals.cache_read + w.output * use.totals.output) / MILLION;
    return sum + (multipliers[use.environment] ?? 1) * points;
  }, 0);
}

function same(weight: number): TokenTotals {
  return totals(weight, weight, weight, weight);
}

describe("stretches of time", () => {
  function readingAt(minute: number, percent: number, plan = "plan-a", resetAt: string | null = RESET_1): CapReading {
    return { takenAt: T(minute), plan, windowKind: WEEKLY_WINDOW, percent, resetAt, source: null };
  }

  function deltaAt(minute: number, tokens: number): UsageDelta {
    return {
      sample: { agentKey: "a", model: "m", environment: BASE, recordAt: T(minute), totals: totals(tokens), taskKey: null, agentKind: null, step: null },
      used: totals(tokens),
      restart: false,
    };
  }

  const deltas = [deltaAt(5, 100), deltaAt(25, 200), deltaAt(45, 300), deltaAt(125, 400)];

  it("takes the use between two readings of one window", () => {
    const { windows } = evaluateAll([readingAt(0, 10), readingAt(30, 14), readingAt(60, 20)], 2);
    const stretches = buildStretches(windows, "plan-a", deltas, CONFIG, BASE);
    expect(stretches.map((s) => s.growth)).toEqual([4, 6]);
    expect(stretches[0]?.uses[0]?.totals.input).toBe(300);
    expect(stretches[1]?.uses[0]?.totals.input).toBe(300);
  });

  it("never lets a stretch cross a reset, so no growth is negative", () => {
    const readings = [readingAt(0, 90), readingAt(30, 98), readingAt(60, 1, "plan-a", RESET_2), readingAt(90, 6, "plan-a", RESET_2)];
    const { windows } = evaluateAll(readings, 2);
    const stretches = buildStretches(windows, "plan-a", deltas, CONFIG, BASE);
    expect(stretches.map((s) => [s.start, s.end, s.growth])).toEqual([
      [T(0), T(30), 8],
      [T(60), T(90), 5],
    ]);
  });

  it("leaves out another plan's readings, and a plan change never makes a stretch", () => {
    const readings = [readingAt(0, 10), readingAt(30, 15), readingAt(60, 3, "plan-b", RESET_2), readingAt(90, 9, "plan-b", RESET_2)];
    const { windows } = evaluateAll(readings, 2);
    expect(buildStretches(windows, "plan-a", deltas, CONFIG, BASE).map((s) => s.growth)).toEqual([5]);
    expect(buildStretches(windows, "plan-b", deltas, CONFIG, BASE).map((s) => s.growth)).toEqual([6]);
  });

  it("joins short stretches and ones where the cap did not move, and skips a missing last reading", () => {
    const readings = [readingAt(0, 10), readingAt(5, 10), readingAt(12, 10), readingAt(30, 13), readingAt(35, 13)];
    const { windows } = evaluateAll(readings, 2);
    const stretches = buildStretches(windows, "plan-a", deltas, CONFIG, BASE);
    expect(stretches).toHaveLength(1);
    // The trailing reading at 35 joins the stretch before it in the same window.
    expect(stretches[0]).toMatchObject({ start: T(0), end: T(35), growth: 3 });
  });

  it("joins a window's last short run to the stretch before it, with its growth and its use", () => {
    const readings = [readingAt(0, 10), readingAt(30, 13), readingAt(35, 14)];
    const { windows } = evaluateAll(readings, 2);
    const withLate = [...deltas, deltaAt(32, 50)];
    const stretches = buildStretches(windows, "plan-a", withLate, CONFIG, BASE);
    expect(stretches).toHaveLength(1);
    expect(stretches[0]).toMatchObject({ start: T(0), end: T(35), growth: 4 });
    expect(stretches[0]?.uses[0]?.totals.input).toBe(100 + 200 + 50);
  });

  it("leaves a trailing short run out when its window has no earlier stretch", () => {
    const { windows } = evaluateAll([readingAt(0, 10), readingAt(5, 11)], 2);
    expect(buildStretches(windows, "plan-a", deltas, CONFIG, BASE)).toEqual([]);
  });

  it("makes none from a single reading", () => {
    const { windows } = evaluateAll([readingAt(0, 10)], 2);
    expect(buildStretches(windows, "plan-a", deltas, CONFIG, BASE)).toEqual([]);
  });
});

describe("the best fit", () => {
  it("gives 400,000 tokens per 1% for one model that used 2 million tokens when the cap rose 5%", () => {
    const stretches = [stretch(0, 5, [{ environment: BASE, model: "model-a", totals: totals(2 * MILLION) }]), stretch(1, 2.5, [{ environment: BASE, model: "model-a", totals: totals(MILLION) }]), stretch(2, 10, [{ environment: BASE, model: "model-a", totals: totals(0, 0, 3 * MILLION, MILLION) }])];
    const fit = fitCapCost(stretches, BASE, CONFIG);
    const model = fit.models[0];
    expect(model?.mode).toBe(FitMode.OneWeight);
    expect(tokensPerPercent(model?.perToken ?? zeroTotals(), totals(2 * MILLION))).toBeCloseTo(400_000, 0);
    expect(fit.leftoverShare).toBeCloseTo(0, 6);
  });

  it("finds three models at once", () => {
    const truth = { "model-a": same(2.5), "model-b": same(0.5), "model-c": same(5) };
    const next = lcg(7);
    const stretches = Array.from({ length: 9 }, (_, i) => {
      const uses = Object.keys(truth).map((model) => ({ environment: BASE, model, totals: totals(Math.round(next() * 4 * MILLION)) }));
      return stretch(i, growthOf(uses, truth), uses);
    });
    const fit = fitCapCost(stretches, BASE, CONFIG);
    for (const model of fit.models) {
      expect(model.perToken.input * MILLION).toBeCloseTo(truth[model.model as keyof typeof truth].input, 3);
    }
  });

  it("stays close with noise and says the leftover", () => {
    const truth = { "model-a": same(2), "model-b": same(1) };
    const next = lcg(11);
    const stretches = Array.from({ length: 10 }, (_, i) => {
      const uses = Object.keys(truth).map((model) => ({ environment: BASE, model, totals: totals(Math.round((0.5 + next()) * 3 * MILLION)) }));
      return stretch(i, growthOf(uses, truth) * (1 + (next() - 0.5) * 0.04), uses);
    });
    const fit = fitCapCost(stretches, BASE, CONFIG);
    const a = fit.models.find((m) => m.model === "model-a");
    expect((a?.perToken.input ?? 0) * MILLION).toBeGreaterThan(1.8);
    expect((a?.perToken.input ?? 0) * MILLION).toBeLessThan(2.2);
    expect(fit.leftoverShare).toBeLessThan(0.05);
    expect(a?.howSure).toBe(HowSure.Sure);
  });

  it("is rough with few stretches and keeps use no report shows as a leftover, never as a model's cost", () => {
    const truth = { "model-a": same(2) };
    const next = lcg(3);
    const stretches = Array.from({ length: 4 }, (_, i) => {
      const uses = [{ environment: BASE, model: "model-a", totals: totals(Math.round((1 + next()) * MILLION)) }];
      return stretch(i, growthOf(uses, truth) + (i === 2 ? 3 : 0), uses);
    });
    const fit = fitCapCost(stretches, BASE, CONFIG);
    expect(fit.models[0]?.howSure).toBe(HowSure.Rough);
    expect(fit.leftoverShare).toBeGreaterThan(0.1);
    const worst = unexplainedStretches(fit, T(-1), 3)[0];
    expect(worst?.start).toBe(stretches[2]?.start);
    expect(unexplainedTotals(fit, T(-1)).points).toBeGreaterThan(2);
  });

  it("starts coarse and gets a weight per kind once there are three times the unknowns in stretches", () => {
    const truth = { "model-a": totals(1, 1.25, 0.1, 5) };
    const next = lcg(5);
    const build = (count: number): Stretch[] =>
      Array.from({ length: count }, (_, i) => {
        const uses = [{ environment: BASE, model: "model-a", totals: totals(next() * 2 * MILLION, next() * 2 * MILLION, next() * 20 * MILLION, next() * MILLION) }];
        return stretch(i, growthOf(uses, truth), uses);
      });
    expect(fitCapCost(build(11), BASE, CONFIG).models[0]?.mode).toBe(FitMode.OneWeight);
    const fine = fitCapCost(build(14), BASE, CONFIG).models[0];
    expect(fine?.mode).toBe(FitMode.PerKind);
    expect(fine?.finerAt).toBe(12);
    expect((fine?.perToken.output ?? 0) * MILLION).toBeCloseTo(5, 2);
    expect((fine?.perToken.cache_read ?? 0) * MILLION).toBeCloseTo(0.1, 2);
  });

  it("never gives a negative weight", () => {
    const stretches = [
      stretch(0, 1, [{ environment: BASE, model: "model-a", totals: totals(MILLION) }, { environment: BASE, model: "model-b", totals: totals(MILLION) }]),
      stretch(1, 0.2, [{ environment: BASE, model: "model-a", totals: totals(MILLION) }, { environment: BASE, model: "model-b", totals: totals(3 * MILLION) }]),
      stretch(2, 1, [{ environment: BASE, model: "model-a", totals: totals(2 * MILLION) }]),
    ];
    for (const model of fitCapCost(stretches, BASE, CONFIG).models) {
      for (const value of Object.values(model.perToken)) expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("a multiplier per environment", () => {
  function mixed(multiplier: number): Stretch[] {
    const truth = { "model-a": same(2) };
    const next = lcg(21);
    return Array.from({ length: 8 }, (_, i) => {
      const cloudShare = i % 2 === 0 ? 0.9 : i % 4 === 1 ? 0.3 : 0.1;
      const total = (1 + next()) * 2 * MILLION;
      const uses = [
        { environment: BASE, model: "model-a", totals: totals(total * (1 - cloudShare)) },
        { environment: CLOUD, model: "model-a", totals: totals(total * cloudShare) },
      ];
      return stretch(i, growthOf(uses, truth, { [CLOUD]: multiplier }), uses);
    });
  }

  it("counts cloud use fully: about 1x, and a cloud-only task costs the same as the same tokens on the base", () => {
    const fit = fitCapCost(mixed(1), BASE, CONFIG);
    const cloud = fit.environments.find((e) => e.environment === CLOUD);
    expect(cloud?.state).toBe(MultiplierState.Measured);
    expect(Math.abs((cloud?.multiplier ?? 0) - 1)).toBeLessThan(0.15);
    expect(fit.environments.find((e) => e.environment === BASE)).toMatchObject({ multiplier: 1, state: MultiplierState.Base });
    expect(costOf(deltaOf(CLOUD, 1_000_000), fit, BASE) / costOf(deltaOf(BASE, 1_000_000), fit, BASE)).toBeCloseTo(1, 1);
  });

  it("counts cloud use as free: about 0x, nothing negative, a cloud-only task costs about 0%", () => {
    const fit = fitCapCost(mixed(0), BASE, CONFIG);
    const cloud = fit.environments.find((e) => e.environment === CLOUD);
    expect(cloud?.multiplier).toBeGreaterThanOrEqual(0);
    expect(cloud?.multiplier).toBeLessThan(0.1);
    for (const model of fit.models) for (const value of Object.values(model.perToken)) expect(value).toBeGreaterThanOrEqual(0);
    expect(costOf(deltaOf(CLOUD, 10 * MILLION), fit, BASE)).toBeLessThan(0.1);
    expect(costOf(deltaOf(BASE, 10 * MILLION), fit, BASE)).toBeGreaterThan(5);
  });

  it("counts an environment as 1x and says so when it has too few stretches or never differs in mix", () => {
    const few = mixed(0).slice(0, 3);
    expect(fitCapCost(few, BASE, CONFIG).environments.find((e) => e.environment === CLOUD)).toMatchObject({ multiplier: 1, state: MultiplierState.NotEnough });
    const proportional = mixed(1).map((s) => ({
      ...s,
      uses: s.uses.map((use) => ({ ...use, totals: totals(use.environment === CLOUD ? 1000 : 1000) })),
    }));
    const flat = fitCapCost(proportional, BASE, CONFIG).environments.find((e) => e.environment === CLOUD);
    expect(flat).toMatchObject({ multiplier: 1, state: MultiplierState.NotEnough });
  });
});

function deltaOf(environment: string, tokens: number): UsageDelta {
  return {
    sample: { agentKey: "a", model: "model-a", environment, recordAt: T(0), totals: totals(tokens), taskKey: null, agentKind: null, step: null },
    used: totals(tokens),
    restart: false,
  };
}

describe("how sure and the shown unexplained share", () => {
  it("shows the unexplained share from positive residuals but judges how sure on the net error, so +3 and -3 do not hurt", () => {
    const uses = [{ environment: BASE, model: "model-a", totals: totals(MILLION) }];
    const stretches = [stretch(0, 13, uses), stretch(1, 7, uses)];
    const config = { ...CONFIG, sure: { minStretches: 2, maxLeftoverShare: 0.1 } };
    const fit = fitCapCost(stretches, BASE, config);
    expect(fit.residuals[0]).toBeCloseTo(3, 3);
    expect(fit.residuals[1]).toBeCloseTo(-3, 3);
    expect(fit.leftoverShare).toBeCloseTo(0.15, 3);
    expect(fit.models[0]?.howSure).toBe(HowSure.Sure);
  });
});

describe("an environment collinear with the base", () => {
  it("counts it as 1x, says not enough data, and gives nothing negative", () => {
    const next = lcg(5);
    const stretches = Array.from({ length: 8 }, (_, i) => {
      const base = (1 + next()) * 2 * MILLION;
      const uses = [
        { environment: BASE, model: "model-a", totals: totals(base) },
        { environment: CLOUD, model: "model-a", totals: totals(base * 0.5) },
      ];
      return stretch(i, growthOf(uses, { "model-a": same(2) }), uses);
    });
    const fit = fitCapCost(stretches, BASE, CONFIG);
    expect(fit.environments.find((e) => e.environment === CLOUD)).toMatchObject({ multiplier: 1, state: MultiplierState.NotEnough });
    for (const environment of fit.environments) expect(environment.multiplier).toBeGreaterThanOrEqual(0);
    for (const model of fit.models) for (const value of Object.values(model.perToken)) expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe("the whole derive path on a realistic month", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const END = Date.parse("2026-11-16T12:00:00.000Z");
  const WEEK = 7 * DAY;

  /** Hourly-thinned rows older than three days, a raw row every five minutes since, for 3 models x 3 environments. */
  function samples(): UsageSample[] {
    const times: number[] = [];
    for (let t = END - 30 * DAY; t < END - 3 * DAY; t += HOUR) times.push(t);
    for (let t = END - 3 * DAY; t <= END; t += 5 * 60_000) times.push(t);
    return ["model-a", "model-b", "model-c"].flatMap((model, m) =>
      [BASE, CLOUD, "desktop"].flatMap((environment, e) =>
        times.map((time, i) => ({
          agentKey: `demo-app/${model}-${environment}`,
          model,
          environment,
          recordAt: new Date(time).toISOString(),
          totals: totals(i * (1000 + m * 300), i * 200 * (1 + e), i * 9000 * (1 + m), i * 150),
          taskKey: null,
          agentKind: null,
          step: null,
        })),
      ),
    );
  }

  /** A reading every three hours; the cap climbs a little each time and resets weekly. */
  function readings(): CapReading[] {
    const first = END - 30 * DAY;
    const all: CapReading[] = [];
    for (let t = first; t <= END; t += 3 * HOUR) {
      const week = Math.floor((t - first) / WEEK);
      const into = (t - first) % WEEK;
      const reset = new Date(first + (week + 1) * WEEK).toISOString();
      all.push({ takenAt: new Date(t).toISOString(), plan: "plan-a", windowKind: WEEKLY_WINDOW, percent: 1 + (into / WEEK) * 90, resetAt: reset, source: null });
    }
    return all;
  }

  it("derives deltas, stretches and the fit from 30 days of samples well inside the Worker CPU budget", () => {
    const rows = samples();
    const caps = readings();
    const started = performance.now();
    const deltas = usageDeltas(rows);
    const { windows } = evaluateAll(caps, 2);
    const stretches = buildStretches(windows, "plan-a", deltas, CONFIG, BASE);
    const fit = fitCapCost(stretches, BASE, CONFIG);
    const elapsed = performance.now() - started;
    console.log(`derive path: ${rows.length} samples, ${caps.length} readings, ${stretches.length} stretches: ${Math.round(elapsed)} ms`);
    expect(stretches.length).toBeGreaterThan(50);
    expect(fit.models.length).toBe(3);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("the fit stays bounded", () => {
  /** A few hundred stretches, three models per kind, three environments and near-collinear columns (cache read follows input). */
  function worstCase(count: number): Stretch[] {
    const next = lcg(7);
    const environments = [BASE, CLOUD, "desktop"];
    return Array.from({ length: count }, (_, i) => {
      const uses = ["model-a", "model-b", "model-c"].flatMap((model) =>
        environments.map((environment) => {
          const input = (1 + next()) * MILLION * (1 + (i % 3));
          return { environment, model, totals: totals(input, input * 0.2 * (1 + next() * 1e-6), input * 10 * (1 + next() * 1e-6), input * 0.1 * (1 + next())) };
        }),
      );
      return stretch(i, 1 + next() * 5, uses);
    });
  }

  it("fits a worst-case sized input well inside the Worker CPU budget", () => {
    const stretches = worstCase(400);
    const started = performance.now();
    const fit = fitCapCost(stretches, BASE, CONFIG);
    const elapsed = performance.now() - started;
    expect(fit.models.every((m) => m.mode === FitMode.PerKind)).toBe(true);
    // Measured about 170 ms here (slice file); the bound leaves room for a slow CI machine.
    expect(elapsed).toBeLessThan(1500);
    for (const model of fit.models) for (const value of Object.values(model.perToken)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it("fits no environment multiplier when there is no base environment at all", () => {
    const uses = (named: string): Stretch["uses"] => [{ environment: named, model: "model-a", totals: totals(MILLION) }];
    const stretches = Array.from({ length: 8 }, (_, i) => stretch(i, 2 + i, [...uses(""), ...(i % 2 === 0 ? uses(CLOUD) : [])]));
    const fit = fitCapCost(stretches, null, CONFIG);
    expect(fit.environments.some((e) => e.state === MultiplierState.Measured)).toBe(false);
  });
});

describe("a model with no fitted weight", () => {
  it("has no known cost: the key is null, never 0", () => {
    const stretches = Array.from({ length: 4 }, (_, i) => stretch(i, 2, [{ environment: BASE, model: "model-a", totals: totals(MILLION) }]));
    const fit = fitCapCost(stretches, BASE, CONFIG);
    const unknown = { ...deltaOf(BASE, MILLION), sample: { ...deltaOf(BASE, MILLION).sample, model: "model-z", taskKey: "task-z" } };
    const known = { ...deltaOf(BASE, MILLION), sample: { ...deltaOf(BASE, MILLION).sample, taskKey: "task-a" } };
    const costs = costByKey([unknown, known], fit, BASE, ({ sample }) => sample.taskKey);
    expect(costs.get("task-z")).toBeNull();
    expect(costs.get("task-a")).toBeGreaterThan(0);
    const mixed = costByKey([known, { ...unknown, sample: { ...unknown.sample, taskKey: "task-a" } }], fit, BASE, ({ sample }) => sample.taskKey);
    expect(mixed.get("task-a")).toBeNull();
  });
});

describe("unexplained stretches", () => {
  it("lists the largest unexplained growth first with how much the reports explained", () => {
    const uses = (tokens: number): Stretch["uses"] => [{ environment: BASE, model: "model-a", totals: totals(tokens * MILLION) }];
    const stretches = [stretch(0, 2, uses(1)), stretch(1, 2, uses(1)), stretch(2, 5.5, uses(1)), stretch(3, 2, uses(1)), stretch(4, 2, uses(1))];
    const fit = fitCapCost(stretches, BASE, CONFIG);
    const top = unexplainedStretches(fit, T(-1), 3);
    expect(top[0]).toMatchObject({ start: stretches[2]?.start, end: stretches[2]?.end });
    expect(top[0]?.points).toBeGreaterThan(2);
    expect(top[0]?.points).toBeGreaterThanOrEqual(top[1]?.points ?? 0);
    expect((top[0]?.explainedPoints ?? 0) + (top[0]?.points ?? 0)).toBeCloseTo(5.5, 6);
    expect(unexplainedStretches(fit, T(-1), 1)).toHaveLength(1);
  });
});

describe("growth placed inside reported chat windows (Slice 16)", () => {
  const CHAT = "Claude chat";
  const DESIGN = "Claude Design";
  /** A fit built by hand: `count` stretches of 60 minutes, each with `left` points the reports do not explain. */
  function fitWith(left: number, count = 1): CapCostFit {
    const stretches = Array.from({ length: count }, (_, i): Stretch => ({ plan: "plan-a", start: T(i * 60), end: T(i * 60 + 60), growth: left, uses: [] }));
    return { models: [], environments: [], stretches, residuals: stretches.map(() => left), leftoverShare: 1 };
  }
  const window = (environment: string, from: number, to: number) => ({ environment, start: T(from), end: T(to) });

  it("leaves everything unexplained when no chat reported work", () => {
    const placed = placeInWindows(fitWith(6), [], T(-1));
    expect(placed.byEnvironment.size).toBe(0);
    expect(placed.fit.residuals).toEqual([6]);
  });

  it("puts the share of the stretch a window covers against its environment", () => {
    const placed = placeInWindows(fitWith(6), [window(CHAT, 0, 30)], T(-1));
    expect(placed.byEnvironment.get(CHAT)).toBeCloseTo(3, 9);
    expect(placed.fit.residuals[0]).toBeCloseTo(3, 9);
    expect(unexplainedTotals(placed.fit, T(-1)).points).toBeCloseTo(3, 9);
  });

  it("merges windows of one environment spelled with different case or spaces, under one name", () => {
    const placed = placeInWindows(fitWith(6), [window(CHAT, 0, 40), window("claude chat ", 20, 60)], T(-1));
    expect([...placed.byEnvironment.keys()]).toEqual([CHAT]);
    expect(placed.byEnvironment.get(CHAT)).toBeCloseTo(6, 9);
  });

  it("leaves growth outside every window unexplained", () => {
    const placed = placeInWindows(fitWith(6), [window(CHAT, 90, 120)], T(-1));
    expect(placed.byEnvironment.size).toBe(0);
    expect(placed.fit.residuals).toEqual([6]);
  });

  it("splits overlapping windows pro rata to their overlap, counting the shared time once", () => {
    const placed = placeInWindows(fitWith(6), [window(CHAT, 0, 40), window(DESIGN, 20, 60)], T(-1));
    expect(placed.byEnvironment.get(CHAT)).toBeCloseTo(3, 9);
    expect(placed.byEnvironment.get(DESIGN)).toBeCloseTo(3, 9);
    expect(placed.fit.residuals[0]).toBeCloseTo(0, 9);
    const uneven = placeInWindows(fitWith(6), [window(CHAT, 0, 15), window(DESIGN, 0, 45)], T(-1));
    expect(uneven.byEnvironment.get(CHAT)).toBeCloseTo((4.5 * 15) / 60, 9);
    expect(uneven.byEnvironment.get(DESIGN)).toBeCloseTo((4.5 * 45) / 60, 9);
  });

  it("never places more than the unexplained growth, and ignores negative residuals", () => {
    const placed = placeInWindows({ ...fitWith(6), residuals: [-2] }, [window(CHAT, 0, 60)], T(-1));
    expect(placed.byEnvironment.size).toBe(0);
    expect(placed.fit.residuals).toEqual([-2]);
    const all = placeInWindows(fitWith(6), [window(CHAT, 0, 60), window(DESIGN, 0, 60)], T(-1));
    expect((all.byEnvironment.get(CHAT) ?? 0) + (all.byEnvironment.get(DESIGN) ?? 0)).toBeCloseTo(6, 9);
  });

  it("counts only stretches ending after the range start towards the environments, but shrinks every residual", () => {
    const placed = placeInWindows(fitWith(6, 2), [window(CHAT, 0, 120)], T(60));
    expect(placed.byEnvironment.get(CHAT)).toBeCloseTo(6, 9);
    expect(placed.fit.residuals[0]).toBeCloseTo(0, 9);
    expect(placed.fit.residuals[1]).toBeCloseTo(0, 9);
  });

  it("stays fast with hundreds of stretches and windows", () => {
    const windows = Array.from({ length: 300 }, (_, i) => window(i % 2 === 0 ? CHAT : DESIGN, i * 60, i * 60 + 45));
    const started = performance.now();
    const placed = placeInWindows(fitWith(2, 400), windows, T(-1));
    const elapsed = performance.now() - started;
    expect(placed.byEnvironment.get(CHAT)).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
  });

  it("stays fast and bounded with far more windows than the cap, keeping the newest", () => {
    const count = 3000;
    const windows = Array.from({ length: count }, (_, i) => window(i % 2 === 0 ? CHAT : DESIGN, i * 60, i * 60 + 45));
    const started = performance.now();
    const placed = placeInWindows(fitWith(2, count), windows, T(-1));
    const elapsed = performance.now() - started;
    expect(placed.byEnvironment.get(CHAT)).toBeGreaterThan(0);
    expect(placed.fit.residuals[0]).toBe(2);
    expect(placed.fit.residuals[count - 1]).toBeLessThan(2);
    expect(elapsed).toBeLessThan(1500);
  });

  it("recomputes the unexplained share from the residuals left after placing", () => {
    const placed = placeInWindows(fitWith(6), [window(CHAT, 0, 30)], T(-1));
    expect(placed.fit.leftoverShare).toBeCloseTo(0.5, 9);
  });
});

describe("placement edge cases (Slice 35)", () => {
  const fitOf = (left: number): CapCostFit => {
    const stretches: Stretch[] = [{ plan: "plan-a", start: T(0), end: T(60), growth: left, uses: [] }];
    return { models: [], environments: [], stretches, residuals: [left], leftoverShare: 1 };
  };
  const win = (environment: string, start: string, end: string) => ({ environment, start, end });

  it("compares window times as times, not as text", () => {
    const offsetForm = new Date(T(0)).toISOString().replace("Z", "+00:00");
    const placed = placeInWindows(fitOf(6), [win("Claude chat", offsetForm, T(30))], T(-1));
    expect(placed.byEnvironment.get("Claude chat")).toBeCloseTo(3, 6);
  });

  it("ignores zero-length and unreadable windows", () => {
    const placed = placeInWindows(fitOf(6), [win("Claude chat", T(10), T(10)), win("Claude Design", "not a time", T(30))], T(-1));
    expect(placed.byEnvironment.size).toBe(0);
    expect(placed.fit.residuals).toEqual([6]);
  });

  it("splits a stretch between three overlapping windows pro rata and keeps the sums whole", () => {
    const placed = placeInWindows(fitOf(6), [win("A", T(0), T(30)), win("B", T(0), T(30)), win("C", T(0), T(30))], T(-1));
    for (const name of ["A", "B", "C"]) expect(placed.byEnvironment.get(name)).toBeCloseTo(1, 6);
    expect((placed.fit.residuals[0] ?? 0) + [...placed.byEnvironment.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(6, 6);
  });

  it("counts growth under the listing threshold in the rest, so listed points plus the rest are the total", () => {
    const stretches: Stretch[] = [0, 1, 2].map((i) => ({ plan: "plan-a", start: T(i * 60), end: T(i * 60 + 60), growth: 1, uses: [] }));
    const fit: CapCostFit = { models: [], environments: [], stretches, residuals: [0.04, 0.03, 2], leftoverShare: 1 };
    const listed = unexplainedStretches(fit, T(-1), 5).reduce((sum, s) => sum + s.points, 0);
    expect(unexplainedStretches(fit, T(-1), 5)).toHaveLength(1);
    expect(listed + unexplainedRest(fit, T(-1), 5)).toBeCloseTo(unexplainedTotals(fit, T(-1)).points, 9);
    expect(unexplainedRest(fit, T(-1), 5)).toBeCloseTo(0.07, 9);
  });
});

describe("which window's mix weights all kinds (Slice 26)", () => {
  const FIRST = "2026-11-10T08:00:00.000Z";
  const SECOND = "2026-11-17T08:00:00.000Z";
  const hoursAfter = (start: string, hours: number): Date => new Date(Date.parse(start) + hours * 3_600_000);
  const weekly = (startedAt: string, plan = "plan-a"): CapWindow => ({ plan, windowKind: WEEKLY_WINDOW, startedAt, resetAt: null, readings: [], peak: 0 });

  it("takes the last full window while the newest one is an hour old", () => {
    const choice = chooseMixWindow([weekly(FIRST), weekly(SECOND)], "plan-a", hoursAfter(SECOND, 1));
    expect(choice).toEqual({ source: MixSource.LastFull, from: FIRST, to: SECOND });
  });

  it("takes the current window once it is 30 hours old, and exactly at a day", () => {
    const windows = [weekly(FIRST), weekly(SECOND)];
    expect(chooseMixWindow(windows, "plan-a", hoursAfter(SECOND, 30)).source).toBe(MixSource.Current);
    expect(chooseMixWindow(windows, "plan-a", hoursAfter(SECOND, YOUNG_WINDOW_HOURS)).source).toBe(MixSource.Current);
  });

  it("skips a stub window left by a reset glitch and takes the last one that lasted a day", () => {
    const stub = hoursAfter(SECOND, -0.5).toISOString();
    const windows = [weekly(FIRST), weekly(stub), weekly(SECOND)];
    expect(chooseMixWindow(windows, "plan-a", hoursAfter(SECOND, 1))).toEqual({ source: MixSource.LastFull, from: FIRST, to: stub });
  });

  it("measures the newest window's age from its reset time when the first reading came late", () => {
    const resetAt = new Date(Date.parse(SECOND) + 7 * 24 * 3_600_000).toISOString();
    const lateFirst = hoursAfter(SECOND, 40).toISOString();
    const late: CapWindow = { ...weekly(lateFirst), resetAt };
    const oldEnough = chooseMixWindow([weekly(FIRST), late], "plan-a", hoursAfter(SECOND, 41));
    expect(oldEnough.source).toBe(MixSource.Current);
    const young = chooseMixWindow([weekly(FIRST), { ...late, resetAt: null }], "plan-a", hoursAfter(SECOND, 41));
    expect(young.source).toBe(MixSource.LastFull);
  });

  it("falls back to the current mix when every earlier window is a stub", () => {
    const stub = hoursAfter(SECOND, -0.5).toISOString();
    expect(chooseMixWindow([weekly(stub), weekly(SECOND)], "plan-a", hoursAfter(SECOND, 1)).source).toBe(MixSource.Current);
  });

  it("has nothing to fall back on with one window or no plan, and ignores other plans and short windows", () => {
    expect(chooseMixWindow([weekly(SECOND)], "plan-a", hoursAfter(SECOND, 1)).source).toBe(MixSource.Current);
    expect(chooseMixWindow([weekly(FIRST), weekly(SECOND)], null, hoursAfter(SECOND, 1)).source).toBe(MixSource.Current);
    expect(chooseMixWindow([weekly(FIRST, "plan-b"), weekly(SECOND)], "plan-a", hoursAfter(SECOND, 1)).source).toBe(MixSource.Current);
    const short = { ...weekly(FIRST), windowKind: "short" };
    expect(chooseMixWindow([short, weekly(SECOND)], "plan-a", hoursAfter(SECOND, 1)).source).toBe(MixSource.Current);
  });
});
