import type { CapCostDto, CapCostModelDto, UsageBucketDto, UsagePageResponse, UsageSeriesDto } from "../src/api/usageDto";
import { configFromRecord } from "../src/config";
import { FitMode, HowSure, MixSource, MultiplierState } from "../src/domain/capCost";
import { BucketUnit, Split, TOKEN_KINDS, TokenKind, UsageRange } from "../src/domain/usage";
import exampleConfig from "../config/board.example.json" with { type: "json" };

/** Monday 16 November 2026, 13:48 UTC: the window began Tuesday 10 November 08:00. */
export const USAGE_SERVER_TIME = "2026-11-16T13:48:00.000Z";
export const PLANS = ["Plan One", "Plan Two"];
export const ENV_ONE = { value: "box-one", label: "Box One" };
export const ENV_TWO = { value: "box-two", label: "Box Two" };

const MILLION = 1_000_000;
const BUCKETS = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];
const WINDOW_START = "2026-11-10T08:00:00.000Z";
const WINDOW_RESET = "2026-11-17T08:00:00.000Z";
const KIND_SHARES = [0.01, 0.06, 0.9, 0.03];

/** Millions of tokens per day, per made-up model. */
const MODELS: [string, number[]][] = [
  ["model-alpha", [1.2, 2.0, 0.6, 1.5, 2.2, 1.8, 1.4]],
  ["model-beta", [3.1, 3.4, 1.9, 3.6, 4.4, 2.8, 2.5]],
  ["model-gamma", [0.8, 1.0, 0.4, 0.9, 1.1, 0.7, 0.6]],
];
const AGENT_KINDS: [string, number[]][] = [
  ["reviewer", [2.0, 3.0, 1.0, 2.5, 3.5, 2.0, 1.5]],
  ["builder", [3.1, 3.4, 1.9, 3.5, 4.2, 3.3, 3.0]],
];
const ENVIRONMENTS: [typeof ENV_ONE, number[]][] = [
  [ENV_ONE, [3.0, 4.0, 2.0, 4.0, 5.0, 3.5, 3.0]],
  [ENV_TWO, [2.1, 2.4, 0.9, 2.0, 2.7, 1.8, 1.5]],
];

const toTokens = (millions: number[]) => millions.map((m) => Math.round(m * MILLION));

function series(name: string | null, label: string | null, colorIndex: number, values: number[]): UsageSeriesDto {
  return { name, label, color_index: colorIndex, values };
}

const MS_PER_DAY = 86_400_000;

/** The Worker's bucket list for the demo week: whole UTC days, the first starting at the window start. */
function bucketList(): UsageBucketDto[] {
  return BUCKETS.map((key, i) => {
    const midnight = Date.parse(`${key}T00:00:00.000Z`);
    const start = i === 0 ? WINDOW_START : new Date(midnight).toISOString();
    return { key, start, end: new Date(midnight + MS_PER_DAY).toISOString() };
  });
}

function sumOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function splits(): UsagePageResponse["splits"] {
  const totals = BUCKETS.map((_, i) => MODELS.reduce((sum, [, values]) => sum + (values[i] ?? 0), 0));
  return {
    [Split.Model]: MODELS.map(([name, values], i) => series(name, name, i, toTokens(values))),
    [Split.TokenKind]: TOKEN_KINDS.map((kind, i) => series(kind, null, i, toTokens(totals.map((t) => t * (KIND_SHARES[i] ?? 0))))),
    [Split.AgentKind]: AGENT_KINDS.map(([name, values], i) => series(name, name, i, toTokens(values))),
    [Split.Environment]: ENVIRONMENTS.map(([env, values], i) => series(env.value, env.label, i, toTokens(values))),
  };
}

function modelTotals(): UsagePageResponse["totals_by_model"] {
  return MODELS.map(([model, values], i) => {
    const total = Math.round(sumOf(values) * MILLION);
    const [input, cacheWrite, cacheRead, output] = KIND_SHARES.map((share) => Math.round(total * share));
    return { model, color_index: i, input: input ?? 0, cache_write: cacheWrite ?? 0, cache_read: cacheRead ?? 0, output: output ?? 0, total };
  });
}

function kindTotals(): UsagePageResponse["totals_by_token_kind"] {
  const rows = modelTotals();
  const add = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  return { input: add((r) => r.input), cache_write: add((r) => r.cache_write), cache_read: add((r) => r.cache_read), output: add((r) => r.output), total: add((r) => r.total) };
}

