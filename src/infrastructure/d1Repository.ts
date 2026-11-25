import {
  type BoardFilter,
  type BoardRow,
  type ItemRepository,
  type ItemWithStepsText,
  type ItemWrite,
  ArchivedItemError,
  StepsChangedError,
  type SessionWindow,
  type StaleCutoffs,
  type StaleResult,
  type SyncApplied,
  type SeriesName,
  SeriesKind,
  type TaskInfo,
  type UsageRepository,
} from "../application/ports";
import type { ArchiveRepository, ArchiveRequest, BatchApplied, PurgeCounts, SyncedPage } from "../application/archive";
import { ARCHIVED_NOTE } from "../domain/archive";
import { COUNTED_CHECK_STATUSES } from "../domain/checks";
import type { CapReading } from "../domain/cap";
import type { UsageSample } from "../domain/usage";
import { SYNC_LEFT_NOTE, type SyncRow, type SyncWrite } from "../domain/docSync";
import {
  DOC_SYNC_SOURCE,
  HEARTBEAT_NOTE,
  type Item,
  type ItemEvent,
  ItemStatus,
  ItemType,
  type Priority,
  STATUS_DROPPED_NOTE,
} from "../domain/item";
import {
  EXPIRING_STATUSES,
  SESSION_AGENT,
  STALE_NOTE,
  WAITING_CLOSED_NOTE,
  WAITING_KEPT_PARENT_TYPES,
} from "../domain/stale";
import { IDENTITY_TRIM_CHARS } from "../domain/capCost";
import { partLetterOf } from "../domain/parts";
import { parseStoredSteps } from "../domain/steps";
import type { ReportInput } from "../domain/upsert";

interface ItemRow extends Omit<Item, "links" | "type" | "priority" | "status" | "steps"> {
  links: string;
  steps: string | null;
  type: string;
  priority: string;
  status: string;
}

/** A row as stored, with the sync's internal columns that toItem leaves out. */
interface SyncItemRow extends ItemRow {
  in_doc_sync: number;
  doc_status: string | null;
  doc_status_at: string | null;
  live_status_at: string | null;
  archived_at: string | null;
}

const SYNC_COLUMNS: ReadonlySet<string> = new Set(["in_doc_sync", "doc_status", "doc_status_at", "live_status_at", "archived_at"]);

/** An item and its ancestors, nearest first, at most ?2 deep; the walk carries the visited keys (`path`, joined by the unit separator) and stops at a repeat, so a stored loop reads each key once (Slice 49 2). */
export const CHAIN_ROWS = `WITH RECURSIVE chain(key, depth, path) AS (
  SELECT ?1, 0, char(31) || ?1 || char(31)
  UNION ALL
  SELECT i.parent_key, chain.depth + 1, chain.path || i.parent_key || char(31) FROM items i JOIN chain ON i.key = chain.key
  WHERE i.parent_key IS NOT NULL AND chain.depth + 1 < ?2 AND instr(chain.path, char(31) || i.parent_key || char(31)) = 0
) SELECT items.* FROM chain JOIN items ON items.key = chain.key ORDER BY chain.depth`;
/**
 * Close rows per JSON parameter: at most this many rows and at most `CLOSE_CHUNK_BYTES` UTF-8 bytes, whichever
 * comes first, so a chunk of long non-ASCII keys stays under D1's 100 KB statement size too.
 */
const CLOSE_CHUNK_ROWS = 200;
const CLOSE_CHUNK_BYTES = 64_000;

interface EventRow extends ItemEvent {
  item_key: string;
}

/**
 * What the board lists: open items and those done inside the window, plus the parts of a slice that is
 * itself listed, however long ago a part was done (a slice's bar counts every part; Slice 11). Only parts
 * and checks ride along: a bug or problem that names a slice is listed by its own status and window.
 * A done slice that still has a check not tried (open or in progress, `isCountedCheck`) stays listed whatever its age (Slice 42: the board's Built list);
 * the probe uses idx_items_parent_key. It runs once per row that reaches it: a done slice row asks
 * about its own checks, a done part or check row asks about its siblings (the parent subquery
 * holds no probe, so no row is probed twice).
 */
const COUNTED_CHECK_SQL = COUNTED_CHECK_STATUSES.map((status) => `'${status}'`).join(", ");
const OPEN_CHECK_OF = (parentKey: string) => `EXISTS (
    SELECT 1 FROM items c WHERE c.parent_key = ${parentKey} AND c.archived_at IS NULL AND c.type = 'check' AND c.status IN (${COUNTED_CHECK_SQL}))`;
const OWN_FILTERS = "(?2 IS NULL OR project = ?2) AND (?3 IS NULL OR type = ?3)";
const LISTED_BY_ITSELF = `(status != 'done' OR done_at > ?1 OR (type = 'slice' AND ${OPEN_CHECK_OF("items.key")}))`;
/** The slices the page lists (the type filter applies to them), read once as a list, never per row: no correlated probe per part (Slice 34). An archived slice is not listed (Slice 50). */
const LISTED_SLICES = `SELECT p.key FROM items p WHERE p.type = 'slice' AND p.archived_at IS NULL
    AND (p.status != 'done' OR p.done_at > ?1 OR ${OPEN_CHECK_OF("p.key")})`;
/** What list_open returns: only what is listed by itself, filtered by project and type; an archived item is never listed (Slice 50). */
export const BOARD_WHERE_OWN = `archived_at IS NULL AND ${LISTED_BY_ITSELF} AND ${OWN_FILTERS}`;
/**
 * The board page's rows: those, plus the riders of a listed slice (the slice's own listing ignores the type
 * filter, so a `part` or `check` filter still finds its riders): every part (done ones too, for the bar) and the
 * checks not done (a done check is never shown, so it is not loaded). The riders follow the type filter: none, or
 * `slice` (the whole tile), or their own type.
 */
export const BOARD_WHERE = `(${BOARD_WHERE_OWN}
    OR (archived_at IS NULL AND type IN ('part', 'check') AND (type = 'part' OR status != 'done') AND (?2 IS NULL OR project = ?2)
      AND (?3 IS NULL OR ?3 = 'slice' OR type = ?3)
      AND parent_key IN (${LISTED_SLICES})))`;

/**
 * Insert params: ?1 key, ?2..?11 the new row's values (defaults filled), ?12 now, ?13 done_at.
 * Conflict params, two per column from ?14: a given flag (0/1) and the value, laid over the
 * stored row inside SQL, so two overlapping reports on one key never overwrite each other's
 * fields. A given NULL clears the column.
 */
