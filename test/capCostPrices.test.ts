import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CAP_COST, parseConfig } from "../src/config";
import { fitCapCost, type ModelFit, type Stretch } from "../src/domain/capCost";
import { priceOf } from "../src/domain/prices";
import { type TokenTotals, zeroTotals } from "../src/domain/usage";

const MILLION = 1_000_000;
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";
const T = (minute: number): string => new Date(Date.UTC(2026, 10, 16, 0, minute)).toISOString();

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** A fresh-input / cache-write / cache-read / output mix typical of agent use. */
function mix(million: number): TokenTotals {
  return { input: million * MILLION * 0.1, cache_write: million * MILLION * 0.08, cache_read: million * MILLION, output: million * MILLION * 0.02 };
}

function dollars(totals: TokenTotals, model: string): number {
  const price = priceOf(model, DEFAULT_CAP_COST.prices) ?? zeroTotals();
  return (price.input * totals.input + price.cache_write * totals.cache_write + price.cache_read * totals.cache_read + price.output * totals.output) / MILLION;
}

/** Stretches where the three models run together in a fixed proportion (as live), growth being `pointsPerDollar` times each model's dollars times its factor. */
function togetherStretches(count: number, factors: Record<string, number>, separate: boolean): Stretch[] {
  const next = lcg(11);
  return Array.from({ length: count }, (_, i) => {
    const uses = [OPUS, SONNET, HAIKU].map((model) => {
      const share = separate ? 0.2 + next() * 3 : 1 + next() * 0.02;
      return { environment: "laptop", model, totals: mix(share * (1 + (i % 4))) };
    });
    const growth = uses.reduce((sum, use) => sum + 0.01 * (factors[use.model] ?? 1) * dollars(use.totals, use.model), 0);
    return { plan: "plan-a", start: T(i * 60), end: T(i * 60 + 30), growth, uses };
  });
}

function model(models: ModelFit[], name: string): ModelFit {
  return models.find((m) => m.model === name) as ModelFit;
}

