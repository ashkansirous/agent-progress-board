import type { CapCostEnvironmentDto } from "../../src/api/usageDto";
import { offsetOf, type OffsetAt } from "../../src/domain/usage";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const CLOCK_DIGITS = 2;
const MILLION = 1_000_000;
const THOUSAND = 1_000;
const NICE_STEPS = [1, 2, 2.5, 5];
const NICE_BASE = 10;

/** A placed row: an environment that sends no token reports, its points come from its reported work windows. */
export function isPlaced(env: CapCostEnvironmentDto): boolean {
  return env.tokens === null && env.reports === 0;
}

/** A time as the viewer's wall clock: the UTC fields of the result are the viewer's local fields. */
export function shifted(iso: string, offset: OffsetAt): Date {
  const at = Date.parse(iso);
  return new Date(at + offsetOf(offset, at) * MS_PER_MINUTE);
}

function pad(n: number): string {
  return String(n).padStart(CLOCK_DIGITS, "0");
}

/** HH:mm in the viewer's time. */
export function clockAt(iso: string, offset: OffsetAt): string {
  const date = shifted(iso, offset);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function part(locale: string, date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}

/** "Tue 10" for a viewer-time date. */
export function dayText(locale: string, date: Date): string {
  return `${part(locale, date, { weekday: "short" })} ${date.getUTCDate()}`;
}

/** "Tue 08:00". */
export function weekdayClock(locale: string, iso: string, offset: OffsetAt): string {
  const date = shifted(iso, offset);
  return `${part(locale, date, { weekday: "short" })} ${clockAt(iso, offset)}`;
}

/** "Tue 17 Nov, 08:00". */
export function longReset(locale: string, iso: string, offset: OffsetAt): string {
  const date = shifted(iso, offset);
  const month = part(locale, date, { month: "short" });
  return `${dayText(locale, date)} ${month}, ${clockAt(iso, offset)}`;
}

// A bucket key is a day (`2026-11-10`) or an hour (`2026-11-10T13`), each with `#2`, `#3` ... when its local time
// came round again; the mark is read off the end, so no key shape depends on the key's length.
const BUCKET_KEY = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}))?(?![\dT])/;

interface BucketTime {
  date: Date;
  isHour: boolean;
}

function parseBucket(bucket: string): BucketTime | null {
  const match = BUCKET_KEY.exec(bucket);
  if (!match) return null;
  const isHour = match[2] !== undefined;
  const date = new Date(Date.parse(`${match[1]}T${match[2] ?? "00"}:00:00Z`));
  return Number.isNaN(date.getTime()) ? null : { date, isHour };
}

/** The time a bucket key starts, as a viewer-time millisecond value; NaN for a key of no known shape. */
export function bucketStartMs(bucket: string): number {
  return parseBucket(bucket)?.date.getTime() ?? Number.NaN;
}

/** "Tue 10" for a day bucket, "13:00" for an hour bucket; empty for a key of no known shape, never "NaN". */
export function bucketLabel(locale: string, bucket: string): string {
  const parsed = parseBucket(bucket);
  if (!parsed) return "";
  return parsed.isHour ? `${pad(parsed.date.getUTCHours())}:00` : dayText(locale, parsed.date);
}

/** One letter for a day bucket (the phone), the hour for an hour bucket; empty for a key of no known shape. */
export function bucketLetter(locale: string, bucket: string): string {
  const parsed = parseBucket(bucket);
  if (!parsed) return "";
  return parsed.isHour ? pad(parsed.date.getUTCHours()) : part(locale, parsed.date, { weekday: "narrow" });
}

/** "34.2%"; a whole percent shows no decimal. */
export function percentText(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** A share of the cap on the cost page: always one decimal, "4.0%". */
export function costPercentText(percent: number, locale = "en-US"): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rounded)}%`;
}

function trimmed(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
}

/** "7.1 M", "12.3 k" or "950". */
export function tokenText(tokens: number, locale: string): string {
  if (tokens >= MILLION) return `${trimmed(tokens / MILLION, locale)} M`;
  if (tokens >= THOUSAND) return `${trimmed(tokens / THOUSAND, locale)} k`;
  return trimmed(tokens, locale);
}

/** Millions with fixed decimals, for the token kinds table. */
export function millionsText(tokens: number, decimals: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(tokens / MILLION);
}

export interface NiceScale {
  top: number;
  step: number;
}

/** The smallest 1, 2, 2.5 or 5 times a power of ten whose `intervals` steps reach `max`. */
export function niceScale(max: number, intervals: number): NiceScale {
  const wanted = Math.max(max, 1) / intervals;
  let power = NICE_BASE ** Math.floor(Math.log10(wanted));
  for (;;) {
    const step = NICE_STEPS.map((n) => n * power).find((candidate) => candidate >= wanted);
    if (step !== undefined) return { top: step * intervals, step };
    power *= NICE_BASE;
  }
}

const TITLE_SEPARATOR = " · ";
const SHORT_TITLE_PARTS = 2;

/** "Slice 9 · Part C" from "Slice 9 · Part C · Notification channel": the first two parts of a title. */
export function shortTaskTitle(title: string): string {
  return title.split(TITLE_SEPARATOR).slice(0, SHORT_TITLE_PARTS).join(TITLE_SEPARATOR);
}

/** Hours and minutes from `nowIso` to the reset, or null when the reset is not ahead of it. */
export function timeUntil(resetIso: string, nowIso: string): { hours: number; minutes: number } | null {
  const minutes = Math.round((Date.parse(resetIso) - Date.parse(nowIso)) / MS_PER_MINUTE);
  if (minutes <= 0) return null;
  return { hours: Math.floor(minutes / MINUTES_PER_HOUR), minutes: minutes % MINUTES_PER_HOUR };
}

const FULL_BAR = 100;

/** A bar's width in percent of the full bar: never below 0, nothing for a null share or no biggest. */
export function barWidth(percent: number | null, biggest: number): number {
  return percent === null || biggest <= 0 ? 0 : Math.max(0, (percent / biggest) * FULL_BAR);
}
