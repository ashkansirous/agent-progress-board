import { showsLiveStatus } from "./docSync";
import { DOC_SYNC_SOURCE, ItemStatus, ItemType } from "./item";

export const DEFAULT_STALE_AFTER_MINUTES = 120;
/** At least an hour, so the tile's "No heartbeat for N h" label never reads 0 h. */
export const MIN_STALE_AFTER_MINUTES = 60;
/** One week; a larger value would push the cutoff outside the Date range. */
export const MAX_STALE_AFTER_MINUTES = 10_080;
/** The note on the history row the cron writes when it turns an item stale. */
export const STALE_NOTE = "Heartbeat expired";

/** The `agent` value of an interactive session's card: the clients' convention, the only one the server reads (Slice 13). */
export const SESSION_AGENT = "session";
/** A session card with no activity for this long turns stale and leaves "Working now"; its own constant, below the configured floor. */
export const SESSION_STALE_AFTER_MINUTES = 15;

const MS_PER_MINUTE = 60_000;

/** The columns of a stored row the expiry rule reads. */
export interface ExpiryRow {
  status: ItemStatus;
  heartbeat_at: string;
  doc_status_at: string | null;
  live_status_at: string | null;
  /** Only `SESSION_AGENT` matters here: a session card expires after `SESSION_STALE_AFTER_MINUTES`. */
  agent?: string | null;
  /** When the item was archived (Slice 50); an archived row never expires. Left out on a live row. */
  archived_at?: string | null;
}

/** The expiry that applies to an item: the session one for a session card, else the configured one. */
export function expiryMinutesFor(agent: string | null | undefined, staleAfterMinutes: number): number {
  return agent === SESSION_AGENT ? SESSION_STALE_AFTER_MINUTES : staleAfterMinutes;
}

/** The statuses of a live item that can go stale. */
export const EXPIRING_STATUSES: readonly ItemStatus[] = [ItemStatus.InProgress, ItemStatus.Blocked];

/**
 * Whether a report moves `live_status_at` (the clock the expiry rule reads): one that gave a status and did
 * not say it came from doc sync, or one that gave no status and so brings a stale item back to a live one
 * (revival, only when the report is no older than the stored heartbeat: `reviveAllowed`). The `LIVE_STATUS_REPORT` SQL in
 * the repository applies the same; `test/stale.test.ts` holds them equal.
 */
export function movesLiveStatus(
  report: { statusGiven: boolean; source?: string | null },
  storedStatus: ItemStatus,
  reviveAllowed = true,
): boolean {
  if (!report.statusGiven) return storedStatus === ItemStatus.Stale && reviveAllowed;
  return (report.source ?? "") !== DOC_SYNC_SOURCE;
}

/** A waiting card with no slice behind it is closed this long after its last report (the owner's answer of 2026-11-18, Slice 34). */
export const WAITING_CLOSE_AFTER_HOURS = 24;
/** The note on the history row of that close. */
export const WAITING_CLOSED_NOTE = "no answer needed after 24 h";
/** The types of the item a waiting card's `parent_key` can name that keep it open: the slice's own work closes it. */
export const WAITING_KEPT_PARENT_TYPES: readonly ItemType[] = [ItemType.Slice, ItemType.Part];

const MS_PER_HOUR = 3_600_000;

/** A waiting card whose last report is older than this ISO time has no one waiting for it. */
export function waitingCutoff(now: Date): string {
  return new Date(now.getTime() - WAITING_CLOSE_AFTER_HOURS * MS_PER_HOUR).toISOString();
}

/** The columns of a stored row the waiting-card close reads; `parent_type` is the type of the item `parent_key` names, null when it names none. */
export interface WaitingRow {
  type: ItemType;
  status: ItemStatus;
  heartbeat_at: string;
  in_doc_sync: boolean;
  parent_type: ItemType | null;
  /** When the item was archived (Slice 50); an archived card is never closed by the cron. Left out on a live row. */
  archived_at?: string | null;
}

/**
 * Whether the cron closes this waiting card: not done, not made by doc sync, no slice or part behind it, and its
 * last report 24 hours old. The `WAITING_ROWS` SQL in the repository applies the same.
 */
export function isWaitingClosable(row: WaitingRow, now: Date): boolean {
  return (
    row.type === ItemType.WaitingForMe &&
    !row.archived_at &&
    row.status !== ItemStatus.Done &&
    !row.in_doc_sync &&
    !(row.parent_type !== null && WAITING_KEPT_PARENT_TYPES.includes(row.parent_type)) &&
    row.heartbeat_at < waitingCutoff(now)
  );
}

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

/**
 * The one heartbeat-age rule: older than the expiry (the session expiry for a session card). Used by
 * `isExpired` and the working-now rule; the `EXPIRED_ROWS` SQL applies the same.
 */
export function isHeartbeatExpired(
  heartbeatAt: string,
  staleAfterMinutes: number,
  now: Date,
  agent?: string | null,
): boolean {
  return heartbeatAt < staleCutoff(now, expiryMinutesFor(agent, staleAfterMinutes));
}

/**
 * Whether the item's question still waits for the owner: set, the item not done, and its heartbeat
 * inside the configured expiry. A session card's 15-minute expiry does not hide a question (a
 * question waits for the owner, not for a heartbeat); the configured one does.
 */
export function hasOpenQuestion(
  row: { needs_you?: string | null; status: ItemStatus; heartbeat_at: string },
  staleAfterMinutes: number,
  now: Date,
): boolean {
  return Boolean(row.needs_you) && row.status !== ItemStatus.Done && !isHeartbeatExpired(row.heartbeat_at, staleAfterMinutes, now);
}

/**
 * Whether the cron turns this row stale: its shown status is a live one (in progress or blocked,
 * set by a report newer than the docs' last change, so an item only the docs set never expires)
 * and its heartbeat is older than the expiry. The SQL in the repository applies the same rule.
 */
export function isExpired(row: ExpiryRow, staleAfterMinutes: number, now: Date): boolean {
  return (
    !row.archived_at &&
    EXPIRING_STATUSES.includes(row.status) &&
    showsLiveStatus(row.live_status_at, row.doc_status_at) &&
    isHeartbeatExpired(row.heartbeat_at, staleAfterMinutes, now, row.agent)
  );
}
