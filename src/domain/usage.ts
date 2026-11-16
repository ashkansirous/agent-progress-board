/**
 * Use worked out from reported running totals (Slice 8). Nothing derived is stored: a sample is
 * the totals of one agent on one model up to its newest record, and the use between two times
 * is a subtraction made here, on every read, so a retry or a late report cannot leave it wrong.
 */
import { windowCutoff } from "./window";

export enum TokenKind {
  Input = "input",
  CacheWrite = "cache_write",
  CacheRead = "cache_read",
  Output = "output",
}

export const TOKEN_KINDS: readonly TokenKind[] = [
  TokenKind.Input,
  TokenKind.CacheWrite,
  TokenKind.CacheRead,
  TokenKind.Output,
];

export enum Split {
  Model = "model",
  TokenKind = "token_kind",
  AgentKind = "agent_kind",
  Environment = "environment",
}

export enum UsageRange {
  Day = "24h",
  Window = "window",
  Month = "30d",
}

export enum BucketUnit {
  Day = "day",
  Hour = "hour",
}

export type TokenTotals = Record<TokenKind, number>;

export interface UsageSample {
  agentKey: string;
  model: string;
  /** null: the client sent none; it counts as the base environment when read. */
  environment: string | null;
  /** ISO time of the newest record the totals counted. */
  recordAt: string;
  totals: TokenTotals;
  taskKey: string | null;
  agentKind: string | null;
  step: string | null;
}

/** What one sample added over the one before it in its series. */
export interface UsageDelta {
  sample: UsageSample;
  used: TokenTotals;
  restart: boolean;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
const DAY_KEY_LENGTH = 10;
const HOUR_KEY_LENGTH = 13;

export function zeroTotals(): TokenTotals {
  return { input: 0, cache_write: 0, cache_read: 0, output: 0 };
}

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return mapKinds((kind) => a[kind] + b[kind]);
}

export function totalOf(totals: TokenTotals): number {
  return TOKEN_KINDS.reduce((sum, kind) => sum + totals[kind], 0);
}

function mapKinds(make: (kind: TokenKind) => number): TokenTotals {
  return {
    input: make(TokenKind.Input),
    cache_write: make(TokenKind.CacheWrite),
    cache_read: make(TokenKind.CacheRead),
    output: make(TokenKind.Output),
  };
}

/** A restart: any of the four running totals went down, so the process counted again from zero. */
export function isRestart(previous: TokenTotals, next: TokenTotals): boolean {
  return TOKEN_KINDS.some((kind) => next[kind] < previous[kind]);
}

/** The identity of one running series: agent, model and environment (null is the empty string). */
export function seriesKeyOf(sample: UsageSample): string {
  return JSON.stringify([sample.agentKey, sample.model, sample.environment ?? ""]);
}

/**
 * One series, in any order: each sample adds its totals minus the previous sample's; a restart
 * counts all four from zero. The first sample counts from zero too. Equal times keep input order.
 */
export function deltasOfSeries(samples: UsageSample[]): UsageDelta[] {
  const ordered = [...samples].sort((a, b) => compareTimes(a.recordAt, b.recordAt));
  let previous = zeroTotals();
  return ordered.map((sample) => {
    const restart = isRestart(previous, sample.totals);
    const used = restart ? sample.totals : mapKinds((kind) => sample.totals[kind] - previous[kind]);
    previous = sample.totals;
    return { sample, used, restart };
  });
}

function compareTimes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every series of the samples, each worked out on its own. */
export function usageDeltas(samples: UsageSample[]): UsageDelta[] {
  const series = new Map<string, UsageSample[]>();
  for (const sample of samples) {
    const key = seriesKeyOf(sample);
    const list = series.get(key);
    if (list === undefined) series.set(key, [sample]);
    else list.push(sample);
  }
  return [...series.values()].flatMap(deltasOfSeries);
}

/** The time `days` before `now`, as an ISO string (built on the shared hours cutoff of domain/window.ts). */
export function daysBefore(now: Date, days: number): string {
  return windowCutoff(now, days * HOURS_PER_DAY);
}

/** The use in the half-open range (from, to]; `from` null is no lower limit. */
export function useBetween(deltas: UsageDelta[], from: string | null, to: string): TokenTotals {
  const inside = deltas.filter(({ sample }) => (from === null || sample.recordAt > from) && sample.recordAt <= to);
  return inside.reduce((sum, { used }) => addTotals(sum, used), zeroTotals());
}

/** The environment with the most tokens (ties: the name that sorts first); null when none is named. */
export function busiestEnvironment(deltas: UsageDelta[]): string | null {
  const tokens = new Map<string, number>();
  for (const { sample, used } of deltas) {
    if (sample.environment !== null) tokens.set(sample.environment, (tokens.get(sample.environment) ?? 0) + totalOf(used));
  }
  const ranked = [...tokens.entries()].sort(([nameA, a], [nameB, b]) => b - a || compareTimes(nameA, nameB));
  return ranked[0]?.[0] ?? null;
}

