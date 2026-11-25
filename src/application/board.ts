import {
  assertSameProject,
  BatchOp,
  closeTargets,
  keepsDoneForChecks,
  MAX_BATCH_ITEMS,
  MAX_EXPANDED_ITEMS,
  planItem,
  type SnapshotItem,
  type SyncedEntry,
  type SyncRow,
  syncedEntries,
  type SyncWrite,
  validateSnapshot,
} from "../domain/docSync";
import { type ArchiveRepository, archiveRefused, assertMayArchive, type BatchApplied, docSyncChildren } from "./archive";
import { type Item, ItemStatus, ItemType, type ItemWithEvents } from "../domain/item";
import { ancestorKeys, isCountedCheck, itemProblem, MAX_PARENT_DEPTH, nestedChecks, type ParentRef } from "../domain/checks";
import { expandParts } from "../domain/parts";
import { DEFAULT_STALE_AFTER_MINUTES, expiryMinutesFor, hasOpenQuestion, SESSION_AGENT, staleCutoff, waitingCutoff } from "../domain/stale";
import { checkReport, DomainError, newItem, type ReportInput, withQuestion } from "../domain/upsert";
import { attachStepCosts, type StepRun, stepRunCutoff, stepRunsOf } from "../domain/stepRuns";
import type { Step } from "../domain/stepTypes";
import { resolveWindowHours, type WindowConfig, windowCutoff } from "../domain/window";
import { ArchivedItemError, type BoardRow, type ItemRepository, LIST_EVENT_LIMIT, type StaleResult, StepsChangedError } from "./ports";

export type AskHumanInput = Omit<ReportInput, "type" | "status">;

export interface MarkDoneInput {
  key: string;
  source?: string | null;
  note?: string;
}

export interface ListOpenInput {
  project?: string;
  type?: ItemType;
  window_hours?: number;
}

export interface Clock {
  now(): Date;
}

export async function reportProgress(
  repo: ItemRepository,
  input: ReportInput,
  clock: Clock,
): Promise<Item> {
  if (input.under_step !== undefined || input.steps !== undefined) return saveStepsReport(repo, input, clock);
  return saveReport(repo, input, await repo.find(input.key), clock);
}

/** Tries of a read-modify-write of the steps column before the report is refused as busy. */
export const UNDER_STEP_TRIES = 5;

/** Longest random wait between two tries, so helpers that collided do not retry in step; 5 tries stay well under a second. */
const UNDER_STEP_BACKOFF_MS = 40;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every write of the steps column (a whole list or an `under_step` subtree) is built from one read of the
 * stored tree, so it is a compare-and-swap: the write applies only while the stored steps are the ones read,
 * else it re-reads and re-merges the kept children (a few bounded tries), so a whole-list report never drops
 * a helper's concurrent subtree and two helpers reporting at once both survive (Slice 39).
 */
async function saveStepsReport(repo: ItemRepository, input: ReportInput, clock: Clock): Promise<Item> {
  for (let attempt = 0; attempt < UNDER_STEP_TRIES; attempt += 1) {
    const { item, stepsText } = await repo.findWithStepsText(input.key);
    try {
      // The type, project and parent rules do not depend on the steps, so a retry does not repeat their reads (Slice 47 2e).
      return await saveReport(repo, input, item, clock, stepsText, attempt > 0);
    } catch (error) {
      if (!(error instanceof StepsChangedError)) throw error;
    }
    await pause(Math.random() * UNDER_STEP_BACKOFF_MS);
  }
  const field = input.under_step === undefined ? "steps" : "under_step";
  throw new DomainError(
    field,
    `field ${field}: temporary, other helpers kept changing the steps and nothing was saved; send the same report again`,
    true,
  );
}

/** `reportProgress` for a caller that has already read the stored item (one find per call); `stepsText` guards the write when given. */
async function saveReport(
  repo: ItemRepository,
  input: ReportInput,
  existing: Item | null,
  clock: Clock,
  stepsText?: string | null,
  alreadyFitted = false,
): Promise<Item> {
  const now = clock.now().toISOString();
  const costs = new Map<string, unknown>();
  const checked = withQuestion(checkReport(input, existing, now, costs), existing, now);
  if (!alreadyFitted) await assertItemFits(repo, checked, existing);
  try {
    // The costs ride on the steps the report sent, found by the id each step resolved to; the rows join them with the step as built (its times and their sources).
    const stepRuns = stepRunsOf(input.key, costs, checked.steps as Step[] | null | undefined, now);
    return await repo.save({ insert: existing ?? newItem(checked, now), input: checked, now, ifStepsText: stepsText, stepRuns });
  } catch (error) {
    if (error instanceof ArchivedItemError) throw archivedReply(error.key);
    throw error;
  }
}

