import type {
  AgentKindDto,
  CapCostDto,
  CapCostEnvironmentDto,
  CapCostModelDto,
  CapLineDto,
  ModelTotalsDto,
  OtherTasksDto,
  TaskCostDto,
  UsageEnvironmentDto,
  UsageResponse,
  UsageSeriesDto,
} from "../api/usageDto";
import type { UsageConfig } from "../config";
import {
  type CapEvaluation,
  type CapReading,
  evaluateAll,
  newestPlan,
  planAt,
  plansOf,
  SHORT_WINDOW,
  WEEKLY_WINDOW,
} from "../domain/cap";
import {
  buildStretches,
  type CapCostFit,
  costByKey,
  FitMode,
  environmentIdentity,
  environmentKey,
  fitCapCost,
  MultiplierState,
  MAX_PLACE_WINDOWS,
  placeInWindows,
  tokensPerPercent,
  totalCost,
  unexplainedStretches,
  unexplainedTotals,
} from "../domain/capCost";
import { DomainError } from "../domain/upsert";
import {
  addTotals,
  BucketUnit,
  bucketKey,
  bucketKeys,
  busiestEnvironment,
  daysBefore,
  environmentTotals,
  rankTasks,
  Split,
  splitByBucket,
  TOKEN_KINDS,
  TokenKind,
  type TokenTotals,
  tokensByKey,
  totalOf,
  totalsByModel,
  type UsageDelta,
  UsageRange,
  type UsageSample,
  useBetween,
  usageDeltas,
  withBaseEnvironment,
  zeroTotals,
} from "../domain/usage";
import type { Clock } from "./board";
import { SeriesKind, type SeriesName, type SessionWindow, type UsageRepository } from "./ports";

const RANGE_DAYS: Record<UsageRange, number> = { [UsageRange.Day]: 1, [UsageRange.Window]: 7, [UsageRange.Month]: 30 };
/** The cap readings are read this far back at least, so a window's state is known (and never fewer than keepDays). */
const MIN_READING_DAYS = 30;
const MAX_UTC_OFFSET_MINUTES = 14 * 60;
/** Placed growth below this many points is not listed as an environment's cost. */
const NO_PLACED_POINTS = 0.05;

export interface ReportUsageInput {
  agent_key: string;
  model: string;
  record_at: string;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  task_key?: string;
  agent_kind?: string;
  step?: string;
  environment?: string;
}

export interface ReportCapInput {
  taken_at: string;
  plan: string;
  windows: { kind: string; percent: number; reset_at?: string }[];
  source?: string;
}

export interface UsageQuery {
  range: UsageRange;
  /** null: the plan of the newest accepted reading. */
  plan: string | null;
  /** null: all environments. */
  environment: string | null;
  utcOffsetMinutes: number;
}

function normalizeTime(field: string, value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new DomainError(field, `field ${field}: not a valid time`);
  return new Date(time).toISOString();
}

/** Stores one sample of running totals; the same report again stores nothing new. */
export async function reportUsage(
  repo: UsageRepository,
  input: ReportUsageInput,
  clock: Clock,
): Promise<{ stored: boolean }> {
  const sample: UsageSample = {
    agentKey: input.agent_key,
    model: input.model,
    environment: input.environment ?? null,
    recordAt: normalizeTime("record_at", input.record_at),
    totals: {
      input: input.input_tokens,
      cache_write: input.cache_write_tokens,
      cache_read: input.cache_read_tokens,
      output: input.output_tokens,
    },
    taskKey: input.task_key ?? null,
    agentKind: input.agent_kind ?? null,
    step: input.step ?? null,
  };
  return { stored: await repo.saveUsage(sample, clock.now().toISOString()) };
}

