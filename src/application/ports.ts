import type { Item, ItemEvent, ItemType, ItemWithEvents } from "../domain/item";
import type { ReportInput } from "../domain/upsert";

export const LIST_EVENT_LIMIT = 20;

export interface BoardFilter {
  project?: string;
  type?: ItemType;
  /** Done items count only when done_at is later than this ISO time. */
  cutoff: string;
  eventLimit: number;
}

export interface ItemWrite {
  /** The row to insert when the key is new (defaults filled). */
  insert: Item;
  /** What the caller gave; on an existing key only these fields change, decided in SQL. */
  input: ReportInput;
  now: string;
}

export interface ItemRepository {
  find(key: string): Promise<Item | null>;
  /**
   * One atomic upsert plus its event row in one batch: writes only the given fields, never
   * touches created_at, and sets or clears done_at from the status change. SQL decides whether
   * anything changed (and so the event note); the item returned is the stored row.
   */
  save(write: ItemWrite): Promise<Item>;
  listBoard(filter: BoardFilter): Promise<ItemWithEvents[]>;
  /** Newest first, all events. */
  eventsFor(key: string): Promise<ItemEvent[]>;
}
