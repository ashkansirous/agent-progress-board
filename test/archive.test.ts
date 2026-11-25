import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveItem, purgeArchive } from "../src/application/archive";
import { applyBatch, listBoardRows, markStaleItems } from "../src/application/board";
import { BatchOp } from "../src/domain/docSync";
import { ARCHIVE_KEEP_DAYS, PURGE_CHUNK_ROWS, purgeCutoff } from "../src/domain/archive";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, READ_TOKEN, resetBoard } from "./helpers";

const PROJECT = "demo-app";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const DAY_MS = 86_400_000;
const slice = (n: number, over: Record<string, unknown> = {}) => ({
  key: `demo-app/slice-${n}`, project: PROJECT, type: "slice", title: `Slice ${n}`, status: "open", ...over,
});
const upsert = (item: Record<string, unknown>) => callTool("upsert_item", item);
const archive = (key: string, token?: string) => callTool("archive_item", { key }, token);
const repo = () => new D1ItemRepository(env.DB);
const clockAt = (date: Date) => ({ now: () => date });
const archivedAt = async (key: string) => (await env.DB.prepare("SELECT archived_at FROM items WHERE key = ?1").bind(key).first<{ archived_at: string | null }>())?.archived_at;

beforeEach(async () => {
  await resetBoard();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function openKeys(): Promise<string[]> {
  return ((await callTool("list_open", {})).data as { key: string }[]).map((item) => item.key).sort();
}

/** A card of the given type that names `parent` in parent_key, made by a plain report (not from the plan documents). */
async function addChild(key: string, parent: string, type = "bug"): Promise<void> {
  const reply = await callTool("report_progress", { key, project: PROJECT, type, title: `Card ${key}`, parent_key: parent });
  expect(reply.isError).toBeFalsy();
}

describe("migration 0010", () => {
  it("adds archived_at (null for a stored item) and its index", async () => {
    await callTool("report_progress", { key: "demo-app/task-1", project: PROJECT, type: "unplanned", title: "Live" });
    expect(await archivedAt("demo-app/task-1")).toBeNull();
    const index = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_archived_at'").first();
    expect(index).not.toBeNull();
  });
});

describe("archive_item", () => {
  it("hides the item and its parts and checks from list_open and the board, and keeps everything unchanged", async () => {
    await upsert(slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "Try it" }] }));
    await upsert(slice(2));
    const before = await env.DB.prepare("SELECT * FROM items WHERE key = 'demo-app/slice-1'").first<Record<string, unknown>>();
    const eventsBefore = await countRows("events");
    const reply = await archive("demo-app/slice-1");
    expect(reply.data).toEqual({ key: "demo-app/slice-1", outcome: "archived", archived: 3 });
    expect(await openKeys()).toEqual(["demo-app/slice-2"]);
    const board = await listBoardRows(repo(), {}, { defaultHours: 24, maxHours: 24 }, clockAt(NOW), true);
    expect(board.map((row) => row.key)).toEqual(["demo-app/slice-2"]);
    const after = await env.DB.prepare("SELECT * FROM items WHERE key = 'demo-app/slice-1'").first<Record<string, unknown>>();
    expect(after).toEqual({ ...before, archived_at: NOW.toISOString() });
    expect(await countRows("events")).toBe(eventsBefore + 1);
    const events = (await callTool("get_item", { key: "demo-app/slice-1", include_archived: true })).data as { events: { note: string | null; at: string }[] };
    expect(events.events[0]).toMatchObject({ note: "archived", at: NOW.toISOString() });
  });

  it("reads back with get_item and include_archived only", async () => {
    await upsert(slice(1));
    await archive("demo-app/slice-1");
    const plain = await callTool("get_item", { key: "demo-app/slice-1" });
    expect(plain.isError).toBe(true);
    expect(plain.text).toContain("no item demo-app/slice-1");
    const read = await callTool("get_item", { key: "demo-app/slice-1", include_archived: true });
    expect(read.data).toMatchObject({ key: "demo-app/slice-1", archived_at: NOW.toISOString() });
    expect((read.data as { events: unknown[] }).events.length).toBeGreaterThan(0);
    await upsert(slice(2));
    expect((await callTool("get_item", { key: "demo-app/slice-2", include_archived: true })).data).not.toHaveProperty("archived_at");
  });

  it("keeps the first archive time when archived again", async () => {
    await upsert(slice(1));
    await archive("demo-app/slice-1");
    vi.setSystemTime(new Date(NOW.getTime() + DAY_MS));
    const again = await archive("demo-app/slice-1");
    expect(again.data).toMatchObject({ outcome: "already_archived", archived: 0 });
    expect(await archivedAt("demo-app/slice-1")).toBe(NOW.toISOString());
  });

  it("refuses an unknown key and a read token", async () => {
    expect((await archive("demo-app/slice-9")).text).toContain("no item demo-app/slice-9");
    await upsert(slice(1));
    expect((await archive("demo-app/slice-1", READ_TOKEN)).isError).toBe(true);
    expect(await archivedAt("demo-app/slice-1")).toBeNull();
  });

  it("an item from the plan documents needs the sync scope; any other item needs only a write scope", async () => {
    await upsert(slice(1));
    await callTool("report_progress", { key: "demo-app/task-1", project: PROJECT, type: "unplanned", title: "Live" });
    await expect(archiveItem(repo(), { key: "demo-app/slice-1" }, clockAt(NOW), false)).rejects.toThrow(/needs the static write token/);
    expect(await archivedAt("demo-app/slice-1")).toBeNull();
    const live = await archiveItem(repo(), { key: "demo-app/task-1" }, clockAt(NOW), false);
    expect(live.outcome).toBe("archived");
    expect(await archivedAt("demo-app/task-1")).toBe(NOW.toISOString());
  });

  it("an upsert of the key brings it back, an unchanged one too, and the 30 days start again on the next archive", async () => {
    await upsert(slice(1));
    await archive("demo-app/slice-1");
    expect((await upsert(slice(1))).data).toMatchObject({ outcome: "updated" });
    expect(await archivedAt("demo-app/slice-1")).toBeNull();
    expect(await openKeys()).toEqual(["demo-app/slice-1"]);
    vi.setSystemTime(new Date(NOW.getTime() + 5 * DAY_MS));
    await archive("demo-app/slice-1");
    expect(await archivedAt("demo-app/slice-1")).toBe(new Date(NOW.getTime() + 5 * DAY_MS).toISOString());
  });

  it("a report, mark_done, ask_human or a heartbeat on an archived key is refused with the archived reply and writes nothing", async () => {
    for (const [index, write] of [
      () => callTool("report_progress", { key: "demo-app/task-1", status: "in_progress" }),
      () => callTool("mark_done", { key: "demo-app/task-2" }),
      () => callTool("ask_human", { key: "demo-app/task-3", project: PROJECT, title: "Q", needs_you: "Which one?" }),
      () => callTool("report_progress", { key: "demo-app/task-4" }),
    ].entries()) {
      const key = `demo-app/task-${index + 1}`;
      await callTool("report_progress", { key, project: PROJECT, type: "unplanned", title: "Live" });
      await archive(key);
      const before = await env.DB.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first<Record<string, unknown>>();
      const eventsBefore = await countRows("events");
      const reply = await write();
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(`${key} is archived`);
      expect(reply.text).toContain("upsert_item");
      expect(await env.DB.prepare("SELECT * FROM items WHERE key = ?1").bind(key).first()).toEqual(before);
      expect(await countRows("events")).toBe(eventsBefore);
    }
  });

  it("archives a slice with its parts and checks at one time, and leaves a live bug or waiting card under it alone", async () => {
    await upsert(slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    await addChild("demo-app/bug-1", "demo-app/slice-1");
    await addChild("demo-app/waiting-1", "demo-app/bug-1", "waiting_for_me");
    await archive("demo-app/slice-1");
    const at = NOW.toISOString();
    for (const key of ["demo-app/slice-1", "demo-app/slice-1/part-A", "demo-app/slice-1/check-1"]) expect(await archivedAt(key)).toBe(at);
    for (const key of ["demo-app/bug-1", "demo-app/waiting-1"]) expect(await archivedAt(key)).toBeNull();
    expect(await openKeys()).toEqual(["demo-app/bug-1", "demo-app/waiting-1"]);
  });

  it("the statement refuses a caller without the sync scope that would take a doc-synced row, whatever the earlier read said", async () => {
    await upsert(slice(1, { checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    const refused = await repo().applyBatch([], [], { keys: ["demo-app/slice-1"], canSync: false }, NOW.toISOString());
    expect(refused.archived).toBe(0);
    expect(await archivedAt("demo-app/slice-1")).toBeNull();
    expect(await archivedAt("demo-app/slice-1/check-1")).toBeNull();
    await callTool("report_progress", { key: "demo-app/task-1", project: PROJECT, type: "unplanned", title: "Live" });
    await addChild("demo-app/bug-1", "demo-app/task-1");
    const allowed = await repo().applyBatch([], [], { keys: ["demo-app/task-1"], canSync: false }, NOW.toISOString());
    expect(allowed.archived).toBe(1);
    expect(await archivedAt("demo-app/bug-1")).toBeNull();
  });

  it("apply_batch with only an archive of a doc-synced key by a caller without the sync scope is refused whole", async () => {
    await upsert(slice(1));
    await expect(applyBatch(repo(), { project: PROJECT, operations: [{ op: BatchOp.Archive, key: "demo-app/slice-1" }] }, clockAt(NOW), false)).rejects.toThrow(/needs the static write token/);
    expect(await archivedAt("demo-app/slice-1")).toBeNull();
  });

  it("writes one archived history row for each archived root, and none when the key was archived already", async () => {
    await upsert(slice(1, { checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    await archive("demo-app/slice-1");
    await archive("demo-app/slice-1");
    const rows = await env.DB.prepare("SELECT item_key FROM events WHERE note = 'archived'").all<{ item_key: string }>();
    expect(rows.results.map((row) => row.item_key)).toEqual(["demo-app/slice-1"]);
  });

  it("an upsert brings back the subtree with the same time, and a row archived on its own earlier stays archived", async () => {
    await upsert(slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "One" }, { key: "demo-app/slice-1/check-2", title: "Two" }] }));
    vi.setSystemTime(new Date(NOW.getTime() - DAY_MS));
    await archive("demo-app/slice-1/check-2");
    vi.setSystemTime(NOW);
    await archive("demo-app/slice-1");
    await upsert(slice(1));
    for (const key of ["demo-app/slice-1", "demo-app/slice-1/part-A", "demo-app/slice-1/check-1"]) expect(await archivedAt(key)).toBeNull();
    expect(await archivedAt("demo-app/slice-1/check-2")).toBe(new Date(NOW.getTime() - DAY_MS).toISOString());
  });

  it("a revive does not pass through a row archived at another time: what hangs under it stays archived", async () => {
    await upsert(slice(1, { checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    await addChild("demo-app/bug-1", "demo-app/slice-1/check-1");
    await archive("demo-app/slice-1");
    const other = new Date(NOW.getTime() - DAY_MS).toISOString();
    await env.DB.prepare("UPDATE items SET archived_at = ?1 WHERE key = 'demo-app/slice-1/check-1'").bind(other).run();
    await env.DB.prepare("UPDATE items SET archived_at = ?1 WHERE key = 'demo-app/bug-1'").bind(NOW.toISOString()).run();
    await upsert(slice(1));
    expect(await archivedAt("demo-app/slice-1")).toBeNull();
    expect(await archivedAt("demo-app/slice-1/check-1")).toBe(other);
    expect(await archivedAt("demo-app/bug-1")).toBe(NOW.toISOString());
  });

  it("an upsert brings the slice back with its parts and checks, with or without lists, and a part the documents dropped comes back for the next sync to close", async () => {
    await upsert(slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "One" }, { key: "demo-app/slice-1/check-2", title: "Two" }] }));
    await archive("demo-app/slice-1");
    await upsert(slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    for (const key of ["demo-app/slice-1/part-A", "demo-app/slice-1/check-1", "demo-app/slice-1/check-2"]) expect(await archivedAt(key)).toBeNull();
    await archive("demo-app/slice-1");
    await upsert(slice(1));
    const archivedLeft = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE parent_key = 'demo-app/slice-1' AND archived_at IS NOT NULL").first<{ n: number }>();
    expect(archivedLeft?.n).toBe(0);
  });

  it("an unchanged sync_snapshot leaves an archived doc item and its parts and checks archived; a changed one brings the subtree back", async () => {
    const full = slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] });
    await upsert(full);
    await archive("demo-app/slice-1");
    const same = await callTool("sync_snapshot", { project: PROJECT, items: [full] });
    expect(same.isError).toBeFalsy();
    for (const key of ["demo-app/slice-1", "demo-app/slice-1/part-A", "demo-app/slice-1/check-1"]) expect(await archivedAt(key)).toBe(NOW.toISOString());
    await callTool("sync_snapshot", { project: PROJECT, items: [{ ...full, title: "Retitled" }] });
    for (const key of ["demo-app/slice-1", "demo-app/slice-1/part-A", "demo-app/slice-1/check-1"]) expect(await archivedAt(key)).toBeNull();
  });

  it("a sync that adds or changes a part under an archived slice stores it archived with the slice's time", async () => {
    const full = slice(1, { parts: [{ letter: "A", title: "Work", done: false }] });
    await upsert(full);
    await archive("demo-app/slice-1");
    const more = { ...full, parts: [{ letter: "A", title: "Work", done: false }, { letter: "B", title: "New", done: false }] };
    expect((await callTool("sync_snapshot", { project: PROJECT, items: [more] })).isError).toBeFalsy();
    expect(await archivedAt("demo-app/slice-1/part-B")).toBe(NOW.toISOString());
    const changed = { ...more, parts: [{ letter: "A", title: "Renamed", done: false }, more.parts[1]] };
    await callTool("sync_snapshot", { project: PROJECT, items: [changed] });
    for (const key of ["demo-app/slice-1", "demo-app/slice-1/part-A", "demo-app/slice-1/part-B"]) expect(await archivedAt(key)).toBe(NOW.toISOString());
    await upsert(slice(1));
    for (const key of ["demo-app/slice-1", "demo-app/slice-1/part-A", "demo-app/slice-1/part-B"]) expect(await archivedAt(key)).toBeNull();
  });

  it("a bug card reported under an archived slice stays live", async () => {
    await upsert(slice(1));
    await archive("demo-app/slice-1");
    await addChild("demo-app/bug-1", "demo-app/slice-1");
    expect(await archivedAt("demo-app/bug-1")).toBeNull();
  });

  it("a sync close never touches an archived row", async () => {
    await upsert(slice(1));
    await upsert(slice(2));
    await archive("demo-app/slice-1");
    const before = await env.DB.prepare("SELECT status, in_doc_sync, updated_at FROM items WHERE key = 'demo-app/slice-1'").first();
    expect((await callTool("sync_snapshot", { project: PROJECT, items: [slice(2)] })).isError).toBeFalsy();
    expect(await env.DB.prepare("SELECT status, in_doc_sync, updated_at FROM items WHERE key = 'demo-app/slice-1'").first()).toEqual(before);
    expect(await archivedAt("demo-app/slice-1")).toBe(NOW.toISOString());
  });

  it("an owner-scope caller cannot archive a slice that has doc-synced checks under it", async () => {
    await callTool("report_progress", { key: "demo-app/slice-9", project: PROJECT, type: "slice", title: "By a report" });
    await upsert(slice(1, { checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    await env.DB.prepare("UPDATE items SET parent_key = 'demo-app/slice-9' WHERE key = 'demo-app/slice-1/check-1'").run();
    await expect(archiveItem(repo(), { key: "demo-app/slice-9" }, clockAt(NOW), false)).rejects.toThrow(/items under it that come from the plan documents/);
    expect(await archivedAt("demo-app/slice-1/check-1")).toBeNull();
  });

  it("a done slice kept on the board by an open check leaves it when that check is archived", async () => {
    await upsert(slice(1, { status: "done", checks: [{ key: "demo-app/slice-1/check-1", title: "Try it" }] }));
    vi.setSystemTime(new Date(NOW.getTime() + 30 * DAY_MS));
    expect(await openKeys()).toEqual(["demo-app/slice-1", "demo-app/slice-1/check-1"]);
    await archive("demo-app/slice-1/check-1");
    expect(await openKeys()).toEqual([]);
  });

  it("is left out of the cron's stale and waiting-card rules", async () => {
    await callTool("report_progress", { key: "demo-app/task-1", project: PROJECT, type: "unplanned", title: "Old", status: "in_progress" });
    await callTool("ask_human", { key: "demo-app/ask-1", project: PROJECT, title: "Q", needs_you: "Which one?" });
    await archive("demo-app/task-1");
    await archive("demo-app/ask-1");
    const later = clockAt(new Date(NOW.getTime() + 3 * DAY_MS));
    const result = await markStaleItems(repo(), 120, later);
    expect(result).toEqual({ stale: 0, waitingClosed: 0 });
  });
});

describe("purge after 30 days", () => {
  const archivedDaysAgo = async (key: string, days: number): Promise<void> => {
    await env.DB.prepare("UPDATE items SET archived_at = ?2 WHERE key = ?1 OR parent_key = ?1")
      .bind(key, new Date(NOW.getTime() - days * DAY_MS).toISOString())
      .run();
  };

  it("keeps the period in one constant", () => {
    expect(ARCHIVE_KEEP_DAYS).toBe(30);
    expect(purgeCutoff(NOW)).toBe("2026-10-21T12:00:00.000Z");
  });

  it("removes items archived more than 30 days ago with their parts, checks and events, and keeps the rest", async () => {
    await upsert(slice(1, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "Try it" }] }));
    await upsert(slice(2));
    await upsert(slice(3));
    await archive("demo-app/slice-1");
    await archive("demo-app/slice-2");
    await archivedDaysAgo("demo-app/slice-1", ARCHIVE_KEEP_DAYS + 1);
    await archivedDaysAgo("demo-app/slice-2", ARCHIVE_KEEP_DAYS - 1);
    const purged = await purgeArchive(repo(), clockAt(NOW));
    expect(purged).toEqual({ removed: 3, unlinked: 0 });
    expect(await countRows("items")).toBe(2);
    const keys = (await env.DB.prepare("SELECT key FROM items ORDER BY key").all<{ key: string }>()).results.map((row) => row.key);
    expect(keys).toEqual(["demo-app/slice-2", "demo-app/slice-3"]);
    const orphans = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE item_key NOT IN (SELECT key FROM items)").first<{ n: number }>();
    expect(orphans?.n).toBe(0);
    expect(await countRows("events")).toBe(3);
    expect(await purgeArchive(repo(), clockAt(NOW))).toEqual({ removed: 0, unlinked: 0 });
  });

  it("purges a doc-synced check with its slice (never a NULL parent left) and clears the parent_key of a live bug card", async () => {
    await upsert(slice(1, { checks: [{ key: "demo-app/slice-1/check-1", title: "One" }] }));
    await callTool("report_progress", { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "A bug", parent_key: "demo-app/slice-1" });
    await archive("demo-app/slice-1");
    const old = purgeCutoff(new Date(NOW.getTime() - DAY_MS));
    await env.DB.prepare("UPDATE items SET archived_at = ?1 WHERE archived_at IS NOT NULL").bind(old).run();
    expect(await purgeArchive(repo(), clockAt(NOW))).toEqual({ removed: 2, unlinked: 1 });
    const parentOf = async (key: string) => (await env.DB.prepare("SELECT parent_key FROM items WHERE key = ?1").bind(key).first<{ parent_key: string | null }>())?.parent_key;
    expect(await parentOf("demo-app/bug-1")).toBeNull();
    expect(await countRows("items")).toBe(1);
  });

  it("purges by the row's own time only: a child archived on its own goes on its own time under a live parent, one past 30 days with it", async () => {
    await upsert(slice(2, { checks: [{ key: "demo-app/slice-2/check-1", title: "Try it" }, { key: "demo-app/slice-2/check-2", title: "Other" }] }));
    const old = purgeCutoff(new Date(NOW.getTime() - DAY_MS));
    await env.DB.prepare("UPDATE items SET archived_at = ?1 WHERE key = 'demo-app/slice-2/check-1'").bind(old).run();
    await env.DB.prepare("UPDATE items SET archived_at = ?1 WHERE key = 'demo-app/slice-2/check-2'").bind(new Date(NOW.getTime() - DAY_MS).toISOString()).run();
    expect((await purgeArchive(repo(), clockAt(NOW))).removed).toBe(1);
    expect(await countRows("items")).toBe(2);
  });

  it("removes a large backlog in bounded chunks over one run, and never a live item", async () => {
    const count = PURGE_CHUNK_ROWS * 2 + 50;
    const old = new Date(NOW.getTime() - (ARCHIVE_KEEP_DAYS + 5) * DAY_MS).toISOString();
    const insert = env.DB.prepare(
      "INSERT INTO items (key, project, type, priority, status, title, source, heartbeat_at, created_at, updated_at, archived_at) VALUES (?1, 'demo-app', 'unplanned', 'P2', 'done', 't', NULL, ?2, ?2, ?2, ?2)",
    );
    await env.DB.batch(Array.from({ length: count }, (_, i) => insert.bind(`demo-app/old-${i}`, old)));
    await upsert(slice(1));
    expect((await purgeArchive(repo(), clockAt(NOW))).removed).toBe(count);
    expect(await countRows("items")).toBe(1);
  });

  it("is run by the scheduled handler", async () => {
    const { default: worker } = await import("../src/index");
    const { createScheduledController, createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    await upsert(slice(1));
    await archive("demo-app/slice-1");
    await archivedDaysAgo("demo-app/slice-1", ARCHIVE_KEEP_DAYS + 1);
    vi.setSystemTime(NOW);
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "*/15 * * * *" }), { ...env });
    await waitOnExecutionContext(ctx);
    expect(await countRows("items")).toBe(0);
  });
});
