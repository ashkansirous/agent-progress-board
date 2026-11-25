import type { SnapshotCheck, SnapshotItem, SyncRow } from "./docSync";
import { ItemStatus, ItemType } from "./item";

/** At most this many checks under one slice in a snapshot; the whole expanded set is bounded by `MAX_EXPANDED_ITEMS`. */
export const MAX_CHECKS = 100;
/** The longest key any item may have; a slice's part keys (`<slice key>/part-X`) are held to it too. */
export const MAX_KEY_LENGTH = 200;
export const PART_SUFFIX_LENGTH = "/part-X".length;
/** The types whose parent_key must name a slice when the parent is known; a bug or problem may name any item (as before Slice 33). */
const SLICE_CHILD_TYPES: readonly ItemType[] = [ItemType.Part, ItemType.Check];

/** An item in its final state: the stored row merged with the report or the snapshot entry. */
export interface ItemState {
  key: string;
  type: ItemType | undefined;
  parent_key: string | null | undefined;
  /** How many checks a snapshot item lists (a report has none). */
  checks?: number;
  /** How many parts a snapshot item lists (a report has none). */
  parts?: number;
  /** A snapshot's stored row under the same key, so a sync does not retype a live item the documents do not own. */
  stored?: Pick<SyncRow, "type" | "in_doc_sync" | "status"> | null;
}

/** The parent row, as far as the rules read it. */
export interface ParentRef {
  project: string;
  type: ItemType;
  /** The parent's own `parent_key`, when known, so a cycle through two items is seen. */
  parent_key?: string | null;
  /** The parent's own parent_key and the keys above it, nearest first (`ancestorKeys` of it), so a cycle of any length is seen. */
  above?: readonly string[];
}

/** How many parents up a cycle check walks; a deeper chain is never walked further (a slice tree is two levels). */
export const MAX_PARENT_DEPTH = 20;

/**
 * The keys above `start` (its parent, that one's parent, ...) up to `MAX_PARENT_DEPTH`, stopping at a key
 * with no parent, an unknown key or a key already seen, so a stored loop cannot make the walk run on.
 */
export function ancestorKeys(start: string | null | undefined, parentOf: (key: string) => string | null | undefined): string[] {
  const keys: string[] = [];
  let key = start;
  while (key && keys.length < MAX_PARENT_DEPTH && !keys.includes(key)) {
    keys.push(key);
    key = parentOf(key);
  }
  return keys;
}

/** Why a snapshot item may not be merged into the stored row: the store holds a live item of another type under its key (a done or closed key may come back with another type). */
function typeConflict(item: ItemState): string | null {
  const stored = item.stored;
  if (!stored || stored.in_doc_sync || stored.status === ItemStatus.Done || stored.type === item.type) return null;
  return `type: ${item.key} is a stored ${stored.type} item the documents do not own, so a sync does not retype it to ${item.type}`;
}

/**
 * The one rule set for keys and parents, used by `report_progress` (the merged final state) and by
 * `sync_snapshot` (each item and nested check). Returns why the item cannot be saved, or null. A reason
 * starts with the field it is about, then a colon.
 */
export function itemProblem(item: ItemState, parent: ParentRef | null, project: string | undefined): string | null {
  const conflict = typeConflict(item);
  if (conflict) return conflict;
  const count = item.checks ?? 0;
  if (count > 0 && item.type !== ItemType.Slice) return `items: ${item.key} is a ${item.type} item; only a slice has checks`;
  if (count > MAX_CHECKS) return `items: ${item.key} has ${count} checks, at most ${MAX_CHECKS}`;
  if (item.parts && item.parts > 0 && item.key.length + PART_SUFFIX_LENGTH > MAX_KEY_LENGTH) {
    return `key: ${item.key} is too long for a slice with parts: a part key adds ${PART_SUFFIX_LENGTH} characters and keys hold at most ${MAX_KEY_LENGTH}`;
  }
  if (item.parent_key && parent && project !== undefined && parent.project !== project) {
    return `parent_key: ${item.parent_key} belongs to project ${parent.project}, not ${project}`;
  }
  const relation = parentProblem(item, parent);
  if (relation) return relation;
  return item.type === ItemType.Check ? checkProblem(item) : null;
}

