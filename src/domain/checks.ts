import type { SnapshotCheck, SnapshotItem } from "./docSync";
import { ItemStatus, ItemType } from "./item";

/** At most this many checks under one slice in a snapshot; the whole expanded set is bounded by `MAX_EXPANDED_ITEMS`. */
export const MAX_CHECKS = 100;
/** The longest key any item may have; a slice's part keys (`<slice key>/part-X`) are held to it too. */
export const MAX_KEY_LENGTH = 200;
const PART_SUFFIX_LENGTH = "/part-X".length;
const SLICE_CHILD_TYPES: readonly ItemType[] = [ItemType.Part, ItemType.Check, ItemType.Bug, ItemType.Problem];

/** An item in its final state: the stored row merged with the report or the snapshot entry. */
export interface ItemState {
  key: string;
  type: ItemType | undefined;
  parent_key: string | null | undefined;
  /** How many checks a snapshot item lists (a report has none). */
  checks?: number;
  /** How many parts a snapshot item lists (a report has none). */
  parts?: number;
}

/** The parent row, as far as the rules read it. */
export interface ParentRef {
  project: string;
  type: ItemType;
  /** The parent's own `parent_key`, when known, so a cycle through two items is seen. */
  parent_key?: string | null;
}

/**
 * The one rule set for keys and parents, used by `report_progress` (the merged final state) and by
 * `sync_snapshot` (each item and nested check). Returns why the item cannot be saved, or null. A reason
 * starts with the field it is about, then a colon.
 */
export function itemProblem(item: ItemState, parent: ParentRef | null, project: string | undefined): string | null {
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
  if (parentKey === item.key || parent?.parent_key === item.key) return `parent_key: ${item.key} cannot be its own parent, directly or through ${parentKey}`;
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
}

/** What the grouping reads of a check item. */
export interface CheckRow extends CheckView {
  project: string;
  status: ItemStatus;
  parent_key?: string | null;
}

/** A check counts as not tried while it is open or being tried; a stale or blocked one is not a check to try now. */
const COUNTED_CHECK_STATUSES: readonly ItemStatus[] = [ItemStatus.Open, ItemStatus.InProgress];

/** The checks still not tried (open or in progress) of each slice, by the slice's key, in the order given. */
export function checksBySlice(rows: readonly CheckRow[]): Map<string, CheckView[]> {
  const bySlice = new Map<string, CheckView[]>();
  for (const row of rows) {
    if (!COUNTED_CHECK_STATUSES.includes(row.status) || !row.parent_key) continue;
    const list = bySlice.get(row.parent_key) ?? [];
    list.push({ key: row.key, title: row.title });
    bySlice.set(row.parent_key, list);
  }
  return bySlice;
}
