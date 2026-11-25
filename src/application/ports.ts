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
  /**
   * Also list the parts and not-done checks of a listed slice, whatever the type filter (the board page needs them for
   * a slice's bar and its checks); `list_open` leaves them out, since a part has no tile (Slice 34).
   */
  withRiders: boolean;
}

/** A board item plus the two stored times the expiry rule needs, which an Item does not carry (Slice 10). */
export interface BoardRow extends ItemWithEvents {
  expiry: Pick<ExpiryRow, "doc_status_at" | "live_status_at">;
  /** Whether the last doc sync listed the item and the status it gave; a part that left the documents is told by these (Slice 11). */
  docSync: { in_doc_sync: boolean; doc_status: ItemStatus | null };
  /** For a listed bug or problem whose `parent_key` names a slice: that slice, read even when the slice itself is not listed, so the chip keeps its number (Slice 34). */
  parentSlice?: { key: string; title: string } | null;
}

/** Heartbeats older than `cutoff` have expired; a session card's own, shorter expiry is `sessionCutoff` (Slice 13). */
export interface StaleCutoffs {
  cutoff: string;
  sessionCutoff: string;
  /** A waiting card with no slice behind it whose last report is older than this is closed (Slice 34). */
  waitingCutoff: string;
}

/** What one stale pass did: items turned stale, and waiting cards closed after 24 hours (Slice 34). */
export interface StaleResult {
  stale: number;
  waitingClosed: number;
}

/** What one doc-sync batch did: the keys whose write took effect (a write the stale-read guard skipped is not in it) and how many rows it closed. */
export interface SyncApplied {
  written: ReadonlySet<string>;
  closed: number;
}

export interface ItemWrite {
  /** The row to insert when the key is new (defaults filled). */
  insert: Item;
  /** What the caller gave; on an existing key only these fields change, decided in SQL. */
  input: ReportInput;
  now: string;
  /**
   * Compare-and-swap for an `under_step` write: when set (even to null), the row is written only while
   * its stored steps text still equals this, else `save` throws `StepsChangedError` and writes nothing.
   */
  ifStepsText?: string | null;
}

/** A report named an archived key: `save` wrote nothing (a report never brings an archived item back; Slice 50). */
export class ArchivedItemError extends Error {
  constructor(readonly key: string) {
    super(`${key} is archived`);
  }
}

/** A guarded save found the stored steps changed since they were read (Slice 39). */
export class StepsChangedError extends Error {
  constructor() {
    super("the steps changed since they were read");
  }
}

/** An item with the raw steps column it was read with, the token a guarded `save` compares. */
export interface ItemWithStepsText {
  item: Item | null;
  stepsText: string | null;
}

export interface ItemRepository {
  find(key: string): Promise<Item | null>;
  /** `find` plus whether the last doc sync lists the item, read in the same statement (Slice 45). */
  findWithDocSync(key: string): Promise<{ item: Item | null; inDocSync: boolean }>;
  /** `find` plus the raw stored steps text, read in the same statement. */
  findWithStepsText(key: string): Promise<ItemWithStepsText>;
  /**
   * The item at `key`, then its parent, then that one's parent, nearest first, at most `limit` items, in one read
   * (Slice 48 9). It ends at a missing item or a key already listed, so a stored loop ends the walk.
   */
  findChain(key: string, limit: number): Promise<Item[]>;
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
   * Returns what took effect, so the summary counts only that. The closes go in chunks of
   * `CLOSE_CHUNK_ROWS` rows or `CLOSE_CHUNK_BYTES` bytes (one JSON parameter each), all inside the same batch.
   */
  applySync(writes: SyncWrite[], closes: SyncRow[], now: string): Promise<SyncApplied>;
  /**
   * One atomic batch: a history event (status stale) for every item whose heartbeat is older
   * than the cutoff and whose shown status is a live one, then those items set to stale. Both
   * statements carry the rule, so a report that lands in between is never overwritten; items
   * already stale no longer match, so a second run writes nothing. Returns how many turned stale.
   * The same batch closes the waiting cards that have no slice behind them and are past
   * `waitingCutoff` (status done, one history row each); those are counted apart, in `waitingClosed`.
   */
  markStale(cutoffs: StaleCutoffs, now: string): Promise<StaleResult>;
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

export interface SessionWindow {
  environment: string;
  start: string;
  end: string;
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
   * Session cards that named an environment (Slice 16): per card, its first report to its last
   * (the board's own stale marks are not reports), for cards last reported at or after `from`,
   * newest `limit` of each environment (by `environmentIdentity`) only, and only for environments with no series of their own (they report no tokens).
   */
  sessionWindowsFrom(from: string, limit: number): Promise<SessionWindow[]>;
  /**
   * Deletes samples older than the cutoff down to the last of each hour per agent, model and
   * environment, always keeping every restart sample and the one before it, so the use worked
   * out afterwards is the same. A second run deletes nothing more. Returns how many were deleted.
   */
  thinUsage(cutoff: string): Promise<number>;
}
