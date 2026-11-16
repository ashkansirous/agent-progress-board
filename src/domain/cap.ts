/**
 * Cap readings (Slice 8). The table keeps only what was reported; which readings count, where a
 * window starts and where a reset happened are worked out here on every read, from the readings
 * of one plan and window kind in order of the time they were taken. So a late older reading
 * re-orders by itself and a retry changes nothing.
 */
export const WEEKLY_WINDOW = "weekly";
export const SHORT_WINDOW = "short";

export enum DropReason {
  /** Lower than a reading already stored in the same window, with no sign of a reset. */
  Stale = "stale",
}

export interface CapReading {
  /** ISO time the client took the reading. */
  takenAt: string;
  plan: string;
  windowKind: string;
  percent: number;
  /** ISO time the window resets, when the client knew it. */
  resetAt: string | null;
  source: string | null;
}

export interface CapVerdict {
  reading: CapReading;
  accepted: boolean;
  reason: DropReason | null;
  /** The stored percent a dropped reading lost to. */
  lostTo: number | null;
}

export interface CapWindow {
  plan: string;
  windowKind: string;
  /** The reset that started this window when known (the previous window's reset time), else the first reading's time. */
  startedAt: string;
  /** When this window resets, as the newest accepted reading said. */
  resetAt: string | null;
  readings: CapReading[];
  /** The highest accepted percent: the stored one a stale reading loses to. */
  peak: number;
}

export interface CapEvaluation {
  windows: CapWindow[];
  verdicts: CapVerdict[];
}

/** One plan and window kind, any order of arrival. */
export function evaluateReadings(readings: CapReading[], lowMarkPercent: number): CapEvaluation {
  const ordered = [...readings].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
  const windows: CapWindow[] = [];
  const verdicts: CapVerdict[] = [];
  for (const reading of ordered) {
    const current = windows[windows.length - 1];
    const windowOver = current !== undefined && isWindowOver(reading, current);
    if (current && !windowOver && isStale(reading, current, lowMarkPercent)) {
      verdicts.push({ reading, accepted: false, reason: DropReason.Stale, lostTo: current.peak });
      continue;
    }
    verdicts.push({ reading, accepted: true, reason: null, lostTo: null });
    if (!current || windowOver || startsNewWindow(reading, current)) windows.push(openWindow(reading, current));
    else addToWindow(current, reading);
  }
  return { windows, verdicts };
}

/** Lower than the stored peak and not a reset: dropped. */
function isStale(reading: CapReading, window: CapWindow, lowMarkPercent: number): boolean {
  return reading.percent < window.peak && !isReset(reading, window, lowMarkPercent);
}

/** A window whose known reset time has passed is over: a reading taken at or after it starts a new window, whatever its percent. */
function isWindowOver(reading: CapReading, window: CapWindow): boolean {
  return window.resetAt !== null && reading.takenAt >= window.resetAt;
}

/**
 * A lower reading is a reset when its reset time differs from the stored one (both must be known),
 * or, otherwise, when it falls to the low mark from above it.
 */
function isReset(reading: CapReading, window: CapWindow, lowMarkPercent: number): boolean {
  if (reading.resetAt !== null && window.resetAt !== null) return reading.resetAt !== window.resetAt;
  return reading.percent <= lowMarkPercent && window.peak > lowMarkPercent;
}

function startsNewWindow(reading: CapReading, window: CapWindow): boolean {
  return reading.percent < window.peak;
}

function openWindow(reading: CapReading, previous: CapWindow | undefined): CapWindow {
  const reset = previous?.resetAt ?? null;
  const startedAt = reset !== null && reset <= reading.takenAt ? reset : reading.takenAt;
  return {
    plan: reading.plan,
    windowKind: reading.windowKind,
    startedAt,
    resetAt: reading.resetAt,
    readings: [reading],
    peak: reading.percent,
  };
}

function addToWindow(window: CapWindow, reading: CapReading): void {
  window.readings.push(reading);
  window.peak = Math.max(window.peak, reading.percent);
  window.resetAt = reading.resetAt ?? window.resetAt;
}

/** Every plan and window kind on its own: a plan change mid-window never mixes two plans' numbers. */
export function evaluateAll(readings: CapReading[], lowMarkPercent: number): CapEvaluation {
  const groups = new Map<string, CapReading[]>();
  for (const reading of readings) {
    const key = JSON.stringify([reading.plan, reading.windowKind]);
    groups.set(key, [...(groups.get(key) ?? []), reading]);
  }
  const results = [...groups.values()].map((group) => evaluateReadings(group, lowMarkPercent));
  return {
    windows: results.flatMap((result) => result.windows),
    verdicts: results.flatMap((result) => result.verdicts),
  };
}

/** The plan in force at a time: the plan of the newest reading taken at or before it, else the first reading's. */
export function planAt(readings: CapReading[], time: string): string | null {
  if (readings.length === 0) return null;
  const ordered = [...readings].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
  const before = ordered.filter((reading) => reading.takenAt <= time);
  return (before[before.length - 1] ?? ordered[0])!.plan;
}

/** The plan of the newest accepted reading; null when none was accepted. */
export function newestPlan(verdicts: CapVerdict[]): string | null {
  const accepted = verdicts.filter((verdict) => verdict.accepted).map((verdict) => verdict.reading);
  const newest = accepted.sort((a, b) => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0))[0];
  return newest?.plan ?? null;
}

export function plansOf(readings: CapReading[]): string[] {
  return [...new Set(readings.map((reading) => reading.plan))].sort();
}
