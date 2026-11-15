import type { BoardFilter, ItemRepository, ItemWrite } from "../application/ports";
import { SYNC_LEFT_NOTE, type SyncRow, type SyncWrite } from "../domain/docSync";
import {
  DOC_SYNC_SOURCE,
  HEARTBEAT_NOTE,
  type Item,
  type ItemEvent,
  type ItemStatus,
  type ItemType,
  type ItemWithEvents,
  type Priority,
} from "../domain/item";
import type { ReportInput } from "../domain/upsert";

interface ItemRow extends Omit<Item, "links" | "type" | "priority" | "status"> {
  links: string;
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
}

const SYNC_COLUMNS = ["in_doc_sync", "doc_status", "doc_status_at", "live_status_at"] as const;

interface EventRow extends ItemEvent {
  item_key: string;
}

const BOARD_WHERE = `(status != 'done' OR done_at > ?1)
  AND (?2 IS NULL OR project = ?2) AND (?3 IS NULL OR type = ?3)`;

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
] as const;
type ChangeableColumn = (typeof CHANGEABLE_COLUMNS)[number];

const FIRST_GIVEN_PARAM = 14;
const STATUS_COLUMN = CHANGEABLE_COLUMNS.indexOf("status");

const flagParam = (index: number): string => `?${FIRST_GIVEN_PARAM + 2 * index}`;
const valueParam = (index: number): string => `?${FIRST_GIVEN_PARAM + 2 * index + 1}`;

const NEXT_STATUS = `CASE WHEN ${flagParam(STATUS_COLUMN)} THEN ${valueParam(STATUS_COLUMN)} ELSE status END`;
const ANY_CHANGED = CHANGEABLE_COLUMNS.map(
  (col, i) => `(${flagParam(i)} AND ${valueParam(i)} IS NOT ${col})`,
).join(" OR ");
const SET_CHANGEABLE = CHANGEABLE_COLUMNS.map(
  (col, i) => `${col} = CASE WHEN ${flagParam(i)} THEN ${valueParam(i)} ELSE ${col} END`,
).join(", ");

const SOURCE_COLUMN = CHANGEABLE_COLUMNS.indexOf("source");
/** A report that gave a status and did not say it came from doc sync moves live_status_at. */
const LIVE_STATUS_REPORT = `${flagParam(STATUS_COLUMN)} AND
  COALESCE(CASE WHEN ${flagParam(SOURCE_COLUMN)} THEN ${valueParam(SOURCE_COLUMN)} END, '') != '${DOC_SYNC_SOURCE}'`;

const UPSERT_ITEM = `INSERT INTO items (key, project, parent, type, priority, status, title, why,
  details_md, links, source, heartbeat_at, created_at, updated_at, done_at, live_status_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12, ?13,
    CASE WHEN ?11 IS '${DOC_SYNC_SOURCE}' THEN NULL ELSE ?12 END)
  ON CONFLICT (key) DO UPDATE SET ${SET_CHANGEABLE}, heartbeat_at = ?12,
  live_status_at = CASE WHEN ${LIVE_STATUS_REPORT} THEN ?12 ELSE live_status_at END,
  updated_at = CASE WHEN ${ANY_CHANGED} THEN ?12 ELSE updated_at END,
  done_at = CASE WHEN ${NEXT_STATUS} = 'done'
    THEN CASE WHEN status = 'done' THEN COALESCE(done_at, ?12) ELSE ?12 END
    ELSE NULL END
  RETURNING *`;

/**
 * A doc-sync write: the row is computed in the domain from one read, so only the columns sync
 * owns are set on an existing key; type, priority, details, heartbeat and created_at stay.
 * ?19 and ?20 are the updated_at and live_status_at the sync read (null for a new key): the
 * update applies only while the row still has them, so it never acts on a stale read.
 */
const SYNC_UPSERT = `INSERT INTO items (key, project, parent, type, priority, status, title, why, links,
  source, heartbeat_at, created_at, updated_at, done_at, in_doc_sync, doc_status, doc_status_at, live_status_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
  ON CONFLICT (key) DO UPDATE SET parent = excluded.parent, status = excluded.status,
  title = excluded.title, why = excluded.why, links = excluded.links, source = excluded.source,
  updated_at = excluded.updated_at, done_at = excluded.done_at, in_doc_sync = excluded.in_doc_sync,
  doc_status = excluded.doc_status, doc_status_at = excluded.doc_status_at
  WHERE items.updated_at IS ?19 AND items.live_status_at IS ?20`;

