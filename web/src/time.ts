import type { Translate } from "./strings";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const CLOCK_DIGITS = 2;

/** Whole minutes from `iso` to `nowMs`, at least 1 so a fresh item never reads "0 min ago". */
function minutesSince(iso: string, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - Date.parse(iso)) / MS_PER_MINUTE));
}

/** Whole hours from `iso` to `nowMs`, at least 1. */
export function hoursSince(iso: string, nowMs: number): number {
  return Math.max(1, Math.floor(minutesSince(iso, nowMs) / MINUTES_PER_HOUR));
}

/** "25 min ago", "2 h ago" or "3 d ago". */
export function ageText(iso: string, nowMs: number, t: Translate): string {
  const minutes = minutesSince(iso, nowMs);
  if (minutes < MINUTES_PER_HOUR) return t("minAgo", { n: minutes });
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return t("hourAgo", { n: hours });
  return t("dayAgo", { n: Math.floor(hours / HOURS_PER_DAY) });
}

/** Local time as HH:mm. */
export function clockTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const pad = (n: number) => String(n).padStart(CLOCK_DIGITS, "0");
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
