import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncSnapshot } from "../src/application/board";
import type { ItemRepository } from "../src/application/ports";
import { closeTargets, type SnapshotItem, type SyncRow } from "../src/domain/docSync";
import { closeChunks, D1ItemRepository } from "../src/infrastructure/d1Repository";
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
    // Both writes were skipped by the stale-read guard, so the summary counts neither (Slice 34).
    expect(summary).toMatchObject({ created: 0, updated: 0, closed: 0, unchanged: 0, raced: 1 });
    expect(await get(1)).toMatchObject({ status: "in_progress", source: "agent" });
    expect((await get(1)).events.map((e) => e.note)).not.toContain("Docs changed the status");
    expect(await get(2)).toMatchObject({ status: "in_progress" });
    expect(await inSync(2)).toBe(true);
    expect((await get(2)).events.map((e) => e.note)).not.toContain("Left the plan");
    at(10);
    await sync([item(1, { status: "blocked" })]);
    expect(await get(1)).toMatchObject({ status: "blocked" });
  });

  it("adds no history row for a sync write that lost its race, even when the row looks like the write's result", async () => {
    await sync([item(1)]);
    at(5);
    const repo = new D1ItemRepository(env.DB);
    const racing: ItemRepository = Object.create(repo, {
      loadForSync: {
        value: async (project: string, keys: string[]) => {
          const rows = await repo.loadForSync(project, keys);
          // Same time, status and source as the sync's own write: only changes() can tell it lost (Slice 34).
          await callTool("report_progress", { key: "demo-app/slice-1", status: "blocked", source: "doc-sync" });
          return rows;
        },
      },
    });
    const before = await countRows("events");
    const summary = await syncSnapshot(racing, { project: PROJECT, items: [item(1, { status: "blocked" })] as SnapshotItem[] }, { now: () => new Date() });
    expect(summary).toMatchObject({ updated: 0, raced: 1 });
    expect(await countRows("events")).toBe(before + 1);
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
    expect((await stored2())?.details_md).toBe("now the rest"); // a slice's stored text is never overwritten
    await sync([item(1, { details_md: "the rest of the title" })]);
    const stored = () => env.DB.prepare("SELECT details_md FROM items WHERE key = ?1").bind("demo-app/slice-1").first<{ details_md: string | null }>();
    expect((await stored())?.details_md).toBe("the rest of the title");
    await callTool("report_progress", { key: "demo-app/slice-1", project: PROJECT, details_md: "live notes" });
    at(5);
    await sync([item(1, { title: "Slice 1 retitled", details_md: "changed" })]);
    expect((await stored())?.details_md).toBe("live notes");
  });

  it("Slice 45: an owner step's details and cut title follow its document line on a re-sync", async () => {
    const step = (title: string, details_md?: string) => ({
      key: "demo-app/slice-4/check-0a1b2c3d4e5f", project: PROJECT, title, type: "waiting_for_me", status: "open", ...(details_md ? { details_md } : {}),
    });
    const read = () => env.DB.prepare("SELECT title, details_md FROM items WHERE key = ?1").bind("demo-app/slice-4/check-0a1b2c3d4e5f").first<{ title: string; details_md: string | null }>();
    await sync([step("Slice 4: a long run-on title that was cut", "old steps")] as never);
    expect(await read()).toEqual({ title: "Slice 4: a long run-on title that was cut", details_md: "old steps" });
    at(2);
    await sync([step("Slice 4: set it up", "go to the page, then test")] as never);
    expect(await read()).toEqual({ title: "Slice 4: set it up", details_md: "go to the page, then test" });
    at(3);
    await sync([step("Slice 4: set it up")] as never);
    expect((await read())?.details_md).toBe("go to the page, then test");
  });

  it("Slice 45 #3: a document line edited down to no steps clears the card's steps text", async () => {
    const key = "demo-app/slice-4/check-0a1b2c3d4e5f";
    const step = (details_md?: string | null) => ({ key, project: PROJECT, title: "Slice 4: do X", type: "waiting_for_me", status: "open", ...(details_md === undefined ? {} : { details_md }) });
    const read = () => env.DB.prepare("SELECT details_md FROM items WHERE key = ?1").bind(key).first<{ details_md: string | null }>();
    await sync([step("open page, copy key")] as never);
    at(2);
    await sync([step(null)] as never);
    expect((await read())?.details_md).toBeNull();
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

  it("skips everything that names a skipped sibling and keeps the unrelated items, however the snapshot is ordered (Slice 47 3f, 3g)", async () => {
    const selfParent = { ...item(1), parent_key: "demo-app/slice-1" };
    const check = { key: "demo-app/slice-1/check-9", project: PROJECT, type: "check", title: "c", status: "open", parent_key: "demo-app/slice-1" };
    const bug = { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "b", status: "open", parent_key: "demo-app/slice-1" };
    const reply = await sync([bug, check, item(2), selfParent, item(3)]);
    expect(reply.data).toMatchObject({ created: 2, skipped: expect.arrayContaining([{ key: bug.key }, { key: check.key }, { key: selfParent.key }].map((s) => expect.objectContaining(s))) });
    expect(await countRows("items")).toBe(2);
  });
});

