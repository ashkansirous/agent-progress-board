import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { type CapReading, type CapWindow, evaluateAll, ownCapModels, WEEKLY_WINDOW } from "../src/domain/cap";
import {
  buildStretches,
  costedModels,
  fitOwnCap,
  fromFitStart,
  ownCapKinds,
  chooseMixWindow,
  environmentIdentity,
  IDENTITY_TRIM_CHARS,
  MAX_PLACE_WINDOWS,
  MixSource,
  YOUNG_WINDOW_HOURS,
  costByKey,
  type CapCostFit,
  type ModelFit,
  costOf,
  FitMode,
  fitCapCost,
  HowSure,
  MultiplierState,
  placeInWindows,
  type Stretch,
  tokensPerPercent,
  unexplainedStretches,
  unexplainedTotals,
} from "../src/domain/capCost";
import { DEFAULT_CAP_COST } from "../src/config";
import { type TokenTotals, type UsageDelta, type UsageSample, usageDeltas, zeroTotals } from "../src/domain/usage";

/** The exact-recovery tests run without the ridge term (it shrinks a fit by about a tenth of a percent); its own tests set it. */
const CONFIG = { ...DEFAULT_CAP_COST, ridge: 0 };
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

/** How long the fixed loop below takes on an idle machine, in ms (measured on the dev machine; a bit above it). */
const IDLE_LOOP_MS = 8;

/**
 * A time limit scaled by how busy this machine is right now: the same fixed loop is timed, best of three, and the limit
 * grows by that loop's slowdown against `IDLE_LOOP_MS`. A suite running beside an e2e run stretches the limit; code that
 * really got slower still fails, because the loop does not slow with it (Slice 45).
 */