const CHANGEABLE_COLUMNS = [
  "project",
  "parent",
  "type",
  "priority",
  "status",
  "title",
  "why",
  "details_md",
  "links",
  "source",
  "environment",
  "steps",
  "agent",
  "model",
  "parent_key",
  "needs_you",
  "after_answer",
  "needs_you_at",
  "outcome",
] as const;
type ChangeableColumn = (typeof CHANGEABLE_COLUMNS)[number];

const LIVE_STATUS_LIST = EXPIRING_STATUSES.map((status) => `'${status}'`).join(", ");

const FIRST_GIVEN_PARAM = 14;
const STATUS_COLUMN = CHANGEABLE_COLUMNS.indexOf("status");

const flagParam = (index: number): string => `?${FIRST_GIVEN_PARAM + 2 * index}`;
const valueParam = (index: number): string => `?${FIRST_GIVEN_PARAM + 2 * index + 1}`;

/**
 * The status after a report: the given one, else the stored one, except that a report with no
 * status brings a stale item back to the status of its newest non-stale event (the status the
 * cron replaced) when that is a live one, else to in_progress (Slice 7, expiry rule design).
 * A report that names a status applies it only when its time ?12 is not older than `live_status_at`, the clock
 * that status moves: a heartbeat with no status never makes an earlier status report look delayed (Slice 34).
 * The revival of a stale item needs the request to be no older than the stored heartbeat.
 */
const LAST_LIVE_STATUS = `COALESCE((SELECT e.status FROM events e WHERE e.item_key = items.key
  AND e.status != '${ItemStatus.Stale}' AND e.status IN (${LIVE_STATUS_LIST})
  AND e.id = (SELECT n.id FROM events n WHERE n.item_key = items.key AND n.status != '${ItemStatus.Stale}'
    ORDER BY n.at DESC, n.id DESC LIMIT 1)), '${ItemStatus.InProgress}')`;
const NEXT_STATUS = `CASE WHEN ${flagParam(STATUS_COLUMN)} THEN
    CASE WHEN ?12 < live_status_at THEN status ELSE ${valueParam(STATUS_COLUMN)} END
  WHEN status = '${ItemStatus.Stale}' AND ?12 >= heartbeat_at THEN ${LAST_LIVE_STATUS} ELSE status END`;
/** A given column that differs from the stored one is a change; steps compare as their stored JSON text, so the same list resent is not. */
const ANY_CHANGED = CHANGEABLE_COLUMNS.map((col, i) =>
  i === STATUS_COLUMN ? `${NEXT_STATUS} IS NOT status` : `(${flagParam(i)} AND ${valueParam(i)} IS NOT ${col})`,
).join(" OR ");
const SET_CHANGEABLE = CHANGEABLE_COLUMNS.map((col, i) =>
  i === STATUS_COLUMN
    ? `status = ${NEXT_STATUS}`
    : `${col} = CASE WHEN ${flagParam(i)} THEN ${valueParam(i)} ELSE ${col} END`,
).join(", ");

/**
 * The rule of isExpired (domain/stale.ts) in SQL: ?1 is the cutoff, an ISO time; ?4 the shorter one
 * for a session card (agent = SESSION_AGENT). Every statement using it binds all four parameters.
 */
export const EXPIRED_ROWS = `archived_at IS NULL AND status IN (${LIVE_STATUS_LIST}) AND live_status_at IS NOT NULL
  AND (doc_status_at IS NULL OR live_status_at > doc_status_at)
  AND heartbeat_at < MAX(?1, ?4)
  AND heartbeat_at < CASE WHEN agent = '${SESSION_AGENT}' THEN ?4 ELSE ?1 END`;

/**
 * ?1 cutoff, ?2 now, ?3 note, ?4 session cutoff. The `MAX(?1, ?4)` line is a bound the index
 * `idx_items_status_heartbeat` (migration 0008) can seek on; the CASE after it, which an index
 * cannot serve, picks the exact cutoff, so the rule is unchanged.
 */
const STALE_EVENTS = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?2, '${ItemStatus.Stale}', NULL, ?3 FROM items WHERE ${EXPIRED_ROWS}`;
const STALE_ITEMS = `UPDATE items SET status = '${ItemStatus.Stale}', updated_at = ?2 WHERE ${EXPIRED_ROWS}`;

/**
 * The rule of isWaitingClosable (domain/stale.ts) in SQL: ?1 is the 24-hour cutoff. A waiting card is
 * kept while a slice or part is its `parent_key`, and when doc sync made it.
 */
const WAITING_KEPT_TYPES = WAITING_KEPT_PARENT_TYPES.map((type) => `'${type}'`).join(", ");
export const WAITING_ROWS = `type = '${ItemType.WaitingForMe}' AND status != '${ItemStatus.Done}' AND in_doc_sync = 0 AND archived_at IS NULL
  AND heartbeat_at < ?1
  AND NOT EXISTS (SELECT 1 FROM items p WHERE p.key = items.parent_key AND p.type IN (${WAITING_KEPT_TYPES}))`;

/** ?1 cutoff, ?2 now, ?3 note: one history row for each card the next statement closes. */
const WAITING_EVENTS = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?2, '${ItemStatus.Done}', NULL, ?3 FROM items WHERE ${WAITING_ROWS}`;
const WAITING_ITEMS = `UPDATE items SET status = '${ItemStatus.Done}', done_at = ?2, updated_at = ?2 WHERE ${WAITING_ROWS}`;

const SOURCE_COLUMN = CHANGEABLE_COLUMNS.indexOf("source");
/**
 * The rule of movesLiveStatus (domain/stale.ts) in SQL: a report that gave a status and did not say it came
 * from doc sync moves live_status_at, and so does one that gave none and revives a stale item (the same
 * `?12 >= heartbeat_at` condition as the revival branch of NEXT_STATUS, so a delayed report that revives nothing moves nothing).
 */
const LIVE_STATUS_REPORT = `(${flagParam(STATUS_COLUMN)} AND
  COALESCE(CASE WHEN ${flagParam(SOURCE_COLUMN)} THEN ${valueParam(SOURCE_COLUMN)} END, '') != '${DOC_SYNC_SOURCE}')
  OR (NOT ${flagParam(STATUS_COLUMN)} AND status = '${ItemStatus.Stale}' AND ?12 >= heartbeat_at)`;

const valueOf = (column: ChangeableColumn): string => valueParam(CHANGEABLE_COLUMNS.indexOf(column));

