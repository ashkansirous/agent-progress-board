import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncSnapshot } from "../src/application/board";
import type { ItemRepository } from "../src/application/ports";
import type { SnapshotItem } from "../src/domain/docSync";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, READ_TOKEN, resetBoard } from "./helpers";

interface Stored {
  key: string;
  status: string;
  title: string;
  source: string | null;
  updated_at: string;
  done_at: string | null;
  events: { note: string | null; status: string; source: string | null }[];
}

const PROJECT = "demo-app";
const item = (n: number, over: Record<string, unknown> = {}) => ({
  key: `demo-app/slice-${n}`,
  project: PROJECT,
  type: "slice",
  title: `Slice ${n}`,
  status: "open",
  parent: "Plan · Search",
  ...over,
});

const sync = (items: unknown[], project = PROJECT) => callTool("sync_snapshot", { project, items });
const get = async (n: number) => (await callTool("get_item", { key: `demo-app/slice-${n}` })).data as Stored;
/** in_doc_sync is internal (not in the item the tools return), so read it from the table. */
const inSync = async (n: number) =>
  (await env.DB.prepare("SELECT in_doc_sync FROM items WHERE key = ?1").bind(`demo-app/slice-${n}`).first<{ in_doc_sync: number }>())
    ?.in_doc_sync === 1;
const at = (minutes: number) => vi.setSystemTime(new Date(Date.UTC(2026, 10, 15, 10, minutes)));

beforeEach(async () => {
  await resetBoard();
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
});
afterEach(() => vi.useRealTimers());