function scaledBudget(baseMs: number): number {
  const once = (): number => {
    const started = performance.now();
    let sum = 0;
    for (let i = 0; i < 3_000_000; i++) sum += Math.sqrt(i) * 1.0000001;
    return sum < 0 ? 0 : performance.now() - started;
  };
  return baseMs * Math.max(1, Math.min(once(), once(), once()) / IDLE_LOOP_MS);
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
    // Three stretches are under the default evidence floor, which would leave the model out of the fit.
    const fit = fitCapCost(stretches, BASE, { ...CONFIG, modelMinStretches: 1 });
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

/** Slice 67: the fit shows only numbers it can back. Counts are made up; no names. */
describe("believable cap cost (Slice 67)", () => {
  const RIDGED = { ...DEFAULT_CAP_COST };
  const noise = lcg(67);

  /** One stretch of `use` per model, with growth from the true weights (points per million tokens) plus a share of noise and a daily untracked amount. */
  function replay(index: number, mix: Record<string, TokenTotals>, truth: Record<string, TokenTotals>, untrackedPerDay = 0): Stretch {
    const uses = Object.entries(mix).map(([model, t]) => ({ environment: BASE, model, totals: t }));
    const days = 30 / (24 * 60);
    const growth = growthOf(uses, truth) * (1 + (noise() - 0.5) * 0.06) + untrackedPerDay * days;
    return stretch(index, growth, uses);
  }

  /** Points of the cap per million tokens, per kind: input, cache write, cache read, output. */
  const OPUS = totals(0.05, 0.0625, 0.005, 0.25);
  const SONNET = totals(0.03, 0.0375, 0.003, 0.15);
  const HAIKU = totals(0.01, 0.0125, 0.001, 0.05);
  const TRUTH = { "model-opus": OPUS, "model-sonnet": SONNET, "model-haiku": HAIKU, "model-fable": OPUS };

  /** Shaped like the 2026-11-26 data: fresh input tiny next to a huge cache read, one model seen in a single stretch. */
  function replayStretches(count: number): Stretch[] {
    return Array.from({ length: count }, (_, i) => {
      const k = (): number => 0.2 + noise() * 1.6;
      const [a, b, c] = [k(), k(), k()];
      const mix: Record<string, TokenTotals> = {
        "model-opus": totals(5_400 * a, 4_000_000 * a * (1 + (i % 3)), 480_000_000 * a, 800_000 * a * (1 + (i % 2))),
        "model-sonnet": totals(3_000 * b, 2_000_000 * b * (1 + (i % 4)), 150_000_000 * b, 500_000 * b * (1 + (i % 3))),
        "model-haiku": totals(1_000 * c, 3_000_000 * c * (1 + (i % 5)), 90_000_000 * c, 300_000 * c * (1 + (i % 2))),
      };
      if (i === 0) mix["model-fable"] = totals(1_970, 1_000_000, 20_000_000, 100_000);
      return replay(i, mix, TRUTH, 0.5);
    });
  }

  it("replays counts shaped like 2026-11-26: Haiku comes out cheaper than Opus and no weight is absurd", () => {
    const stretches = replayStretches(14);
    const fit = fitCapCost(stretches, BASE, RIDGED);
    const byName = new Map(fit.models.map((m) => [m.model, m]));
    const allKinds = (name: string): number => {
      const all = stretches.flatMap((s) => s.uses).filter((use) => use.model === name).reduce((sum, use) => ({
        input: sum.input + use.totals.input, cache_write: sum.cache_write + use.totals.cache_write, cache_read: sum.cache_read + use.totals.cache_read, output: sum.output + use.totals.output,
      }), zeroTotals());
      return tokensPerPercent(byName.get(name)?.perToken ?? zeroTotals(), all) ?? 0;
    };
    expect(allKinds("model-haiku")).toBeGreaterThan(allKinds("model-opus"));
    expect(allKinds("model-sonnet")).toBeGreaterThan(allKinds("model-opus"));
    for (const model of fit.models) for (const weight of Object.values(model.perToken)) expect(weight * MILLION).toBeLessThan(2);
    // Opus keeps a real weight on every kind: no dashes from a zeroed model.
    for (const weight of Object.values(byName.get("model-opus")?.perToken ?? zeroTotals())) expect(weight).toBeGreaterThan(0);
  });

  it("shows a dash for a model seen in too few stretches (Fable in one partial window)", () => {
    const fit = fitCapCost(replayStretches(14), BASE, RIDGED);
    const fable = fit.models.find((m) => m.model === "model-fable");
    expect(fable?.enough).toBe(false);
    expect(fable?.howSure).toBe(HowSure.Rough);
    expect(fit.models.find((m) => m.model === "model-opus")?.enough).toBe(true);
    const unit = { sample: { agentKey: "a", model: "model-fable", environment: BASE, recordAt: T(0), totals: totals(1000), taskKey: null, agentKind: null, step: null }, used: totals(1000), restart: false } satisfies UsageDelta;
    expect(costByKey([unit], fit, BASE, () => "k").get("k")).toBeNull();
  });

  it("counts a stretch as evidence only where the model holds a real share of the tokens", () => {
    const tiny = (i: number): Stretch => stretch(i, 2, [
      { environment: BASE, model: "model-a", totals: totals(0, 0, 100 * MILLION) },
      { environment: BASE, model: "model-b", totals: totals(0, 0, 1000) },
    ]);
    const fit = fitCapCost(Array.from({ length: 8 }, (_, i) => tiny(i)), BASE, RIDGED);
    expect(fit.models.find((m) => m.model === "model-b")?.enough).toBe(false);
    expect(fit.models.find((m) => m.model === "model-a")?.enough).toBe(true);
  });

  it("keeps kinds that move together bounded: a tiny kind takes the model's mean weight, not a column of its own", () => {
    // Fresh input moves with cache write (always 0.4% of it) and is under the kind share, so it cannot trade weight with it.
    const rows = Array.from({ length: 16 }, (_, i) => {
      const write = (1 + (i % 4)) * 10 * MILLION;
      const read = (1 + ((i * 7) % 5)) * 40 * MILLION;
      return replay(i, { "model-a": totals(write * 0.004, write, read, 1 * MILLION) }, { "model-a": totals(0.05, 0.0625, 0.005, 0.25) });
    });
    const model = fitCapCost(rows, BASE, RIDGED).models[0];
    expect(model?.mode).toBe(FitMode.PerKind);
    const own = [model?.perToken.cache_write ?? 0, model?.perToken.cache_read ?? 0, model?.perToken.output ?? 0];
    expect(model?.perToken.input).toBeGreaterThanOrEqual(Math.min(...own) - 1e-12);
    expect(model?.perToken.input).toBeLessThanOrEqual(Math.max(...own) + 1e-12);
  });

  it("puts growth no tokens explain on the intercept, not into the model weights", () => {
    const uses = (i: number): Stretch["uses"] => [{ environment: BASE, model: "model-a", totals: totals(0, 0, (20 + ((i * 13) % 9) * 10) * MILLION) }];
    const build = (extraPerDay: number): Stretch[] => Array.from({ length: 12 }, (_, i) => {
      const days = 30 / (24 * 60);
      return stretch(i, growthOf(uses(i), { "model-a": same(0.02) }) + extraPerDay * days, uses(i));
    });
    const loose = { ...CONFIG, untrackedRidge: 1 };
    const clean = fitCapCost(build(0), BASE, loose);
    const dirty = fitCapCost(build(40), BASE, loose);
    expect(dirty.untrackedPerDay).toBeGreaterThan(5);
    expect(clean.untrackedPerDay).toBeLessThan(0.5);
    // With the intercept held back almost fully (as if there were none) the extra growth inflates the weight more.
    const without = fitCapCost(build(40), BASE, { ...CONFIG, untrackedRidge: 1000 });
    const weightOf = (fit: typeof clean): number => fit.models[0]?.perToken.cache_read ?? 0;
    expect(weightOf(dirty) / weightOf(clean)).toBeLessThan(weightOf(without) / weightOf(clean));
    expect(weightOf(dirty) / weightOf(clean)).toBeLessThan(1.6);
  });

  it("drops readings and use before the fit start date and keeps everything with none", () => {
    const readings = [0, 30, 60, 90].map((m, i) => ({ takenAt: T(m), plan: "plan-a", windowKind: WEEKLY_WINDOW, percent: 10 + i * 5, resetAt: RESET_1, source: null }));
    const { windows } = evaluateAll(readings, 2);
    const delta = (minute: number): UsageDelta => ({
      sample: { agentKey: "a", model: "m", environment: BASE, recordAt: T(minute), totals: totals(10), taskKey: null, agentKind: null, step: null },
      used: totals(10),
      restart: false,
    });
    const deltas = [delta(10), delta(40), delta(70)];
    expect(fromFitStart(windows, deltas, null)).toEqual({ windows, deltas });
    const cut = fromFitStart(windows, deltas, T(30));
    expect(cut.windows[0]?.readings.map((r) => r.takenAt)).toEqual([T(30), T(60), T(90)]);
    expect(cut.deltas.map((d) => d.sample.recordAt)).toEqual([T(40), T(70)]);
    expect(buildStretches(cut.windows, "plan-a", cut.deltas, CONFIG, BASE).map((s) => s.start)).toEqual([T(30), T(60)]);
    expect(fromFitStart(windows, deltas, "2099-01-01").windows).toEqual([]);
  });

  it("fits a model with its own cap on that window alone and leaves it out of the shared fit", () => {
    const own = "weekly:fable";
    const reading = (kind: string, minute: number, percent: number): CapReading => ({ takenAt: T(minute), plan: "plan-a", windowKind: kind, percent, resetAt: RESET_1, source: null });
    const shared = [0, 30, 60, 90, 120].map((m, i) => reading(WEEKLY_WINDOW, m, 10 + i * 4));
    const mine = [0, 30, 60, 90, 120].map((m, i) => reading(own, m, 5 + i * 3));
    const { windows } = evaluateAll([...shared, ...mine], 2);
    const delta = (model: string, minute: number, tokens: number): UsageDelta => ({
      sample: { agentKey: "a", model, environment: BASE, recordAt: T(minute), totals: totals(0, 0, tokens), taskKey: null, agentKind: null, step: null },
      used: totals(0, 0, tokens),
      restart: false,
    });
    // The own cap rises 3 points per 30 minutes for 100 million tokens: 0.03 points per million.
    const deltas = [20, 50, 80, 110].flatMap((m) => [delta("claude-fable-5", m, 100 * MILLION), delta("model-other", m, 200 * MILLION)]);
    const models = ["claude-fable-5", "model-other"];
    const kinds = ownCapKinds(windows, "plan-a", models);
    expect([...kinds.entries()]).toEqual([["claude-fable-5", own]]);
    const sharedOnly = deltas.filter(({ sample }) => !kinds.has(sample.model));
    expect(buildStretches(windows, "plan-a", sharedOnly, CONFIG, BASE).every((s) => s.uses.every((u) => u.model === "model-other"))).toBe(true);
    const fitted = fitOwnCap(windows, "plan-a", deltas, { ...CONFIG, minStretches: 3 }, BASE, ["claude-fable-5"], own)[0] as ModelFit;
    expect(fitted.ownCap).toBe(own);
    expect(fitted.enough).toBe(true);
    expect(fitted.perToken.cache_read * MILLION).toBeCloseTo(0.03, 3);
    const sharedFit = { ...fitCapCost(buildStretches(windows, "plan-a", sharedOnly, CONFIG, BASE), BASE, CONFIG) };
    const both = { ...sharedFit, models: [...sharedFit.models, fitted] };
    expect(costedModels(both).has("claude-fable-5")).toBe(false);
    expect(ownCapModels("weekly", models)).toEqual([]);
    expect(ownCapModels("weekly:nothing-like-it", models)).toEqual([]);
  });

  it("matches the own-cap kind by whole name parts, never by a substring, and keeps the kind naming the most parts (review 2026-11-27)", () => {
    const models = ["claude-opus-4", "claude-sonnet-5", "model-opus-mini"];
    expect(ownCapModels("weekly:op", models)).toEqual([]);
    expect(ownCapModels("weekly:o", models)).toEqual([]);
    expect(ownCapModels("weekly:opus", models)).toEqual(["claude-opus-4", "model-opus-mini"]);
    expect(ownCapModels("weekly:opus-4", models)).toEqual(["claude-opus-4"]);
    const reading = (kind: string, minute: number, percent: number): CapReading => ({ takenAt: T(minute), plan: "plan-a", windowKind: kind, percent, resetAt: RESET_1, source: null });
    const { windows } = evaluateAll([reading("weekly:opus", 0, 5), reading("weekly:opus-4", 30, 8)], 2);
    const kinds = ownCapKinds(windows, "plan-a", models);
    expect(kinds.size).toBe(2);
    expect(kinds.get("model-opus-mini")).toBe("weekly:opus");
    expect(kinds.get("claude-opus-4")).toBe("weekly:opus-4");
    const reversed = ownCapKinds([...windows].reverse(), "plan-a", models);
    expect(reversed.get("claude-opus-4")).toBe("weekly:opus-4");
    expect(reversed.get("model-opus-mini")).toBe("weekly:opus");
  });

  it("takes every model whose name matches the own-cap kind out of the shared fit", () => {
    const own = "weekly:opus";
    const models = ["claude-opus-4", "claude-opus-5", "model-other"];
    expect(ownCapModels(own, models)).toEqual(["claude-opus-4", "claude-opus-5"]);
    const reading = (minute: number, percent: number): CapReading => ({ takenAt: T(minute), plan: "plan-a", windowKind: own, percent, resetAt: RESET_1, source: null });
    const { windows } = evaluateAll([0, 30, 60, 90, 120].map((m, i) => reading(m, 5 + i * 3)), 2);
    expect([...ownCapKinds(windows, "plan-a", models).entries()]).toEqual([["claude-opus-4", own], ["claude-opus-5", own]]);
    const delta = (model: string, minute: number): UsageDelta => ({
      sample: { agentKey: "a", model, environment: BASE, recordAt: T(minute), totals: totals(0, 0, 50 * MILLION), taskKey: null, agentKind: null, step: null },
      used: totals(0, 0, 50 * MILLION),
      restart: false,
    });
    const deltas = [20, 50, 80, 110].flatMap((m) => [delta("claude-opus-4", m), delta("claude-opus-5", m)]);
    const fits = fitOwnCap(windows, "plan-a", deltas, { ...CONFIG, minStretches: 3 }, BASE, ["claude-opus-4", "claude-opus-5"], own);
    expect(fits.map((f) => [f.model, f.ownCap])).toEqual([["claude-opus-4", own], ["claude-opus-5", own]]);
    // Each stretch moves 3 points over 50 million tokens of each: the two weights together make up 0.06 points per million.
    expect(fits.reduce((sum, f) => sum + f.perToken.cache_read * MILLION, 0)).toBeCloseTo(0.06, 3);
  });

  it("leaves a model under the evidence floor out of the fit, so it cannot skew the shown models", () => {
    const next = lcg(11);
    const base = (): Stretch["uses"] => [{ environment: BASE, model: "model-a", totals: totals(0, 0, (20 + Math.floor(next() * 40)) * MILLION) }];
    const plain = Array.from({ length: 12 }, () => base());
    const growth = (uses: Stretch["uses"]): number => growthOf(uses, { "model-a": same(0.02) });
    const without = plain.map((uses, i) => stretch(i, growth(uses) + (i < 3 ? 1 : 0), uses));
    const withThin = plain.map((uses, i) => stretch(i, growth(uses) + (i < 3 ? 1 : 0), i < 3 ? [...uses, { environment: BASE, model: "model-thin", totals: totals(0, 0, 0.2 * MILLION) }] : uses));
    const fit = fitCapCost(withThin, BASE, RIDGED);
    const thin = fit.models.find((m) => m.model === "model-thin");
    expect(thin).toMatchObject({ enough: false, stretches: 3 });
    expect(Object.values(thin?.perToken ?? {}).every((w) => w === 0)).toBe(true);
    // The shown model is fitted as if the thin one had never been reported.
    expect(fit.models.find((m) => m.model === "model-a")?.perToken).toEqual(fitCapCost(without, BASE, RIDGED).models[0]?.perToken);
    expect(fit.stretches).toBe(withThin);
  });

  it("judges how sure on each model's own part of the error and counts evidence by explained growth", () => {
    // model-b holds 3% of the tokens in 6 stretches but its fitted points explain none of the growth: no evidence.
    const rows = Array.from({ length: 8 }, (_, i) => {
      const a = (20 + (i % 4) * 10) * MILLION;
      const uses: Stretch["uses"] = [{ environment: BASE, model: "model-a", totals: totals(0, 0, a) }];
      if (i < 6) uses.push({ environment: BASE, model: "model-b", totals: totals(0, 0, a * 0.03) });
      return stretch(i, growthOf(uses, { "model-a": same(0.02) }), uses);
    });
    const fit = fitCapCost(rows, BASE, { ...RIDGED, modelMinStretches: 4 });
    const a = fit.models.find((m) => m.model === "model-a");
    const b = fit.models.find((m) => m.model === "model-b");
    expect(a).toMatchObject({ enough: true, howSure: HowSure.Sure });
    expect(b?.enough).toBe(false);
    expect(b?.howSure).toBe(HowSure.Rough);
  });

  it("keeps the fit bounded with the ridge, the intercept and merged kinds on many stretches", () => {
    const rows = replayStretches(300);
    const started = performance.now();
    fitCapCost(rows, BASE, RIDGED);
    expect(performance.now() - started).toBeLessThan(scaledBudget(3000));
  });
});

describe("how sure and the shown unexplained share", () => {
  it("shows the unexplained share from positive residuals but judges how sure on the net error, so +3 and -3 do not hurt", () => {
    const uses = [{ environment: BASE, model: "model-a", totals: totals(MILLION) }];
    const stretches = [stretch(0, 13, uses), stretch(1, 7, uses)];
    const config = { ...CONFIG, modelMinStretches: 1, sure: { minStretches: 2, maxLeftoverShare: 0.1 } };
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
    expect(elapsed).toBeLessThan(scaledBudget(3000));
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
    expect(elapsed).toBeLessThan(scaledBudget(1500));
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
    return { models: [], environments: [], stretches, residuals: stretches.map(() => left), leftoverShare: 1, untrackedPerDay: 0 };
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

  it("caps the windows per environment, so a busy environment does not push out an older one's", () => {
    const busy = Array.from({ length: MAX_PLACE_WINDOWS + 100 }, (_, i) => window(DESIGN, 1000 + i * 2, 1001 + i * 2));
    const placed = placeInWindows(fitWith(6), [window(CHAT, 0, 30), ...busy], T(-1));
    expect(placed.byEnvironment.get(CHAT)).toBeCloseTo(3, 9);
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

  it("keeps the allocation as it was before Slice 35: windows in end order, whatever order they arrive in (review finding 5)", () => {
    // CHAT starts first but ends last, so start order and end order differ.
    const nested = [window(CHAT, 0, 50), window(DESIGN, 10, 30)];
    const placed = placeInWindows(fitWith(6), nested, T(-1));
    expect([...placed.byEnvironment.keys()]).toEqual([DESIGN, CHAT]);
    // 50 of the 60 minutes are covered (5 points), split pro rata to each window's overlap (50 and 20 minutes).
    expect(placed.byEnvironment.get(CHAT)).toBeCloseTo((5 * 50) / 70, 9);
    expect(placed.byEnvironment.get(DESIGN)).toBeCloseTo((5 * 20) / 70, 9);
    const reversed = placeInWindows(fitWith(6), [...nested].reverse(), T(-1));
    expect([...reversed.byEnvironment.entries()]).toEqual([...placed.byEnvironment.entries()]);
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
    expect(elapsed).toBeLessThan(scaledBudget(1500));
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
    expect(elapsed).toBeLessThan(scaledBudget(1500));
  });

  it("recomputes the unexplained share from the residuals left after placing", () => {
    const placed = placeInWindows(fitWith(6), [window(CHAT, 0, 30)], T(-1));
    expect(placed.fit.leftoverShare).toBeCloseTo(0.5, 9);
  });
});

describe("placement edge cases (Slice 35)", () => {
  const fitOf = (left: number): CapCostFit => {
    const stretches: Stretch[] = [{ plan: "plan-a", start: T(0), end: T(60), growth: left, uses: [] }];
    return { models: [], environments: [], stretches, residuals: [left], leftoverShare: 1, untrackedPerDay: 0 };
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

  it("counts growth under the listing threshold in the total, though the list leaves it out", () => {
    const stretches: Stretch[] = [0, 1, 2].map((i) => ({ plan: "plan-a", start: T(i * 60), end: T(i * 60 + 60), growth: 1, uses: [] }));
    const fit: CapCostFit = { models: [], environments: [], stretches, residuals: [0.04, 0.03, 2], leftoverShare: 1, untrackedPerDay: 0 };
    expect(unexplainedStretches(fit, T(-1), 5)).toHaveLength(1);
    expect(unexplainedTotals(fit, T(-1)).points).toBeCloseTo(2.07, 9);
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

describe("environmentIdentity and the repository filter (Slice 34)", () => {
  const NAMES = ["Laptop", " laptop ", "LAPTOP", "\tDesk\r\n", "Ünï", "ÜNÏ", "İstanbul", "x ", " x", "Ǆ", "ǆ", "", "  "];

  it("is the same function as the SQL the repository compares with, for ASCII and for the names that differ", async () => {
    for (const name of NAMES) {
      const row = await env.DB.prepare("SELECT lower(trim(?1, ?2)) AS identity").bind(name, IDENTITY_TRIM_CHARS).first<{ identity: string }>();
      expect(row?.identity, JSON.stringify(name)).toBe(environmentIdentity(name));
    }
  });

  it("treats the ASCII spellings of one name as one and a non-ASCII case difference as two", () => {
    expect(environmentIdentity(" Laptop\t")).toBe(environmentIdentity("LAPTOP"));
    expect(environmentIdentity("Ünï")).not.toBe(environmentIdentity("ÜNÏ"));
  });
});
