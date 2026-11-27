/**
 * What 1% of the cap costs (Slice 9). Nothing here is stored: stretches of time between two cap
 * readings of one window, the best fit of what each token costs, and the cost of any use are
 * all worked out on every read from the readings and the use samples.
 */
import type { CapCostConfig } from "../config";
import { type CapWindow, ownCapModels, WEEKLY_WINDOW } from "./cap";
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
/** Placement works on at most this many work windows per environment (the newest, after merging overlaps), so its cost per read is bounded by this times the number of environments. */
export const MAX_PLACE_WINDOWS = 500;

/** The characters trimmed from both ends of an environment name; the repository's SQL `trim(x, ?)` is bound to this same set. */
export const IDENTITY_TRIM_CHARS = " \t\n\r";
const IDENTITY_TRIM = /^[ \t\n\r]+|[ \t\n\r]+$/g;
const ASCII_UPPER = /[A-Z]/g;

/**
 * The one way environment names are compared: without case or surrounding spaces, ASCII only (SQLite's `lower`
 * folds A-Z and nothing else, so a wider rule here would disagree with the repository filter). Used by merging,
 * placement and the repository filter (Slice 34); `test/capCost.test.ts` holds the SQL and this equal.
 */
export function environmentIdentity(name: string): string {
  return name.replace(IDENTITY_TRIM, "").replace(ASCII_UPPER, (letter) => letter.toLowerCase());
}

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
  /** Slice 67: the model's own weights are backed by enough stretches where it holds a real share; false shows a dash, and its cost is unknown. */
  enough: boolean;
  /** Slice 67: the window kind of the model's own cap (`weekly:<model>`) when it was fitted against that, else null. Its points are not the shared cap's. */
  ownCap: string | null;
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
  /** Slice 67: points of the cap per day the fit puts on use no tokens explain ("untracked use"); never in a model's weights. */
  untrackedPerDay: number;
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
export function buildStretches(
  windows: CapWindow[],
  plan: string,
  deltas: UsageDelta[],
  config: CapCostConfig,
  base: string | null,
  windowKind: string = WEEKLY_WINDOW,
): Stretch[] {
  const byTime = [...deltas].sort((a, b) => (a.sample.recordAt < b.sample.recordAt ? -1 : a.sample.recordAt > b.sample.recordAt ? 1 : 0));
  return windows
    .filter((window) => window.plan === plan && window.windowKind === windowKind)
    .flatMap((window) => windowStretches(window, byTime, config, base));
}

/**
 * Slice 67: the fit's start date. Readings taken before `from` are dropped (a window left with none
 * is dropped), and so are use deltas recorded before it. Nothing is deleted; a null `from` keeps all.
 */