function weeklyLine(): UsagePageResponse["cap"]["weekly"] {
  const readings = [
    ["2026-11-10T20:00:00.000Z", 3],
    ["2026-11-11T20:00:00.000Z", 9.8],
    ["2026-11-12T20:00:00.000Z", 13.1],
    ["2026-11-13T20:00:00.000Z", 22],
    ["2026-11-14T20:00:00.000Z", 25.9],
    ["2026-11-15T20:00:00.000Z", 26.6],
    ["2026-11-16T13:46:00.000Z", 34.2],
  ] as const;
  return {
    windows: [{ started_at: WINDOW_START, reset_at: WINDOW_RESET, readings: readings.map(([taken_at, percent]) => ({ taken_at, percent })) }],
    dropped: [{ taken_at: "2026-11-13T22:00:00.000Z", percent: 19.5, stored_percent: 22 }],
    latest: { taken_at: "2026-11-16T13:46:00.000Z", percent: 34.2, reset_at: WINDOW_RESET },
  };
}

function shortLine(): UsagePageResponse["cap"]["short"] {
  const readings = [
    { taken_at: "2026-11-16T12:00:00.000Z", percent: 30 },
    { taken_at: "2026-11-16T13:46:00.000Z", percent: 41 },
  ];
  const reset = "2026-11-16T15:58:00.000Z";
  return {
    windows: [{ started_at: "2026-11-16T10:58:00.000Z", reset_at: reset, readings }],
    dropped: [],
    latest: { taken_at: "2026-11-16T13:46:00.000Z", percent: 41, reset_at: reset },
  };
}

const example = configFromRecord(exampleConfig);

/** What GET /api/usage answers for a demo week: three made-up models, two made-up environments, one dropped reading. */
export function demoUsage(over: Partial<UsagePageResponse> = {}): UsagePageResponse {
  return {
    server_time: USAGE_SERVER_TIME,
    range: UsageRange.Window,
    from: WINDOW_START,
    plan: PLANS[0] ?? null,
    plans: PLANS,
    environment: null,
    environments: [
      { ...ENV_ONE, tokens: Math.round(sumOf(ENVIRONMENTS[0]?.[1] ?? []) * MILLION), reports: 40 },
      { ...ENV_TWO, tokens: Math.round(sumOf(ENVIRONMENTS[1]?.[1] ?? []) * MILLION), reports: 22 },
    ],
    base_environment: ENV_ONE.value,
    utc_offset_minutes: 0,
    time_zone: null,
    palette: example.usage.series,
    bucket_unit: BucketUnit.Day,
    buckets: bucketList(),
    splits: splits(),
    totals_by_model: modelTotals(),
    totals_by_token_kind: kindTotals(),
    top_tasks: [
      { key: "demo-app/slice-9", title: "Slice 9 · Part C · Notification channel", project: "demo-app", tokens: 7_100_000, cap_points: null },
      { key: "demo-app/slice-4", title: "Slice 4 · Part B · Tag search", project: "demo-app", tokens: 5_900_000, cap_points: null },
      { key: "garden/water-log", title: "Slice 8 · Watering log", project: "garden", tokens: 4_400_000, cap_points: null },
      { key: "lab/ci", title: "CI failing on main", project: "lab", tokens: 2_600_000, cap_points: null },
    ],
    other_tasks: { tokens: 3_300_000, projects: 3, cap_points: null },
    agent_kinds: [],
    cap: { weekly: weeklyLine(), short: shortLine() },
    cap_cost: notReadyCapCost(2),
    palettes: example.palettes,
    ...over,
  };
}

const FRESH_TOKENS = 174_000;
const KIND_TOKENS = { input: FRESH_TOKENS, cache_write: 140_000, cache_read: 1_740_000, output: 35_000 };
const KIND_RATIOS = { input: 1, cache_write: 1.24, cache_read: 0.1, output: 5 };

function scaled(factor: number): Record<TokenKind, number> {
  return { input: KIND_TOKENS.input * factor, cache_write: KIND_TOKENS.cache_write * factor, cache_read: KIND_TOKENS.cache_read * factor, output: KIND_TOKENS.output * factor };
}