/** A parent_key may not name the item itself, nor an item that names it back, nor a known parent that is not a slice. */
function parentProblem(item: ItemState, parent: ParentRef | null): string | null {
  const parentKey = item.parent_key;
  if (!parentKey) return null;
  const loops = parentKey === item.key || parent?.parent_key === item.key || (parent?.above ?? []).includes(item.key);
  if (loops) return `parent_key: ${item.key} cannot be its own parent, directly or through ${parentKey}`;
  const needsSlice = item.type !== undefined && SLICE_CHILD_TYPES.includes(item.type);
  if (needsSlice && parent && parent.type !== ItemType.Slice) return `parent_key: ${parentKey} is not a slice, and a ${item.type} names a slice`;
  if (item.type === ItemType.Part && !item.key.startsWith(`${parentKey}/part-`)) {
    return `key: the key of a part of ${parentKey} must start with "${parentKey}/part-", got ${item.key}`;
  }
  return null;
}

function checkProblem(item: ItemState): string | null {
  const parentKey = item.parent_key;
  if (!parentKey) return "parent_key: a check item needs the key of its slice";
  if (!item.key.startsWith(`${parentKey}/`)) {
    return `key: the key of a check of ${parentKey} must start with "${parentKey}/", got ${item.key}`;
  }
  return null;
}

/** A slice's checks as items of their own (type check, `parent_key` the slice, the key the client gave). */
export function nestedChecks(slice: SnapshotItem): SnapshotItem[] {
  return (slice.checks ?? []).map((check: SnapshotCheck) => ({
    key: check.key,
    project: slice.project,
    type: ItemType.Check,
    title: check.title,
    status: ItemStatus.Open,
    priority: slice.priority,
    parent_key: slice.key,
  }));
}

/** One check as the board lists it. */
export interface CheckView {
  key: string;
  title: string;
  /** The check's own state: a stale or blocked check is shown with it but is not counted as not tried. */
  status: ItemStatus;
}

/** What the grouping reads of a check item. */
export interface CheckRow extends CheckView {
  project: string;
  status: ItemStatus;
  parent_key?: string | null;
}

/** A check counts while it is open, being tried or blocked (a blocked one is still to do, Slice 51); a stale one is not a check to try now. */
export const COUNTED_CHECK_STATUSES: readonly ItemStatus[] = [ItemStatus.Open, ItemStatus.InProgress, ItemStatus.Blocked];

/** The one rule for "a check not tried": the list under a slice, the Built test and the board load (`OPEN_CHECK_OF`) all use it. */
export function isCountedCheck(status: ItemStatus): boolean {
  return COUNTED_CHECK_STATUSES.includes(status);
}

/** A check is shown under its slice (or as loose) in every state but done; only `isCountedCheck` ones are counted. */
export function isShownCheck(status: ItemStatus): boolean {
  return status !== ItemStatus.Done;
}

/** How many of these checks are not tried (`isCountedCheck`), the number every count and heading uses. */
export function countedChecks(checks: readonly CheckView[]): number {
  return checks.filter((check) => isCountedCheck(check.status)).length;
}

/** The checks to show (not done) of each slice, by the slice's key, in the order given; each carries its status. */
export function checksBySlice(rows: readonly CheckRow[]): Map<string, CheckView[]> {
  const bySlice = new Map<string, CheckView[]>();
  for (const row of rows) {
    if (!isShownCheck(row.status) || !row.parent_key) continue;
    const list = bySlice.get(row.parent_key) ?? [];
    list.push({ key: row.key, title: row.title, status: row.status });
    bySlice.set(row.parent_key, list);
  }
  return bySlice;
}