describe("the close rule, in the domain and in SQL (Slice 34)", () => {
  it("closes exactly the rows closeTargets names", async () => {
    await sync([item(1), item(2), item(3)]);
    await sync([{ ...item(1), project: "other-app", key: "other-app/slice-1" }], "other-app");
    await callTool("report_progress", { key: "demo-app/live", project: PROJECT, type: "bug", title: "Live" });
    const repo = new D1ItemRepository(env.DB);
    const listed = new Set(["demo-app/slice-1"]);
    const stored = await repo.loadForSync(PROJECT, ["demo-app/live", "other-app/slice-1"]);
    const expected = closeTargets(stored, PROJECT, listed).map((row) => row.key).sort();
    expect(expected).toEqual(["demo-app/slice-2", "demo-app/slice-3"]);
    await sync([item(1)]);
    const closed = await env.DB.prepare("SELECT item_key FROM events WHERE note = 'Left the plan' ORDER BY item_key").all<{ item_key: string }>();
    expect(closed.results.map((row) => row.item_key)).toEqual(expected);
    const stillSynced = await env.DB.prepare("SELECT key FROM items WHERE in_doc_sync = 1 ORDER BY key").all<{ key: string }>();
    expect(stillSynced.results.map((row) => row.key)).toEqual(["demo-app/slice-1", "other-app/slice-1"]);
  });
});

describe("a very large close (Slice 34)", () => {
  const BIG_CLOSE = 5000;

  it("sizes the chunks by bytes, so long non-ASCII keys stay under D1's 100 KB statement limit", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      key: `demo-app/${"界".repeat(200)}-${i}`,
      updated_at: "2026-11-01T00:00:00.000Z",
      live_status_at: null,
    })) as unknown as SyncRow[];
    const chunks = closeChunks(rows);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(new TextEncoder().encode(chunk).length).toBeLessThan(100_000 / 1.5);
    expect(chunks.flatMap((chunk) => JSON.parse(chunk) as unknown[])).toHaveLength(300);
  });

  const LONG_TEST_MS = 60_000;

  it("closes 5,000 rows that left the plan, in chunks of one batch, and counts them", { timeout: LONG_TEST_MS }, async () => {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO items (key, project, type, priority, status, title, links, source, heartbeat_at, created_at, updated_at, in_doc_sync)
       SELECT 'demo-app/old-' || i || '-' || hex(randomblob(60)), 'demo-app', 'unplanned', 'P2', 'open', 'Old ' || i, '[]', 'doc-sync',
         '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 1 FROM n`,
    ).bind(BIG_CLOSE).run();
    const reply = await sync([item(1)]);
    expect(reply.isError).toBe(false);
    expect(reply.data).toMatchObject({ created: 1, closed: BIG_CLOSE });
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE in_doc_sync = 1 AND status != 'done'").first<{ n: number }>();
    expect(open?.n).toBe(1);
    const events = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE note = 'Left the plan'").first<{ n: number }>();
    expect(events?.n).toBe(BIG_CLOSE);
  });
});
