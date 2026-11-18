import { DEFAULT_PRIORITY, DOC_SYNC_SOURCE, type Item, type ItemLink, ItemStatus, ItemType, type Priority } from "./item";
import { DomainError } from "./upsert";

export const MAX_SNAPSHOT_ITEMS = 200;
/**
 * Slices and their parts together, after the parts are expanded into items (Slice 11); bounds the write batch.
 * Cloudflare D1 documents no cap on statements in one `batch()`: the batch counts as one query against the
 * per-invocation limit (50 free, 1000 paid), and a sync issues two (the read and the batch). The
 * limits that bind are per statement (100 KB, 100 bound parameters; an upsert binds 19), which a
 * larger batch does not change. 1000 items (2000 statements at most) stays under every documented limit,
 * and the batch stays one atomic write.
 */
export const MAX_EXPANDED_ITEMS = 1000;
export const SYNC_ADDED_NOTE = "Added by doc sync";
export const SYNC_CHANGED_NOTE = "Docs changed the status";
export const SYNC_LEFT_NOTE = "Left the plan";

/** One item of a project's doc-sync set, as the docs describe it. */
export interface SnapshotItem {
  key: string;
  project: string;
  type: ItemType;
  title: string;
  status: ItemStatus;
  priority?: Priority;
  parent?: string | null;
  why?: string | null;
  /** The rest of a clipped title, so it reaches the card; set when the item is first stored, or later while the stored `details_md` is still null; a set one is never overwritten. */
  details_md?: string | null;
  links?: ItemLink[];
  /** The slice's lettered parts as the documents list them (Slice 11). */
  parts?: SnapshotPart[];
  /** The slice's "not yet tried on a device" lines (Slice 14); a check left out is closed. */
  checks?: SnapshotCheck[];
  /**
   * Set by `expandParts` on a part's own item and by `nestedChecks` on a check's; a client sends it
   * only on a top-level check item, to name a slice that is not in the snapshot; null clears a stored one.
   */
  parent_key?: string | null;
}

/** One check line of a slice: the client owns its key (stable across syncs) and the document owns its text. */
export interface SnapshotCheck {
  key: string;
  title: string;
}

const SLICE_KEY_NUMBER = /slice-(\d+)$/;
/** "Slice N" followed by a space, a colon, a dash or the end of the string: never a letter, digit or dot after the number. */
const SLICE_TITLE_PREFIX = /^Slice\s+(\d+)(?=$|[\s·:–—-])\s*(?:[·:–—-]\s*)?(.*)$/i;

/** A slice's number and its title as two values ("Slice 12", "App crashes on start"). */
export interface SliceName {
  number: number | null;
  title: string;
}

/**
 * Splits a slice's stored title into its number and its words. The number is the N of a key ending in
 * `slice-N` when there is one (the title's "Slice N" prefix leaves the title only when it names that
 * same N), else the title's own prefix, else null; a title that is only a prefix stays whole.
 */
export function splitSliceTitle(key: string, title: string): SliceName {
  const keyNumber = SLICE_KEY_NUMBER.exec(key)?.[1];
  const prefixed = SLICE_TITLE_PREFIX.exec(title.trim());
  if (keyNumber !== undefined) {
    const words = prefixed !== null && Number(prefixed[1]) === Number(keyNumber) ? prefixed[2]?.trim() : undefined;
    return { number: Number(keyNumber), title: words || title };
  }
  if (prefixed) return { number: Number(prefixed[1]), title: prefixed[2] ? prefixed[2].trim() : title };
  return { number: null, title };
}

/** One lettered group of a slice's work list: the document owns its title and whether it is done. */
export interface SnapshotPart {
  letter: string;
  title: string;
  done: boolean;
}

/** The history row a sync writes; the source is always doc-sync. */
export interface SyncEvent {
  at: string;
  status: ItemStatus;
  note: string;
}

