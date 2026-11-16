/**
 * What 1% of the cap costs (Slice 9). Nothing here is stored: stretches of time between two cap
 * readings of one window, the best fit of what each token costs, and the cost of any use are
 * all worked out on every read from the readings and the use samples.
 */
import type { CapCostConfig } from "../config";
import { type CapWindow, WEEKLY_WINDOW } from "./cap";
import { TOKEN_KINDS, type TokenKind, type TokenTotals, totalOf, type UsageDelta, zeroTotals } from "./usage";

const MS_PER_MINUTE = 60_000;
const PER_MILLION = 1_000_000;
const KIND_COUNT = TOKEN_KINDS.length;
/**
 * Hard bounds on the fit, which runs in the Worker on every usage read. One solve costs at most
 * MAX_SOLVE_ROUNDS x columns x stretches x 2 steps; the alternation runs at most MAX_FIT_ROUNDS
 * times with two solves each. Sized so a few hundred stretches with per-kind columns stay far
 * under the Worker CPU limit (the measured time is in the slice file).
 */
const MAX_FIT_ROUNDS = 25;
const MAX_SOLVE_ROUNDS = 200;
const SOLVE_STEP_LIMIT = 1e-9;
/** Two stretches must differ at least this much in the share an environment holds, or its multiplier cannot be told apart. */
const MIN_MIX_SPREAD = 0.05;
/** Unexplained growth below this many points counts as none. */
const NO_POINTS = 0.05;

export enum FitMode {
  /** One weight for every token kind of the model. */
  OneWeight = "one_weight",
  PerKind = "per_kind",
}

export enum HowSure {
  Sure = "sure",
  Rough = "rough",
}

export enum MultiplierState {
  Base = "base",
  Measured = "measured",
  NotEnough = "not_enough",
}

/** The use of one model in one environment inside a stretch. */
export interface StretchUse {
  environment: string;
  model: string;
  totals: TokenTotals;
}

/** A stretch of time inside one window on one plan, with a cap reading at each end. */
export interface Stretch {
  plan: string;
  start: string;
  end: string;
  /** Percentage points the cap rose over the stretch. */
  growth: number;
  uses: StretchUse[];
}

export interface ModelFit {
  model: string;
  mode: FitMode;
  /** Points of the cap per token, per kind (the same number for every kind on one weight). */
  perToken: TokenTotals;
  /** Stretches holding use of this model. */
  stretches: number;
  /** The stretch count at which the model gets a weight per kind. */
  finerAt: number;
  howSure: HowSure;
}

export interface EnvironmentFit {
  environment: string;
  multiplier: number;
  state: MultiplierState;
  /** Stretches holding use of this environment. */
  stretches: number;
  howSure: HowSure | null;
}

export interface CapCostFit {
  models: ModelFit[];
  environments: EnvironmentFit[];
  stretches: Stretch[];
  /** Per stretch, in order: growth minus what the fit explains (may be negative). */
  residuals: number[];
  /** Share of the growth no report explained, 0 to 1. */
  leftoverShare: number;
}

export interface UnexplainedStretch {
  start: string;
  end: string;
  /** Points of cap growth the reports do not explain. */
  points: number;
  growthPoints: number;
  explainedPoints: number;
}

export interface UnexplainedTotals {
  points: number;
  growthPoints: number;
  share: number;
}

/** The environment a delta counts under; no name and no base is the one unnamed environment. */
export function environmentKey(environment: string | null, base: string | null): string {
  return environment ?? base ?? "";
}

function minutesBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / MS_PER_MINUTE;
}

/**
 * The stretches of one plan: inside each weekly window, from one accepted reading to a later one
 * once the time is at least the reporting interval and the cap rose by a measurable amount;
 * shorter ones are joined onto the next. A window's last readings that never get there are left
 * out, and no stretch crosses a window, so a reset can never give a negative growth.
 */
export function buildStretches(windows: CapWindow[], plan: string, deltas: UsageDelta[], config: CapCostConfig, base: string | null): Stretch[] {
  const byTime = [...deltas].sort((a, b) => (a.sample.recordAt < b.sample.recordAt ? -1 : a.sample.recordAt > b.sample.recordAt ? 1 : 0));
  return windows
    .filter((window) => window.plan === plan && window.windowKind === WEEKLY_WINDOW)
    .flatMap((window) => windowStretches(window, byTime, config, base));
}