export function fromFitStart(windows: CapWindow[], deltas: UsageDelta[], from: string | null): { windows: CapWindow[]; deltas: UsageDelta[] } {
  const start = from === null ? Number.NaN : Date.parse(from);
  if (Number.isNaN(start)) return { windows, deltas };
  const kept = windows
    .map((window) => ({ ...window, readings: window.readings.filter((r) => Date.parse(r.takenAt) >= start) }))
    .filter((window) => window.readings.length > 0);
  return { windows: kept, deltas: deltas.filter(({ sample }) => Date.parse(sample.recordAt) >= start) };
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
export function nnls(columns: number[][], target: number[], start: number[], ridge: number | number[] = 0): number[] {
  const x = start.map((value) => Math.max(0, value));
  const norms = columns.map((column) => column.reduce((sum, v) => sum + v * v, 0));
  const fitted = target.map((_, row) => columns.reduce((sum, column, c) => sum + (column[row] ?? 0) * (x[c] ?? 0), 0));
  for (let round = 0; round < MAX_SOLVE_ROUNDS; round++) {
    let moved = 0;
    for (let c = 0; c < columns.length; c++) {
      moved = Math.max(moved, stepColumn(columns[c] ?? [], norms[c] ?? 0, x, c, target, fitted, typeof ridge === "number" ? ridge : (ridge[c] ?? 0)));
    }
    if (moved < SOLVE_STEP_LIMIT) break;
  }
  return x;
}

/**
 * One coordinate step: moves x[c] to its best value with the rest held, updates `fitted`, returns the move.
 * `ridge` (Slice 67) adds a penalty of ridge x norm x x[c]^2, scaled to the column's own size, so two columns
 * that move together share their weight instead of one running away.
 */
function stepColumn(column: number[], norm: number, x: number[], c: number, target: number[], fitted: number[], ridge: number): number {
  if (norm === 0) return 0;
  const current = x[c] ?? 0;
  let gradient = 0;
  for (let row = 0; row < column.length; row++) {
    const v = column[row] ?? 0;
    gradient += v * ((target[row] ?? 0) - (fitted[row] ?? 0) + v * current);
  }
  const next = Math.max(0, gradient / (norm * (1 + ridge)));
  for (let row = 0; row < column.length; row++) fitted[row] = (fitted[row] ?? 0) + (column[row] ?? 0) * (next - current);
  x[c] = next;
  return Math.abs(next - current);
}

interface Column {
  model: string;
  /** null: one weight for every kind. */
  kind: TokenKind | null;
  /** Slice 67: the intercept, one per fit: points per day no tokens explain; it has no model. */
  untracked?: boolean;
}

interface FitPlan {
  models: string[];
  modes: Map<string, FitMode>;
  columns: Column[];
  /** Per-kind models: the kinds too small to have a column, priced at the model's mean weight. */
  merged: Map<string, TokenKind[]>;
}

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

function stretchDays(stretch: Stretch): number {
  return Math.max(0, Date.parse(stretch.end) - Date.parse(stretch.start)) / MS_PER_DAY;
}

/** A model's tokens per kind over all stretches. */
function modelKindTokens(stretches: Stretch[], model: string): TokenTotals {
  return stretches
    .flatMap((s) => s.uses)
    .filter((use) => use.model === model)
    .reduce((sum, use) => addInto(sum, use.totals), zeroTotals());
}

/** Kinds with their own column: at least `minKindShare` of the model's tokens (the largest kind always). */
function columnKinds(tokens: TokenTotals, config: CapCostConfig): TokenKind[] {
  const all = totalOf(tokens);
  const largest = TOKEN_KINDS.reduce((best, kind) => (tokens[kind] > tokens[best] ? kind : best), TOKEN_KINDS[0] as TokenKind);
  return TOKEN_KINDS.filter((kind) => kind === largest || (all > 0 && tokens[kind] / all >= config.minKindShare));
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
  const merged = new Map<string, TokenKind[]>();
  const columns = models.flatMap((model): Column[] => {
    if (modes.get(model) !== FitMode.PerKind) return [{ model, kind: null }];
    const kept = columnKinds(modelKindTokens(stretches, model), config);
    merged.set(model, TOKEN_KINDS.filter((kind) => !kept.includes(kind)));
    return kept.map((kind) => ({ model, kind }));
  });
  if (stretches.length > 0) columns.push({ model: "", kind: null, untracked: true });
  return { models, modes, columns, merged };
}

function columnTokens(use: StretchUse, column: Column): number {
  if (column.untracked || use.model !== column.model) return 0;
  return column.kind === null ? totalOf(use.totals) : use.totals[column.kind];
}

/** Weight columns with the multipliers held: per stretch the tokens in millions, scaled by each environment's multiplier; the intercept's is the stretch's days. */
function weightColumns(stretches: Stretch[], plan: FitPlan, multipliers: Map<string, number>): number[][] {
  return plan.columns.map((column) =>
    stretches.map((s) =>
      column.untracked
        ? stretchDays(s)
        : s.uses.reduce((sum, use) => sum + (multipliers.get(use.environment) ?? 1) * columnTokens(use, column) / PER_MILLION, 0),
    ),
  );
}

/** The intercept is held back harder than the model weights, so growth the tokens can explain is theirs and only the rest is "untracked". */
function ridgeOf(plan: FitPlan, config: CapCostConfig): number[] {
  return plan.columns.map((column) => (column.untracked ? config.untrackedRidge : config.ridge));
}

/** Points per day the fit puts on the intercept, over one stretch. */
function untrackedPoints(stretch: Stretch, plan: FitPlan, weights: number[]): number {
  return plan.columns.reduce((sum, column, c) => sum + (column.untracked ? (weights[c] ?? 0) * stretchDays(stretch) : 0), 0);
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
  let weights = nnls(weightColumns(stretches, plan, multipliers), growth, plan.columns.map(() => 0), ridgeOf(plan, config));
  for (let round = 0; round < MAX_FIT_ROUNDS && estimated.length > 0; round++) {
    const before = estimated.map((name) => multipliers.get(name) ?? 1);
    const weightsBefore = weights;
    const fixed = fixedPart(stretches, plan, weights, estimated);
    const next = nnls(multiplierColumns(stretches, plan, weights, estimated), growth.map((g, s) => g - (fixed[s] ?? 0)), before);
    estimated.forEach((name, i) => multipliers.set(name, next[i] ?? 0));
    weights = nnls(weightColumns(stretches, plan, multipliers), growth, weights, ridgeOf(plan, config));
    const change = Math.max(...estimated.map((name, i) => Math.abs((multipliers.get(name) ?? 0) - (before[i] ?? 0))));
    const weightChange = Math.max(0, ...weights.map((w, i) => Math.abs(w - (weightsBefore[i] ?? 0))));
    if (Math.max(change, weightChange) < config.convergence) break;
  }
  return { weights, multipliers };
}

/** Per stretch, the points the environments that are not estimated (the base and the unmeasured ones, all 1x) account for. */
function fixedPart(stretches: Stretch[], plan: FitPlan, weights: number[], estimated: string[]): number[] {
  return stretches.map((s) =>
    untrackedPoints(s, plan, weights) +
    s.uses.filter((use) => !estimated.includes(use.environment)).reduce((sum, use) => sum + weightedMillions(use, plan, weights), 0),
  );
}

/**
 * Points per token of one model, per kind. A kind with no column of its own (too small a share of
 * the model's tokens) takes the model's mean weight over the kinds that have one, so it can never
 * run away on a handful of tokens.
 */
function perTokenOf(plan: FitPlan, weights: number[], model: string, stretches: Stretch[]): TokenTotals {
  const perToken = zeroTotals();
  plan.columns.forEach((column, c) => {
    if (column.model !== model || column.untracked) return;
    const value = (weights[c] ?? 0) / PER_MILLION;
    for (const kind of column.kind === null ? TOKEN_KINDS : [column.kind]) perToken[kind] = value;
  });
  const small = plan.merged.get(model) ?? [];
  if (small.length === 0) return perToken;
  const tokens = modelKindTokens(stretches, model);
  const own = TOKEN_KINDS.filter((kind) => !small.includes(kind));
  const points = own.reduce((sum, kind) => sum + perToken[kind] * tokens[kind], 0);
  const count = own.reduce((sum, kind) => sum + tokens[kind], 0);
  const mean = count > 0 ? points / count : 0;
  for (const kind of small) perToken[kind] = tokens[kind] > 0 ? mean : 0;
  return perToken;
}

function howSure(stretches: number, netErrorShare: number, config: CapCostConfig): HowSure {
  const enough = stretches >= config.sure.minStretches && netErrorShare <= config.sure.maxLeftoverShare;
  return enough ? HowSure.Sure : HowSure.Rough;
}

/** The indexes of the stretches where the model holds at least `modelMinShare` of the tokens: the evidence its own weights stand on. */
function evidenceIndexes(stretches: Stretch[], model: string, config: CapCostConfig): number[] {
  return stretches.flatMap((s, i) => {
    const all = s.uses.reduce((sum, use) => sum + totalOf(use.totals), 0);
    const own = s.uses.filter((use) => use.model === model).reduce((sum, use) => sum + totalOf(use.totals), 0);
    return own > 0 && own >= config.modelMinShare * all ? [i] : [];
  });
}

/** Models whose token evidence is under the floor: they leave the shared fit, so their growth is untracked use. */
function thinModels(stretches: Stretch[], config: CapCostConfig): Set<string> {
  return new Set(modelsOf(stretches).filter((model) => evidenceIndexes(stretches, model, config).length < config.modelMinStretches));
}

/** Points the fit gives one model in one stretch (its weights, times each environment's multiplier). */
function modelPoints(stretch: Stretch, model: string, plan: FitPlan, weights: number[], multipliers: Map<string, number>): number {
  return stretch.uses
    .filter((use) => use.model === model)
    .reduce((sum, use) => sum + (multipliers.get(use.environment) ?? 1) * weightedMillions(use, plan, weights), 0);
}

interface FitState {
  stretches: Stretch[];
  plan: FitPlan;
  weights: number[];
  multipliers: Map<string, number>;
  fitError: number[];
}

/**
 * Per model (Slice 67): a stretch is evidence only when the model holds a real share of its tokens and
 * its fitted points explain a real share of the stretch's growth; how sure is judged on the model's own
 * part of each stretch's error, not on the whole fit's.
 */
function evidenceOf(model: string, tokenEvidence: number[], state: FitState, config: CapCostConfig): { count: number; ownError: number } {
  const { stretches, plan, weights, multipliers, fitError } = state;
  const parts = tokenEvidence.flatMap((i) => {
    const stretch = stretches[i] as Stretch;
    const points = modelPoints(stretch, model, plan, weights, multipliers);
    if (points < config.modelMinShare * stretch.growth) return [];
    const fitted = fittedGrowth(stretch, plan, weights, multipliers);
    const portion = fitted > 0 ? points / fitted : 0;
    return [{ error: (fitError[i] ?? 0) * portion, growth: stretch.growth * portion }];
  });
  const growth = parts.reduce((sum, p) => sum + p.growth, 0);
  const net = Math.abs(parts.reduce((sum, p) => sum + p.error, 0));
  return { count: parts.length, ownError: growth === 0 ? 0 : net / growth };
}

function modelFitOf(model: string, all: Stretch[], thin: Set<string>, state: FitState, config: CapCostConfig): ModelFit {
  const base = { model, ownCap: null, finerAt: config.fineFactor * KIND_COUNT, stretches: stretchesWith(all, (use) => use.model === model) };
  if (thin.has(model)) return { ...base, mode: FitMode.OneWeight, enough: false, perToken: zeroTotals(), howSure: HowSure.Rough };
  const { count, ownError } = evidenceOf(model, evidenceIndexes(all, model, config), state, config);
  const enough = count >= config.modelMinStretches;
  return {
    ...base,
    mode: state.plan.modes.get(model) ?? FitMode.OneWeight,
    enough,
    perToken: perTokenOf(state.plan, state.weights, model, state.stretches),
    howSure: enough ? howSure(count, ownError, config) : HowSure.Rough,
  };
}

/**
 * The best fit over the stretches: points of the cap per token for each model (per kind once there
 * are enough stretches), and a multiplier per environment with `base` fixed at 1. Never negative.
 * A model under the evidence floor is left out of the fit (its growth is untracked use), so it cannot skew the shown ones.
 */
export function fitCapCost(all: Stretch[], base: string | null, config: CapCostConfig): CapCostFit {
  const baseKey = base ?? "";
  const thin = thinModels(all, config);
  const stretches = thin.size === 0 ? all : all.map((s) => ({ ...s, uses: s.uses.filter((use) => !thin.has(use.model)) }));
  const plan = planFit(stretches, config);
  const estimated = base === null ? [] : estimableEnvironments(stretches, baseKey, config);
  const { weights, multipliers } = solve(stretches, plan, estimated, config);
  const residuals = stretches.map((s) => s.growth - fittedGrowth(s, plan, weights, multipliers));
  const leftoverShare = shareOfGrowth(stretches, residuals);
  // The verdict judges the whole fit, the intercept included; the shown residuals leave it out (it is the unexplained growth).
  const fitError = residuals.map((r, i) => r - untrackedPoints(stretches[i] as Stretch, plan, weights));
  const netShare = netErrorShare(stretches, fitError);
  const state: FitState = { stretches, plan, weights, multipliers, fitError };
  const models = modelsOf(all).map((model) => modelFitOf(model, all, thin, state, config));
  const names = [...new Set(all.flatMap((s) => s.uses.map((use) => use.environment)))].sort();
  const environments = names.map((name): EnvironmentFit => {
    const count = stretchesWith(all, (use) => use.environment === name);
    const measured = estimated.includes(name);
    return {
      environment: name,
      multiplier: measured ? (multipliers.get(name) ?? 1) : 1,
      state: name === baseKey ? MultiplierState.Base : measured ? MultiplierState.Measured : MultiplierState.NotEnough,
      stretches: count,
      howSure: measured ? howSure(count, netShare, config) : null,
    };
  });
  return { models, environments, stretches: all, residuals, leftoverShare, untrackedPerDay: untrackedPerDay(plan, weights) };
}

/** The models that have a cap of their own among the plan's windows, as model name -> window kind. */
export function ownCapKinds(windows: CapWindow[], plan: string, models: string[]): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const window of windows) {
    if (window.plan !== plan) continue;
    for (const model of ownCapModels(window.windowKind, models)) if (!kinds.has(model)) kinds.set(model, window.windowKind);
  }
  return kinds;
}