describe("sync_snapshot", () => {
  it("creates doc-sync items, then a second identical sync changes nothing", async () => {
    const first = await sync([item(1), item(2)]);
    expect(first.data).toMatchObject({ created: 2, updated: 0, closed: 0 });
    const before = await get(1);
    const events = await countRows("events");
    at(5);
    const second = await sync([item(1), item(2)]);
    expect(second.data).toMatchObject({ created: 0, updated: 0, closed: 0, unchanged: 2 });
    expect(await get(1)).toEqual(before);
    expect(await countRows("events")).toBe(events);
    expect(before).toMatchObject({ source: "doc-sync" });
    expect(await inSync(1)).toBe(true);
    expect(before.events[0]).toMatchObject({ note: "Added by doc sync", source: "doc-sync" });
  });

  it("closes doc-sync items missing from the snapshot, never live-only ones", async () => {
    await sync([item(1), item(2)]);
    await callTool("report_progress", { key: "demo-app/live", project: PROJECT, type: "bug", title: "Live" });
    at(5);
    const reply = await sync([item(1)]);
    expect(reply.data).toMatchObject({ closed: 1, unchanged: 1 });
    expect(await get(2)).toMatchObject({ status: "done" });
    expect(await inSync(2)).toBe(false);
    expect((await get(2)).events[0]).toMatchObject({ note: "Left the plan", status: "done" });
    const live = (await callTool("get_item", { key: "demo-app/live" })).data as Stored;
    expect(live.status).toBe("open");
  });

  it("reopens a closed item when its key comes back", async () => {
    await sync([item(1)]);
    at(5);
    await sync([]);
    expect(await get(1)).toMatchObject({ status: "done", done_at: expect.any(String) });
    at(10);
    await sync([item(1)]);
    expect(await get(1)).toMatchObject({ status: "open", done_at: null });
    expect(await inSync(1)).toBe(true);
  });

  it("keeps a live in_progress across syncs until the docs change, then the docs win", async () => {
    await sync([item(1)]);
    at(5);
    await callTool("report_progress", { key: "demo-app/slice-1", status: "in_progress", source: "agent" });
    at(10);
    expect((await sync([item(1, { title: "Renamed" })])).data).toMatchObject({ updated: 1 });
    expect(await get(1)).toMatchObject({ status: "in_progress", title: "Renamed" });
    at(15);
    await sync([item(1, { status: "blocked" })]);
    expect(await get(1)).toMatchObject({ status: "blocked" });
  });

  it("does not count a doc-sync-sourced report as live", async () => {
    await sync([item(1)]);
    at(5);
    await callTool("report_progress", { key: "demo-app/slice-1", status: "in_progress", source: "doc-sync" });
    at(10);
    await sync([item(1, { title: "Renamed" })]);
    expect(await get(1)).toMatchObject({ status: "open" });
  });

  it("adopts a live-only item: the docs' title, but the live blocked status stays on first sync", async () => {
    await callTool("report_progress", { key: "demo-app/slice-1", project: PROJECT, type: "slice", title: "Old", status: "blocked", source: "agent-a" });
    at(5);
    await sync([item(1)]);
    const adopted = await get(1);
    expect(adopted).toMatchObject({ title: "Slice 1", status: "blocked", source: "agent-a" });
    expect(await inSync(1)).toBe(true);
    expect(adopted.events).toHaveLength(1);
    at(10);
    await sync([item(1, { status: "in_progress" })]);
    expect(await get(1)).toMatchObject({ status: "in_progress", source: "doc-sync" });
  });

  it("keeps the live reporter's source on a title-only change", async () => {
    await sync([item(1)]);
    at(5);
    await callTool("report_progress", { key: "demo-app/slice-1", status: "in_progress", source: "agent-a" });
    at(10);
    await sync([item(1, { title: "Renamed" })]);
    expect(await get(1)).toMatchObject({ title: "Renamed", source: "agent-a" });
  });

  it("does not return the sync's internal columns", async () => {
    await sync([item(1)]);
    const stored = await get(1);
    for (const column of ["doc_status", "doc_status_at", "live_status_at"]) {
      expect(stored).not.toHaveProperty(column);
    }
  });

  it("keeps the checks of a done slice open, and a second sync changes nothing (Slice 42: built, not in progress)", async () => {
    const built = item(7, { status: "done", checks: [{ key: "demo-app/slice-7/check-a", title: "Try it" }, { key: "demo-app/slice-7/check-b", title: "Try more" }] });
    expect((await sync([built])).data).toMatchObject({ created: 3, closed: 0 });
    at(5);
    expect((await sync([built])).data).toMatchObject({ created: 0, updated: 0, closed: 0, unchanged: 3 });
    expect(await get(7)).toMatchObject({ status: "done" });
    const check = (await callTool("get_item", { key: "demo-app/slice-7/check-a" })).data as Stored;
    expect(check).toMatchObject({ status: "open" });
  });

  it("closes many items with an empty snapshot in one go", async () => {
    const many = Array.from({ length: 150 }, (_, i) => item(i + 1));
    await sync(many);
    at(5);
    expect((await sync([])).data).toMatchObject({ closed: 150, created: 0 });
    expect(await get(150)).toMatchObject({ status: "done" });
    expect(await inSync(150)).toBe(false);
    expect((await get(150)).events[0]).toMatchObject({ note: "Left the plan" });
    expect(await countRows("events")).toBe(300);
  });

  it("never undoes a live report that lands between the read and the write", async () => {
    await sync([item(1), item(2)]);
    at(5);
    const repo = new D1ItemRepository(env.DB);
    const racing: ItemRepository = Object.create(repo, {
      loadForSync: {
        value: async (project: string, keys: string[]) => {
          const rows = await repo.loadForSync(project, keys);
          at(6);
          await callTool("report_progress", { key: "demo-app/slice-1", status: "in_progress", source: "agent" });
          await callTool("report_progress", { key: "demo-app/slice-2", status: "in_progress", source: "agent" });
          return rows;
        },
      },
    });
    at(7);
    const snapshot = { project: PROJECT, items: [item(1, { status: "blocked" })] as SnapshotItem[] };
    const summary = await syncSnapshot(racing, snapshot, { now: () => new Date() });
    expect(summary).toMatchObject({ updated: 1, closed: 1 });
    expect(await get(1)).toMatchObject({ status: "in_progress", source: "agent" });
    expect((await get(1)).events.map((e) => e.note)).not.toContain("Docs changed the status");
    expect(await get(2)).toMatchObject({ status: "in_progress" });
    expect(await inSync(2)).toBe(true);
    expect((await get(2)).events.map((e) => e.note)).not.toContain("Left the plan");
    at(10);
    await sync([item(1, { status: "blocked" })]);
    expect(await get(1)).toMatchObject({ status: "blocked" });
  });

  it("keeps an item open when a same-status live report lands between the read and the close", async () => {
    await sync([item(1), item(2)]);
    at(5);
    const repo = new D1ItemRepository(env.DB);
    const racing: ItemRepository = Object.create(repo, {
      loadForSync: {
        value: async (project: string, keys: string[]) => {
          const rows = await repo.loadForSync(project, keys);
          at(6);
          await callTool("report_progress", { key: "demo-app/slice-2", status: "open", source: "agent" });
          return rows;
        },
      },
    });
    at(7);
    const snapshot = { project: PROJECT, items: [item(1)] as SnapshotItem[] };
    await syncSnapshot(racing, snapshot, { now: () => new Date() });
    expect(await get(2)).toMatchObject({ status: "open" });
    expect(await inSync(2)).toBe(true);
    expect((await get(2)).events.map((e) => e.note)).not.toContain("Left the plan");
    at(10);
    expect((await sync([item(1)])).data).toMatchObject({ closed: 1 });
    expect(await get(2)).toMatchObject({ status: "done" });
  });

  it("syncs a 200-item snapshot in one call and updates all of it again", async () => {
    const full = Array.from({ length: 200 }, (_, i) => item(i + 1));
    expect((await sync(full)).data).toMatchObject({ created: 200, closed: 0 });
    expect(await countRows("items")).toBe(200);
    at(5);
    const renamed = full.map((one) => ({ ...one, title: `${one.title} renamed` }));
    expect((await sync(renamed)).data).toMatchObject({ updated: 200, unchanged: 0 });
    expect(await get(200)).toMatchObject({ title: "Slice 200 renamed" });
  });

  it("refuses a 201-item snapshot naming the limit, and writes nothing", async () => {
    const reply = await sync(Array.from({ length: 201 }, (_, i) => item(i + 1)));
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("200");
    expect(await countRows("items")).toBe(0);
  });

  it("rejects a bad snapshot and writes nothing", async () => {
    const wrongProject = await sync([item(1, { project: "other" })]);
    expect(wrongProject.isError).toBe(true);
    expect((await sync([item(1), item(1)])).text).toContain("twice");
    const many = await sync(Array.from({ length: 201 }, (_, i) => item(i + 1)));
    expect(many.text).toContain("200");
    expect(await countRows("items")).toBe(0);
  });

  it("refuses a key that belongs to another project", async () => {
    await callTool("report_progress", { key: "demo-app/slice-1", project: "other", type: "slice", title: "Theirs" });
    const reply = await sync([item(2), item(1)]);
    expect(reply.isError).toBe(true);
    expect(await countRows("items")).toBe(1);
  });

  it("needs a write token", async () => {
    const reply = await callTool("sync_snapshot", { project: PROJECT, items: [] }, READ_TOKEN);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("read-only");
  });
});

