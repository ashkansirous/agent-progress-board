import {
  assertSameProject,
  closeTargets,
  MAX_EXPANDED_ITEMS,
  planItem,
  type SnapshotItem,
  type SyncRow,
  validateSnapshot,
} from "../domain/docSync";
import { type Item, ItemStatus, ItemType, type ItemWithEvents } from "../domain/item";
import { ancestorKeys, itemProblem, MAX_PARENT_DEPTH, nestedChecks, type ParentRef } from "../domain/checks";
import { expandParts } from "../domain/parts";
import { DEFAULT_STALE_AFTER_MINUTES, expiryMinutesFor, hasOpenQuestion, SESSION_AGENT, staleCutoff, waitingCutoff } from "../domain/stale";
import { checkReport, DomainError, newItem, type ReportInput, withQuestion } from "../domain/upsert";
import { resolveWindowHours, type WindowConfig, windowCutoff } from "../domain/window";
import { type BoardRow, type ItemRepository, LIST_EVENT_LIMIT, type StaleResult, StepsChangedError } from "./ports";

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
      return await saveReport(repo, input, item, clock, stepsText);
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
): Promise<Item> {
  const now = clock.now().toISOString();
  const checked = withQuestion(checkReport(input, existing, now), existing, now);
  await assertItemFits(repo, checked, existing);
  return repo.save({ insert: existing ?? newItem(checked, now), input: checked, now, ifStepsText: stepsText });
}

/**
 * The report's final state (the stored row with the report laid over it) must pass `itemProblem`, so a
 * retype or re-parent of an existing item is checked like a new one. A parent that does not exist yet is
 * allowed (a live report may arrive before the document snapshot lists the slice).
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

/** The parent and its ancestors by key, read one by one up to `MAX_PARENT_DEPTH` (a stored loop ends the walk). */
async function loadParents(repo: ItemRepository, start: string | null | undefined): Promise<Map<string, Item>> {
  const rows = new Map<string, Item>();
  let key = start;
  while (key && rows.size < MAX_PARENT_DEPTH && !rows.has(key)) {
    const row = await repo.find(key);
    if (!row) break;
    rows.set(key, row);
    key = row.parent_key;
  }
  return rows;
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

export async function askHuman(
  repo: ItemRepository,
  input: AskHumanInput,
  clock: Clock,
  staleAfterMinutes: number = DEFAULT_STALE_AFTER_MINUTES,
): Promise<Item> {
  const existing = await repo.find(input.key);
  if (existing && existing.type !== ItemType.WaitingForMe) return askOnItem(repo, existing, input, clock, staleAfterMinutes);
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
  input: AskHumanInput,
  clock: Clock,
  staleAfterMinutes: number,
): Promise<Item> {
  if (existing.status === ItemStatus.Done) {
    throw new DomainError("key", `field key: item ${input.key} is done, so ask_human cannot ask on it`);
  }
  if (existing.type === ItemType.Part || (await isDocSynced(repo, existing))) {
    throw new DomainError("key", `field key: item ${input.key} is a part or comes from the plan documents, so ask_human cannot ask on it`);
  }
  const { key, title, why, needs_you, after_answer } = input;
  if (needs_you === null) return saveReport(repo, { key, why, needs_you: null }, existing, clock);
  if (needs_you?.trim()) return saveReport(repo, { key, why, needs_you, after_answer: after_answer ?? null }, existing, clock);
  const kept = hasOpenQuestion(existing, staleAfterMinutes, clock.now()) ? existing.needs_you : null;
  const question = why?.trim() ? why : (kept ?? title);
  return saveReport(repo, { key, needs_you: question, after_answer: after_answer ?? null }, existing, clock);
}

async function isDocSynced(repo: ItemRepository, item: Item): Promise<boolean> {
  const rows = await repo.loadForSync(item.project, [item.key]);
  return rows.some((row) => row.key === item.key && row.in_doc_sync);
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
  const merges = items.map((snap) => ({
    existed: byKey.has(snap.key),
    write: planItem(byKey.get(snap.key), snap, input.project, now),
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
  for (let pass = 0; pass <= groups.length; pass += 1) {
    const before = reasons.size;
    const kept = new Map([...topLevel].filter(([key]) => !reasons.has(key)));
    for (const { item } of groups) {
      if (reasons.has(item.key)) continue;
      const reason = topLevelProblem(project, item, { kept, stored, skipped: reasons });
      if (reason) reasons.set(item.key, reason);
    }
    if (reasons.size === before) break;
  }
  return reasons;
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
): Promise<BoardRow[]> {
  const hours = resolveWindowHours(input.window_hours, window);
  return repo.listBoard({
    project: input.project,
    type: input.type,
    cutoff: windowCutoff(clock.now(), hours),
    eventLimit: LIST_EVENT_LIMIT,
    withRiders,
  });
}

export async function listOpen(
  repo: ItemRepository,
  input: ListOpenInput,
  window: WindowConfig,
  clock: Clock,
): Promise<ItemWithEvents[]> {
  const rows = await listBoardRows(repo, input, window, clock, false);
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
