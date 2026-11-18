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
import { itemProblem, nestedChecks, type ParentRef } from "../domain/checks";
import { expandParts } from "../domain/parts";
import { DEFAULT_STALE_AFTER_MINUTES, expiryMinutesFor, hasOpenQuestion, SESSION_AGENT, staleCutoff } from "../domain/stale";
import { checkReport, DomainError, newItem, type ReportInput, withQuestion } from "../domain/upsert";
import { resolveWindowHours, type WindowConfig, windowCutoff } from "../domain/window";
import { type BoardRow, type ItemRepository, LIST_EVENT_LIMIT } from "./ports";

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
  return saveReport(repo, input, await repo.find(input.key), clock);
}

/** `reportProgress` for a caller that has already read the stored item (one find per call). */
async function saveReport(repo: ItemRepository, input: ReportInput, existing: Item | null, clock: Clock): Promise<Item> {
  const now = clock.now().toISOString();
  const checked = withQuestion(checkReport(input), existing, now);
  await assertItemFits(repo, checked, existing);
  return repo.save({ insert: existing ?? newItem(checked, now), input: checked, now });
}

/**
 * The report's final state (the stored row with the report laid over it) must pass `itemProblem`, so a
 * retype or re-parent of an existing item is checked like a new one. A parent that does not exist yet is
 * allowed (a live report may arrive before the document snapshot lists the slice).
 */
async function assertItemFits(repo: ItemRepository, input: ReportInput, existing: Item | null): Promise<void> {
  const parentKey = input.parent_key === undefined ? existing?.parent_key : input.parent_key;
  const parent = parentKey ? await repo.find(parentKey) : null;
  const state = { key: input.key, type: input.type ?? existing?.type, parent_key: parentKey };
  const reason = itemProblem(state, parent, input.project ?? existing?.project);
  if (reason) throw problemError(reason);
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
  if (changed.length > 0 || closes.length > 0) await repo.applySync(changed, closes, now);
  const created = merges.filter((m) => !m.existed).length;
  return {
    project: input.project,
    created,
    updated: changed.length - created,
    closed: closes.length,
    unchanged: merges.length - changed.length,
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
  const seen = new Set(topLevel.keys());
  const items: SnapshotItem[] = [];
  const skipped: SkippedItem[] = [];
  const held = new Set<string>();
  for (const { item, members } of groups) {
    const reason = topLevelProblem(project, item, topLevel, stored);
    if (reason) {
      skipped.push({ key: item.key, reason });
      for (const member of members) held.add(member.key);
      continue;
    }
    const [self, ...children] = members;
    items.push(omitChecks(self!));
    for (const child of children) {
      const childReason = childProblem(project, child, item, seen);
      if (childReason) skipped.push({ key: child.key, reason: childReason });
      else {
        seen.add(child.key);
        items.push(child);
      }
    }
  }
  return { items, skipped, held };
}

function omitChecks(item: SnapshotItem): SnapshotItem {
  const rest = { ...item };
  delete rest.checks;
  return rest;
}

function parentRef(row: { project: string; type: ItemType } | undefined): ParentRef | null {
  return row ? { project: row.project, type: row.type } : null;
}

/** A top-level item in its final state: the snapshot's type and parent_key, the stored parent_key when it sends none. */
function topLevelProblem(
  project: string,
  item: SnapshotItem,
  topLevel: Map<string, SnapshotItem>,
  stored: Map<string, SyncRow>,
): string | null {
  const row = stored.get(item.key);
  const parentKey = item.parent_key ?? row?.parent_key;
  const parent = parentKey ? parentRef(topLevel.get(parentKey) ?? stored.get(parentKey)) : null;
  const state = { key: item.key, type: item.type, parent_key: parentKey, checks: item.checks?.length };
  return itemProblem(state, parent, project);
}

/** A part or check made from a slice: its parent is that slice, and its key may not repeat one already kept. */
function childProblem(
  project: string,
  child: SnapshotItem,
  slice: SnapshotItem,
  seen: Set<string>,
): string | null {
  if (seen.has(child.key)) return `key: ${child.key} appears twice in the snapshot`;
  const state = { key: child.key, type: child.type, parent_key: child.parent_key };
  return itemProblem(state, parentRef(slice), project);
}

/** The board window with each item's expiry times, for the page's working-now rule. */
export async function listBoardRows(
  repo: ItemRepository,
  input: ListOpenInput,
  window: WindowConfig,
  clock: Clock,
): Promise<BoardRow[]> {
  const hours = resolveWindowHours(input.window_hours, window);
  return repo.listBoard({
    project: input.project,
    type: input.type,
    cutoff: windowCutoff(clock.now(), hours),
    eventLimit: LIST_EVENT_LIMIT,
  });
}

export async function listOpen(
  repo: ItemRepository,
  input: ListOpenInput,
  window: WindowConfig,
  clock: Clock,
): Promise<ItemWithEvents[]> {
  const rows = await listBoardRows(repo, input, window, clock);
  return rows.map(withoutExpiry);
}

function withoutExpiry(row: BoardRow): ItemWithEvents {
  const { expiry, docSync, ...item } = row;
  void expiry;
  void docSync;
  return item;
}

/** The cron's one job: turn live items without a recent heartbeat stale; returns how many. */
export async function markStaleItems(
  repo: ItemRepository,
  staleAfterMinutes: number,
  clock: Clock,
): Promise<number> {
  const now = clock.now();
  const cutoffs = {
    cutoff: staleCutoff(now, staleAfterMinutes),
    sessionCutoff: staleCutoff(now, expiryMinutesFor(SESSION_AGENT, staleAfterMinutes)),
  };
  return repo.markStale(cutoffs, now.toISOString());
}

export async function getItem(repo: ItemRepository, key: string): Promise<ItemWithEvents> {
  const item = await repo.find(key);
  if (!item) throw new DomainError("key", `field key: no item ${key}`);
  return { ...item, events: await repo.eventsFor(key) };
}