function windowStretches(window: CapWindow, deltas: UsageDelta[], config: CapCostConfig, base: string | null): Stretch[] {
  const stretches: Stretch[] = [];
  let anchor = window.readings[0];
  for (const reading of window.readings.slice(1)) {
    if (anchor === undefined) break;
    const growth = reading.percent - anchor.percent;
    const long = minutesBetween(anchor.takenAt, reading.takenAt) >= config.minStretchMinutes;
    if (!long || growth < config.minGrowthPoints || growth <= 0) continue;
    stretches.push({
      plan: window.plan,
      start: anchor.takenAt,
      end: reading.takenAt,
      growth,
      uses: usesBetween(deltas, anchor.takenAt, reading.takenAt, base),
    });
    anchor = reading;
  }
  return joinTrailingRun(window, anchor, stretches, deltas, base);
}

/**
 * A window's last run of readings that never got long enough or high enough joins the stretch
 * before it in the same window, so its growth and its use are both in the fit. With no earlier
 * stretch in the window it stays out.
 */
function joinTrailingRun(window: CapWindow, anchor: CapWindow["readings"][number] | undefined, stretches: Stretch[], deltas: UsageDelta[], base: string | null): Stretch[] {
  const last = window.readings[window.readings.length - 1];
  const previous = stretches[stretches.length - 1];
  if (anchor === undefined || last === undefined || previous === undefined || last.takenAt === anchor.takenAt) return stretches;
  const extra = last.percent - anchor.percent;
  if (extra < 0) return stretches;
  const joined: Stretch = { ...previous, end: last.takenAt, growth: previous.growth + extra, uses: usesBetween(deltas, previous.start, last.takenAt, base) };
  return [...stretches.slice(0, -1), joined];
}

/** The index of the first delta (sorted by time) recorded after `time`. */
function firstAfter(sorted: UsageDelta[], time: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle]?.sample.recordAt ?? "") <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The use in (from, to] of deltas sorted by time, as one entry per environment and model. */
function usesBetween(sorted: UsageDelta[], from: string, to: string, base: string | null): StretchUse[] {
  const uses = new Map<string, Map<string, StretchUse>>();
  for (let i = firstAfter(sorted, from); i < sorted.length; i++) {
    const { sample, used } = sorted[i] as UsageDelta;
    if (sample.recordAt > to) break;
    const environment = environmentKey(sample.environment, base);
    const models = uses.get(environment) ?? new Map<string, StretchUse>();
    uses.set(environment, models);
    const entry = models.get(sample.model) ?? { environment, model: sample.model, totals: zeroTotals() };
    models.set(sample.model, { ...entry, totals: addInto(entry.totals, used) });
  }
  return [...uses.values()].flatMap((models) => [...models.values()]);
}

function addInto(a: TokenTotals, b: TokenTotals): TokenTotals {
  return { input: a.input + b.input, cache_write: a.cache_write + b.cache_write, cache_read: a.cache_read + b.cache_read, output: a.output + b.output };
}

/** Non-negative least squares by coordinate descent: minimises |A x - y| with every x at least 0. */
export function nnls(columns: number[][], target: number[], start: number[]): number[] {
  const x = start.map((value) => Math.max(0, value));
  const norms = columns.map((column) => column.reduce((sum, v) => sum + v * v, 0));
  const fitted = target.map((_, row) => columns.reduce((sum, column, c) => sum + (column[row] ?? 0) * (x[c] ?? 0), 0));
  for (let round = 0; round < MAX_SOLVE_ROUNDS; round++) {
    let moved = 0;
    for (let c = 0; c < columns.length; c++) {
      moved = Math.max(moved, stepColumn(columns[c] ?? [], norms[c] ?? 0, x, c, target, fitted));
    }
    if (moved < SOLVE_STEP_LIMIT) break;
  }
  return x;
}

