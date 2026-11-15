import type { BoardFilter, ItemRepository, ItemWrite } from "../application/ports";
import {
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

const UPSERT_ITEM = `INSERT INTO items (key, project, parent, type, priority, status, title, why,
  details_md, links, source, heartbeat_at, created_at, updated_at, done_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12, ?13)
  ON CONFLICT (key) DO UPDATE SET ${SET_CHANGEABLE}, heartbeat_at = ?12,
  updated_at = CASE WHEN ${ANY_CHANGED} THEN ?12 ELSE updated_at END,
  done_at = CASE WHEN ${NEXT_STATUS} = 'done'
    THEN CASE WHEN status = 'done' THEN COALESCE(done_at, ?12) ELSE ?12 END
    ELSE NULL END
  RETURNING *`;

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

/** [flag, value]: left out = not given, null = clear (links clear to an empty list). */
function givenParams(input: ReportInput, col: ChangeableColumn): [number, string | null] {
  const value = input[col];
  if (value === undefined) return [0, null];
  if (col === "links") return [1, JSON.stringify(value ?? [])];
  return [1, value as string | null];
}

function toItem(row: ItemRow): Item {
  return {
    ...row,
    type: row.type as ItemType,
    priority: row.priority as Priority,
    status: row.status as ItemStatus,
    links: JSON.parse(row.links) as Item["links"],
  };
}

function attachEvents(items: ItemRow[], events: EventRow[]): ItemWithEvents[] {
  const byKey = new Map<string, ItemEvent[]>();
  for (const { item_key, ...event } of events) {
    byKey.set(item_key, [...(byKey.get(item_key) ?? []), event]);
  }
  return items.map((row) => ({ ...toItem(row), events: byKey.get(row.key) ?? [] }));
}