/** The refusal of a report on an archived key: nothing was written, and the reply says how to bring the item back (Slice 50). */
function archivedReply(key: string): DomainError {
  return new DomainError(
    "key",
    `field key: ${key} is archived, so this report was not saved; a report does not bring an item back. Upsert it with upsert_item (needs the static write token) to restore it`,
  );
}

/**
 * The report's final state (the stored row with the report laid over it) must pass `itemProblem`, so a
 * retype or re-parent of an existing item is checked like a new one. A parent that does not exist yet is
 * allowed (a live report may arrive before the document snapshot lists the slice). A report that leaves the
 * stored type, project and parent as they are returns at once: a legacy row stored before the rules existed keeps
 * accepting reports, while a snapshot skips it (Slice 47 3k).
 */
async function assertItemFits(repo: ItemRepository, input: ReportInput, existing: Item | null): Promise<void> {
  if (existing && !changesRelation(input, existing)) return;
  const parentKey = input.parent_key === undefined ? existing?.parent_key : input.parent_key;
  const parents = await loadParents(repo, parentKey);
  const parent = parentKey ? parentRef(parents.get(parentKey), (key) => parents.get(key)?.parent_key) : null;
  const state = { key: input.key, type: input.type ?? existing?.type, parent_key: parentKey };
  const reason = itemProblem(state, parent, input.project ?? existing?.project);
  if (reason) throw problemError(reason);
}

/**
 * Whether a report changes the stored item's type, project or parent: a heartbeat or status report does not, so
 * a legacy row stored before the rules existed is never refused for something the report leaves as it was.
 */
function changesRelation(input: ReportInput, existing: Item): boolean {
  return (
    (input.type !== undefined && input.type !== existing.type) ||
    (input.project !== undefined && input.project !== existing.project) ||
    (input.parent_key !== undefined && input.parent_key !== existing.parent_key)
  );
}

/** The parent and its ancestors by key, read in one query up to `MAX_PARENT_DEPTH` (a stored loop ends the walk). */
async function loadParents(repo: ItemRepository, start: string | null | undefined): Promise<Map<string, Item>> {
  if (!start) return new Map();
  const chain = await repo.findChain(start, MAX_PARENT_DEPTH);
  return new Map(chain.map((row) => [row.key, row]));
}

/** A rule's reason as the error a tool returns: the reason names its field before the colon. */
function problemError(reason: string): DomainError {
  return new DomainError(reason.slice(0, reason.indexOf(":")), `field ${reason}`);
}

export async function markDone(
  repo: ItemRepository,
  input: MarkDoneInput,
  clock: Clock,
): Promise<Item> {
  const existing = await repo.find(input.key);
  if (!existing) throw new DomainError("key", `field key: no item ${input.key}`);
  return saveReport(repo, { ...input, status: ItemStatus.Done }, existing, clock);
}

/** The stale window, or a getter read only when an ask on another type's item needs it, so a config error cannot fail a create (Slice 45). */
type StaleAfter = number | (() => number);

export async function askHuman(
  repo: ItemRepository,
  input: AskHumanInput,
  clock: Clock,
  staleAfterMinutes: StaleAfter = DEFAULT_STALE_AFTER_MINUTES,
): Promise<Item> {
  const { item: existing, inDocSync } = await repo.findWithDocSync(input.key);
  if (existing && existing.type !== ItemType.WaitingForMe) return askOnItem(repo, existing, inDocSync, input, clock, staleAfterMinutes);
  const report: ReportInput = { ...input, type: ItemType.WaitingForMe, status: ItemStatus.Open };
  return saveReport(repo, report, existing, clock);
}