/** One coordinate step: moves x[c] to its best value with the rest held, updates `fitted`, returns the move. */
function stepColumn(column: number[], norm: number, x: number[], c: number, target: number[], fitted: number[]): number {
  if (norm === 0) return 0;
  const current = x[c] ?? 0;
  let gradient = 0;
  for (let row = 0; row < column.length; row++) {
    const v = column[row] ?? 0;
    gradient += v * ((target[row] ?? 0) - (fitted[row] ?? 0) + v * current);
  }
  const next = Math.max(0, gradient / norm);
  for (let row = 0; row < column.length; row++) fitted[row] = (fitted[row] ?? 0) + (column[row] ?? 0) * (next - current);
  x[c] = next;
  return Math.abs(next - current);
}

interface Column {
  model: string;
  /** null: one weight for every kind. */
  kind: TokenKind | null;
}

interface FitPlan {
  models: string[];
  modes: Map<string, FitMode>;
  columns: Column[];
}

function modelsOf(stretches: Stretch[]): string[] {
  return [...new Set(stretches.flatMap((s) => s.uses.map((use) => use.model)))].sort();
}

function stretchesWith(stretches: Stretch[], match: (use: StretchUse) => boolean): number {
  return stretches.filter((s) => s.uses.some((use) => match(use) && totalOf(use.totals) > 0)).length;
}

function planFit(stretches: Stretch[], config: CapCostConfig): FitPlan {
  const models = modelsOf(stretches);
  const modes = new Map(
    models.map((model): [string, FitMode] => [
      model,
      stretchesWith(stretches, (use) => use.model === model) >= config.fineFactor * KIND_COUNT ? FitMode.PerKind : FitMode.OneWeight,
    ]),
  );
  const columns = models.flatMap((model): Column[] =>
    modes.get(model) === FitMode.PerKind ? TOKEN_KINDS.map((kind) => ({ model, kind })) : [{ model, kind: null }],
  );
  return { models, modes, columns };
}

function columnTokens(use: StretchUse, column: Column): number {
  if (use.model !== column.model) return 0;
  return column.kind === null ? totalOf(use.totals) : use.totals[column.kind];
}

/** Weight columns with the multipliers held: per stretch the tokens in millions, scaled by each environment's multiplier. */
function weightColumns(stretches: Stretch[], plan: FitPlan, multipliers: Map<string, number>): number[][] {
  return plan.columns.map((column) =>
    stretches.map((s) =>
      s.uses.reduce((sum, use) => sum + (multipliers.get(use.environment) ?? 1) * columnTokens(use, column) / PER_MILLION, 0),
    ),
  );
}

/** Points the use of one model costs at a given weight vector, per million tokens, before any multiplier. */
function weightedMillions(use: StretchUse, plan: FitPlan, weights: number[]): number {
  return plan.columns.reduce((sum, column, c) => sum + (weights[c] ?? 0) * columnTokens(use, column) / PER_MILLION, 0);
}

function multiplierColumns(stretches: Stretch[], plan: FitPlan, weights: number[], estimated: string[]): number[][] {
  return estimated.map((environment) =>
    stretches.map((s) =>
      s.uses.filter((use) => use.environment === environment).reduce((sum, use) => sum + weightedMillions(use, plan, weights), 0),
    ),
  );
}

/** An environment is told apart only with enough stretches that hold it and a different mix between them. */
function estimableEnvironments(stretches: Stretch[], base: string, config: CapCostConfig): string[] {
  const names = [...new Set(stretches.flatMap((s) => s.uses.map((use) => use.environment)))].filter((name) => name !== base).sort();
  return names.filter((name) => {
    if (stretchesWith(stretches, (use) => use.environment === name) < config.environmentMinStretches) return false;
    const shares = stretches.map((s) => environmentShare(s, name));
    return Math.max(...shares) - Math.min(...shares) >= MIN_MIX_SPREAD;
  });
}

function environmentShare(stretch: Stretch, environment: string): number {
  const all = stretch.uses.reduce((sum, use) => sum + totalOf(use.totals), 0);
  const own = stretch.uses.filter((use) => use.environment === environment).reduce((sum, use) => sum + totalOf(use.totals), 0);
  return all === 0 ? 0 : own / all;
}

interface Solved {
  weights: number[];
  multipliers: Map<string, number>;
}

