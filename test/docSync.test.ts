import { describe, expect, it } from "vitest";
import {
  MAX_SNAPSHOT_ITEMS,
  closeTargets,
  planItem,
  type SnapshotItem,
  SYNC_ADDED_NOTE,
  SYNC_CHANGED_NOTE,
  type SyncRow,
  validateSnapshot,
} from "../src/domain/docSync";
import { DOC_SYNC_SOURCE, ItemStatus, ItemType, Priority } from "../src/domain/item";

const T1 = "2026-11-15T10:00:00.000Z";
const T2 = "2026-11-15T11:00:00.000Z";
const T3 = "2026-11-15T12:00:00.000Z";
const PROJECT = "demo-app";

const snap: SnapshotItem = {
  key: "demo-app/slice-1",
  project: PROJECT,
  type: ItemType.Slice,
  title: "Sample slice",
  status: ItemStatus.Open,
  parent: "Plan · Search",
};

function synced(over: Partial<SyncRow> = {}): SyncRow {
  const created = planItem(undefined, snap, PROJECT, T1)!.item;
  return { ...created, ...over };
}

describe("planItem", () => {
  it("creates a doc-sync row with an event for a new key", () => {
    const write = planItem(undefined, snap, PROJECT, T1)!;
    expect(write.item).toMatchObject({
      source: DOC_SYNC_SOURCE,
      in_doc_sync: true,
      doc_status: ItemStatus.Open,
      doc_status_at: T1,
      live_status_at: null,
      priority: Priority.P2,
    });
    expect(write.event).toEqual({ at: T1, status: ItemStatus.Open, note: SYNC_ADDED_NOTE });
  });

  it("is a no-op when the same snapshot arrives again", () => {
    expect(planItem(synced(), snap, PROJECT, T2)).toBeNull();
  });

  it("lets the snapshot win on title, why, parent and links without an event", () => {
    const changed = { ...snap, title: "New", why: "Because", parent: null, links: [{ label: "a", url: "https://x.test" }] };
    const write = planItem(synced(), changed, PROJECT, T2)!;
    expect(write.item).toMatchObject({ title: "New", why: "Because", parent: null, updated_at: T2 });
    expect(write.item.links).toHaveLength(1);
    expect(write.event).toBeNull();
  });

  it("keeps a live status newer than the docs' last change, and leaves doc_status_at alone", () => {
    const live = synced({ status: ItemStatus.InProgress, live_status_at: T2 });
    expect(planItem(live, snap, PROJECT, T3)).toBeNull();
    const retitled = planItem(live, { ...snap, title: "New" }, PROJECT, T3)!;
    expect(retitled.item).toMatchObject({ status: ItemStatus.InProgress, doc_status_at: T1 });
    expect(retitled.event).toBeNull();
  });

  it("lets a doc change made after the live report win, with an event", () => {
    const live = synced({ status: ItemStatus.InProgress, live_status_at: T2 });
    const write = planItem(live, { ...snap, status: ItemStatus.Blocked }, PROJECT, T3)!;
    expect(write.item).toMatchObject({ status: ItemStatus.Blocked, doc_status: ItemStatus.Blocked, doc_status_at: T3 });
    expect(write.event).toEqual({ at: T3, status: ItemStatus.Blocked, note: SYNC_CHANGED_NOTE });
  });

  it("first sight of a live item keeps its live status, records the doc status, leaves doc_status_at empty", () => {
    const liveOnly = synced({
      in_doc_sync: false, doc_status: null, doc_status_at: null, live_status_at: T1,
      status: ItemStatus.Blocked, source: "hook",
    });
    const write = planItem(liveOnly, snap, PROJECT, T2)!;
    expect(write.item).toMatchObject({
      in_doc_sync: true, status: ItemStatus.Blocked, doc_status: ItemStatus.Open, doc_status_at: null, source: "hook",
    });
    expect(write.event).toBeNull();
    const synced2 = planItem(write.item, snap, PROJECT, T3);
    expect(synced2).toBeNull();
    const docChange = planItem(write.item, { ...snap, status: ItemStatus.InProgress }, PROJECT, T3)!;
    expect(docChange.item).toMatchObject({ status: ItemStatus.InProgress, doc_status_at: T3, source: DOC_SYNC_SOURCE });
  });

  it("first sight of an item with no live status shows the docs' status at once", () => {
    const untouched = synced({ in_doc_sync: false, doc_status: null, doc_status_at: null, live_status_at: null });
    const write = planItem(untouched, { ...snap, status: ItemStatus.Done }, PROJECT, T2)!;
    expect(write.item).toMatchObject({ status: ItemStatus.Done, doc_status_at: T2 });
  });

  it("keeps the live reporter's source when only the title changes", () => {
    const live = synced({ status: ItemStatus.InProgress, live_status_at: T2, source: "agent-a" });
    const write = planItem(live, { ...snap, title: "New" }, PROJECT, T3)!;
    expect(write.item.source).toBe("agent-a");
  });

  it("carries the read it was computed from", () => {
    const stored = synced({ updated_at: T2, live_status_at: T2 });
    const write = planItem(stored, { ...snap, title: "New" }, PROJECT, T3)!;
    expect(write.read).toEqual({ updated_at: T2, live_status_at: T2 });
    expect(planItem(undefined, snap, PROJECT, T1)!.read).toBeNull();
  });

  it("ignores key order in links but sees a different list order", () => {
    const links = [{ label: "a", url: "https://a.test" }, { label: "b", url: "https://b.test" }];
    const stored = synced({ links });
    const reordered = links.map(({ label, url }) => ({ url, label }));
    expect(planItem(stored, { ...snap, links: reordered }, PROJECT, T2)).toBeNull();
    expect(planItem(stored, { ...snap, links: [...links].reverse() }, PROJECT, T2)).not.toBeNull();
  });

  it("sets and clears done_at with the shown status", () => {
    const done = planItem(synced(), { ...snap, status: ItemStatus.Done }, PROJECT, T2)!;
    expect(done.item.done_at).toBe(T2);
    const reopened = planItem(done.item, snap, PROJECT, T3)!;
    expect(reopened.item.done_at).toBeNull();
  });
});