/**
 * A question on an item of another type (Slice 13): the item keeps its type, status and title and
 * gets `needs_you` (the question: `needs_you`, else `why`, else the title) and `after_answer`, so the
 * session stays one card. Only the question fields (`needs_you`, `after_answer`, `why`) are passed on;
 * project, links, source and the rest of the ask are ignored, and every other stored field is kept. A done item, a part and a doc-synced item cannot be asked
 * on (the documents own them). With no text of its own the ask keeps an open question as stored.
 */
async function askOnItem(
  repo: ItemRepository,
  existing: Item,
  inDocSync: boolean,
  input: AskHumanInput,
  clock: Clock,
  staleAfter: StaleAfter,
): Promise<Item> {
  if (existing.status === ItemStatus.Done) {
    throw new DomainError("key", `field key: item ${input.key} is done, so ask_human cannot ask on it`);
  }
  if (existing.type === ItemType.Part || inDocSync) {
    throw new DomainError("key", `field key: item ${input.key} is a part or comes from the plan documents, so ask_human cannot ask on it`);
  }
  const { key, title, why, needs_you, after_answer } = input;
  if (needs_you === null) return saveReport(repo, { key, why, needs_you: null }, existing, clock);
  if (needs_you?.trim()) return saveReport(repo, { key, why, needs_you, after_answer }, existing, clock);
  const kept = hasOpenQuestion(existing, typeof staleAfter === "function" ? staleAfter() : staleAfter, clock.now()) ? existing.needs_you : null;
  const question = why?.trim() ? why : (kept ?? title);
  return saveReport(repo, { key, needs_you: question, after_answer }, existing, clock);
}

export interface SyncSnapshotInput {
  project: string;
  items: SnapshotItem[];
}

export interface SyncSummary {
  project: string;
  created: number;
  updated: number;
  closed: number;
  unchanged: number;
  /** Items whose write the stale-read guard skipped because the row moved since the read: resend the snapshot to apply them. */
  raced: number;
  /** Items the sync did not save, each with the reason; everything else was saved. */
  skipped: SkippedItem[];
}

export interface SkippedItem {
  key: string;
  reason: string;
}

/**
 * The keys of the snapshot items that still list a check to do (Slice 51): a check the store has not seen, or one it
 * holds in a counted state (`isCountedCheck`). A check the owner has done, or the docs dropped, no longer keeps a done slice done.
 */
function slicesWithOpenChecks(
  items: SnapshotItem[],
  kept: ReadonlySet<string>,
  stored: Map<string, SyncRow>,
  now: string,
): Set<string> {
  const heldRow = (check: SnapshotItem) => {
    const row = stored.get(check.key);
    return row !== undefined && isCountedCheck(row.status);
  };
  const stays = (slice: SnapshotItem) => {
    const checks = nestedChecks(slice);
    const applied = checks.filter((check) => kept.has(check.key));
    return keepsDoneForChecks(applied, stored, now) || checks.some((check) => !kept.has(check.key) && heldRow(check));
  };
  return new Set(items.filter(stays).map((item) => item.key));
}

/** One project's full doc-sync set: merge each item, close the ones that left, one batch. */
export async function syncSnapshot(
  repo: ItemRepository,
  input: SyncSnapshotInput,
  clock: Clock,
): Promise<SyncSummary> {
  validateSnapshot(input.project, input.items);
  const groups = input.items.map((item) => ({ item, members: expandParts([item, ...nestedChecks(item)]) }));
  const candidates = groups.flatMap((group) => group.members);
  if (candidates.length > MAX_EXPANDED_ITEMS) {
    throw new DomainError("items", `field items: at most ${MAX_EXPANDED_ITEMS} items per snapshot after parts and checks, got ${candidates.length}`);
  }
  const now = clock.now().toISOString();
  const stored = await repo.loadForSync(input.project, loadKeys(candidates));
  const byKey = new Map(stored.map((item) => [item.key, item]));
  for (const candidate of candidates) assertSameProject(byKey.get(candidate.key), input.project);
  const { items, skipped, held } = screenSnapshot(input.project, groups, byKey);
  const withChecks = slicesWithOpenChecks(input.items, new Set(items.map((item) => item.key)), byKey, now);
  const merges = items.map((snap) => ({
    existed: byKey.has(snap.key),
    write: planItem(byKey.get(snap.key), snap, input.project, now, withChecks.has(snap.key)),
  }));
  const skippedKeys = new Set(skipped.map((entry) => entry.key));
  const listed = new Set([...items.map((item) => item.key), ...skippedKeys, ...held]);
  const keepsParts = (item: SnapshotItem) => item.parts === undefined || skippedKeys.has(item.key);
  const keepsChecks = (item: SnapshotItem) => item.checks === undefined || skippedKeys.has(item.key);
  const partless = new Set(input.items.filter(keepsParts).map((item) => item.key));
  const checkless = new Set(input.items.filter(keepsChecks).map((item) => item.key));
  const closes = closeTargets(stored, input.project, listed, partless, checkless);
  const changed = merges.flatMap((m) => (m.write ? [m.write] : []));
  const applied =
    changed.length > 0 || closes.length > 0 ? await repo.applySync(changed, closes, now) : { written: new Set<string>(), closed: 0 };
  const wrote = merges.filter((m) => m.write && applied.written.has(m.write.item.key));
  const created = wrote.filter((m) => !m.existed).length;
  return {
    project: input.project,
    created,
    updated: wrote.length - created,
    closed: applied.closed,
    unchanged: merges.length - changed.length,
    raced: changed.length - wrote.length,
    skipped,
  };
}