/** Alternating non-negative least squares: weights with the multipliers fixed, then multipliers with the weights fixed. */
function solve(stretches: Stretch[], plan: FitPlan, estimated: string[], config: CapCostConfig): Solved {
  const growth = stretches.map((s) => s.growth);
  const multipliers = new Map<string, number>(estimated.map((name) => [name, 1]));
  let weights = nnls(weightColumns(stretches, plan, multipliers), growth, plan.columns.map(() => 0));
  for (let round = 0; round < MAX_FIT_ROUNDS && estimated.length > 0; round++) {
    const before = estimated.map((name) => multipliers.get(name) ?? 1);
    const weightsBefore = weights;
    const fixed = fixedPart(stretches, plan, weights, estimated);
    const next = nnls(multiplierColumns(stretches, plan, weights, estimated), growth.map((g, s) => g - (fixed[s] ?? 0)), before);
    estimated.forEach((name, i) => multipliers.set(name, next[i] ?? 0));
    weights = nnls(weightColumns(stretches, plan, multipliers), growth, weights);
    const change = Math.max(...estimated.map((name, i) => Math.abs((multipliers.get(name) ?? 0) - (before[i] ?? 0))));
    const weightChange = Math.max(0, ...weights.map((w, i) => Math.abs(w - (weightsBefore[i] ?? 0))));
    if (Math.max(change, weightChange) < config.convergence) break;
  }
  return { weights, multipliers };
}

/** Per stretch, the points the environments that are not estimated (the base and the unmeasured ones, all 1x) account for. */
function fixedPart(stretches: Stretch[], plan: FitPlan, weights: number[], estimated: string[]): number[] {
  return stretches.map((s) =>
    s.uses.filter((use) => !estimated.includes(use.environment)).reduce((sum, use) => sum + weightedMillions(use, plan, weights), 0),
  );
}

function perTokenOf(plan: FitPlan, weights: number[], model: string): TokenTotals {
  const perToken = zeroTotals();
  plan.columns.forEach((column, c) => {
    if (column.model !== model) return;
    const value = (weights[c] ?? 0) / PER_MILLION;
    for (const kind of column.kind === null ? TOKEN_KINDS : [column.kind]) perToken[kind] = value;
  });
  return perToken;
}

function howSure(stretches: number, netErrorShare: number, config: CapCostConfig): HowSure {
  const enough = stretches >= config.sure.minStretches && netErrorShare <= config.sure.maxLeftoverShare;
  return enough ? HowSure.Sure : HowSure.Rough;
}

/**
 * The best fit over the stretches: points of the cap per token for each model (per kind once there
 * are enough stretches), and a multiplier per environment with `base` fixed at 1. Never negative.
 */
export function fitCapCost(stretches: Stretch[], base: string | null, config: CapCostConfig): CapCostFit {
  const baseKey = base ?? "";
  const plan = planFit(stretches, config);
  const estimated = base === null ? [] : estimableEnvironments(stretches, baseKey, config);
  const { weights, multipliers } = solve(stretches, plan, estimated, config);
  const residuals = stretches.map((s) => s.growth - fittedGrowth(s, plan, weights, multipliers));
  const leftoverShare = shareOfGrowth(stretches, residuals);
  const netShare = netErrorShare(stretches, residuals);
  const models = plan.models.map((model): ModelFit => {
    const count = stretchesWith(stretches, (use) => use.model === model);
    return {
      model,
      mode: plan.modes.get(model) ?? FitMode.OneWeight,
      perToken: perTokenOf(plan, weights, model),
      stretches: count,
      finerAt: config.fineFactor * KIND_COUNT,
      howSure: howSure(count, netShare, config),
    };
  });
  const names = [...new Set(stretches.flatMap((s) => s.uses.map((use) => use.environment)))].sort();
  const environments = names.map((name): EnvironmentFit => {
    const count = stretchesWith(stretches, (use) => use.environment === name);
    const measured = estimated.includes(name);
    return {
      environment: name,
      multiplier: measured ? (multipliers.get(name) ?? 1) : 1,
      state: name === baseKey ? MultiplierState.Base : measured ? MultiplierState.Measured : MultiplierState.NotEnough,
      stretches: count,
      howSure: measured ? howSure(count, netShare, config) : null,
    };
  });
  return { models, environments, stretches, residuals, leftoverShare };
}

function fittedGrowth(stretch: Stretch, plan: FitPlan, weights: number[], multipliers: Map<string, number>): number {
  return stretch.uses.reduce((sum, use) => sum + (multipliers.get(use.environment) ?? 1) * weightedMillions(use, plan, weights), 0);
}

