import { showsLiveStatus } from "./docSync";
import { ItemStatus } from "./item";

export const DEFAULT_STALE_AFTER_MINUTES = 120;
/** At least an hour, so the tile's "No heartbeat for N h" label never reads 0 h. */
export const MIN_STALE_AFTER_MINUTES = 60;
/** One week; a larger value would push the cutoff outside the Date range. */
export const MAX_STALE_AFTER_MINUTES = 10_080;
/** The note on the history row the cron writes when it turns an item stale. */
export const STALE_NOTE = "Heartbeat expired";

const MS_PER_MINUTE = 60_000;

/** The columns of a stored row the expiry rule reads. */
export interface ExpiryRow {
  status: ItemStatus;
  heartbeat_at: string;
  doc_status_at: string | null;
  live_status_at: string | null;
}

/** The statuses of a live item that can go stale. */
export const EXPIRING_STATUSES: readonly ItemStatus[] = [ItemStatus.InProgress, ItemStatus.Blocked];

export function isValidStaleAfter(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_STALE_AFTER_MINUTES &&
    value <= MAX_STALE_AFTER_MINUTES
  );
}

/** A heartbeat older than this ISO time has expired. */
export function staleCutoff(now: Date, staleAfterMinutes: number): string {
  return new Date(now.getTime() - staleAfterMinutes * MS_PER_MINUTE).toISOString();
}

/** The one heartbeat-age rule: older than the expiry. Used by `isExpired` and the working-now rule. */
export function isHeartbeatExpired(heartbeatAt: string, staleAfterMinutes: number, now: Date): boolean {
  return heartbeatAt < staleCutoff(now, staleAfterMinutes);
}

/**
 * Whether the cron turns this row stale: its shown status is a live one (in progress or blocked,
 * set by a report newer than the docs' last change, so an item only the docs set never expires)
 * and its heartbeat is older than the expiry. The SQL in the repository applies the same rule.
 */
export function isExpired(row: ExpiryRow, staleAfterMinutes: number, now: Date): boolean {
  return (
    EXPIRING_STATUSES.includes(row.status) &&
    showsLiveStatus(row.live_status_at, row.doc_status_at) &&
    isHeartbeatExpired(row.heartbeat_at, staleAfterMinutes, now)
  );
}