/** One operation of `apply_batch`: an upsert carries the whole item, a close or archive only its key. */
export type BatchOperation =
  | { op: BatchOp.Upsert; item: SnapshotItem }
  | { op: BatchOp.Close; key: string }
  | { op: BatchOp.Archive; key: string };

export interface ApplyBatchInput {
  project: string;
  operations: BatchOperation[];
}

export enum OpOutcome {
  Created = "created",
  Updated = "updated",
  Unchanged = "unchanged",
  /** The write found the row changed since it was read and left it: send the operation again. */
  Raced = "raced",
  Closed = "closed",
  AlreadyClosed = "already_closed",
  Archived = "archived",
  AlreadyArchived = "already_archived",
}

export interface OpResult {
  op: BatchOp;
  key: string;
  outcome: OpOutcome;
}

export interface BatchSummary {
  project: string;
  /** One line per operation, in the order sent. */
  results: OpResult[];
  created: number;
  updated: number;
  unchanged: number;
  /** Rows closed: the operations' own and the parts and checks left out of an upserted slice's lists. */
  closed: number;
  /** Rows archived: each item with its parts and checks. */
  archived: number;
  /** Writes the stale-read guard left because their row moved since it was read: send the batch again to apply them. */
  raced: number;
}

/** What a caller that may not write plan documents is told when a batch holds an upsert or a close. */
const BATCH_FORBIDDEN = "forbidden: apply_batch upsert and close operations need the static write token";

type BatchRepository = ItemRepository & ArchiveRepository;

/** The operation's key: an upsert's item key, else the operation's own. */
function opKey(operation: BatchOperation): string {
  return operation.op === BatchOp.Upsert ? operation.item.key : operation.key;
}

/** Refuses a batch that names one key twice or holds more than `MAX_BATCH_ITEMS` items once parts and checks are expanded (the count includes closes and archives). */
function assertBatchShape(operations: BatchOperation[], expanded: number): void {
  const seen = new Set<string>();
  operations.forEach((operation, index) => {
    const key = opKey(operation);
    if (seen.has(key)) throw new DomainError("operations", `field operations: operation ${index} repeats key ${key}`);
    seen.add(key);
  });
  if (expanded > MAX_BATCH_ITEMS) {
    throw new DomainError("operations", `field operations: at most ${MAX_BATCH_ITEMS} items per call after parts and checks, got ${expanded}`);
  }
}

/**
 * Add, update, close and archive in one atomic batch (Slice 50). Nothing relies on absence: only the items an upsert names
 * are written, and only the keys a close names are closed (with their parts and checks), so a partial run never closes
 * anything wrongly. A bad operation refuses the whole call and names its key. Upserts and closes write plan documents, so
 * they need the sync token (`canSync`); an archive needs it only for an item the documents own.
 */