/** The compare-and-swap params after the changeable ones: guard on (0/1) and the steps text the row must still hold. */
const GUARD_FLAG_INDEX = FIRST_GIVEN_PARAM + 2 * CHANGEABLE_COLUMNS.length;
const GUARD_FLAG = `?${GUARD_FLAG_INDEX}`;
const GUARD_STEPS = `?${GUARD_FLAG_INDEX + 1}`;

const UPSERT_ITEM = `INSERT INTO items (key, project, parent, type, priority, status, title, why,
  details_md, links, source, heartbeat_at, created_at, updated_at, done_at, live_status_at, environment,
  steps, agent, model, parent_key, needs_you, after_answer, needs_you_at, outcome)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12, ?13,
    CASE WHEN ?11 IS '${DOC_SYNC_SOURCE}' THEN NULL ELSE ?12 END, ${valueOf("environment")},
    ${valueOf("steps")}, ${valueOf("agent")}, ${valueOf("model")}, ${valueOf("parent_key")},
    ${valueOf("needs_you")}, ${valueOf("after_answer")}, ${valueOf("needs_you_at")}, ${valueOf("outcome")})
  ON CONFLICT (key) DO UPDATE SET ${SET_CHANGEABLE}, heartbeat_at = MAX(heartbeat_at, ?12),
  live_status_at = CASE WHEN ${LIVE_STATUS_REPORT} THEN COALESCE(MAX(live_status_at, ?12), ?12) ELSE live_status_at END,
  updated_at = CASE WHEN ${ANY_CHANGED} THEN MAX(updated_at, ?12) ELSE updated_at END,
  done_at = CASE WHEN ${NEXT_STATUS} = 'done'
    THEN CASE WHEN status = 'done' THEN COALESCE(done_at, ?12) ELSE ?12 END
    ELSE NULL END
  WHERE items.archived_at IS NULL AND (${GUARD_FLAG} = 0 OR items.steps IS ${GUARD_STEPS})
  RETURNING *`;

/**
 * A doc-sync write: the row is computed in the domain from one read, so only the columns sync
 * owns are set on an existing key; type, priority, details, heartbeat and created_at stay.
 * ?20 and ?21 are the updated_at and live_status_at the sync read (null for a new key): the
 * update applies only while the row still has them, so it never acts on a stale read.
 * ?22 is details_md as the domain decided it (`detailsOf` in docSync.ts: a reporter's notes are kept, the documents' own
 * text is refreshed); the compare-and-swap above means it was decided from the row as it still is.
 */
const SYNC_UPSERT = `INSERT INTO items (key, project, parent, type, priority, status, title, why, links,
  source, heartbeat_at, created_at, updated_at, done_at, in_doc_sync, doc_status, doc_status_at, live_status_at,
  parent_key, details_md)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?22)
  ON CONFLICT (key) DO UPDATE SET type = excluded.type, parent = excluded.parent, parent_key = excluded.parent_key,
  status = excluded.status,
  title = excluded.title, why = excluded.why, links = excluded.links, source = excluded.source,
  updated_at = excluded.updated_at, done_at = excluded.done_at, in_doc_sync = excluded.in_doc_sync,
  doc_status = excluded.doc_status, doc_status_at = excluded.doc_status_at,
  details_md = excluded.details_md,
  archived_at = CASE WHEN EXISTS (SELECT 1 FROM items p WHERE p.key = excluded.parent_key AND p.archived_at IS NOT NULL)
    THEN items.archived_at ELSE NULL END
  WHERE items.updated_at IS ?20 AND items.live_status_at IS ?21`;

/**
 * Written only when the upsert right before it in the batch took effect: `changes()` is that upsert's row count, so a
 * write that lost its compare-and-swap adds no event, like INSERT_EVENT. Keep the two statements adjacent.
 */
const SYNC_EVENT = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?2, ?3, ?4, ?5 FROM items
  WHERE key = ?1 AND changes() > 0`;

/**
 * ?1 is a JSON list of {key, updated_at, live_status_at}: the rows the close read, matched in
 * one statement. Like the write guard, a row whose updated_at or live_status_at moved since
 * the read (a live report, even one with the same status) is left open.
 */
const CLOSE_ROWS = `in_doc_sync = 1
  AND key IN (SELECT json_extract(k.value, '$.key') FROM json_each(?1) AS k)
  AND EXISTS (
  SELECT 1 FROM json_each(?1) AS r
  WHERE json_extract(r.value, '$.key') = items.key
    AND json_extract(r.value, '$.updated_at') IS items.updated_at
    AND json_extract(r.value, '$.live_status_at') IS items.live_status_at)`;

/** ?1 rows, ?2 now, ?3 source, ?4 note: one event per row that was not done yet. */
const CLOSE_EVENTS = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?2, 'done', ?3, ?4 FROM items WHERE status != 'done' AND ${CLOSE_ROWS}`;

/** ?1 rows, ?2 now, ?3 source. Leaving the plan is a doc change: doc_status becomes done. */
const CLOSE_ITEMS = `UPDATE items SET in_doc_sync = 0, doc_status = 'done', doc_status_at = ?2,
  done_at = CASE WHEN status = 'done' THEN COALESCE(done_at, ?2) ELSE ?2 END,
  source = CASE WHEN status = 'done' THEN source ELSE ?3 END, status = 'done', updated_at = ?2
  WHERE ${CLOSE_ROWS}`;

/**
 * ?1 now, ?2 a JSON list of keys, ?3 1 when the caller may write plan items. Archives each key and the plan-owned rows
 * under it (recursive on `parent_key`, only rows with `in_doc_sync = 1` or a part or check); a live bug, problem,
 * waiting or agent card under it is never taken. A row already archived keeps its first time (Slice 50). The permission
 * condition is in this statement: a caller without the sync scope archives only while no row it would take is
 * doc-synced, else the statement changes nothing (`changes() = 0`, which the caller reads as a refusal).
 */
const ARCHIVE_ROWS = `WITH RECURSIVE sub(key) AS (
    SELECT value FROM json_each(?2)
    UNION SELECT c.key FROM items c JOIN sub ON c.parent_key = sub.key
      AND (c.in_doc_sync = 1 OR c.type IN ('${ItemType.Part}', '${ItemType.Check}')))
  UPDATE items SET archived_at = ?1 WHERE archived_at IS NULL
  AND key IN (SELECT key FROM sub)
  AND (?3 = 1 OR NOT EXISTS (SELECT 1 FROM items s WHERE s.key IN (SELECT key FROM sub) AND s.archived_at IS NULL AND s.in_doc_sync = 1))`;

