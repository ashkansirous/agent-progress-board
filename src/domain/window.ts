const MS_PER_HOUR = 3_600_000;

/** One year of hours: the largest window config may ask for, so the cutoff stays inside the Date range. */
export const MAX_WINDOW_HOURS = 24 * 365;

export interface WindowConfig {
  defaultHours: number;
  maxHours: number;
}

export function resolveWindowHours(requested: number | undefined, config: WindowConfig): number {
  return Math.min(requested ?? config.defaultHours, config.maxHours);
}

export function windowCutoff(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * MS_PER_HOUR).toISOString();
}