export async function applyBatch(repo: BatchRepository, input: ApplyBatchInput, clock: Clock, canSync: boolean): Promise<BatchSummary> {
  const { project, operations } = input;
  const upserts = operations.flatMap((operation) => (operation.op === BatchOp.Upsert ? [operation.item] : []));
  validateSnapshot(project, upserts, upserts.length);
  const groups = upserts.map((item) => ({ item, members: expandParts([item, ...nestedChecks(item)]) }));
  const candidates = groups.flatMap((group) => group.members);
  assertBatchShape(operations, candidates.length + operations.length - upserts.length);
  if (!canSync && operations.some((operation) => operation.op !== BatchOp.Archive)) throw new DomainError("operations", BATCH_FORBIDDEN);
  const now = clock.now().toISOString();
  const named = operations.filter((operation) => operation.op !== BatchOp.Upsert).map(opKey);
  const stored = await repo.loadForSync(project, [...loadKeys(candidates), ...named]);
  const byKey = new Map(stored.map((row) => [row.key, row]));
  for (const candidate of candidates) assertSameProject(byKey.get(candidate.key), project);
  const plan = planBatch(project, operations, groups, byKey, now, canSync);
  const applied = await repo.applyBatch(plan.writes, plan.closes, { keys: plan.archiveKeys, canSync }, now);
  if (!canSync && plan.archiveKeys.length > 0 && applied.archived === 0) throw archiveRefused(plan.archiveKeys.join(", "));
  return summarise(project, plan, applied);
}

/** Everything a batch will write, worked out from one read, before any write. */
interface BatchPlan {
  operations: BatchOperation[];
  merges: { key: string; existed: boolean; write: SyncWrite | null }[];
  writes: SyncWrite[];
  closes: SyncRow[];
  /** Keys of the close operations whose row was still in the documents (the others were closed before). */
  closeKeys: Set<string>;
  archiveKeys: string[];
  alreadyArchived: Set<string>;
}

function planBatch(
  project: string,
  operations: BatchOperation[],
  groups: SnapshotGroup[],
  byKey: Map<string, SyncRow>,
  now: string,
  canSync: boolean,
): BatchPlan {
  const { items, skipped } = screenSnapshot(project, groups, byKey);
  const first = skipped[0];
  if (first) throw new DomainError("operations", `field operations: ${first.key} is refused: ${first.reason}`);
  const withChecks = slicesWithOpenChecks(groups.map((group) => group.item), new Set(items.map((item) => item.key)), byKey, now);
  const merges = items.map((snap) => ({
    key: snap.key,
    existed: byKey.has(snap.key),
    write: planItem(byKey.get(snap.key), snap, project, now, withChecks.has(snap.key), true),
  }));
  const listed = new Set(items.map((item) => item.key));
  const tops = groups.map((group) => group.item);
  const keepParts = new Set(tops.filter((i) => i.parts === undefined).map((i) => i.key));
  const keepChecks = new Set(tops.filter((i) => i.checks === undefined).map((i) => i.key));
  const leftOut = closeTargets(childrenOf(tops, byKey), project, listed, keepParts, keepChecks);
  const writes = merges.flatMap((merge) => (merge.write ? [merge.write] : []));
  const closing = closeOperations(project, operations, byKey);
  const closes = [...new Map([...leftOut, ...closing.rows].map((row) => [row.key, row])).values()];
  const archives = archiveOperations(project, operations, byKey, canSync);
  return { operations, merges, writes, closes, closeKeys: closing.keys, ...archives };
}

/** The stored doc-sync parts and checks of the slices an upsert names. */
function childrenOf(tops: SnapshotItem[], byKey: Map<string, SyncRow>): SyncRow[] {
  const parents = new Set(tops.map((item) => item.key));
  const isChild = (row: SyncRow): boolean => row.type === ItemType.Part || row.type === ItemType.Check;
  return [...byKey.values()].filter((row) => isChild(row) && parents.has(row.parent_key ?? ""));
}

/** The row a close or archive names: it must exist in this project. */
function namedRow(project: string, key: string, byKey: Map<string, SyncRow>): SyncRow {
  const row = byKey.get(key);
  if (!row) throw new DomainError("operations", `field operations: no item ${key}`);
  if (row.project !== project) throw new DomainError("operations", `field operations: ${key} belongs to project ${row.project}, not ${project}`);
  return row;
}