/**
 * Brings the archived subtree of one key back (Slice 50): the key and every descendant reached only through rows whose
 * `archived_at` equals the key's own, so a row archived at another time is neither revived nor passed through. The
 * key's time is read inside the statement. The guard is the same compare-and-swap the upsert right after it carries,
 * so a write that loses it revives nothing. Runs BEFORE the upsert, which clears the key's own time.
 * ?1 key, ?2 the updated_at and ?3 the live_status_at the sync read (the guard of SYNC_UPSERT).
 */
const SYNC_REVIVE = `UPDATE items SET archived_at = NULL WHERE key IN (
  WITH RECURSIVE sub(key, at) AS (
    SELECT r.key, r.archived_at FROM items r
      WHERE r.key = ?1 AND r.archived_at IS NOT NULL AND r.updated_at IS ?2 AND r.live_status_at IS ?3
    UNION SELECT c.key, c.archived_at FROM items c JOIN sub ON c.parent_key = sub.key AND c.archived_at = sub.at)
  SELECT key FROM sub)`;

/**
 * ?1 project, ?2 the last key of the previous page (null for the first), ?3 limit: the live top-level doc-sync rows by
 * key. A part or check is read with its slice (`SYNCED_CHILDREN`), never listed alone.
 */
const SYNCED_ROWS = `SELECT * FROM items WHERE project = ?1 AND in_doc_sync = 1
  AND type NOT IN ('${ItemType.Part}', '${ItemType.Check}') AND (?2 IS NULL OR key > ?2) ORDER BY key LIMIT ?3`;

/** ?1 a JSON list of slice keys: their doc-sync parts and checks, archived ones too (the hash covers what the documents list). */
const SYNCED_CHILDREN = `SELECT * FROM items WHERE in_doc_sync = 1
  AND type IN ('${ItemType.Part}', '${ItemType.Check}') AND parent_key IN (SELECT value FROM json_each(?1))`;

/**
 * ?1 cutoff, ?2 limit: the keys one purge chunk removes; the three statements pick the same rows (the unlink changes no
 * row the choice reads, and the events delete touches another table). Only the time counts: a row archived with its
 * parent has the parent's time, one archived on its own has its own (Slice 50).
 */
const PURGE_KEYS = `SELECT key FROM items WHERE archived_at IS NOT NULL AND archived_at < ?1
  ORDER BY key LIMIT ?2`;
/**
 * A row that names a purged item (a bug, problem or waiting card of the slice) loses the link, so no `parent_key` is left
 * dangling. A doc-synced row keeps its `parent_key`: the documents own it, and clearing it would make its hash differ.
 */
const PURGE_UNLINK = `UPDATE items SET parent_key = NULL WHERE in_doc_sync = 0 AND parent_key IN (${PURGE_KEYS})`;
const PURGE_EVENTS = `DELETE FROM events WHERE item_key IN (${PURGE_KEYS})`;
const PURGE_ITEMS = `DELETE FROM items WHERE key IN (${PURGE_KEYS})`;

/**
 * ?1 now, ?2 a JSON list of keys: one `archived` history row for each named key that the archive update right before it
 * archived (an already archived key kept its first time). Bound by `changes() > 0` like INSERT_EVENT and SYNC_EVENT, so
 * an update that archived nothing adds no row; keep the two statements adjacent.
 */
const ARCHIVE_EVENTS = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?1, status, source, '${ARCHIVED_NOTE}' FROM items
  WHERE archived_at = ?1 AND key IN (SELECT value FROM json_each(?2)) AND changes() > 0`;

/**
 * ?1 now, ?2 note (the caller's, else Heartbeat when `changesNothing` found the request changed only the
 * heartbeat, else null), ?3 key. Decided from the request, never from stored-row equality, so a delayed report
 * that changed the title, steps or question still leaves its own row. Runs right after the
 * upsert in the same batch (one transaction, statements in order): `changes()` is the row count of that
 * upsert, so a guarded write that lost the compare-and-swap (its ON CONFLICT ... WHERE matched nothing)
 * adds no event, and a write that took effect adds exactly one, whatever the clock or the steps text. The
 * status and source are the item's after this write: nothing runs between the two statements of the batch.
 */
const INSERT_EVENT = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?1, status, source, ?2 FROM items WHERE key = ?3 AND changes() > 0`;

/**
 * Coalesces heartbeats: when the two newest events of the item are both Heartbeat rows with the same status and
 * source, the older goes, so a long run of heartbeats is one row that moves forward. ?1 key, ?2 note. It runs
 * only for a save that wrote a Heartbeat row (`changes()` is the event insert's count, so it is 0 when the save lost
 * its race or wrote no row), right after that insert.
 */
const COALESCE_HEARTBEATS = `DELETE FROM events WHERE changes() > 0 AND id = (
    SELECT n.id FROM events n WHERE n.item_key = ?1 ORDER BY n.at DESC, n.id DESC LIMIT 1 OFFSET 1)
  AND note = ?2 AND EXISTS (
    SELECT 1 FROM events t WHERE t.id = (
      SELECT m.id FROM events m WHERE m.item_key = ?1 ORDER BY m.at DESC, m.id DESC LIMIT 1)
    AND t.note = ?2 AND t.status IS events.status AND t.source IS events.source)`;

/** The slices that listed bugs and problems name in `parent_key`, listed or not (same binds as the listing). */
const PARENT_SLICES = (where: string): string => `SELECT key, title FROM items WHERE type = '${ItemType.Slice}'
  AND key IN (SELECT parent_key FROM items WHERE ${where} AND type IN ('${ItemType.Bug}', '${ItemType.Problem}') AND parent_key IS NOT NULL)`;

const boardEvents = (where: string): string => `SELECT item_key, at, status, source, note FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY item_key ORDER BY at DESC, id DESC) AS rn
  FROM events WHERE item_key IN (SELECT key FROM items WHERE ${where})
) WHERE rn <= ?4 ORDER BY item_key, at DESC, id DESC`;

/** `environmentIdentity` (domain/capCost.ts) in SQL: ASCII lower case, the same characters trimmed (?4 is `IDENTITY_TRIM_CHARS`). */
const ENVIRONMENT_IDENTITY = (column: string): string => `lower(trim(${column}, ?4))`;

/**
 * ?1 the session agent, ?2 from, ?3 limit, ?4 the characters the identity trims. A session's window is its first
 * to its last report; the board's own stale marks do not count. Only cards last reported at or after ?2, only
 * environments with no usage_series row (the same identity as `environmentIdentity`), and per environment only
 * its newest ?3 cards, so one busy environment cannot crowd out the older windows of another.
 */