/** A stored item with the sync's internal columns; these never leave the sync (not in Item). */
export interface SyncRow extends Item {
  /** The item was in its project's last doc-sync snapshot. */
  in_doc_sync: boolean;
  /** The status the docs last gave; null for an item no snapshot has touched. */
  doc_status: ItemStatus | null;
  /** When a sync first saw that doc status; null while a live status has outranked the docs. */
  doc_status_at: string | null;
  /** When a report from a source other than doc-sync last set the status. */
  live_status_at: string | null;
}

/** What the sync read; the write applies only while the row still looks like this. */
export interface SyncRead {
  updated_at: string;
  live_status_at: string | null;
}

/** The full row to store, the event if any, and the read it was computed from (null = new key). */
export interface SyncWrite {
  item: SyncRow;
  event: SyncEvent | null;
  read: SyncRead | null;
}

/** Rejects a snapshot that is too big, names another project, or repeats a key. */
export function validateSnapshot(project: string, items: SnapshotItem[], max: number = MAX_SNAPSHOT_ITEMS): void {
  if (items.length > max) {
    throw new DomainError("items", `field items: at most ${max} items per snapshot, got ${items.length}`);
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (item.project !== project) {
      throw new DomainError("items", `field items: ${item.key} has project ${item.project}, the call is for ${project}`);
    }
    if (seen.has(item.key)) throw new DomainError("items", `field items: key ${item.key} appears twice`);
    seen.add(item.key);
  }
}

/** The key is stored under another project, which a snapshot may not take over. */
export function assertSameProject(stored: SyncRow | undefined, project: string): void {
  if (stored && stored.project !== project) {
    throw new DomainError("items", `field items: ${stored.key} belongs to project ${stored.project}, not ${project}`);
  }
}

/** The live status wins when it was set after the docs last changed; no doc time is older. */
export function showsLiveStatus(liveAt: string | null, docAt: string | null): boolean {
  return liveAt !== null && (docAt === null || liveAt > docAt);
}

function doneAt(status: ItemStatus, stored: Item | undefined, now: string): string | null {
  if (status !== ItemStatus.Done) return null;
  return stored?.status === ItemStatus.Done ? (stored.done_at ?? now) : now;
}

function newRow(snap: SnapshotItem, project: string, now: string): SyncRow {
  return {
    key: snap.key,
    project,
    parent: snap.parent ?? null,
    parent_key: snap.parent_key ?? null,
    type: snap.type,
    priority: snap.priority ?? DEFAULT_PRIORITY,
    status: snap.status,
    title: snap.title,
    why: snap.why ?? null,
    details_md: snap.details_md ?? null,
    links: snap.links ?? [],
    source: DOC_SYNC_SOURCE,
    heartbeat_at: now,
    created_at: now,
    updated_at: now,
    done_at: doneAt(snap.status, undefined, now),
    in_doc_sync: true,
    doc_status: snap.status,
    doc_status_at: now,
    live_status_at: null,
  };
}

/** Same list in the same order, each link equal by label and url (key order is irrelevant). */
function sameLinks(a: ItemLink[], b: ItemLink[]): boolean {
  return a.length === b.length && a.every((link, i) => link.label === b[i]?.label && link.url === b[i]?.url);
}

function docFieldsDiffer(stored: SyncRow, next: SyncRow): boolean {
  return (
    stored.type !== next.type ||
    stored.title !== next.title ||
    stored.why !== next.why ||
    stored.parent !== next.parent ||
    (stored.parent_key ?? null) !== (next.parent_key ?? null) ||
    !sameLinks(stored.links, next.links) ||
    (stored.details_md ?? null) !== (next.details_md ?? null) ||
    stored.in_doc_sync !== next.in_doc_sync ||
    stored.doc_status !== next.doc_status ||
    stored.doc_status_at !== next.doc_status_at ||
    stored.status !== next.status ||
    stored.done_at !== next.done_at
  );
}