describe("closeTargets", () => {
  it("picks the project's doc-sync items the snapshot no longer lists", () => {
    const gone = synced({ key: "demo-app/gone" });
    const liveOnly = synced({ key: "demo-app/live", in_doc_sync: false });
    const other = synced({ key: "other/x", project: "other" });
    const listed = new Set([snap.key]);
    expect(closeTargets([synced(), gone, liveOnly, other], PROJECT, listed)).toEqual([gone]);
  });

  it("reopens when a closed key returns in a later snapshot", () => {
    const closed = synced({
      in_doc_sync: false, status: ItemStatus.Done, done_at: T2, doc_status: ItemStatus.Done, doc_status_at: T2,
    });
    const back = planItem(closed, snap, PROJECT, T3)!;
    expect(back.item).toMatchObject({ status: ItemStatus.Open, in_doc_sync: true, done_at: null, doc_status_at: T3 });
    expect(back.event?.status).toBe(ItemStatus.Open);
  });
});

describe("validateSnapshot", () => {
  it("rejects a repeated key, another project and too many items", () => {
    expect(() => validateSnapshot(PROJECT, [snap, snap])).toThrow("twice");
    expect(() => validateSnapshot(PROJECT, [{ ...snap, project: "other" }])).toThrow("other");
    const many = Array.from({ length: MAX_SNAPSHOT_ITEMS + 1 }, (_, i) => ({ ...snap, key: `k${i}` }));
    expect(() => validateSnapshot(PROJECT, many)).toThrow(String(MAX_SNAPSHOT_ITEMS));
    expect(() => validateSnapshot(PROJECT, [])).not.toThrow();
  });
});
