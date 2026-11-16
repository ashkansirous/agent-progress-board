import type { UsagePageResponse, UsageSeriesDto } from "../src/api/usageDto";
import { configFromRecord } from "../src/config";
import { BucketUnit, Split, TOKEN_KINDS, UsageRange } from "../src/domain/usage";
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
    palette: example.usage.series,
    bucket_unit: BucketUnit.Day,
    buckets: BUCKETS,
    splits: splits(),
    totals_by_model: modelTotals(),
    totals_by_token_kind: kindTotals(),
    top_tasks: [
      { key: "demo-app/slice-9", title: "Slice 9 · Part C · Notification channel", project: "demo-app", tokens: 7_100_000 },
      { key: "demo-app/slice-4", title: "Slice 4 · Part B · Tag search", project: "demo-app", tokens: 5_900_000 },
      { key: "garden/water-log", title: "Slice 8 · Watering log", project: "garden", tokens: 4_400_000 },
      { key: "lab/ci", title: "CI failing on main", project: "lab", tokens: 2_600_000 },
    ],
    other_tasks: { tokens: 3_300_000, projects: 3 },
    agent_kinds: [],
    cap: { weekly: weeklyLine(), short: shortLine() },
    palettes: example.palettes,
    ...over,
  };
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