/** A close takes the item and its stored doc-sync parts and checks; an item the documents no longer hold is left as it is. */
function closeOperations(project: string, operations: BatchOperation[], byKey: Map<string, SyncRow>): { rows: SyncRow[]; keys: Set<string> } {
  const rows: SyncRow[] = [];
  const keys = new Set<string>();
  for (const operation of operations) {
    if (operation.op !== BatchOp.Close) continue;
    const row = namedRow(project, operation.key, byKey);
    if (!row.in_doc_sync || row.archived_at) continue;
    keys.add(row.key);
    rows.push(row, ...[...byKey.values()].filter((child) => child.parent_key === row.key && child.in_doc_sync && !child.archived_at));
  }
  return { rows, keys };
}

function archiveOperations(
  project: string,
  operations: BatchOperation[],
  byKey: Map<string, SyncRow>,
  canSync: boolean,
): { archiveKeys: string[]; alreadyArchived: Set<string> } {
  const archiveKeys: string[] = [];
  const alreadyArchived = new Set<string>();
  for (const operation of operations) {
    if (operation.op !== BatchOp.Archive) continue;
    const row = namedRow(project, operation.key, byKey);
    assertMayArchive(row, canSync, docSyncChildren(row, byKey.values()));
    if (row.archived_at) alreadyArchived.add(row.key);
    else archiveKeys.push(row.key);
  }
  return { archiveKeys, alreadyArchived };
}

function summarise(project: string, plan: BatchPlan, applied: BatchApplied): BatchSummary {
  const merged = new Map(plan.merges.map((merge) => [merge.key, merge]));
  const results = plan.operations.map((operation): OpResult => {
    const key = opKey(operation);
    return { op: operation.op, key, outcome: outcomeOf(operation, plan, applied, merged.get(key)) };
  });
  const count = (outcome: OpOutcome): number => results.filter((result) => result.outcome === outcome).length;
  const lostWrites = results.filter((result) => result.op === BatchOp.Upsert && result.outcome === OpOutcome.Raced).length;
  return {
    project,
    results,
    created: count(OpOutcome.Created),
    updated: count(OpOutcome.Updated),
    unchanged: count(OpOutcome.Unchanged),
    closed: applied.closed,
    archived: applied.archived,
    raced: lostWrites + Math.max(0, plan.closes.length - applied.closed),
  };
}

function outcomeOf(
  operation: BatchOperation,
  plan: BatchPlan,
  applied: BatchApplied,
  merge: BatchPlan["merges"][number] | undefined,
): OpOutcome {
  if (operation.op === BatchOp.Archive) return plan.alreadyArchived.has(operation.key) ? OpOutcome.AlreadyArchived : OpOutcome.Archived;
  if (operation.op === BatchOp.Close) return plan.closeKeys.has(operation.key) ? OpOutcome.Closed : OpOutcome.AlreadyClosed;
  if (!merge?.write) return OpOutcome.Unchanged;
  if (!applied.written.has(merge.key)) return OpOutcome.Raced;
  return merge.existed ? OpOutcome.Updated : OpOutcome.Created;
}

/** One doc-synced item by itself (add or update, with its parts and checks): `apply_batch` with one upsert. */
export async function upsertItem(repo: BatchRepository, item: SnapshotItem, clock: Clock): Promise<OpResult & { raced: number }> {
  const summary = await applyBatch(repo, { project: item.project, operations: [{ op: BatchOp.Upsert, item }] }, clock, true);
  return { ...summary.results[0]!, raced: summary.raced };
}

/** The page size of `list_synced` when the call gives none; 100 entries of at most 200-character keys stay far under the reply limit. */
export const LIST_SYNCED_PAGE = 100;

export interface ListSyncedInput {
  project: string;
  after_key?: string;
  limit?: number;
}

/** A project's live top-level doc-sync items by key with the hash of what the documents last said, one page at a time (Slice 50). */
export async function listSynced(repo: ArchiveRepository, input: ListSyncedInput): Promise<SyncedEntry[]> {
  const page = await repo.syncedPage(input.project, input.after_key ?? null, input.limit ?? LIST_SYNCED_PAGE);
  return syncedEntries(page.rows, page.children);
}

/** The keys one sync loads: every item's own, plus each parent's (read once, in the same query, for the parent checks). */
function loadKeys(items: SnapshotItem[]): string[] {
  const keys = new Set(items.map((item) => item.key));
  for (const item of items) if (item.parent_key) keys.add(item.parent_key);
  return [...keys];
}

