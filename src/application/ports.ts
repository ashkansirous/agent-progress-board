import type { SyncRow, SyncWrite } from "../domain/docSync";
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
  /** Every item of the project plus any item with one of the keys (whatever its project). */
  loadForSync(project: string, keys: string[]): Promise<SyncRow[]>;
  /**
   * The writes plus the close of the given rows (set-based, a fixed number of statements) in
   * one atomic batch: a failure leaves nothing half applied. Each write and close applies only
   * while its row still matches what was read, so a live report in between is never undone.
   */
  applySync(writes: SyncWrite[], closes: SyncRow[], now: string): Promise<void>;
  /**
   * One atomic batch: a history event (status stale) for every item whose heartbeat is older
   * than the cutoff and whose shown status is a live one, then those items set to stale. Both
   * statements carry the rule, so a report that lands in between is never overwritten; items
   * already stale no longer match, so a second run writes nothing. Returns how many turned stale.
   */
  markStale(cutoff: string, now: string): Promise<number>;
  listBoard(filter: BoardFilter): Promise<ItemWithEvents[]>;
  /** Newest first, all events. */
  eventsFor(key: string): Promise<ItemEvent[]>;
}