function fittedModel(model: string, colorIndex: number, factor: number, howSure: HowSure): CapCostModelDto {
  return {
    model,
    color_index: colorIndex,
    mode: FitMode.PerKind,
    not_enough: false,
    own_cap: null,
    price_factor: null,
    tokens_per_percent: scaled(factor),
    all_kinds_tokens_per_percent: 700_000 * factor,
    mix_source: MixSource.Current,
    kind_ratios: KIND_RATIOS,
    kind_ratio_reference: TokenKind.Input,
    how_sure: howSure,
    stretches: 14,
    finer_at: 12,
  };
}

/** One model still on one weight: 19 million tokens per 1% for every kind. */
function coarseModel(model: string, colorIndex: number, stretches: number): CapCostModelDto {
  const each = 19_000_000;
  return {
    model,
    color_index: colorIndex,
    mode: FitMode.OneWeight,
    not_enough: false,
    own_cap: null,
    price_factor: null,
    tokens_per_percent: { input: each, cache_write: each, cache_read: each, output: each },
    all_kinds_tokens_per_percent: each,
    mix_source: MixSource.Current,
    kind_ratios: null,
    kind_ratio_reference: null,
    how_sure: HowSure.Rough,
    stretches,
    finer_at: 12,
  };
}

/** The estimate of the demo week: two models per kind, one on one weight, one measured environment, three unexplained stretches. */
export function readyCapCost(): CapCostDto {
  return {
    ready: true,
    own_cap_ready: false,
    price_anchored: true,
    stretches: 14,
    min_stretches: 3,
    models: [fittedModel("model-alpha", 0, 1, HowSure.Sure), fittedModel("model-beta", 1, 2, HowSure.Sure), coarseModel("model-gamma", 2, 7)],
    environments: [
      { ...ENV_ONE, tokens: 24_100_000, reports: 40, cap_points: 19.6, multiplier: 1, state: MultiplierState.Base, how_sure: null, stretches: 14 },
      { ...ENV_TWO, tokens: 11_700_000, reports: 22, cap_points: 11.8, multiplier: 0.98, state: MultiplierState.Measured, how_sure: HowSure.Sure, stretches: 18 },
    ],
    untracked_per_day: 0.4,
    unexplained: { points: 2.8, growth_points: 34.2, share: 0.0819 },
    unexplained_stretches: [
      { start: "2026-11-14T10:05:00.000Z", end: "2026-11-14T12:40:00.000Z", points: 1.6, growth_points: 1.6, explained_points: 0 },
      { start: "2026-11-12T14:00:00.000Z", end: "2026-11-12T15:30:00.000Z", points: 0.7, growth_points: 2.1, explained_points: 1.4 },
      { start: "2026-11-11T09:00:00.000Z", end: "2026-11-11T10:30:00.000Z", points: 0.5, growth_points: 1.2, explained_points: 0.7 },
    ],
    steps: [{ step: "build", cap_points: 12.4 }],
  };
}

/** A plan with too few stretches: the "estimate not ready" card. */
export function notReadyCapCost(stretches: number): CapCostDto {
  return { ready: false, own_cap_ready: false, price_anchored: false, stretches, min_stretches: 3, models: [], environments: [], untracked_per_day: null, unexplained: null, unexplained_stretches: [], steps: [] };
}

/** The demo week with a ready estimate, cap figures on the tasks and agent kinds. */
export function readyUsage(over: Partial<UsagePageResponse> = {}): UsagePageResponse {
  const base = demoUsage();
  const points = [8.6, 7.2, 5.4, 3.2];
  return demoUsage({
    cap_cost: readyCapCost(),
    top_tasks: base.top_tasks.map((task, i) => ({ ...task, cap_points: points[i] ?? 0 })),
    other_tasks: { tokens: 3_300_000, projects: 3, cap_points: 4 },
    agent_kinds: [
      { name: "builder", color_index: 1, tokens: 22_400_000, cap_points: 17.2 },
      { name: "reviewer", color_index: 0, tokens: 15_600_000, cap_points: 11.3 },
    ],
    ...over,
  });
}

/** The same week with no reading of any kind and no tokens. */
export function emptyUsage(): UsagePageResponse {
  const empty = { windows: [], dropped: [], latest: null };
  return demoUsage({
    splits: { [Split.Model]: [], [Split.TokenKind]: [], [Split.AgentKind]: [], [Split.Environment]: [] },
    totals_by_model: [],
    totals_by_token_kind: { input: 0, cache_write: 0, cache_read: 0, output: 0, total: 0 },
    top_tasks: [],
    other_tasks: null,
    cap: { weekly: empty, short: empty },
  });
}