/**
 * Slice 67: a model with its own cap reading (`weekly:<model>`) is fitted against that window alone,
 * from the use of the models that share that cap only, and left out of the shared fit. Its weights
 * are points of its own cap, so they are never compared with another model's. Too few stretches: the
 * model is listed with no weights (a dash), never a made-up figure.
 */
export function fitOwnCap(windows: CapWindow[], plan: string, deltas: UsageDelta[], config: CapCostConfig, base: string | null, models: string[], windowKind: string): ModelFit[] {
  const own = deltas.filter(({ sample }) => models.includes(sample.model));
  const stretches = buildStretches(windows, plan, own, config, base, windowKind);
  const fits = stretches.length === 0 ? [] : fitCapCost(stretches, base, config).models;
  return models.map((model): ModelFit => {
    const empty: ModelFit = { model, mode: FitMode.OneWeight, enough: false, ownCap: windowKind, perToken: zeroTotals(), stretches: 0, finerAt: config.fineFactor * KIND_COUNT, howSure: HowSure.Rough };
    const fitted = fits.find((m) => m.model === model);
    if (fitted === undefined) return empty;
    return { ...fitted, enough: fitted.enough && stretches.length >= config.minStretches, ownCap: windowKind };
  });
}

function untrackedPerDay(plan: FitPlan, weights: number[]): number {
  return plan.columns.reduce((sum, column, c) => sum + (column.untracked ? (weights[c] ?? 0) : 0), 0);
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

/** The models whose weights the shared cap backs (Slice 67): enough evidence, and not fitted against a cap of their own. Any other model's cost is unknown (null, never 0). */
export function costedModels(fit: CapCostFit): Set<string> {
  return new Set(fit.models.filter((m) => m.enough && m.ownCap === null).map((m) => m.model));
}

/** Points of the cap the use costs: tokens times the model's weights times its environment's multiplier. */
export function costOf(delta: UsageDelta, fit: CapCostFit, base: string | null): number {
  const model = fit.models.find((m) => m.model === delta.sample.model);
  if (model === undefined || model.ownCap !== null) return 0;
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
  const fitted = costedModels(fit);
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

/** A window younger than this has too thin a mix to weight "all kinds" by (Slice 26). */
export const YOUNG_WINDOW_HOURS = 24;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Which window's mix of kinds weights the "all kinds" figure. */
export enum MixSource {
  Current = "current",
  LastFull = "last_full",
}

export interface MixChoice {
  source: MixSource;
  /** The last full window's span (from inclusive, to exclusive) when it is the source; null for the current mix. */
  from: string | null;
  to: string | null;
}

/** A window that lasted at least as long as the "young" threshold counts as a full one; a stub (a reset glitch) does not. */
function lastedFull(window: CapWindow, endedAt: string): boolean {
  return Date.parse(endedAt) - Date.parse(window.startedAt) >= YOUNG_WINDOW_HOURS * MS_PER_HOUR;
}

const MS_PER_WEEK = 7 * 24 * MS_PER_HOUR;

/** When a weekly window really began: its reset time minus a week when that is earlier than its first reading (a late first reading). */
function windowStartMs(window: CapWindow): number {
  const started = Date.parse(window.startedAt);
  if (window.resetAt === null) return started;
  const fromReset = Date.parse(window.resetAt) - MS_PER_WEEK;
  return Number.isNaN(fromReset) ? started : Math.min(started, fromReset);
}

/**
 * Slice 26: while the plan's newest weekly window is younger than a day, the mix comes from the
 * newest earlier window that lasted a full day or more (stubs are skipped); with none, or once the
 * newest window is a day old, from the current one (the range, as before).
 */
export function chooseMixWindow(windows: CapWindow[], plan: string | null, now: Date): MixChoice {
  const current: MixChoice = { source: MixSource.Current, from: null, to: null };
  if (plan === null) return current;
  const weekly = windows
    .filter((w) => w.plan === plan && w.windowKind === WEEKLY_WINDOW)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const newest = weekly[weekly.length - 1];
  if (newest === undefined || now.getTime() - windowStartMs(newest) >= YOUNG_WINDOW_HOURS * MS_PER_HOUR) return current;
  for (let i = weekly.length - 2; i >= 0; i--) {
    const window = weekly[i] as CapWindow;
    const endedAt = (weekly[i + 1] as CapWindow).startedAt;
    if (lastedFull(window, endedAt)) return { source: MixSource.LastFull, from: window.startedAt, to: endedAt };
  }
  return current;
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

/** One reported piece of work of an environment that cannot read its own use (a chat or a Claude Design session), first report to last. */
export interface WorkWindow {
  environment: string;
  start: string;
  end: string;
}

export interface PlacedGrowth {
  /** The fit with the placed points taken out of the residuals, so the unexplained figures count only what is left. */
  fit: CapCostFit;
  /** Points of cap growth put against each window environment. */
  byEnvironment: Map<string, number>;
}

/** A work window with its times parsed once. */
interface TimedWindow {
  environment: string;
  from: number;
  to: number;
}

/** The windows' parts inside the stretch (empty ones left out), in window order (the order of `windows`, which `boundedWindows` leaves sorted by end, as before Slice 35). */
function overlapsOf(windows: TimedWindow[], from: number, to: number): Array<{ environment: string; from: number; to: number }> {
  const inside: Array<{ environment: string; from: number; to: number }> = [];
  for (const w of windows) {
    const start = Math.max(w.from, from);
    const end = Math.min(w.to, to);
    if (end > start) inside.push({ environment: w.environment, from: start, to: end });
  }
  return inside;
}

/** Milliseconds that at least one of the intervals covers. */
function coveredMs(parts: Array<{ from: number; to: number }>): number {
  const spans = parts.map((p): [number, number] => [p.from, p.to]).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let reach = -Infinity;
  for (const [from, to] of spans) {
    covered += Math.max(0, to - Math.max(from, reach));
    reach = Math.max(reach, to);
  }
  return covered;
}

/**
 * Slice 16: growth no token report explains, inside the time a chat or Design session reported
 * working, goes against that session's environment instead of "not explained". The share of a
 * stretch's unexplained growth that is placed is the share of the stretch's time the windows
 * cover; it is split between overlapping windows pro rata to their overlap. Outside every window
 * it stays unexplained. Only stretches ending after `since` count towards `byEnvironment` (the
 * range shown); every stretch's residual shrinks. Nothing is stored: this runs on every read, one pass over stretches x windows.
 */
export function placeInWindows(fit: CapCostFit, allWindows: WorkWindow[], since: string): PlacedGrowth {
  const byEnvironment = new Map<string, number>();
  if (allWindows.length === 0) return { fit, byEnvironment };
  const windows = boundedWindows(allWindows);
  if (windows.length === 0) return { fit, byEnvironment };
  const residuals = fit.stretches.map((stretch, i) => {
    const left = Math.max(0, fit.residuals[i] ?? 0);
    const start = Date.parse(stretch.start);
    const length = Date.parse(stretch.end) - start;
    const parts = left === 0 || length <= 0 ? [] : overlapsOf(windows, start, start + length);
    const total = parts.reduce((sum, p) => sum + (p.to - p.from), 0);
    if (total === 0) return fit.residuals[i] ?? 0;
    const placed = (left * coveredMs(parts)) / length;
    if (stretch.end > since) parts.forEach((p) => byEnvironment.set(p.environment, (byEnvironment.get(p.environment) ?? 0) + (placed * (p.to - p.from)) / total));
    return (fit.residuals[i] ?? 0) - placed;
  });
  return { fit: { ...fit, residuals, leftoverShare: shareOfGrowth(fit.stretches, residuals) }, byEnvironment };
}

/** Overlapping windows of one environment merged once (times compared as parsed numbers), then the newest MAX_PLACE_WINDOWS of each environment kept. Empty and unreadable windows are dropped. */
function boundedWindows(windows: WorkWindow[]): TimedWindow[] {
  const timed = windows
    .map((w): TimedWindow => ({ environment: w.environment, from: Date.parse(w.start), to: Date.parse(w.end) }))
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.to > w.from)
    .sort((a, b) => a.from - b.from);
  const open = new Map<string, TimedWindow>();
  const merged: TimedWindow[] = [];
  const names = new Map<string, string>();
  for (const w of timed) {
    const identity = environmentIdentity(w.environment);
    const last = open.get(identity);
    if (last && w.from <= last.to) {
      if (w.to > last.to) last.to = w.to;
      continue;
    }
    if (!names.has(identity)) names.set(identity, w.environment);
    const copy = { ...w, environment: names.get(identity) as string };
    open.set(identity, copy);
    merged.push(copy);
  }
  return newestPerEnvironment(merged);
}

/** The newest MAX_PLACE_WINDOWS windows of each environment identity, in order of end; one busy environment never crowds out another's. */
function newestPerEnvironment(merged: TimedWindow[]): TimedWindow[] {
  const sorted = merged.sort((a, b) => a.to - b.to);
  const kept = new Map<string, number>();
  const newest: TimedWindow[] = [];
  for (const window of [...sorted].reverse()) {
    const identity = environmentIdentity(window.environment);
    const count = kept.get(identity) ?? 0;
    if (count >= MAX_PLACE_WINDOWS) continue;
    kept.set(identity, count + 1);
    newest.push(window);
  }
  return newest.reverse();
}