const SESSION_WINDOWS = `SELECT environment, start_at, end_at FROM (
  SELECT i.environment AS environment, MIN(e.at) AS start_at, MAX(e.at) AS end_at,
    ROW_NUMBER() OVER (PARTITION BY ${ENVIRONMENT_IDENTITY("i.environment")} ORDER BY MAX(e.at) DESC, i.key) AS rn
  FROM items i JOIN events e ON e.item_key = i.key
  WHERE i.agent = ?1 AND i.archived_at IS NULL AND i.environment IS NOT NULL AND i.environment <> '' AND e.status <> '${ItemStatus.Stale}'
    AND NOT EXISTS (SELECT 1 FROM usage_series s WHERE s.kind = 'environment'
      AND ${ENVIRONMENT_IDENTITY("s.value")} = ${ENVIRONMENT_IDENTITY("i.environment")})
  GROUP BY i.key HAVING MAX(e.at) >= ?2
) WHERE rn <= ?3 ORDER BY end_at DESC, environment`;

const INSERT_SAMPLE = `INSERT OR IGNORE INTO usage_samples (agent_key, model, environment, record_at,
  reported_at, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, task_key, agent_kind, step)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`;

const INSERT_SERIES = "INSERT OR IGNORE INTO usage_series (kind, value, first_seen) VALUES (?1, ?2, ?3)";