/** A delta whose environment is null moved to the base environment (the rule for old clients). */
export function withBaseEnvironment(deltas: UsageDelta[], base: string | null): UsageDelta[] {
  if (base === null) return deltas;
  return deltas.map((delta) =>
    delta.sample.environment === null ? { ...delta, sample: { ...delta.sample, environment: base } } : delta,
  );
}

/** The bucket a time falls in, in the viewer's time: `YYYY-MM-DD`, or `YYYY-MM-DDTHH` for hours. */
export function bucketKey(isoTime: string, offsetMinutes: number, unit: BucketUnit): string {
  const shifted = new Date(Date.parse(isoTime) + offsetMinutes * MS_PER_MINUTE).toISOString();
  return shifted.slice(0, unit === BucketUnit.Day ? DAY_KEY_LENGTH : HOUR_KEY_LENGTH);
}

/** Every bucket from the one holding `from` to the one holding `to`, oldest first. */
export function bucketKeys(from: string, to: string, offsetMinutes: number, unit: BucketUnit): string[] {
  const step = unit === BucketUnit.Day ? MS_PER_DAY : MS_PER_HOUR;
  const last = bucketKey(to, offsetMinutes, unit);
  const keys: string[] = [];
  for (let at = Date.parse(from); ; at += step) {
    const key = bucketKey(new Date(at).toISOString(), offsetMinutes, unit);
    if (keys[keys.length - 1] !== key) keys.push(key);
    if (key >= last) return keys;
  }
}

export interface SeriesValues {
  /** null: the delta had no value for this split (no agent kind, or an environment with no base). */
  name: string | null;
  values: number[];
}

/** The tokens of each delta added up per bucket, one series per name of the chosen split. */
export function splitByBucket(
  deltas: UsageDelta[],
  buckets: string[],
  bucketOf: (delta: UsageDelta) => string,
  split: Split,
): SeriesValues[] {
  const series = new Map<string | null, number[]>();
  for (const delta of deltas) {
    const index = buckets.indexOf(bucketOf(delta));
    if (index < 0) continue;
    for (const [name, tokens] of tokensBySplit(delta, split)) {
      const values = series.get(name) ?? buckets.map(() => 0);
      values[index] = (values[index] ?? 0) + tokens;
      series.set(name, values);
    }
  }
  return [...series.entries()].map(([name, values]) => ({ name, values }));
}

function tokensBySplit({ sample, used }: UsageDelta, split: Split): [string | null, number][] {
  switch (split) {
    case Split.Model:
      return [[sample.model, totalOf(used)]];
    case Split.AgentKind:
      return [[sample.agentKind, totalOf(used)]];
    case Split.Environment:
      return [[sample.environment, totalOf(used)]];
    case Split.TokenKind:
      return TOKEN_KINDS.map((kind): [string, number] => [kind, used[kind]]);
  }
}

/** Tokens per key, summed (a null key is left out). */
export function tokensByKey(deltas: UsageDelta[], keyOf: (delta: UsageDelta) => string | null): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const delta of deltas) {
    const key = keyOf(delta);
    if (key !== null) tokens.set(key, (tokens.get(key) ?? 0) + totalOf(delta.used));
  }
  return tokens;
}

/** Totals per model, token kinds kept apart. */
export function totalsByModel(deltas: UsageDelta[]): Map<string, TokenTotals> {
  const totals = new Map<string, TokenTotals>();
  for (const { sample, used } of deltas) {
    totals.set(sample.model, addTotals(totals.get(sample.model) ?? zeroTotals(), used));
  }
  return totals;
}

export interface RankedTasks {
  top: [string, number][];
  rest: [string, number][];
}

/** The `limit` biggest keys by tokens (ties: key order) and the rest. */
export function rankTasks(tokens: Map<string, number>, limit: number): RankedTasks {
  const ranked = [...tokens.entries()].sort(([keyA, a], [keyB, b]) => b - a || compareTimes(keyA, keyB));
  return { top: ranked.slice(0, limit), rest: ranked.slice(limit) };
}

/** The reports (samples) and tokens of each environment, null counted under the base. */
export function environmentTotals(deltas: UsageDelta[]): Map<string, { tokens: number; reports: number }> {
  const totals = new Map<string, { tokens: number; reports: number }>();
  for (const { sample, used } of deltas) {
    if (sample.environment === null) continue;
    const entry = totals.get(sample.environment) ?? { tokens: 0, reports: 0 };
    totals.set(sample.environment, { tokens: entry.tokens + totalOf(used), reports: entry.reports + 1 });
  }
  return totals;
}