/** A snapshot item with the items its parts and checks became (the item first). */
interface SnapshotGroup {
  item: SnapshotItem;
  members: SnapshotItem[];
}

/**
 * Runs `itemProblem` on every item and nested check of a snapshot. An item with a problem is skipped,
 * never thrown (its parts and checks go with it); the rest is kept. A skipped key, and every part and check of a skipped item, is also not closed.
 */
function screenSnapshot(
  project: string,
  groups: SnapshotGroup[],
  stored: Map<string, SyncRow>,
): { items: SnapshotItem[]; skipped: SkippedItem[]; held: Set<string> } {
  const topLevel = new Map(groups.map((group) => [group.item.key, group.item]));
  const reasons = topLevelReasons(project, groups, topLevel, stored);
  const seen = new Set(topLevel.keys());
  const items: SnapshotItem[] = [];
  const skipped: SkippedItem[] = [];
  const held = new Set<string>();
  for (const { item, members } of groups) {
    const reason = reasons.get(item.key);
    if (reason) {
      skipped.push({ key: item.key, reason });
      for (const member of members) held.add(member.key);
      continue;
    }
    const [self, ...children] = members;
    items.push(omitChecks(self!));
    for (const child of children) {
      const childReason = childProblem(project, child, item, seen, stored.get(child.key));
      if (childReason) skipped.push({ key: child.key, reason: childReason });
      else {
        seen.add(child.key);
        items.push(child);
      }
    }
  }
  return { items, skipped, held };
}

/**
 * Each top-level item's problem, if any. A parent named by a sibling is read from that sibling only while the
 * sibling is itself kept, so passes repeat until no more items are skipped (each pass skips at least one or ends).
 */
function topLevelReasons(
  project: string,
  groups: SnapshotGroup[],
  topLevel: Map<string, SnapshotItem>,
  stored: Map<string, SyncRow>,
): Map<string, string> {
  const reasons = new Map<string, string>();
  // One kept map for every pass: a skipped key leaves it when it is skipped, never a copy per pass (Slice 47 3f).
  const kept = new Map(topLevel);
  let pending = groups.map((group) => group.item);
  for (let pass = 0; pass <= groups.length && pending.length > 0; pass += 1) {
    const before = reasons.size;
    for (const item of pending) {
      const reason = topLevelProblem(project, item, { kept, stored, skipped: reasons });
      if (!reason) continue;
      reasons.set(item.key, reason);
      kept.delete(item.key);
    }
    if (reasons.size === before) break;
    // Only an item that names a parent can change its answer once another item is skipped (Slice 47 3g).
    pending = pending.filter((item) => !reasons.has(item.key) && effectiveParent(item, stored) !== null);
  }
  return reasons;
}

/** The parent_key a top-level item ends with: the snapshot's, or the stored one when it sends none. */
function effectiveParent(item: SnapshotItem, stored: Map<string, SyncRow>): string | null {
  const parentKey = item.parent_key === undefined ? stored.get(item.key)?.parent_key : item.parent_key;
  return parentKey ?? null;
}

function omitChecks(item: SnapshotItem): SnapshotItem {
  const rest = { ...item };
  delete rest.checks;
  return rest;
}

function parentRef(
  row: { key: string; project: string; type: ItemType; parent_key?: string | null } | undefined | null,
  parentOf?: (key: string) => string | null | undefined,
): ParentRef | null {
  if (!row) return null;
  const parentKey = parentOf ? parentOf(row.key) : row.parent_key;
  return { project: row.project, type: row.type, parent_key: parentKey, above: ancestorKeys(parentKey, parentOf ?? (() => null)) };
}

/** What a top-level item is checked against: the sibling items still kept, the stored rows and the reasons already given. */
interface TopLevelContext {
  kept: Map<string, SnapshotItem>;
  stored: Map<string, SyncRow>;
  skipped: Map<string, string>;
}

/**
 * A top-level item in its final state: the snapshot's type and parent_key, the stored parent_key when it sends none.
 * An item naming a sibling that is itself skipped is skipped too, so it is never saved under a refused parent.
 */
