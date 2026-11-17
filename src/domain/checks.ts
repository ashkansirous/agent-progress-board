import type { SnapshotCheck, SnapshotItem } from "./docSync";
import { ItemStatus, ItemType } from "./item";

/** At most this many checks under one slice in a snapshot; the whole expanded set is bounded by `MAX_EXPANDED_ITEMS`. */
export const MAX_CHECKS = 100;

/** An item in its final state: the stored row merged with the report or the snapshot entry. */
export interface ItemState {
  key: string;
  type: ItemType | undefined;
  parent_key: string | null | undefined;
  /** How many checks a snapshot item lists (a report has none). */
  checks?: number;
}

/** The parent row, as far as the rules read it. */
export interface ParentRef {
  project: string;
  type: ItemType;
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
  if (item.parent_key && parent && project !== undefined && parent.project !== project) {
    return `parent_key: ${item.parent_key} belongs to project ${parent.project}, not ${project}`;
  }
  return item.type === ItemType.Check ? checkProblem(item, parent) : null;
}

function checkProblem(item: ItemState, parent: ParentRef | null): string | null {
  const parentKey = item.parent_key;
  if (!parentKey) return "parent_key: a check item needs the key of its slice";
  if (!item.key.startsWith(`${parentKey}/`)) {
    return `key: the key of a check of ${parentKey} must start with "${parentKey}/", got ${item.key}`;
  }
  if (parent && parent.type !== ItemType.Slice) return `parent_key: ${parentKey} is not a slice, and a check names a slice`;
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

/** The checks still not tried (not done) of each slice, by the slice's key, in the order given. */
export function checksBySlice(rows: readonly CheckRow[]): Map<string, CheckView[]> {
  const bySlice = new Map<string, CheckView[]>();
  for (const row of rows) {
    if (row.status === ItemStatus.Done || !row.parent_key) continue;
    const list = bySlice.get(row.parent_key) ?? [];
    list.push({ key: row.key, title: row.title });
    bySlice.set(row.parent_key, list);
  }
  return bySlice;
}