/** Stores one raw reading per window; which ones count is decided when read. */
export async function reportCap(repo: UsageRepository, input: ReportCapInput): Promise<{ stored: number; windows: number }> {
  const takenAt = normalizeTime("taken_at", input.taken_at);
  const readings: CapReading[] = input.windows.map((window) => ({
    takenAt,
    plan: input.plan,
    windowKind: window.kind,
    percent: window.percent,
    resetAt: window.reset_at === undefined ? null : normalizeTime("reset_at", window.reset_at),
    source: input.source ?? null,
  }));
  return { stored: await repo.saveCapReadings(readings), windows: readings.length };
}

/** The cron's second job: thin samples older than the keep-time; returns how many were deleted. */
export async function thinOldUsage(repo: UsageRepository, keepDays: number, clock: Clock): Promise<number> {
  return repo.thinUsage(daysBefore(clock.now(), keepDays));
}

export function parseUsageQuery(params: URLSearchParams): UsageQuery {
  const range = params.get("range") ?? UsageRange.Window;
  if (!(Object.values(UsageRange) as string[]).includes(range)) {
    throw new DomainError("range", `field range: one of ${Object.values(UsageRange).join(", ")}`);
  }
  return {
    range: range as UsageRange,
    plan: params.get("plan") || null,
    environment: params.get("environment") || null,
    utcOffsetMinutes: parseOffset(params.get("utc_offset")),
  };
}

function parseOffset(raw: string | null): number {
  if (raw === null || raw === "") return 0;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || Math.abs(minutes) > MAX_UTC_OFFSET_MINUTES) {
    throw new DomainError("utc_offset", `field utc_offset: whole minutes from UTC, at most ${MAX_UTC_OFFSET_MINUTES} either way`);
  }
  return minutes;
}

interface CapState {
  readings: CapReading[];
  evaluation: CapEvaluation;
  plan: string | null;
}

/** The whole usage answer for one request: tokens worked out from samples, caps from raw readings. */
export async function readUsage(
  repo: UsageRepository,
  query: UsageQuery,
  config: UsageConfig,
  clock: Clock,
): Promise<UsageResponse> {
  const now = clock.now();
  const cap = await loadCap(repo, query, config, now);
  const from = rangeStart(query.range, now, cap);
  const history = usageDeltas(await repo.usageSamplesFrom(historyStart(from, now, config)));
  // One base for the page and the fit: the busiest environment of the whole history, never of the range.
  const base = config.baseEnvironment ?? busiestEnvironment(history);
  const knownHistory = withBaseEnvironment(history, base);
  const known = rangeDeltas(knownHistory, cap, from, now.toISOString());
  const shown = query.environment === null ? known : known.filter(({ sample }) => sample.environment === query.environment);
  const [order, sessionWindows] = await Promise.all([repo.seriesNames(), repo.sessionWindowsFrom(historyStart(from, now, config), MAX_PLACE_WINDOWS)]);
  const costing = placeChatGrowth(fitFor(cap, knownHistory, config, base), knownHistory, order, windowsInFilter(sessionWindows, query.environment), from);
  const tasks = await taskCosts(repo, shown, config.topTasks, costing);
  const unit = query.range === UsageRange.Day ? BucketUnit.Hour : BucketUnit.Day;
  const buckets = bucketKeys(from, now.toISOString(), query.utcOffsetMinutes, unit);
  return {
    server_time: now.toISOString(),
    range: query.range,
    from,
    plan: cap.plan,
    plans: plansOf(cap.readings),
    environment: query.environment,
    environments: environmentList(known, order, config),
    base_environment: base,
    utc_offset_minutes: query.utcOffsetMinutes,
    palette: config.series,
    bucket_unit: unit,
    buckets,
    splits: buildSplits(shown, buckets, unit, query.utcOffsetMinutes, order, config),
    totals_by_model: modelTotals(shown, order),
    totals_by_token_kind: kindTotals(shown, now.toISOString()),
    top_tasks: tasks.top,
    other_tasks: tasks.other,
    agent_kinds: agentKinds(shown, order, costing),
    cap: { weekly: capLine(cap, WEEKLY_WINDOW, from), short: capLine(cap, SHORT_WINDOW, from) },
    cap_cost: capCostDto(costing, { known, shown, order, config, from }),
  };
}