const INSERT_CAP_READING = `INSERT OR IGNORE INTO cap_readings (taken_at, plan, window_kind, percent, reset_at, source)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

/**
 * ?1 from: every sample since (time index), and, only for the series that have a sample since,
 * the newest one before it: one seek per series into the identity index (newest first, LIMIT 1).
 * A series with no sample in the range has no use in it and is not read. The two parts never
 * overlap, so UNION ALL. The rows come back in no order: `usageSamplesFrom` sorts them once, in the code
 * (a final ORDER BY over a UNION ALL is a temp sort of the whole range). Every stored time is UTC ISO (application/usage.ts), so text order is
 * time order.
 */
export const SAMPLES_FROM =`SELECT * FROM usage_samples WHERE record_at >= ?1
  UNION ALL
  SELECT b.* FROM (
    SELECT DISTINCT agent_key, model, COALESCE(environment, '') AS env
    FROM usage_samples INDEXED BY idx_usage_samples_time WHERE record_at >= ?1
  ) g JOIN usage_samples b ON b.id = (
    SELECT p.id FROM usage_samples p
    WHERE p.agent_key = g.agent_key AND p.model = g.model
      AND COALESCE(p.environment, '') = g.env AND p.record_at < ?1
    ORDER BY p.record_at DESC LIMIT 1)`;

/** Thinning looks this far back from the cutoff only; older samples were thinned by earlier runs. */
const THIN_BAND_DAYS = 3;
const MS_PER_DAY = 86_400_000;

const SERIES_WINDOW = "PARTITION BY agent_key, model, COALESCE(environment, '') ORDER BY record_at, id";
const WENT_DOWN = (column: string): string => `${column} < LAG(${column}) OVER (${SERIES_WINDOW})`;

/**
 * The rule of isRestart (domain/usage.ts) in SQL: a sample is a restart when any running total
 * is lower than the one before it. ?1 cutoff, ?2 band start. Deleted: in the band (?2 up to
 * ?1, time index), not the last of its hour, not a restart, not the sample just before a
 * restart and not the sample just before the task key or agent kind of its series changes (so
 * the use, per task and per agent kind too, stays the same). The first row of the band (its
 * predecessor is unknown, so it may be a restart) and the last (its successor is not read) are
 * kept for this run. The hour is the first 13 characters of a UTC ISO time.
 */
export const THIN_ROWS =`SELECT id FROM (
  SELECT id, task_key, agent_kind, restart, hour_rank,
    LAG(id) OVER (${SERIES_WINDOW}) AS prev_id, LEAD(id) OVER (${SERIES_WINDOW}) AS next_id,
    LEAD(restart) OVER (${SERIES_WINDOW}) AS next_restart,
    LEAD(task_key) OVER (${SERIES_WINDOW}) AS next_task,
    LEAD(agent_kind) OVER (${SERIES_WINDOW}) AS next_kind FROM (
    SELECT id, record_at, agent_key, model, environment, task_key, agent_kind,
      ${["input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens"].map(WENT_DOWN).join(" OR ")} AS restart,
      ROW_NUMBER() OVER (PARTITION BY agent_key, model, COALESCE(environment, ''), substr(record_at, 1, 13)
        ORDER BY record_at DESC, id DESC) AS hour_rank
    FROM usage_samples WHERE record_at >= ?2 AND record_at < ?1
  )
) WHERE hour_rank > 1 AND restart IS NOT 1 AND prev_id IS NOT NULL AND next_id IS NOT NULL
  AND next_restart IS NOT 1 AND next_task IS task_key AND next_kind IS agent_kind`;

interface UsageSampleRow {
  id: number;
  agent_key: string;
  model: string;
  environment: string | null;
  record_at: string;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  task_key: string | null;
  agent_kind: string | null;
  step: string | null;
}

/** ?1 a JSON list of keys. A part's slice (its `parent_key`) is read with it, so the part's title can name both. */
const TASK_INFO = `SELECT i.key AS key, i.title AS title, i.project AS project, i.type AS type, s.title AS slice_title
  FROM items i LEFT JOIN items s ON s.key = i.parent_key AND s.type = '${ItemType.Slice}'
  WHERE i.key IN (SELECT value FROM json_each(?1))`;

interface TaskInfoRow extends TaskInfo {
  type: string;
  slice_title: string | null;
}

/** A part's own title is only its work ("Docs"): the usage row shows "Slice title · Part B · Docs", so two slices' parts differ (Slice 11 review). */
function toTaskInfo({ key, title, project, type, slice_title }: TaskInfoRow): TaskInfo {
  const letter = type === ItemType.Part ? partLetterOf(key) : null;
  if (letter === null) return { key, title, project };
  const part = `Part ${letter} · ${title}`;
  return { key, title: slice_title ? `${slice_title} · ${part}` : part, project };
}

interface CapReadingRow {
  taken_at: string;
  plan: string;
  window_kind: string;
  percent: number;
  reset_at: string | null;
  source: string | null;
}

export class D1ItemRepository implements ItemRepository, UsageRepository, ArchiveRepository {
  constructor(private readonly db: D1Database) {}

  async saveUsage(sample: UsageSample, now: string): Promise<boolean> {
    const names: SeriesName[] = [
      { kind: SeriesKind.Model, value: sample.model },
      ...(sample.agentKind ? [{ kind: SeriesKind.AgentKind, value: sample.agentKind }] : []),
      ...(sample.environment ? [{ kind: SeriesKind.Environment, value: sample.environment }] : []),
    ];
    const [stored] = await this.db.batch([
      this.db.prepare(INSERT_SAMPLE).bind(...sampleParams(sample, now)),
      ...names.map(({ kind, value }) => this.db.prepare(INSERT_SERIES).bind(kind, value, now)),
    ]);
    return (stored?.meta.changes ?? 0) > 0;
  }

  async saveCapReadings(readings: CapReading[]): Promise<number> {
    const insert = this.db.prepare(INSERT_CAP_READING);
    const results = await this.db.batch(
      readings.map((r) => insert.bind(r.takenAt, r.plan, r.windowKind, r.percent, r.resetAt, r.source)),
    );
    return results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  }

  async usageSamplesFrom(from: string): Promise<UsageSample[]> {
    const { results } = await this.db.prepare(SAMPLES_FROM).bind(from).all<UsageSampleRow>();
    return results.sort(bySeriesThenTime).map(toUsageSample);
  }

  async capReadingsFrom(from: string): Promise<CapReading[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM cap_readings WHERE taken_at >= ?1 ORDER BY taken_at, id")
      .bind(from)
      .all<CapReadingRow>();
    return results.map(toCapReading);
  }

  async seriesNames(): Promise<SeriesName[]> {
    const { results } = await this.db
      .prepare("SELECT kind, value FROM usage_series ORDER BY first_seen, value")
      .all<{ kind: string; value: string }>();
    return results.map(({ kind, value }) => ({ kind: kind as SeriesKind, value }));
  }

  async taskInfo(keys: string[]): Promise<TaskInfo[]> {
    const { results } = await this.db.prepare(TASK_INFO).bind(JSON.stringify(keys)).all<TaskInfoRow>();
    return results.map(toTaskInfo);
  }

  async sessionWindowsFrom(from: string, limit: number): Promise<SessionWindow[]> {
    const { results } = await this.db
      .prepare(SESSION_WINDOWS)
      .bind(SESSION_AGENT, from, limit, IDENTITY_TRIM_CHARS)
      .all<{ environment: string; start_at: string; end_at: string }>();
    return results.map((row) => ({ environment: row.environment, start: row.start_at, end: row.end_at }));
  }

  async thinUsage(cutoff: string): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM usage_samples WHERE id IN (${THIN_ROWS})`)
      .bind(cutoff, new Date(Date.parse(cutoff) - THIN_BAND_DAYS * MS_PER_DAY).toISOString())
      .run();
    return result.meta.changes ?? 0;
  }

  async find(key: string): Promise<Item | null> {
    const row = await this.db.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<ItemRow>();
    return row ? toItem(row) : null;
  }

  async findChain(key: string, limit: number): Promise<Item[]> {
    if (limit < 1) return [];
    const { results } = await this.db.prepare(CHAIN_ROWS).bind(key, limit).all<ItemRow>();
    // Deliberate backstop: CHAIN_ROWS already stops at a repeat; this cut keeps a loop from ever reaching the caller if that SQL changes.
    const seen = new Set<string>();
    const chain: Item[] = [];
    for (const row of results) {
      if (seen.has(row.key)) break;
      seen.add(row.key);
      chain.push(toItem(row));
    }
    return chain;
  }

  async findWithDocSync(key: string): Promise<{ item: Item | null; inDocSync: boolean }> {
    const row = await this.db.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<SyncItemRow>();
    return { item: row ? toItem(row) : null, inDocSync: row?.in_doc_sync === 1 };
  }

  async findWithStepsText(key: string): Promise<ItemWithStepsText> {
    const row = await this.db.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<ItemRow>();
    return { item: row ? toItem(row) : null, stepsText: row?.steps ?? null };
  }

  async save(write: ItemWrite): Promise<Item> {
    const { key, note } = write.input;
    const guarded = write.ifStepsText !== undefined;
    const stored = await this.db.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<SyncItemRow>();
    const eventNote = note ?? quietNote(stored, write);
    // A report never revives: UPSERT_ITEM itself skips an archived row (`archived_at IS NULL` in its WHERE), so a report that
    // finds the key archived writes nothing and is refused below, whatever happened between the read above and the batch.
    const statements = [
      this.db.prepare(UPSERT_ITEM).bind(...upsertParams(write)),
      this.db.prepare(INSERT_EVENT).bind(write.now, eventNote, key),
    ];
    if (eventNote === HEARTBEAT_NOTE) statements.push(this.db.prepare(COALESCE_HEARTBEATS).bind(key, HEARTBEAT_NOTE));
    const results = await this.db.batch(statements);
    const row = results[0]?.results[0] as ItemRow | undefined;
    if (!row && (await this.isArchived(key))) throw new ArchivedItemError(key);
    if (!row && guarded) throw new StepsChangedError();
    if (!row) throw new Error(`upsert of ${key} returned no row`);
    return toItem(row);
  }

  private async isArchived(key: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT archived_at FROM items WHERE key = ?1").bind(key).first<{ archived_at: string | null }>();
    return Boolean(row?.archived_at);
  }

  async loadForSync(project: string, keys: string[]): Promise<SyncRow[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM items
         WHERE (project = ?1 AND in_doc_sync = 1) OR key IN (SELECT value FROM json_each(?2))`)
      .bind(project, JSON.stringify(keys))
      .all<SyncItemRow>();
    return results.map(toSyncRow);
  }

  async applySync(writes: SyncWrite[], closes: SyncRow[], now: string): Promise<SyncApplied> {
    const { written, closed } = await this.runSync(writes, closes, { keys: [], canSync: true }, now);
    return { written, closed };
  }

  async applyBatch(writes: SyncWrite[], closes: SyncRow[], archive: ArchiveRequest, now: string): Promise<BatchApplied> {
    return this.runSync(writes, closes, archive, now);
  }

  /** The sync's statements (writes with their events, chunked closes) and the archive, in one batch; the tally reads each statement's own row count. */
  private async runSync(writes: SyncWrite[], closes: SyncRow[], archive: ArchiveRequest, now: string): Promise<BatchApplied> {
    const archiveKeys = archive.keys;
    const upsert = this.db.prepare(SYNC_UPSERT);
    const event = this.db.prepare(SYNC_EVENT);
    const statements: D1PreparedStatement[] = [];
    const upsertAt = new Map<number, string>();
    const revive = this.db.prepare(SYNC_REVIVE);
    for (const { item, event: change, read } of writes) {
      // The revive runs for every write of an existing key, so an archive that landed after the read is still undone with the write.
      if (read) statements.push(revive.bind(item.key, read.updated_at, read.live_status_at));
      upsertAt.set(statements.length, item.key);
      statements.push(upsert.bind(...syncParams(item), read?.updated_at ?? null, read?.live_status_at ?? null, item.details_md));
      if (change) statements.push(event.bind(item.key, change.at, change.status, DOC_SYNC_SOURCE, change.note));
    }
    const closeAt = new Set<number>();
    for (const rows of closeChunks(closes)) {
      statements.push(this.db.prepare(CLOSE_EVENTS).bind(rows, now, DOC_SYNC_SOURCE, SYNC_LEFT_NOTE));
      closeAt.add(statements.length);
      statements.push(this.db.prepare(CLOSE_ITEMS).bind(rows, now, DOC_SYNC_SOURCE));
    }
    const archiveAt = archiveKeys.length > 0 ? statements.length : -1;
    if (archiveKeys.length > 0) {
      const keys = JSON.stringify(archiveKeys);
      statements.push(this.db.prepare(ARCHIVE_ROWS).bind(now, keys, archive.canSync ? 1 : 0), this.db.prepare(ARCHIVE_EVENTS).bind(now, keys));
    }
    const results = statements.length > 0 ? await this.db.batch(statements) : [];
    const written = new Set<string>();
    let closed = 0;
    let archived = 0;
    results.forEach((result, index) => {
      const key = upsertAt.get(index);
      if (key !== undefined && (result.meta.changes ?? 0) > 0) written.add(key);
      if (closeAt.has(index)) closed += result.meta.changes ?? 0;
      if (index === archiveAt) archived = result.meta.changes ?? 0;
    });
    return { written, closed, archived };
  }

  async findWithArchive(key: string): Promise<{ item: Item | null; archivedAt: string | null }> {
    const row = await this.db.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<SyncItemRow>();
    return { item: row ? toItem(row) : null, archivedAt: row?.archived_at ?? null };
  }

  async syncedPage(project: string, afterKey: string | null, limit: number): Promise<SyncedPage> {
    const { results } = await this.db.prepare(SYNCED_ROWS).bind(project, afterKey, limit).all<SyncItemRow>();
    const rows = results.map(toSyncRow);
    if (rows.length === 0) return { rows, children: [] };
    const kids = await this.db.prepare(SYNCED_CHILDREN).bind(JSON.stringify(rows.map((row) => row.key))).all<SyncItemRow>();
    return { rows, children: kids.results.map(toSyncRow) };
  }

  async purgeArchived(cutoff: string, limit: number): Promise<PurgeCounts> {
    const [unlinked, , items] = await this.db.batch([
      this.db.prepare(PURGE_UNLINK).bind(cutoff, limit),
      this.db.prepare(PURGE_EVENTS).bind(cutoff, limit),
      this.db.prepare(PURGE_ITEMS).bind(cutoff, limit),
    ]);
    return { removed: items?.meta.changes ?? 0, unlinked: unlinked?.meta.changes ?? 0 };
  }

  async markStale({ cutoff, sessionCutoff, waitingCutoff }: StaleCutoffs, now: string): Promise<StaleResult> {
    const [, stale, , waiting] = await this.db.batch([
      this.db.prepare(STALE_EVENTS).bind(cutoff, now, STALE_NOTE, sessionCutoff),
      this.db.prepare(STALE_ITEMS).bind(cutoff, now, STALE_NOTE, sessionCutoff),
      this.db.prepare(WAITING_EVENTS).bind(waitingCutoff, now, WAITING_CLOSED_NOTE),
      this.db.prepare(WAITING_ITEMS).bind(waitingCutoff, now),
    ]);
    return { stale: stale?.meta.changes ?? 0, waitingClosed: waiting?.meta.changes ?? 0 };
  }

  async listBoard(filter: BoardFilter): Promise<BoardRow[]> {
    const where = [filter.cutoff, filter.project ?? null, filter.type ?? null] as const;
    const listed = filter.withRiders ? BOARD_WHERE : BOARD_WHERE_OWN;
    const statements = [
      this.db.prepare(`SELECT * FROM items WHERE ${listed} ORDER BY created_at DESC, key`).bind(...where),
      this.db.prepare(boardEvents(listed)).bind(...where, filter.eventLimit),
    ];
    // Only the board page shows the slice chip; list_open skips this third read of the listing (Slice 34).
    if (filter.withRiders) statements.push(this.db.prepare(PARENT_SLICES(listed)).bind(...where));
    const [items, events, slices] = await this.db.batch(statements);
    const parents = new Map(((slices?.results ?? []) as { key: string; title: string }[]).map((s) => [s.key, s]));
    return attachEvents((items?.results ?? []) as SyncItemRow[], (events?.results ?? []) as EventRow[], parents);
  }

  async eventsFor(key: string): Promise<ItemEvent[]> {
    const { results } = await this.db
      .prepare("SELECT at, status, source, note FROM events WHERE item_key = ?1 ORDER BY at DESC, id DESC")
      .bind(key)
      .all<ItemEvent>();
    return results;
  }
}

const ENCODER = new TextEncoder();

/**
 * The close rows as JSON texts of at most `CLOSE_CHUNK_ROWS` rows and `CLOSE_CHUNK_BYTES` bytes each: one text is one statement parameter, and
 * D1 caps a statement at 100 KB, so a big close is several statements in the one batch, not one parameter that fails it.
 */
export function closeChunks(closes: SyncRow[]): string[] {
  const chunks: string[] = [];
  let rows: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (rows.length > 0) chunks.push(`[${rows.join(",")}]`);
    rows = [];
    bytes = 0;
  };
  for (const { key, updated_at, live_status_at } of closes) {
    const text = JSON.stringify({ key, updated_at, live_status_at });
    const size = ENCODER.encode(text).length + 1;
    if (rows.length >= CLOSE_CHUNK_ROWS || (rows.length > 0 && bytes + size > CLOSE_CHUNK_BYTES)) flush();
    rows.push(text);
    bytes += size;
  }
  flush();
  return chunks;
}

/**
 * Whether the request changed nothing but the heartbeat, judged from what it gave against the row it read: a given
 * column that differs is a change; a given status counts unless it is older than `live_status_at` (the SQL
 * `NEXT_STATUS` drops it); with no status given, only the revival of a stale item is one. A new key is a change.
 */
function changesOnlyHeartbeat(stored: SyncItemRow | null, { input, now }: ItemWrite): boolean {
  if (!stored) return false;
  const row = stored as unknown as Record<string, unknown>;
  return CHANGEABLE_COLUMNS.every((col, index) => {
    const [given, value] = givenParams(input, col);
    if (index !== STATUS_COLUMN) return !given || value === (row[col] ?? null);
    if (given) return (stored.live_status_at !== null && now < stored.live_status_at) || value === stored.status;
    return !(stored.status === ItemStatus.Stale && now >= stored.heartbeat_at);
  });
}

/**
 * The history note of a report with no note of its own: nothing but a heartbeat changed, and then the dropped-status
 * note when the only thing given beyond it was an older status. A report that also changed another field gets no
 * note, so the real change is not hidden under one that says it was ignored (Slice 47 review #3).
 */
function quietNote(stored: SyncItemRow | null, write: ItemWrite): string | null {
  if (!changesOnlyHeartbeat(stored, write)) return null;
  return statusDropped(stored, write) ? STATUS_DROPPED_NOTE : HEARTBEAT_NOTE;
}

/** True when the request names a status other than the stored one but is older than `live_status_at`, so `NEXT_STATUS` drops it: the history row says so (Slice 47, Slice 34 follow-up #9). */
function statusDropped(stored: SyncItemRow | null, { input, now }: ItemWrite): boolean {
  if (!stored || input.status === undefined || stored.live_status_at === null) return false;
  return now < stored.live_status_at && input.status !== stored.status;
}

function upsertParams({ insert, input, now, ifStepsText }: ItemWrite): (string | number | null)[] {
  return [
    insert.key, insert.project, insert.parent, insert.type, insert.priority, insert.status, insert.title,
    insert.why, insert.details_md, JSON.stringify(insert.links), insert.source, now, insert.done_at,
    ...CHANGEABLE_COLUMNS.flatMap((col) => givenParams(input, col)),
    ifStepsText === undefined ? 0 : 1,
    ifStepsText ?? null,
  ];
}

function sampleParams(s: UsageSample, now: string): (string | number | null)[] {
  return [
    s.agentKey, s.model, s.environment, s.recordAt, now, s.totals.input, s.totals.cache_write,
    s.totals.cache_read, s.totals.output, s.taskKey, s.agentKind, s.step,
  ];
}

/** The one place samples are put in order: the series, then time, then id: the same order as `SERIES_WINDOW`, which thinning keeps by. Text compares byte-wise, like SQLite's. */
function bySeriesThenTime(a: UsageSampleRow, b: UsageSampleRow): number {
  return (
    compareText(a.agent_key, b.agent_key) ||
    compareText(a.model, b.model) ||
    compareText(a.environment ?? "", b.environment ?? "") ||
    compareText(a.record_at, b.record_at) ||
    a.id - b.id
  );
}

/** Orders text by code point, which is the order of its UTF-8 bytes (SQLite's); JS `<` orders by UTF-16 unit, so a character above U+FFFF would sort before U+E000 to U+FFFF (Slice 47 5a). */
export function compareText(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a.codePointAt(i)!;
    const right = b.codePointAt(j)!;
    if (left !== right) return left < right ? -1 : 1;
    i += left > MAX_BMP_CODE_POINT ? 2 : 1;
    j += right > MAX_BMP_CODE_POINT ? 2 : 1;
  }
  if (i < a.length) return 1;
  return j < b.length ? -1 : 0;
}

const MAX_BMP_CODE_POINT = 0xffff;

function toUsageSample(row: UsageSampleRow): UsageSample {
  return {
    agentKey: row.agent_key,
    model: row.model,
    environment: row.environment,
    recordAt: row.record_at,
    totals: {
      input: row.input_tokens,
      cache_write: row.cache_write_tokens,
      cache_read: row.cache_read_tokens,
      output: row.output_tokens,
    },
    taskKey: row.task_key,
    agentKind: row.agent_kind,
    step: row.step,
  };
}

function toCapReading(row: CapReadingRow): CapReading {
  return {
    takenAt: row.taken_at,
    plan: row.plan,
    windowKind: row.window_kind,
    percent: row.percent,
    resetAt: row.reset_at,
    source: row.source,
  };
}

function syncParams(i: SyncRow): (string | number | null)[] {
  return [
    i.key, i.project, i.parent, i.type, i.priority, i.status, i.title, i.why, JSON.stringify(i.links),
    i.source, i.heartbeat_at, i.created_at, i.updated_at, i.done_at, i.in_doc_sync ? 1 : 0,
    i.doc_status, i.doc_status_at, i.live_status_at, i.parent_key ?? null,
  ];
}

/** [flag, value]: left out = not given, null = clear (links clear to an empty list). */
function givenParams(input: ReportInput, col: ChangeableColumn): [number, string | null] {
  const value = input[col];
  if (value === undefined) return [0, null];
  if (col === "links") return [1, JSON.stringify(value ?? [])];
  if (col === "steps") return [1, value === null ? null : JSON.stringify(value)];
  return [1, value as string | null];
}

/** The public item: the sync's internal columns are dropped. */
function toItem(row: ItemRow): Item {
  const item = Object.fromEntries(Object.entries(row).filter(([column]) => !SYNC_COLUMNS.has(column))) as unknown as ItemRow;
  return {
    ...item,
    type: row.type as ItemType,
    priority: row.priority as Priority,
    status: row.status as ItemStatus,
    links: JSON.parse(row.links) as Item["links"],
    steps: parseStoredSteps(row.steps),
  };
}

function toSyncRow(row: SyncItemRow): SyncRow {
  return {
    ...toItem(row),
    in_doc_sync: row.in_doc_sync === 1,
    doc_status: row.doc_status as ItemStatus | null,
    doc_status_at: row.doc_status_at,
    live_status_at: row.live_status_at,
    archived_at: row.archived_at ?? null,
  };
}

function attachEvents(items: SyncItemRow[], events: EventRow[], parents: Map<string, { key: string; title: string }>): BoardRow[] {
  const byKey = new Map<string, ItemEvent[]>();
  for (const { item_key, ...event } of events) {
    byKey.set(item_key, [...(byKey.get(item_key) ?? []), event]);
  }
  return items.map((row) => ({
    ...toItem(row),
    events: byKey.get(row.key) ?? [],
    expiry: { doc_status_at: row.doc_status_at, live_status_at: row.live_status_at },
    docSync: { in_doc_sync: row.in_doc_sync === 1, doc_status: row.doc_status as ItemStatus | null },
    parentSlice: row.parent_key ? (parents.get(row.parent_key) ?? null) : null,
  }));
}