function topLevelProblem(project: string, item: SnapshotItem, context: TopLevelContext): string | null {
  const { kept, stored, skipped } = context;
  const row = stored.get(item.key);
  const parentKey = item.parent_key === undefined ? row?.parent_key : item.parent_key;
  if (parentKey && skipped.has(parentKey)) return `parent_key: ${parentKey} is skipped in this snapshot, so ${item.key} cannot name it`;
  const parentOf = (key: string): string | null | undefined => {
    const snap = kept.get(key);
    return snap && snap.parent_key !== undefined ? snap.parent_key : stored.get(key)?.parent_key;
  };
  const parent = parentKey ? parentRef(kept.get(parentKey) ?? stored.get(parentKey), parentOf) : null;
  const state = { key: item.key, type: item.type, parent_key: parentKey, checks: item.checks?.length, parts: item.parts?.length, stored: row };
  return itemProblem(state, parent, project);
}

/** A part or check made from a slice: its parent is that slice, and its key may not repeat one already kept. */
function childProblem(
  project: string,
  child: SnapshotItem,
  slice: SnapshotItem,
  seen: Set<string>,
  stored: SyncRow | undefined,
): string | null {
  if (seen.has(child.key)) return `key: ${child.key} appears twice in the snapshot`;
  const state = { key: child.key, type: child.type, parent_key: child.parent_key, stored };
  return itemProblem(state, parentRef(slice), project);
}

/** The board window with each item's expiry times, for the page's working-now rule. */
export async function listBoardRows(
  repo: ItemRepository,
  input: ListOpenInput,
  window: WindowConfig,
  clock: Clock,
  withRiders = true,
  withCosts = true,
): Promise<BoardRow[]> {
  const hours = resolveWindowHours(input.window_hours, window);
  const rows = await repo.listBoard({
    project: input.project,
    type: input.type,
    cutoff: windowCutoff(clock.now(), hours),
    eventLimit: LIST_EVENT_LIMIT,
    withRiders,
  });
  if (withCosts) await withStepCosts(repo, rows);
  return rows;
}

/** Puts each listed item's step costs from the stored step runs on its steps (Slice 54): derived at read, one query for all items with steps. */
export async function withStepCosts<T extends Pick<Item, "key" | "steps">>(repo: ItemRepository, items: readonly T[]): Promise<void> {
  const keys = items.filter((item) => (item.steps?.length ?? 0) > 0).map((item) => item.key);
  if (keys.length === 0) return;
  const runs = await repo.stepRunsFor(keys);
  const byItem = new Map<string, StepRun[]>();
  for (const run of runs) byItem.set(run.item_key, [...(byItem.get(run.item_key) ?? []), run]);
  for (const item of items) attachStepCosts(item.steps, byItem.get(item.key) ?? []);
}

/** The cron's step-run job: deletes the measured rows that ended more than 180 days ago; returns how many (Slice 54). */
export async function thinOldStepRuns(repo: ItemRepository, clock: Clock): Promise<number> {
  return repo.deleteStepRunsBefore(stepRunCutoff(clock.now()));
}

export async function listOpen(
  repo: ItemRepository,
  input: ListOpenInput,
  window: WindowConfig,
  clock: Clock,
): Promise<ItemWithEvents[]> {
  // No step costs here: only the board page and get_item show them, and list_open replies are cut at a size (Slice 54 Decision 11).
  const rows = await listBoardRows(repo, input, window, clock, false, false);
  return rows.map(withoutExpiry);
}

function withoutExpiry(row: BoardRow): ItemWithEvents {
  const { expiry, docSync, parentSlice, ...item } = row;
  void expiry;
  void docSync;
  void parentSlice;
  return item;
}

/** The cron's one job: turn live items without a recent heartbeat stale and close the old waiting cards; returns both counts. */
export async function markStaleItems(
  repo: ItemRepository,
  staleAfterMinutes: number,
  clock: Clock,
): Promise<StaleResult> {
  const now = clock.now();
  const cutoffs = {
    cutoff: staleCutoff(now, staleAfterMinutes),
    sessionCutoff: staleCutoff(now, expiryMinutesFor(SESSION_AGENT, staleAfterMinutes)),
    waitingCutoff: waitingCutoff(now),
  };
  return repo.markStale(cutoffs, now.toISOString());
}

export async function getItem(repo: ItemRepository, key: string): Promise<ItemWithEvents> {
  const item = await repo.find(key);
  if (!item) throw new DomainError("key", `field key: no item ${key}`);
  return { ...item, events: await repo.eventsFor(key) };
}
