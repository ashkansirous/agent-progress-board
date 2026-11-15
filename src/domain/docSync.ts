import { DEFAULT_PRIORITY, DOC_SYNC_SOURCE, type Item, type ItemLink, ItemStatus, type ItemType, type Priority } from "./item";
import { DomainError } from "./upsert";

export const MAX_SNAPSHOT_ITEMS = 200;
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
  links?: ItemLink[];
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
export function validateSnapshot(project: string, items: SnapshotItem[]): void {
  if (items.length > MAX_SNAPSHOT_ITEMS) {
    throw new DomainError("items", `field items: at most ${MAX_SNAPSHOT_ITEMS} items per snapshot, got ${items.length}`);
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
function showsLiveStatus(liveAt: string | null, docAt: string | null): boolean {
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
    type: snap.type,
    priority: snap.priority ?? DEFAULT_PRIORITY,
    status: snap.status,
    title: snap.title,
    why: snap.why ?? null,
    details_md: null,
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
    stored.title !== next.title ||
    stored.why !== next.why ||
    stored.parent !== next.parent ||
    !sameLinks(stored.links, next.links) ||
    stored.in_doc_sync !== next.in_doc_sync ||
    stored.doc_status !== next.doc_status ||
    stored.doc_status_at !== next.doc_status_at ||
    stored.status !== next.status
  );
}

/**
 * Merges one snapshot item into the stored row (or none). Title, why, parent and links always
 * take the snapshot's values; the status shown is the live one only while it is newer than the
 * docs' last status change. Returns null when nothing would change (idempotent).
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
    title: snap.title,
    why: snap.why ?? null,
    parent: snap.parent ?? null,
    links: snap.links ?? [],
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
export function closeTargets(stored: SyncRow[], project: string, listed: Set<string>): SyncRow[] {
  return stored.filter((item) => item.project === project && item.in_doc_sync && !listed.has(item.key));
}
