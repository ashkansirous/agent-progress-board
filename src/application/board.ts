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
import { expiryMinutesFor, SESSION_AGENT, staleCutoff } from "../domain/stale";
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
  const existing = await repo.find(input.key);
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
  return reportProgress(repo, { ...input, status: ItemStatus.Done }, clock);
}

export async function askHuman(
  repo: ItemRepository,
  input: AskHumanInput,
  clock: Clock,
): Promise<Item> {
  const existing = await repo.find(input.key);
  if (existing && existing.type !== ItemType.WaitingForMe) return askOnItem(repo, existing, input, clock);
  const report: ReportInput = { ...input, type: ItemType.WaitingForMe, status: ItemStatus.Open };
  return reportProgress(repo, report, clock);
}

/**
 * A question on an item of another type (Slice 13): the item keeps its type, status and title and
 * gets `needs_you` (the question, from `why`, else the title) and `after_answer`, so the session
 * stays one card. Every other field the ask sends follows the rules of `report_progress`; a field it
 * leaves out keeps its stored value. A done item cannot be asked on.
 */
async function askOnItem(repo: ItemRepository, existing: Item, input: AskHumanInput, clock: Clock): Promise<Item> {
  if (existing.status === ItemStatus.Done) {
    throw new DomainError("key", `field key: item ${input.key} is done, so ask_human cannot ask on it`);
  }
  const { title, why, ...rest } = input;
  return reportProgress(repo, { ...rest, needs_you: why?.trim() ? why : title, after_answer: rest.after_answer ?? null }, clock);
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
  const item: Partial<BoardRow> = { ...row };
  delete item.expiry;
  delete item.docSync;
  return item as ItemWithEvents;
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