describe("sync_snapshot rules (Slice 33)", () => {
  const bug = { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "Live bug", status: "open" };

  it("skips a live item of another type that shares the key, and leaves it as it was", async () => {
    await callTool("report_progress", { key: bug.key, project: PROJECT, type: "bug", title: "Live bug" });
    const reply = await sync([{ ...bug, type: "slice", title: "Retyped" }]);
    expect(reply.data).toMatchObject({ created: 0, updated: 0, skipped: [{ key: bug.key, reason: expect.stringContaining("type") }] });
    const row = await env.DB.prepare("SELECT type, title, in_doc_sync FROM items WHERE key = ?1").bind(bug.key).first();
    expect(row).toMatchObject({ type: "bug", title: "Live bug", in_doc_sync: 0 });
  });

  it("closes a doc-synced bug the document dropped, even when its slice sends no parts", async () => {
    await sync([item(1), { ...bug, parent_key: "demo-app/slice-1" }]);
    const reply = await sync([item(1)]);
    expect(reply.data).toMatchObject({ closed: 1 });
    expect((await callTool("get_item", { key: bug.key })).data).toMatchObject({ status: "done" });
  });

  it("keeps the live why and parent on every sync when the snapshot leaves them out, and clears them only with null", async () => {
    await callTool("report_progress", { key: bug.key, project: PROJECT, type: "bug", title: "Live bug", why: "Seen live", parent: "Wave 3" });
    await sync([bug]);
    expect((await callTool("get_item", { key: bug.key })).data).toMatchObject({ why: "Seen live", parent: "Wave 3" });
    await sync([{ ...bug, title: "Again" }]);
    expect((await callTool("get_item", { key: bug.key })).data).toMatchObject({ why: "Seen live", parent: "Wave 3" });
    await sync([{ ...bug, title: "Again", why: null, parent: null }]);
    expect((await callTool("get_item", { key: bug.key })).data).toMatchObject({ why: null, parent: null });
  });

  it("saves a closed key that comes back as done with no event, and keeps its done_at", async () => {
    await sync([item(1, { status: "done" }), item(2)]);
    at(5);
    await sync([item(2)]);
    const closed = await get(1);
    expect(await inSync(1)).toBe(false);
    at(10);
    const reply = await sync([item(1, { status: "done" }), item(2)]);
    expect(reply.data).toMatchObject({ updated: 1, created: 0 });
    expect(await inSync(1)).toBe(true);
    const back = await get(1);
    expect(back.done_at).toBe(closed.done_at);
    expect(back.events).toEqual(closed.events);
  });

  it("clears a stored parent_key with null", async () => {
    await sync([item(1), { ...bug, parent_key: "demo-app/slice-1" }]);
    await sync([item(1), { ...bug, parent_key: null }]);
    expect(((await callTool("get_item", { key: bug.key })).data as { parent_key: string | null }).parent_key).toBeNull();
  });

  it("skips a slice whose part keys would pass the key limit, and an item that is its own parent", async () => {
    const long = `demo-app/${"s".repeat(190)}`;
    const reply = await sync([{ ...item(1), key: long, parts: [{ letter: "A", title: "A", done: false }] }, { ...bug, parent_key: bug.key }]);
    expect(reply.data).toMatchObject({ created: 0, skipped: [{ key: long }, { key: bug.key }] });
  });

  it("validates the expanded set: a nested check with a wrong prefix and a part that repeats a key are skipped, the slice is kept", async () => {
    const dup = { key: "demo-app/slice-1/part-A", project: PROJECT, type: "problem", title: "dup", status: "open", parent_key: "demo-app/slice-1" };
    const slice = {
      ...item(1),
      parts: [{ letter: "A", title: "A", done: false }],
      checks: [{ key: "demo-app/other/check-1", title: "wrong prefix" }],
    };
    const reply = await sync([slice, dup]);
    expect(reply.data).toMatchObject({ created: 2, skipped: expect.arrayContaining([{ key: "demo-app/other/check-1", reason: expect.any(String) }]) });
    expect(await inSync(1)).toBe(true);
    expect(await countRows("items")).toBe(2);
  });

  it("fills a null details_md on an existing key, and never overwrites a set one", async () => {
    await sync([item(2)]);
    const stored2 = () => env.DB.prepare("SELECT details_md FROM items WHERE key = ?1").bind("demo-app/slice-2").first<{ details_md: string | null }>();
    expect((await stored2())?.details_md).toBeNull();
    at(2);
    await sync([item(2, { details_md: "now the rest" })]);
    expect((await stored2())?.details_md).toBe("now the rest");
    at(3);
    await sync([item(2, { details_md: "changed again" })]);
    expect((await stored2())?.details_md).toBe("now the rest");
    await sync([item(1, { details_md: "the rest of the title" })]);
    const stored = () => env.DB.prepare("SELECT details_md FROM items WHERE key = ?1").bind("demo-app/slice-1").first<{ details_md: string | null }>();
    expect((await stored())?.details_md).toBe("the rest of the title");
    await callTool("report_progress", { key: "demo-app/slice-1", project: PROJECT, details_md: "live notes" });
    at(5);
    await sync([item(1, { title: "Slice 1 retitled", details_md: "changed" })]);
    expect((await stored())?.details_md).toBe("live notes");
  });

  it("checks a check against a sibling slice that is itself skipped", async () => {
    const badSlice = { ...item(1), checks: [{ key: "demo-app/other/check-1", title: "x" }] };
    const check = { key: "demo-app/slice-1/check-9", project: PROJECT, type: "check", title: "c", status: "open", parent_key: "demo-app/slice-1" };
    const reply = await sync([check, badSlice]);
    expect(reply.data).toMatchObject({ skipped: expect.arrayContaining([{ key: "demo-app/other/check-1", reason: expect.any(String) }]) });
  });

  it("skips a top-level check whose sibling slice is skipped, and stores neither", async () => {
    const selfParent = { ...item(1), parent_key: "demo-app/slice-1" };
    const check = { key: "demo-app/slice-1/check-9", project: PROJECT, type: "check", title: "c", status: "open", parent_key: "demo-app/slice-1" };
    const reply = await sync([check, selfParent]);
    expect(reply.data).toMatchObject({ created: 0, skipped: [{ key: check.key }, { key: selfParent.key }] });
    expect(await countRows("items")).toBe(0);
  });
});
