import { PURGE_CHUNK_ROWS, PURGE_MAX_CHUNKS, purgeCutoff } from "../domain/archive";
import type { SyncRow, SyncWrite } from "../domain/docSync";
import { type Item, type ItemEvent, ItemType, type ItemWithEvents } from "../domain/item";
import { DomainError } from "../domain/upsert";
import type { Clock } from "./board";
import type { ItemRepository, SyncApplied } from "./ports";

/** What one archive-aware batch did: the sync counts, plus how many rows were archived (an item and its parts and checks). */
export interface BatchApplied extends SyncApplied {
  archived: number;
}

/** A page of a project's top-level doc-sync rows and the stored parts and checks under them. */
export interface SyncedPage {
  rows: SyncRow[];
  children: SyncRow[];
}

/**
 * What archiving, the batch write and the purge need from storage (Slice 50). Kept apart from `ItemRepository`, which
 * the older tools use; `D1ItemRepository` implements both.
 */
export interface ArchiveRepository {
  /** The item at `key` whatever its archive state, with the time it was archived (null when it is live). */
  findWithArchive(key: string): Promise<{ item: Item | null; archivedAt: string | null }>;
  /**
   * `applySync` plus the archive of `archiveKeys` and the parts and checks under them, in the one atomic batch: a failure
   * leaves nothing half applied. An already archived row keeps its first time, so the 30 days never restart on a repeat.
   */
  applyBatch(writes: SyncWrite[], closes: SyncRow[], archive: ArchiveRequest, now: string): Promise<BatchApplied>;
  /** Up to `limit` live top-level doc-sync rows of the project with a key after `afterKey`, by key, with their stored parts and checks. */
  syncedPage(project: string, afterKey: string | null, limit: number): Promise<SyncedPage>;
  /**
   * Removes up to `limit` items archived before `cutoff` with their events, in one batch; returns how many items went and
   * how many other (not doc-synced) rows lost their link to one of them.
   */
  purgeArchived(cutoff: string, limit: number): Promise<PurgeCounts>;
}

/** What one purge chunk did. */
export interface PurgeCounts {
  removed: number;
  unlinked: number;
}

/**
 * The keys an archive names and whether the caller may write plan items. The permission is checked inside the archive
 * statement, never only on an earlier read: without the sync scope the statement archives nothing when any row it would take is doc-synced.
 */
export interface ArchiveRequest {
  keys: string[];
  canSync: boolean;
}

export enum ArchiveOutcome {
  Archived = "archived",
  AlreadyArchived = "already_archived",
}

export interface ArchiveResult {
  key: string;
  outcome: ArchiveOutcome;
  /** Rows archived: the item and its parts and checks. */
  archived: number;
}

export interface ArchiveItemInput {
  key: string;
}

/** The archive time of the item's row, or an error that names a key no row holds. */
export async function readArchiveTarget(repo: ItemRepository, key: string, project: string | null): Promise<SyncRow> {
  const [row] = (await repo.loadForSync(project ?? "", [key])).filter((stored) => stored.key === key);
  if (!row) throw new DomainError("key", `field key: no item ${key}`);
  if (project !== null && row.project !== project) {
    throw new DomainError("key", `field key: ${key} belongs to project ${row.project}, not ${project}`);
  }
  return row;
}

/** Whether an archive of its parent takes this row: a plan-owned row (doc-synced, or a part or check); a live card is left alone. */
function isPlanOwned(row: SyncRow): boolean {
  return row.in_doc_sync || row.type === ItemType.Part || row.type === ItemType.Check;
}

/**
 * The live doc-synced rows an archive of `row` takes (recursive on `parent_key`, through plan-owned rows only, like the
 * archive statement). This early read only words the refusal; the statement itself holds the rule.
 */