/**
 * Merges one snapshot item into the stored row (or none). Title takes the snapshot's value; why, parent,
 * parent_key and links do too when the snapshot sends them (null clears one), and a field the snapshot leaves
 * out keeps its stored value on every sync, so a live value is never lost; the status shown is the live one
 * only while it is newer than the docs' last status change. Returns null when nothing would change (idempotent).
 * A closed key that returns as done (Slice 4 #3): the close wrote status done with in_doc_sync off, so the
 * return flips in_doc_sync, which `docFieldsDiffer` sees; the row is saved, with no history row (the status
 * did not change) and its done_at kept. That is the right outcome: the item is in the docs again.
 */
export function planItem(stored: SyncRow | undefined, snap: SnapshotItem, project: string, now: string): SyncWrite | null {
  if (!stored) {
    const event = { at: now, status: snap.status, note: SYNC_ADDED_NOTE };
    return { item: newRow(snap, project, now), event, read: null };
  }
  const docStatusAt = nextDocStatusAt(stored, snap, now);
  const status = showsLiveStatus(stored.live_status_at, docStatusAt) ? stored.status : snap.status;
  const next: SyncRow = {
    ...stored,
    type: snap.type,
    title: snap.title,
    why: snap.why === undefined ? stored.why : snap.why,
    parent: snap.parent === undefined ? stored.parent : snap.parent,
    parent_key: snap.parent_key === undefined ? (stored.parent_key ?? null) : snap.parent_key,
    links: snap.links ?? stored.links,
    details_md: stored.details_md ?? snap.details_md ?? null,
    status,
    in_doc_sync: true,
    doc_status: snap.status,
    doc_status_at: docStatusAt,
    done_at: doneAt(status, stored, now),
  };
  if (!docFieldsDiffer(stored, next)) return null;
  const statusChanged = status !== stored.status;
  const source = statusChanged ? DOC_SYNC_SOURCE : stored.source;
  const event = statusChanged ? { at: now, status, note: SYNC_CHANGED_NOTE } : null;
  const read = { updated_at: stored.updated_at, live_status_at: stored.live_status_at };
  return { item: { ...next, source, updated_at: now }, event, read };
}

/**
 * When a sync first saw the doc status. A first sight of an item that already has a live
 * status leaves it empty, which counts as older than any live status; with no live status it
 * is now, and so is a first-sight `done` (docs record a finish only after it happened, so it
 * is never older news than a live open status). After that it moves only when the docs' status
 * changes.
 */
function nextDocStatusAt(stored: SyncRow, snap: SnapshotItem, now: string): string | null {
  if (stored.doc_status === null) {
    return stored.live_status_at === null || snap.status === ItemStatus.Done ? now : null;
  }
  return stored.doc_status === snap.status ? stored.doc_status_at : now;
}

/** The stored doc-sync items of the project that the snapshot no longer lists. */
export function closeTargets(
  stored: SyncRow[],
  project: string,
  listed: Set<string>,
  /** Slices whose snapshot item sent no `parts`: their stored parts are left as they are (Slice 11). */
  keepPartsOf: Set<string> = new Set(),
  /** Slices whose snapshot item sent no `checks`: their stored checks are left as they are (Slice 14). */
  keepChecksOf: Set<string> = new Set(),
): SyncRow[] {
  return stored.filter(
    (item) =>
      item.project === project &&
      item.in_doc_sync &&
      !listed.has(item.key) &&
      !isKeptChild(item, keepPartsOf, keepChecksOf),
  );
}

/**
 * A part or check whose slice sent no list of its kind is kept as it is. A bug or problem names its slice in
 * `parent_key` too, but the slice does not own it: the document dropped it, so it closes.
 */
function isKeptChild(item: SyncRow, keepParts: Set<string>, keepChecks: Set<string>): boolean {
  if (!item.parent_key) return false;
  if (item.type === ItemType.Check) return keepChecks.has(item.parent_key);
  return item.type === ItemType.Part && keepParts.has(item.parent_key);
}