/**
 * Two different figures. The shown unexplained share (`shareOfGrowth`) counts only growth the
 * reports could not explain (positive residuals), as the slice defines it. The how-sure verdict
 * judges the net error instead, so residuals that offset each other (+3 and -3) do not make a
 * good fit look bad.
 */
function netErrorShare(stretches: Stretch[], residuals: number[]): number {
  const growth = stretches.reduce((sum, s) => sum + s.growth, 0);
  const net = Math.abs(residuals.reduce((sum, r) => sum + r, 0));
  return growth === 0 ? 0 : net / growth;
}

function shareOfGrowth(stretches: Stretch[], residuals: number[]): number {
  const growth = stretches.reduce((sum, s) => sum + s.growth, 0);
  const left = residuals.reduce((sum, r) => sum + Math.max(0, r), 0);
  return growth === 0 ? 0 : left / growth;
}

/** Points of the cap the use costs: tokens times the model's weights times its environment's multiplier. */
export function costOf(delta: UsageDelta, fit: CapCostFit, base: string | null): number {
  const model = fit.models.find((m) => m.model === delta.sample.model);
  if (model === undefined) return 0;
  const environment = environmentKey(delta.sample.environment, base);
  const multiplier = fit.environments.find((e) => e.environment === environment)?.multiplier ?? 1;
  return multiplier * TOKEN_KINDS.reduce((sum, kind) => sum + delta.used[kind] * model.perToken[kind], 0);
}

/**
 * Cost per key (task, agent kind, step), summed over deltas; a null key is left out. A key with
 * use of a model that has no fitted weight has no known cost: null, never 0.
 */
export function costByKey(
  deltas: UsageDelta[],
  fit: CapCostFit,
  base: string | null,
  keyOf: (delta: UsageDelta) => string | null,
): Map<string, number | null> {
  const fitted = new Set(fit.models.map((m) => m.model));
  const costs = new Map<string, number | null>();
  for (const delta of deltas) {
    const key = keyOf(delta);
    if (key === null) continue;
    const before = costs.get(key);
    if (before === null || !fitted.has(delta.sample.model)) costs.set(key, null);
    else costs.set(key, (before ?? 0) + costOf(delta, fit, base));
  }
  return costs;
}

/** The cost of the use in the deltas that has no value for the key (the "not named" part), in points. */
export function totalCost(deltas: UsageDelta[], fit: CapCostFit, base: string | null): number {
  return deltas.reduce((sum, delta) => sum + costOf(delta, fit, base), 0);
}

/** Tokens per 1% of the cap for a mix of kinds, or null when that use costs nothing. */
export function tokensPerPercent(perToken: TokenTotals, mix: TokenTotals): number | null {
  const points = TOKEN_KINDS.reduce((sum, kind) => sum + mix[kind] * perToken[kind], 0);
  return points > 0 ? totalOf(mix) / points : null;
}

/** The stretches ending after `since`, the largest unexplained growth first, at most `limit`. */
export function unexplainedStretches(fit: CapCostFit, since: string, limit: number): UnexplainedStretch[] {
  return fit.stretches
    .map((stretch, i) => ({ stretch, left: Math.max(0, fit.residuals[i] ?? 0) }))
    .filter(({ stretch, left }) => stretch.end > since && left >= NO_POINTS)
    .sort((a, b) => b.left - a.left || (a.stretch.start < b.stretch.start ? -1 : 1))
    .slice(0, limit)
    .map(({ stretch, left }) => ({
      start: stretch.start,
      end: stretch.end,
      points: left,
      growthPoints: stretch.growth,
      explainedPoints: Math.max(0, stretch.growth - left),
    }));
}

/** The unexplained growth of the stretches ending after `since`, as points and as a share of the growth. */
export function unexplainedTotals(fit: CapCostFit, since: string): UnexplainedTotals {
  const inside = fit.stretches.map((stretch, i) => ({ stretch, left: Math.max(0, fit.residuals[i] ?? 0) })).filter(({ stretch }) => stretch.end > since);
  const growthPoints = inside.reduce((sum, { stretch }) => sum + stretch.growth, 0);
  const points = inside.reduce((sum, { left }) => sum + left, 0);
  return { points, growthPoints, share: growthPoints === 0 ? 0 : points / growthPoints };
}