export function docSyncChildren(row: SyncRow, stored: Iterable<SyncRow>): SyncRow[] {
  const rows = [...stored];
  const found = new Map<string, SyncRow>();
  const queue = [row.key];
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    for (const child of rows) {
      if (child.parent_key !== key || child.key === row.key || found.has(child.key) || !isPlanOwned(child)) continue;
      found.set(child.key, child);
      queue.push(child.key);
    }
  }
  return [...found.values()].filter((child) => child.in_doc_sync && !child.archived_at);
}

/** The refusal of an archive the statement itself did not carry out (nothing was changed). */
export function archiveRefused(key: string): DomainError {
  return new DomainError("key", `forbidden: ${key} or an item under it comes from the plan documents; archiving it needs the static write token`);
}

/**
 * An item that comes from the plan documents is archived only by a caller that may write them (the sync token). So is
 * an item with doc-synced parts or checks under it, since archiving it takes them too (`children`, from `docSyncChildren`).
 */
export function assertMayArchive(row: SyncRow, canSync: boolean, children: SyncRow[]): void {
  if (canSync) return;
  if (row.in_doc_sync) {
    throw new DomainError("key", `forbidden: ${row.key} comes from the plan documents; archiving it needs the static write token`);
  }
  if (children.length > 0) {
    throw new DomainError("key", `forbidden: ${row.key} has items under it that come from the plan documents; archiving it needs the static write token`);
  }
}

/**
 * Archives one item with its parts and checks: hidden from the board, `list_open` and every count, kept unchanged, and
 * removed for good 30 days later by the cron. An item that is archived already stays as it is (its 30 days do not restart).
 */
export async function archiveItem(
  repo: ItemRepository & ArchiveRepository,
  input: ArchiveItemInput,
  clock: Clock,
  canSync: boolean,
): Promise<ArchiveResult> {
  const row = await readArchiveTarget(repo, input.key, null);
  assertMayArchive(row, canSync, docSyncChildren(row, await repo.loadForSync(row.project, [input.key])));
  if (row.archived_at) return { key: input.key, outcome: ArchiveOutcome.AlreadyArchived, archived: 0 };
  const applied = await repo.applyBatch([], [], { keys: [input.key], canSync }, clock.now().toISOString());
  if (applied.archived === 0) return afterEmptyArchive(repo, input.key);
  return { key: input.key, outcome: ArchiveOutcome.Archived, archived: applied.archived };
}

/** The archive statement changed nothing: another call archived the item first, or the statement refused a caller without the sync scope. */
async function afterEmptyArchive(repo: ItemRepository & ArchiveRepository, key: string): Promise<ArchiveResult> {
  const { archivedAt } = await repo.findWithArchive(key);
  if (archivedAt === null) throw archiveRefused(key);
  return { key, outcome: ArchiveOutcome.AlreadyArchived, archived: 0 };
}

/** An item with its history, and the time it was archived when it was (`get_item` with `include_archived`). */
export async function getItemWithArchive(
  repo: ItemRepository & ArchiveRepository,
  key: string,
  includeArchived: boolean,
): Promise<ItemWithEvents & { archived_at?: string }> {
  const { item, archivedAt } = await repo.findWithArchive(key);
  if (!item || (archivedAt !== null && !includeArchived)) throw new DomainError("key", `field key: no item ${key}`);
  const events: ItemEvent[] = await repo.eventsFor(key);
  return archivedAt === null ? { ...item, events } : { ...item, events, archived_at: archivedAt };
}

/** The cron's third job: removes items archived more than 30 days ago, in bounded chunks; what is left waits for the next run. */
export async function purgeArchive(repo: ArchiveRepository, clock: Clock): Promise<PurgeCounts> {
  const cutoff = purgeCutoff(clock.now());
  const total: PurgeCounts = { removed: 0, unlinked: 0 };
  for (let chunk = 0; chunk < PURGE_MAX_CHUNKS; chunk += 1) {
    const count = await repo.purgeArchived(cutoff, PURGE_CHUNK_ROWS);
    total.removed += count.removed;
    total.unlinked += count.unlinked;
    if (count.removed < PURGE_CHUNK_ROWS) break;
  }
  return total;
}
