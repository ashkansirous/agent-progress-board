import type { Translate } from "./strings";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const CLOCK_DIGITS = 2;
/** Shown in place of a time the browser cannot read, so it never looks fresh and never prints NaN. */
export const UNKNOWN_TIME = "–";

/** True when `iso` is a time the browser can read; a stored time the Worker normalised always is. */
export function isTime(iso: string): boolean {
  return !Number.isNaN(Date.parse(iso));
}

/** Whole minutes from `iso` to `nowMs`, at least 1 so a fresh item never reads "0 min ago"; NaN for an unreadable time (callers check `isTime`). */
export function minutesSince(iso: string, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - Date.parse(iso)) / MS_PER_MINUTE));
}

/** Whole hours from `iso` to `nowMs`, at least 1; NaN for an unreadable time. */
export function hoursSince(iso: string, nowMs: number): number {
  return Math.max(1, Math.floor(minutesSince(iso, nowMs) / MINUTES_PER_HOUR));
}

/** "25 min ago", "2 h ago" or "3 d ago". */
export function ageText(iso: string, nowMs: number, t: Translate): string {
  if (!isTime(iso)) return UNKNOWN_TIME;
  const minutes = minutesSince(iso, nowMs);
  if (minutes < MINUTES_PER_HOUR) return t("minAgo", { n: minutes });
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return t("hourAgo", { n: hours });
  return t("dayAgo", { n: Math.floor(hours / HOURS_PER_DAY) });
}

/** Local time as HH:mm. */
export function clockTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return UNKNOWN_TIME;
  const pad = (n: number) => String(n).padStart(CLOCK_DIGITS, "0");
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
