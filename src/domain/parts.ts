import type { SnapshotItem, SnapshotPart } from "./docSync";
import { DomainError } from "./errors";
import { ItemStatus, ItemType } from "./item";
import { isWorkingNow, type WorkingRow } from "./steps";

/** What a slice's part looks like on the board (Slice 11). */
export enum PartState {
  Done = "done",
  Active = "active",
  /** Someone held it and its report stopped. */
  Stale = "stale",
  Pending = "pending",
}

/** What the slice's tile says is going on in its parts: the active one, a stale one, the next one or nothing left. */
export enum PartNowKind {
  Active = "active",
  Stale = "stale",
  Next = "next",
  AllDone = "all_done",
}

export const MAX_PARTS = 26;
const PERCENT = 100;
const PART_LETTER = /^[A-Z]$/;
const PART_KEY = /\/part-([A-Z])$/;

/** The key of a slice's part: `<slice key>/part-<letter>`, e.g. demo-app/slice-58/part-B. */
export function partKey(sliceKey: string, letter: string): string {
  return `${sliceKey}/part-${letter}`;
}

export function isPartLetter(letter: string): boolean {
  return PART_LETTER.test(letter);
}

/** The letter a part key ends in, or null when the key is not a part's. */
export function partLetterOf(key: string): string | null {
  return PART_KEY.exec(key)?.[1] ?? null;
}

function partItem(slice: SnapshotItem, part: SnapshotPart): SnapshotItem {
  if (!isPartLetter(part.letter)) {
    throw new DomainError("items", `field items: ${slice.key} has part letter ${part.letter}, which must be one letter A to Z`);
  }
  return {
    key: partKey(slice.key, part.letter),
    project: slice.project,
    type: ItemType.Part,
    title: part.title,
    status: part.done ? ItemStatus.Done : ItemStatus.Open,
    priority: slice.priority,
    parent_key: slice.key,
  };
}

/**
 * The snapshot's items with each slice's parts added as items of their own (type part, key
 * `<slice key>/part-<letter>`, `parent_key` the slice). A part is an item like any other from
 * here on: one that leaves the list is closed by the same rule as a slice that left the table.
 */
export function expandParts(items: SnapshotItem[]): SnapshotItem[] {
  return items.flatMap((item) => {
    const { parts, ...slice } = item;
    if (parts && parts.length > 0 && item.type !== ItemType.Slice) {
      throw new DomainError("items", `field items: ${item.key} is a ${item.type} item; only a slice has parts`);
    }
    if (parts && parts.length > MAX_PARTS) {
      throw new DomainError("items", `field items: ${item.key} has ${parts.length} parts, at most ${MAX_PARTS}`);
    }
    return [slice, ...(parts ?? []).map((part) => partItem(item, part))];
  });
}

/** One part as the board reads it. */
export interface PartView {
  key: string;
  letter: string;
  title: string;
  state: PartState;
}

export interface PartsProgress {
  done: number;
  total: number;
  /** Parts done over parts, rounded. The part in progress adds nothing until it is done. */
  percent: number;
}

/** null when the slice has no parts: no bar, nothing guessed. */
export function partsProgress(states: readonly PartState[]): PartsProgress | null {
  if (states.length === 0) return null;
  const done = states.filter((state) => state === PartState.Done).length;
  return { done, total: states.length, percent: Math.round((done / states.length) * PERCENT) };
}

/**
 * The part's state at read: done, working now (the one `isWorkingNow` rule), stale (live, but its
 * heartbeat stopped or the cron turned it stale) or pending. Never stored.
 */
export function partStateOf(row: WorkingRow, staleAfterMinutes: number, now: Date): PartState {
  if (row.status === ItemStatus.Done) return PartState.Done;
  if (isWorkingNow(row, staleAfterMinutes, now)) return PartState.Active;
  const held = row.status === ItemStatus.InProgress || row.status === ItemStatus.Stale;
  return held ? PartState.Stale : PartState.Pending;
}

/**
 * The status the board shows for a slice: one with a part in progress reads as in flight while its
 * stored status is open or stale. Worked out at read, never stored; get_item and list_open keep the stored one.
 */
export function shownStatusOf(status: ItemStatus, hasActivePart: boolean): ItemStatus {
  const idle = status === ItemStatus.Open || status === ItemStatus.Stale;
  return hasActivePart && idle ? ItemStatus.InProgress : status;
}

export interface PartNow<T extends PartView = PartView> {
  kind: PartNowKind;
  /** The part the kind is about; null when all parts are done. */
  part: T | null;
}

/** The tile's part-now line: the first active part, else the first stale one, else the first pending one, else all done. Parts come in letter order. */
export function partNow<T extends PartView>(parts: readonly T[]): PartNow<T> {
  const active = parts.find((part) => part.state === PartState.Active);
  if (active) return { kind: PartNowKind.Active, part: active };
  const stale = parts.find((part) => part.state === PartState.Stale);
  if (stale) return { kind: PartNowKind.Stale, part: stale };
  const next = parts.find((part) => part.state === PartState.Pending);
  if (next) return { kind: PartNowKind.Next, part: next };
  return { kind: PartNowKind.AllDone, part: null };
}

/** The part to follow: the active one only, never a stale one. */
export function activePartOf<T extends PartView>(parts: readonly T[]): T | null {
  return parts.find((part) => part.state === PartState.Active) ?? null;
}

/** The first pending part reads "Next" in a list, the rest "Later". */
export function firstPendingKey(parts: readonly PartView[]): string | null {
  return parts.find((part) => part.state === PartState.Pending)?.key ?? null;
}