describe("list prices as the prior of the fit (Slice 67 item 7)", () => {
  it("matches a model by whole name parts, case ignored, and the entry naming the most parts wins", () => {
    expect(priceOf("Claude-Opus-5-5", DEFAULT_CAP_COST.prices)?.input).toBe(4);
    expect(priceOf("claude-opus-5-5", DEFAULT_CAP_COST.prices)?.cache_write).toBe(5);
    expect(priceOf("claude-opusx-5", DEFAULT_CAP_COST.prices)).toBeNull();
    expect(priceOf("some-other-model", DEFAULT_CAP_COST.prices)).toBeNull();
    const prices = { ...DEFAULT_CAP_COST.prices, "opus-5": { input: 1, output: 2, cache_read: 0.5, cache_write: 3 } };
    expect(priceOf("claude-opus-5-5", prices)).toEqual({ input: 1, cache_write: 3, cache_read: 0.5, output: 2 });
  });

  it("keeps Haiku cheaper than Sonnet cheaper than Opus, in price order, when the models' use moves together", () => {
    const fit = fitCapCost(togetherStretches(40, {}, false), null, DEFAULT_CAP_COST);
    const [opus, sonnet, haiku] = [OPUS, SONNET, HAIKU].map((name) => model(fit.models, name));
    expect(fit.priceAnchored).toBe(true);
    for (const kind of ["input", "cache_write", "cache_read", "output"] as const) {
      expect(haiku?.perToken[kind]).toBeLessThan(sonnet?.perToken[kind] ?? 0);
      expect(sonnet?.perToken[kind]).toBeLessThan(opus?.perToken[kind] ?? 0);
    }
    // The gaps are the list prices' (Opus 2x Sonnet, Sonnet 20x Haiku on fresh input), within a few percent.
    expect((opus?.perToken.input ?? 0) / (sonnet?.perToken.input ?? 1)).toBeCloseTo(2, 0);
    expect((sonnet?.perToken.input ?? 0) / (haiku?.perToken.input ?? 1)).toBeCloseTo(20, -1);
    // Haiku's own points are under the evidence floor (it is cheap), so its figure is the list price alone: a dash, never a Sure one (Decisions 2).
    expect(haiku?.enough).toBe(false);
    expect(haiku?.priceFactor).toBeCloseTo(1, 0);
  });

  it("keeps a model with no price entry in the same unit as the priced ones, so its weight is never a runaway multiple of theirs", () => {
    const next = lcg(5);
    const stretches: Stretch[] = Array.from({ length: 40 }, (_, i) => {
      const uses = [OPUS, SONNET, "mistral-large"].map((name) => ({ environment: "laptop", model: name, totals: mix((0.2 + next() * 3) * (1 + (i % 4))) }));
      const growth = uses.reduce((sum, use) => sum + 0.01 * dollars(use.totals, use.model === "mistral-large" ? OPUS : use.model), 0);
      return { plan: "plan-a", start: T(i * 60), end: T(i * 60 + 30), growth, uses };
    });
    const fit = fitCapCost(stretches, null, DEFAULT_CAP_COST);
    const ratio = model(fit.models, "mistral-large").perToken.input / model(fit.models, OPUS).perToken.input;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(5);
  });

  it("names no list-price anchor and no factor for a single priced model", () => {
    const stretches = togetherStretches(30, {}, true).map((s) => ({ ...s, uses: s.uses.filter((use) => use.model === OPUS) }));
    const fit = fitCapCost(stretches, null, DEFAULT_CAP_COST);
    expect(fit.priceAnchored).toBe(false);
    expect(model(fit.models, OPUS).priceFactor).toBeNull();
  });

  it("still lets a clear factor through when the models' use is separable", () => {
    const stretches = togetherStretches(150, { [OPUS]: 3 }, true);
    // The hold is the number of typical stretches' worth of evidence for the list price: a weak one lets a clear gap through, the default holds harder.
    const fit = fitCapCost(stretches, null, { ...DEFAULT_CAP_COST, priceShrink: 5 });
    const held = fitCapCost(stretches, null, DEFAULT_CAP_COST);
    expect((model(held.models, OPUS).priceFactor ?? 0) / (model(held.models, SONNET).priceFactor ?? 1)).toBeLessThan(
      (model(fit.models, OPUS).priceFactor ?? 0) / (model(fit.models, SONNET).priceFactor ?? 1),
    );
    const opus = model(fit.models, OPUS).priceFactor ?? 0;
    const sonnet = model(fit.models, SONNET).priceFactor ?? 1;
    // The data says Opus costs three times its list-price share; the hold on 1 gives some of that back, not all.
    expect(opus / sonnet).toBeGreaterThan(1.5);
  });

  it("lets no Infinity or NaN reach a weight when a priced model's column is subnormal or empty", () => {
    for (const scale of [0, 1e-170]) {
      const stretches = togetherStretches(30, {}, true).map((s) => ({
        ...s,
        uses: s.uses.map((use) => (use.model === OPUS ? { ...use, totals: { input: use.totals.input * scale, cache_write: use.totals.cache_write * scale, cache_read: use.totals.cache_read * scale, output: use.totals.output * scale } } : use)),
      }));
      const fit = fitCapCost(stretches, null, DEFAULT_CAP_COST);
      for (const m of fit.models) for (const value of Object.values(m.perToken)) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("gives a model with no price entry the fit it had", () => {
    const stretches = togetherStretches(20, {}, true).map((s) => ({ ...s, uses: s.uses.map((use) => ({ ...use, model: use.model.replace(/claude-(\w+)-5-5/, "model-$1x") })) }));
    const fit = fitCapCost(stretches, null, DEFAULT_CAP_COST);
    expect(fit.priceAnchored).toBe(false);
    expect(fit.models.every((m) => m.priceFactor === null)).toBe(true);
  });

  it("fits a worst-case sized priced input inside the time budget", () => {
    const stretches = togetherStretches(400, {}, true);
    const started = performance.now();
    const fit = fitCapCost(stretches, null, DEFAULT_CAP_COST);
    expect(performance.now() - started).toBeLessThan(3000);
    for (const m of fit.models) for (const value of Object.values(m.perToken)) expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe("the price config (Slice 67 item 7)", () => {
  it("has the 2026-11-27 list prices by default, and a configured entry overrides or adds one", () => {
    const base = parseConfig(undefined).usage.capCost;
    expect(base.prices.haiku).toEqual({ input: 0.1, output: 0.5, cache_read: 0.01 });
    expect(base.priceShrink).toBe(50);
    expect(base.priceFactorShown).toBe(0.5);
    const set = parseConfig(JSON.stringify({ usage: { capCost: { prices: { opus: { input: 5, output: 25, cache_read: 0.5 }, mistral: { input: 1, output: 3, cache_read: 0.1, cache_write: 2 } } } } })).usage.capCost;
    expect(set.prices.opus?.input).toBe(5);
    expect(set.prices.mistral?.cache_write).toBe(2);
    expect(set.prices.sonnet?.input).toBe(2);
  });

  it("logs and skips a bad entry, keeping the default", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = parseConfig(JSON.stringify({ usage: { capCost: { prices: { opus: { input: -1, output: 2, cache_read: 1 }, odd: "x" } } } })).usage.capCost;
    expect(config.prices.opus?.input).toBe(4);
    expect(config.prices.odd).toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
