import type { CapReading } from "../domain/cap";
import type { SyncRow, SyncWrite } from "../domain/docSync";
import type { Item, ItemEvent, ItemStatus, ItemType, ItemWithEvents } from "../domain/item";
import type { ExpiryRow } from "../domain/stale";
import type { ReportInput } from "../domain/upsert";
import type { UsageSample } from "../domain/usage";

export const LIST_EVENT_LIMIT = 20;

export interface BoardFilter {
  project?: string;
  type?: ItemType;
  /** Done items count only when done_at is later than this ISO time. */
  cutoff: string;
  eventLimit: number;
}

/** A board item plus the two stored times the expiry rule needs, which an Item does not carry (Slice 10). */
export interface BoardRow extends ItemWithEvents {
  expiry: Pick<ExpiryRow, "doc_status_at" | "live_status_at">;
  /** Whether the last doc sync listed the item and the status it gave; a part that left the documents is told by these (Slice 11). */
  docSync: { in_doc_sync: boolean; doc_status: ItemStatus | null };
}

/** Heartbeats older than `cutoff` have expired; a session card's own, shorter expiry is `sessionCutoff` (Slice 13). */
export interface StaleCutoffs {
  cutoff: string;
  sessionCutoff: string;
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
  markStale(cutoffs: StaleCutoffs, now: string): Promise<number>;
  listBoard(filter: BoardFilter): Promise<BoardRow[]>;
  /** Newest first, all events. */
  eventsFor(key: string): Promise<ItemEvent[]>;
}

export enum SeriesKind {
  Model = "model",
  AgentKind = "agent_kind",
  Environment = "environment",
}

export interface SeriesName {
  kind: SeriesKind;
  value: string;
}

export interface TaskInfo {
  key: string;
  title: string;
  project: string;
}

/** What the usage tools and the usage route need from storage (Slice 8). Append-only: rows are never updated. */
export interface UsageRepository {
  /**
   * One batch: the sample (INSERT OR IGNORE on agent key, model, environment and record time, so
   * the same report twice stores one row) plus a usage_series row for each name it carries.
   * Returns true when the sample was new, false when it was already stored.
   */
  saveUsage(sample: UsageSample, now: string): Promise<boolean>;
  /** One atomic batch of INSERT OR IGNORE rows (time taken, plan, window kind); returns how many were new. */
  saveCapReadings(readings: CapReading[]): Promise<number>;
  /**
   * The samples at or after `from`, plus per series the newest one before it (the sample the
   * first delta in range subtracts from). A series with no sample in range is not read. Every
   * stored time is UTC ISO (normalised before the write), so text order is time order.
   */
  usageSamplesFrom(from: string): Promise<UsageSample[]>;
  capReadingsFrom(from: string): Promise<CapReading[]>;
  /** Model, agent kind and environment names by first seen, then by value. */
  seriesNames(): Promise<SeriesName[]>;
  taskInfo(keys: string[]): Promise<TaskInfo[]>;
  /**
   * Deletes samples older than the cutoff down to the last of each hour per agent, model and
   * environment, always keeping every restart sample and the one before it, so the use worked
   * out afterwards is the same. A second run deletes nothing more. Returns how many were deleted.
   */
  thinUsage(cutoff: string): Promise<number>;
}
