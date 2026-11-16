import type {
  AgentKindDto,
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
import { DomainError } from "../domain/upsert";
import {
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
  type TokenKind,
  tokensByKey,
  totalOf,
  totalsByModel,
  type UsageDelta,
  UsageRange,
  type UsageSample,
  useBetween,
  usageDeltas,
  withBaseEnvironment,
} from "../domain/usage";
import type { Clock } from "./board";
import { SeriesKind, type SeriesName, type UsageRepository } from "./ports";

const RANGE_DAYS: Record<UsageRange, number> = { [UsageRange.Day]: 1, [UsageRange.Window]: 7, [UsageRange.Month]: 30 };
/** The cap readings are read this far back at least, so a window's state is known (and never fewer than keepDays). */
const MIN_READING_DAYS = 30;
const MAX_UTC_OFFSET_MINUTES = 14 * 60;

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
  const deltas = rangeDeltas(await repo.usageSamplesFrom(from), cap, from, now.toISOString());
  const base = config.baseEnvironment ?? busiestEnvironment(deltas);
  const known = withBaseEnvironment(deltas, base);
  const shown = query.environment === null ? known : known.filter(({ sample }) => sample.environment === query.environment);
  const order = await repo.seriesNames();
  const tasks = await taskCosts(repo, shown, config.topTasks);
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
    agent_kinds: agentKinds(shown, order),
    cap: { weekly: capLine(cap, WEEKLY_WINDOW, from), short: capLine(cap, SHORT_WINDOW, from) },
  };
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
function rangeDeltas(samples: UsageSample[], cap: CapState, from: string, to: string): UsageDelta[] {
  return usageDeltas(samples).filter(({ sample }) => {
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

function agentKinds(deltas: UsageDelta[], order: SeriesName[]): AgentKindDto[] {
  const indexOf = colorIndexer(order, SeriesKind.AgentKind);
  return [...tokensByKey(deltas, ({ sample }) => sample.agentKind).entries()]
    .map(([name, tokens]) => ({ name, color_index: indexOf(name), tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

async function taskCosts(
  repo: UsageRepository,
  deltas: UsageDelta[],
  limit: number,
): Promise<{ top: TaskCostDto[]; other: OtherTasksDto | null }> {
  const ranked = rankTasks(tokensByKey(deltas, ({ sample }) => sample.taskKey), limit);
  const infos = new Map((await repo.taskInfo([...ranked.top, ...ranked.rest].map(([key]) => key))).map((i) => [i.key, i]));
  const describe = ([key, tokens]: [string, number]): TaskCostDto => ({
    key,
    title: infos.get(key)?.title ?? key,
    project: infos.get(key)?.project ?? projectOfKey(key),
    tokens,
  });
  const rest = ranked.rest.map(describe);
  const other = rest.length === 0 ? null : { tokens: rest.reduce((sum, t) => sum + t.tokens, 0), projects: new Set(rest.map((t) => t.project)).size };
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