/** The history the fit reads: as far back as the cap readings are, and never later than the range. */
function historyStart(from: string, now: Date, config: UsageConfig): string {
  const earliest = daysBefore(now, Math.max(MIN_READING_DAYS, config.keepDays));
  return from < earliest ? from : earliest;
}

async function loadCap(repo: UsageRepository, query: UsageQuery, config: UsageConfig, now: Date): Promise<CapState> {
  const readings = await repo.capReadingsFrom(daysBefore(now, Math.max(MIN_READING_DAYS, config.keepDays)));
  const evaluation = evaluateAll(readings, config.lowMarkPercent);
  return { readings, evaluation, plan: query.plan ?? newestPlan(evaluation.verdicts) };
}

/** `window` starts where the plan's current weekly window starts; with no weekly reading, 7 days back. */
function rangeStart(range: UsageRange, now: Date, cap: CapState): string {
  if (range === UsageRange.Window) {
    const windows = cap.evaluation.windows.filter((w) => w.plan === cap.plan && w.windowKind === WEEKLY_WINDOW);
    const current = windows[windows.length - 1];
    if (current) return current.startedAt;
  }
  return daysBefore(now, RANGE_DAYS[range]);
}

/** Deltas of the range, only those that fall in the chosen plan's time (no readings: every plan). */
function rangeDeltas(history: UsageDelta[], cap: CapState, from: string, to: string): UsageDelta[] {
  return history.filter(({ sample }) => {
    if (sample.recordAt < from || sample.recordAt > to) return false;
    return cap.plan === null || planAt(cap.readings, sample.recordAt) === cap.plan;
  });
}

function colorIndexer(order: SeriesName[], kind: SeriesKind): (value: string | null) => number {
  const names = order.filter((entry) => entry.kind === kind).map((entry) => entry.value);
  return (value) => (value === null || !names.includes(value) ? names.length : names.indexOf(value));
}

function environmentList(deltas: UsageDelta[], order: SeriesName[], config: UsageConfig): UsageEnvironmentDto[] {
  const indexOf = colorIndexer(order, SeriesKind.Environment);
  return [...environmentTotals(deltas).entries()]
    .sort(([a], [b]) => indexOf(a) - indexOf(b) || a.localeCompare(b))
    .map(([value, { tokens, reports }]) => ({ value, label: config.environmentLabels[value] ?? value, tokens, reports }));
}

function buildSplits(
  deltas: UsageDelta[],
  buckets: string[],
  unit: BucketUnit,
  offset: number,
  order: SeriesName[],
  config: UsageConfig,
): Record<Split, UsageSeriesDto[]> {
  const bucketOf = (delta: UsageDelta): string => bucketKey(delta.sample.recordAt, offset, unit);
  const indexers: Record<Split, (name: string | null) => number> = {
    [Split.Model]: colorIndexer(order, SeriesKind.Model),
    [Split.AgentKind]: colorIndexer(order, SeriesKind.AgentKind),
    [Split.Environment]: colorIndexer(order, SeriesKind.Environment),
    [Split.TokenKind]: (name) => TOKEN_KINDS.indexOf(name as TokenKind),
  };
  const build = (split: Split): UsageSeriesDto[] =>
    splitByBucket(deltas, buckets, bucketOf, split)
      .map(({ name, values }) => ({
        name,
        label: split === Split.Environment && name !== null ? (config.environmentLabels[name] ?? name) : name,
        color_index: indexers[split](name),
        values,
      }))
      .sort((a, b) => a.color_index - b.color_index || String(a.name).localeCompare(String(b.name)));
  return {
    [Split.Model]: build(Split.Model),
    [Split.TokenKind]: build(Split.TokenKind),
    [Split.AgentKind]: build(Split.AgentKind),
    [Split.Environment]: build(Split.Environment),
  };
}

