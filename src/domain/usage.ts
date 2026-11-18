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

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
const DAY_KEY_LENGTH = 10;
const HOUR_KEY_LENGTH = 13;
/** Zones change offset on quarter-hour edges of UTC at the finest, so one lookup serves a whole quarter hour. */
const OFFSET_SLOT_MS = 15 * MS_PER_MINUTE;
/** The most time zone formatters kept; a caller can name many spellings of zones, so the cache is bounded. */
const MAX_ZONE_FORMATS = 32;
/** Starts the number that ends the key of a later pass through a local hour the clocks repeated (`2026-10-25T02#2`). */
export const REPEATED_HOUR_MARK = "#";
const SECOND_PASS = 2;

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

/** The viewer's offset from UTC in minutes (east positive) at a moment, in epoch milliseconds: a fixed number, or a time zone's, which changes with daylight saving. */
export type OffsetAt = number | ((epochMs: number) => number);

export function offsetOf(offset: OffsetAt, epochMs: number): number {
  return typeof offset === "number" ? offset : offset(epochMs);
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(zone: string): Intl.DateTimeFormat {
  const known = zoneFormats.get(zone);
  if (known) return known;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const oldest = zoneFormats.keys().next();
  if (zoneFormats.size >= MAX_ZONE_FORMATS && !oldest.done) zoneFormats.delete(oldest.value);
  zoneFormats.set(zone, made);
  return made;
}

function zoneOffsetNow(format: Intl.DateTimeFormat, epochMs: number): number {
  const part = new Map(format.formatToParts(epochMs).map(({ type, value }) => [type, Number(value)]));
  const wall = Date.UTC(part.get("year") ?? 0, (part.get("month") ?? 1) - 1, part.get("day") ?? 1, part.get("hour") ?? 0, part.get("minute") ?? 0, part.get("second") ?? 0);
  return Math.round((wall - Math.floor(epochMs / MS_PER_SECOND) * MS_PER_SECOND) / MS_PER_MINUTE);
}

/**
 * A time zone's offset at each moment (Slice 35 #1), or null when the name is not a time zone the runtime knows.
 * Each quarter hour is looked up once per function, so a long range costs one formatter call per quarter hour, not per delta.
 */
export function zoneOffsetAt(zone: string): OffsetAt | null {
  let format: Intl.DateTimeFormat;
  try {
    format = zoneFormat(zone);
  } catch {
    return null;
  }
  const slots = new Map<number, number>();
  return (epochMs) => {
    const slot = Math.floor(epochMs / OFFSET_SLOT_MS);
    const known = slots.get(slot);
    if (known !== undefined) return known;
    const offset = zoneOffsetNow(format, slot * OFFSET_SLOT_MS);
    slots.set(slot, offset);
    return offset;
  };
}

/**
 * The one offset rule of the page and the Worker: the time zone the viewer sent when there is one the runtime knows,
 * else the fixed offset. Every surface asks the function this returns, once per moment.
 */
export function offsetForZone(zone: string | null, fixedMinutes: number): OffsetAt {
  return (zone === null ? null : zoneOffsetAt(zone)) ?? fixedMinutes;
}

/** One bucket of a chart in real time: its key (`YYYY-MM-DD`, or `YYYY-MM-DDTHH` for hours, `#2` on a repeated local hour) and the moment it starts and ends. */
export interface Bucket {
  key: string;
  startMs: number;
  endMs: number;
}

function wallOf(at: number, offset: OffsetAt): number {
  return at + offsetOf(offset, at) * MS_PER_MINUTE;
}

function wallKey(wall: number, unit: BucketUnit): string {
  return new Date(wall).toISOString().slice(0, unit === BucketUnit.Day ? DAY_KEY_LENGTH : HOUR_KEY_LENGTH);
}

/** The real moment a viewer-time wall clock value shows, found through the offset function (the offset is read twice, so a change near the value is honoured). */
function momentOfWall(wall: number, offset: OffsetAt): number {
  const guess = wall - offsetOf(offset, wall) * MS_PER_MINUTE;
  return wall - offsetOf(offset, guess) * MS_PER_MINUTE;
}

function wallFloor(wall: number, span: number): number {
  return wall - (((wall % span) + span) % span);
}

/** Adds a bucket; a local key seen before gets `#2`, `#3`, ... (a repeated hour, whole or half). */
function addBucket(buckets: Bucket[], seen: Map<string, number>, key: string, startMs: number, endMs: number): void {
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  buckets.push({ key: count < SECOND_PASS ? key : `${key}${REPEATED_HOUR_MARK}${count}`, startMs, endMs });
}

function hourBuckets(fromMs: number, toMs: number, offset: OffsetAt): Bucket[] {
  const buckets: Bucket[] = [];
  const seen = new Map<string, number>();
  const intoHour = wallOf(fromMs, offset) - wallFloor(wallOf(fromMs, offset), MS_PER_HOUR);
  for (let start = fromMs - intoHour; start <= toMs; start += MS_PER_HOUR) {
    addBucket(buckets, seen, wallKey(wallOf(start, offset), BucketUnit.Hour), start, start + MS_PER_HOUR);
  }
  return buckets;
}

function dayBuckets(fromMs: number, toMs: number, offset: OffsetAt): Bucket[] {
  const buckets: Bucket[] = [];
  const seen = new Map<string, number>();
  for (let wall = wallFloor(wallOf(fromMs, offset), MS_PER_DAY); ; wall += MS_PER_DAY) {
    const start = momentOfWall(wall, offset);
    if (start > toMs) return buckets;
    const end = momentOfWall(wall + MS_PER_DAY, offset);
    if (end > start) addBucket(buckets, seen, wallKey(wall, BucketUnit.Day), start, end);
  }
}

/**
 * The buckets of a range, made by walking real time from the range start: one real hour, or one local day (to the next
 * local midnight, found through the offset function), at a time until the end. A day is 23 or 25 hours at a clock change,
 * and an hour the clocks repeated is two buckets. The loop ends on milliseconds, never on key order.
 */
export function bucketsBetween(fromMs: number, toMs: number, offset: OffsetAt, unit: BucketUnit): Bucket[] {
  return unit === BucketUnit.Day ? dayBuckets(fromMs, toMs, offset) : hourBuckets(fromMs, toMs, offset);
}

/** The keys of `bucketsBetween` for ISO times, oldest first. */
export function bucketKeys(from: string, to: string, offset: OffsetAt, unit: BucketUnit): string[] {
  return bucketsBetween(Date.parse(from), Date.parse(to), offset, unit).map(({ key }) => key);
}

/** The index of the bucket holding a moment, or -1 when no bucket does (before the first, after the last, or in a gap). */
export function bucketIndexAt(ms: number, buckets: Bucket[]): number {
  let low = 0;
  let high = buckets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const bucket = buckets[mid] as Bucket;
    if (ms < bucket.startMs) high = mid - 1;
    else if (ms >= bucket.endMs) low = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Where a moment falls along the buckets: the index of the bucket holding it plus the part of that bucket gone, so 0 is the
 * left edge and `buckets.length` the right edge. The one position rule of every chart; a moment outside is clamped to an edge.
 */
export function xOfMoment(ms: number, buckets: Bucket[]): number {
  const first = buckets[0];
  const last = buckets.at(-1);
  if (first === undefined || last === undefined || ms < first.startMs) return 0;
  if (ms >= last.endMs) return buckets.length;
  const index = bucketIndexAt(ms, buckets);
  if (index >= 0) {
    const { startMs, endMs } = buckets[index] as Bucket;
    return index + (ms - startMs) / (endMs - startMs);
  }
  return buckets.findIndex((bucket) => bucket.startMs > ms);
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
  const positions = new Map(buckets.map((key, index) => [key, index]));
  for (const delta of deltas) {
    const index = positions.get(bucketOf(delta));
    if (index === undefined) continue;
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