/** Written only when the write above took effect (the row now has this updated_at and status). */
const SYNC_EVENT = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?2, ?3, ?4, ?5 FROM items
  WHERE key = ?1 AND updated_at = ?2 AND status = ?3 AND source = ?4`;

/**
 * ?1 is a JSON list of {key, updated_at, live_status_at}: the rows the close read, matched in
 * one statement. Like the write guard, a row whose updated_at or live_status_at moved since
 * the read (a live report, even one with the same status) is left open.
 */
const CLOSE_ROWS = `in_doc_sync = 1 AND EXISTS (
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

/** The note is the caller's, else Heartbeat when this write left updated_at alone. */
const INSERT_EVENT = `INSERT INTO events (item_key, at, status, source, note)
  SELECT key, ?1, status, source,
    COALESCE(?2, CASE WHEN updated_at = ?1 THEN NULL ELSE ?4 END)
  FROM items WHERE key = ?3`;

const BOARD_EVENTS = `SELECT item_key, at, status, source, note FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY item_key ORDER BY at DESC, id DESC) AS rn
  FROM events WHERE item_key IN (SELECT key FROM items WHERE ${BOARD_WHERE})
) WHERE rn <= ?4 ORDER BY item_key, at DESC, id DESC`;

export class D1ItemRepository implements ItemRepository {
  constructor(private readonly db: D1Database) {}

  async find(key: string): Promise<Item | null> {
    const row = await this.db.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<ItemRow>();
    return row ? toItem(row) : null;
  }

  async save(write: ItemWrite): Promise<Item> {
    const { key, note } = write.input;
    const [upserted] = await this.db.batch([
      this.db.prepare(UPSERT_ITEM).bind(...upsertParams(write)),
      this.db.prepare(INSERT_EVENT).bind(write.now, note ?? null, key, HEARTBEAT_NOTE),
    ]);
    const row = upserted?.results[0] as ItemRow | undefined;
    if (!row) throw new Error(`upsert of ${key} returned no row`);
    return toItem(row);
  }

  async loadForSync(project: string, keys: string[]): Promise<SyncRow[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM items
         WHERE (project = ?1 AND in_doc_sync = 1) OR key IN (SELECT value FROM json_each(?2))`)
      .bind(project, JSON.stringify(keys))
      .all<SyncItemRow>();
    return results.map(toSyncRow);
  }

  async applySync(writes: SyncWrite[], closes: SyncRow[], now: string): Promise<void> {
    const upsert = this.db.prepare(SYNC_UPSERT);
    const event = this.db.prepare(SYNC_EVENT);
    const statements = writes.flatMap(({ item, event: change, read }) => [
      upsert.bind(...syncParams(item), read?.updated_at ?? null, read?.live_status_at ?? null),
      ...(change ? [event.bind(item.key, change.at, change.status, DOC_SYNC_SOURCE, change.note)] : []),
    ]);
    if (closes.length > 0) {
      const rows = JSON.stringify(closes.map(({ key, updated_at, live_status_at }) => ({ key, updated_at, live_status_at })));
      statements.push(
        this.db.prepare(CLOSE_EVENTS).bind(rows, now, DOC_SYNC_SOURCE, SYNC_LEFT_NOTE),
        this.db.prepare(CLOSE_ITEMS).bind(rows, now, DOC_SYNC_SOURCE),
      );
    }
    await this.db.batch(statements);
  }

  async listBoard(filter: BoardFilter): Promise<ItemWithEvents[]> {
    const where = [filter.cutoff, filter.project ?? null, filter.type ?? null] as const;
    const [items, events] = await this.db.batch([
      this.db
        .prepare(`SELECT * FROM items WHERE ${BOARD_WHERE} ORDER BY created_at DESC, key`)
        .bind(...where),
      this.db.prepare(BOARD_EVENTS).bind(...where, filter.eventLimit),
    ]);
    return attachEvents((items?.results ?? []) as ItemRow[], (events?.results ?? []) as EventRow[]);
  }

  async eventsFor(key: string): Promise<ItemEvent[]> {
    const { results } = await this.db
      .prepare("SELECT at, status, source, note FROM events WHERE item_key = ?1 ORDER BY at DESC, id DESC")
      .bind(key)
      .all<ItemEvent>();
    return results;
  }
}

function upsertParams({ insert, input, now }: ItemWrite): (string | number | null)[] {
  return [
    insert.key, insert.project, insert.parent, insert.type, insert.priority, insert.status, insert.title,
    insert.why, insert.details_md, JSON.stringify(insert.links), insert.source, now, insert.done_at,
    ...CHANGEABLE_COLUMNS.flatMap((col) => givenParams(input, col)),
  ];
}

function syncParams(i: SyncRow): (string | number | null)[] {
  return [
    i.key, i.project, i.parent, i.type, i.priority, i.status, i.title, i.why, JSON.stringify(i.links),
    i.source, i.heartbeat_at, i.created_at, i.updated_at, i.done_at, i.in_doc_sync ? 1 : 0,
    i.doc_status, i.doc_status_at, i.live_status_at,
  ];
}

/** [flag, value]: left out = not given, null = clear (links clear to an empty list). */
function givenParams(input: ReportInput, col: ChangeableColumn): [number, string | null] {
  const value = input[col];
  if (value === undefined) return [0, null];
  if (col === "links") return [1, JSON.stringify(value ?? [])];
  return [1, value as string | null];
}

/** The public item: the sync's internal columns are dropped. */
function toItem(row: ItemRow): Item {
  const item: ItemRow & Partial<SyncItemRow> = { ...row };
  for (const column of SYNC_COLUMNS) delete item[column];
  return {
    ...item,
    type: row.type as ItemType,
    priority: row.priority as Priority,
    status: row.status as ItemStatus,
    links: JSON.parse(row.links) as Item["links"],
  };
}

function toSyncRow(row: SyncItemRow): SyncRow {
  return {
    ...toItem(row),
    in_doc_sync: row.in_doc_sync === 1,
    doc_status: row.doc_status as ItemStatus | null,
    doc_status_at: row.doc_status_at,
    live_status_at: row.live_status_at,
  };
}

function attachEvents(items: ItemRow[], events: EventRow[]): ItemWithEvents[] {
  const byKey = new Map<string, ItemEvent[]>();
  for (const { item_key, ...event } of events) {
    byKey.set(item_key, [...(byKey.get(item_key) ?? []), event]);
  }
  return items.map((row) => ({ ...toItem(row), events: byKey.get(row.key) ?? [] }));
}