function modelTotals(deltas: UsageDelta[], order: SeriesName[]): ModelTotalsDto[] {
  const indexOf = colorIndexer(order, SeriesKind.Model);
  return [...totalsByModel(deltas).entries()]
    .map(([model, totals]) => ({ model, color_index: indexOf(model), ...totals, total: totalOf(totals) }))
    .sort((a, b) => a.color_index - b.color_index || a.model.localeCompare(b.model));
}

/** The use of the shown deltas up to `to`, by the one use rule (domain/usage.ts). */
function kindTotals(deltas: UsageDelta[], to: string): UsageResponse["totals_by_token_kind"] {
  const used = useBetween(deltas, null, to);
  return { ...used, total: totalOf(used) };
}

function agentKinds(deltas: UsageDelta[], order: SeriesName[], costing: Costing): AgentKindDto[] {
  const indexOf = colorIndexer(order, SeriesKind.AgentKind);
  const points = costsBy(deltas, costing, ({ sample }) => sample.agentKind);
  return [...tokensByKey(deltas, ({ sample }) => sample.agentKind).entries()]
    .map(([name, tokens]) => ({ name, color_index: indexOf(name), tokens, cap_points: points?.get(name) ?? null }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

async function taskCosts(
  repo: UsageRepository,
  deltas: UsageDelta[],
  limit: number,
  costing: Costing,
): Promise<{ top: TaskCostDto[]; other: OtherTasksDto | null }> {
  const points = costsBy(deltas, costing, ({ sample }) => sample.taskKey);
  const pointsOf = (key: string): number | null => points?.get(key) ?? null;
  const ranked = rankTasks(tokensByKey(deltas, ({ sample }) => sample.taskKey), limit);
  const infos = new Map((await repo.taskInfo([...ranked.top, ...ranked.rest].map(([key]) => key))).map((i) => [i.key, i]));
  const describe = ([key, tokens]: [string, number]): TaskCostDto => ({
    key,
    title: infos.get(key)?.title ?? key,
    project: infos.get(key)?.project ?? projectOfKey(key),
    tokens,
    cap_points: pointsOf(key),
  });
  const rest = ranked.rest.map(describe);
  const other =
    rest.length === 0
      ? null
      : {
          tokens: rest.reduce((sum, t) => sum + t.tokens, 0),
          projects: new Set(rest.map((t) => t.project)).size,
          cap_points: rest.some((t) => t.cap_points === null) ? null : rest.reduce((sum, t) => sum + (t.cap_points ?? 0), 0),
        };
  return { top: ranked.top.map(describe), other };
}

/** A key with no item: its project is the part before the first slash, else the key. */
function projectOfKey(key: string): string {
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : key;
}

/** One window kind of the chosen plan: accepted readings per window, dropped ones with what they lost to. */
function capLine(cap: CapState, kind: string, from: string): CapLineDto {
  const windows = cap.evaluation.windows.filter((w) => w.plan === cap.plan && w.windowKind === kind);
  const inRange = windows
    .map((w) => ({ w, readings: w.readings.filter((r) => r.takenAt >= from) }))
    .filter(({ readings }) => readings.length > 0);
  const dropped = cap.evaluation.verdicts.filter(
    (v) => !v.accepted && v.reading.plan === cap.plan && v.reading.windowKind === kind && v.reading.takenAt >= from,
  );
  const newest = windows[windows.length - 1];
  const last = newest?.readings[newest.readings.length - 1];
  return {
    windows: inRange.map(({ w, readings }) => ({
      started_at: w.startedAt,
      reset_at: w.resetAt,
      readings: readings.map((r) => ({ taken_at: r.takenAt, percent: r.percent })),
    })),
    dropped: dropped.map((v) => ({ taken_at: v.reading.takenAt, percent: v.reading.percent, stored_percent: v.lostTo ?? 0 })),
    latest: last ? { taken_at: last.takenAt, percent: last.percent, reset_at: newest?.resetAt ?? null } : null,
  };
}

/** The fit of the chosen plan, or none while it has too few stretches; the count is kept either way. */
interface Costing {
  fit: CapCostFit | null;
  stretches: number;
  base: string | null;
  minStretches: number;
  /** Points of cap growth put against environments that report no tokens, from their reported work windows (Slice 16). */
  placed: Map<string, number>;
}

/**
 * Slice 16: cap growth no token report explains, inside the reported work of a session whose
 * environment sends no token numbers (a chat, Claude Design), is put against that environment.
 * An environment that does report tokens is fitted like any other and has no window here.
 */
function placeChatGrowth(costing: Costing, history: UsageDelta[], order: SeriesName[], sessionWindows: SessionWindow[], rangeFrom: string): Costing {
  if (costing.fit === null) return costing;
  const reporting = new Set([
    ...history.map(({ sample }) => environmentIdentity(environmentKey(sample.environment, costing.base))),
    ...order.filter((entry) => entry.kind === SeriesKind.Environment).map((entry) => environmentIdentity(entry.value)),
  ]);
  const windows = sessionWindows.filter((w) => !reporting.has(environmentIdentity(w.environment)));
  const placed = placeInWindows(costing.fit, windows, rangeFrom);
  return { ...costing, fit: placed.fit, placed: placed.byEnvironment };
}

/** An environment filter narrows the placed work windows too: only the filtered environment's own windows count. */
function windowsInFilter(windows: SessionWindow[], environment: string | null): SessionWindow[] {
  if (environment === null) return windows;
  const wanted = environmentIdentity(environment);
  return windows.filter((w) => environmentIdentity(w.environment) === wanted);
}

function fitFor(cap: CapState, history: UsageDelta[], config: UsageConfig, base: string | null): Costing {
  const stretches = cap.plan === null ? [] : buildStretches(cap.evaluation.windows, cap.plan, history, config.capCost, base);
  const fit = stretches.length >= config.capCost.minStretches ? fitCapCost(stretches, base, config.capCost) : null;
  return { fit, stretches: stretches.length, base, minStretches: config.capCost.minStretches, placed: new Map() };
}

/** Points of the cap per key; null while the estimate is not ready. */
function costsBy(deltas: UsageDelta[], costing: Costing, keyOf: (delta: UsageDelta) => string | null): Map<string, number | null> | null {
  return costing.fit ? costByKey(deltas, costing.fit, costing.base, keyOf) : null;
}

interface CapCostContext {
  known: UsageDelta[];
  shown: UsageDelta[];
  order: SeriesName[];
  config: UsageConfig;
  from: string;
}

function capCostDto(costing: Costing, context: CapCostContext): CapCostDto {
  const { fit } = costing;
  const head = { ready: false, stretches: costing.stretches, min_stretches: costing.minStretches };
  if (fit === null) {
    return { ...head, models: [], environments: [], unexplained: null, unexplained_stretches: [], steps: [] };
  }
  const { known, shown, order, config, from } = context;
  const totals = unexplainedTotals(fit, from);
  const modelIndex = colorIndexer(order, SeriesKind.Model);
  return {
    ...head,
    ready: true,
    models: fit.models.map((model) => modelDto(fit, model.model, known, modelIndex)),
    environments: environmentCosts(costing, fit, known, order, config),
    unexplained: { points: totals.points, growth_points: totals.growthPoints, share: totals.share },
    unexplained_stretches: unexplainedStretches(fit, from, config.capCost.unexplainedStretches).map((s) => ({
      start: s.start,
      end: s.end,
      points: s.points,
      growth_points: s.growthPoints,
      explained_points: s.explainedPoints,
    })),
    steps: stepCosts(shown, costing),
  };
}

function stepCosts(deltas: UsageDelta[], costing: Costing): { step: string; cap_points: number | null }[] {
  const points = costsBy(deltas, costing, ({ sample }) => sample.step) ?? new Map<string, number | null>();
  return [...points.entries()]
    .map(([step, cap_points]) => ({ step, cap_points }))
    .sort((a, b) => (b.cap_points ?? -1) - (a.cap_points ?? -1) || a.step.localeCompare(b.step));
}

const UNIT_MIX: TokenTotals = { input: 1, cache_write: 1, cache_read: 1, output: 1 };

function perKindValues(make: (kind: TokenKind) => number | null): Record<TokenKind, number | null> {
  return {
    input: make(TokenKind.Input),
    cache_write: make(TokenKind.CacheWrite),
    cache_read: make(TokenKind.CacheRead),
    output: make(TokenKind.Output),
  };
}

/** Fresh input, unless the fit gave it no weight (it is never negative); then the kind that weighs the most. */
function ratioReference(perToken: TokenTotals): TokenKind | null {
  if (perToken.input > 0) return TokenKind.Input;
  const heaviest = TOKEN_KINDS.reduce((best, kind) => (perToken[kind] > perToken[best] ? kind : best), TokenKind.Input);
  return perToken[heaviest] > 0 ? heaviest : null;
}

function modelDto(fit: CapCostFit, name: string, known: UsageDelta[], indexOf: (value: string | null) => number): CapCostModelDto {
  const model = fit.models.find((m) => m.model === name) as CapCostFit["models"][number];
  const own = totalsByModel(known).get(name);
  const mix = own && totalOf(own) > 0 ? own : stretchMix(fit, name);
  const reference = ratioReference(model.perToken);
  const ratio = (kind: TokenKind): number | null => (reference === null ? null : model.perToken[kind] / model.perToken[reference]);
  return {
    model: name,
    color_index: indexOf(name),
    mode: model.mode,
    tokens_per_percent: perKindValues((kind) => (model.perToken[kind] > 0 ? 1 / model.perToken[kind] : null)),
    all_kinds_tokens_per_percent: tokensPerPercent(model.perToken, mix),
    kind_ratios: model.mode === FitMode.PerKind ? perKindValues(ratio) : null,
    kind_ratio_reference: model.mode === FitMode.PerKind ? reference : null,
    how_sure: model.howSure,
    stretches: model.stretches,
    finer_at: model.finerAt,
  };
}

/** The model's use inside the stretches, summed: the mix when the range holds none of it. */
function stretchMix(fit: CapCostFit, name: string): TokenTotals {
  const uses = fit.stretches.flatMap((s) => s.uses).filter((use) => use.model === name);
  const mix = uses.reduce((sum, use) => addTotals(sum, use.totals), zeroTotals());
  return totalOf(mix) > 0 ? mix : UNIT_MIX;
}

function environmentCosts(costing: Costing, fit: CapCostFit, known: UsageDelta[], order: SeriesName[], config: UsageConfig): CapCostEnvironmentDto[] {
  const weighted = new Set(fit.models.map((m) => m.model));
  const reporting = environmentList(known, order, config).map((environment) => {
    const fitted = fit.environments.find((e) => e.environment === environment.value);
    const own = known.filter(({ sample }) => sample.environment === environment.value);
    return {
      ...environment,
      cap_points: own.some(({ sample }) => !weighted.has(sample.model)) ? null : totalCost(own, fit, costing.base),
      multiplier: fitted?.multiplier ?? 1,
      state: fitted?.state ?? (environment.value === costing.base ? MultiplierState.Base : MultiplierState.NotEnough),
      how_sure: fitted?.howSure ?? null,
      stretches: fitted?.stretches ?? 0,
    };
  });
  return [...reporting, ...placedEnvironments(costing, config)];
}

/** Environments with no token reports whose reported work windows hold cap growth: tokens unknown (null, never 0), points placed. */
function placedEnvironments(costing: Costing, config: UsageConfig): CapCostEnvironmentDto[] {
  return [...costing.placed.entries()]
    .filter(([, points]) => points >= NO_PLACED_POINTS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, points]) => ({
      value,
      label: config.environmentLabels[value] ?? value,
      tokens: null,
      reports: 0,
      cap_points: points,
      multiplier: null,
      state: MultiplierState.NotEnough,
      how_sure: null,
      stretches: 0,
    }));
}
