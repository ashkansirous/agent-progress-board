import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBatch } from "../src/application/board";
import { BatchOp, docHash, MAX_BATCH_ITEMS, type SnapshotItem } from "../src/domain/docSync";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, READ_TOKEN, resetBoard } from "./helpers";

const PROJECT = "demo-app";
type TestItem = SnapshotItem & Record<string, unknown>;
const slice = (n: number, over: Record<string, unknown> = {}): TestItem =>
  ({ key: `demo-app/slice-${n}`, project: PROJECT, type: "slice", title: `Slice ${n}`, status: "open", ...over }) as TestItem;
const upsert = (item: TestItem) => ({ op: "upsert", item });
const close = (key: string) => ({ op: "close", key });
const archive = (key: string) => ({ op: "archive", key });
const batch = (operations: unknown[], token?: string) => callTool("apply_batch", { project: PROJECT, operations }, token);
const stored = async (key: string) =>
  env.DB.prepare("SELECT status, in_doc_sync, archived_at FROM items WHERE key = ?1").bind(key).first<{ status: string; in_doc_sync: number; archived_at: string | null }>();
const at = (minutes: number) => vi.setSystemTime(new Date(Date.UTC(2026, 10, 15, 10, minutes)));

beforeEach(async () => {
  await resetBoard();
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
});
afterEach(() => vi.useRealTimers());

describe("apply_batch", () => {
  it("accepts 200 items and refuses 201, writing nothing for the refused call", async () => {
    const ok = await batch(Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => upsert(slice(i + 1))));
    expect(ok.isError).toBe(false);
    expect(ok.data).toMatchObject({ created: 200, updated: 0, unchanged: 0, closed: 0, archived: 0, raced: 0 });
    expect(await countRows("items")).toBe(200);
    const over = await batch(Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => upsert(slice(i + 1000))));
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/expected array to have <=200 items/);
    expect(await countRows("items")).toBe(200);
  });

  it("counts parts and checks toward the 200: 101 slices with one part each is refused", async () => {
    const withPart = (n: number) => slice(n, { parts: [{ letter: "A", title: "Work", done: false }] });
    const refused = await batch(Array.from({ length: 101 }, (_, i) => upsert(withPart(i + 1))));
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("at most 200 items per call after parts and checks, got 202");
    const accepted = await batch(Array.from({ length: 100 }, (_, i) => upsert(withPart(i + 1))));
    expect(accepted.data).toMatchObject({ created: 200 - 100 });
    expect(await countRows("items")).toBe(200);
  });

  it("applies a mixed batch of upsert, close and archive with one result line per operation", async () => {
    await batch([upsert(slice(1)), upsert(slice(2, { parts: [{ letter: "A", title: "Work", done: false }], checks: [{ key: "demo-app/slice-2/check-1", title: "On the S21" }] })), upsert(slice(3))]);
    at(5);
    const reply = await batch([upsert(slice(1, { title: "Renamed" })), upsert(slice(4)), close("demo-app/slice-2"), archive("demo-app/slice-3")]);
    expect(reply.isError).toBe(false);
    const data = reply.data as { results: { op: string; key: string; outcome: string }[] };
    expect(data.results).toEqual([
      { op: "upsert", key: "demo-app/slice-1", outcome: "updated" },
      { op: "upsert", key: "demo-app/slice-4", outcome: "created" },
      { op: "close", key: "demo-app/slice-2", outcome: "closed" },
      { op: "archive", key: "demo-app/slice-3", outcome: "archived" },
    ]);
    expect(reply.data).toMatchObject({ created: 1, updated: 1, closed: 3, archived: 1, raced: 0 });
    expect(await stored("demo-app/slice-2")).toMatchObject({ status: "done", in_doc_sync: 0 });
    expect(await stored("demo-app/slice-2/part-A")).toMatchObject({ status: "done", in_doc_sync: 0 });
    expect(await stored("demo-app/slice-2/check-1")).toMatchObject({ status: "done", in_doc_sync: 0 });
    expect(await stored("demo-app/slice-3")).toMatchObject({ archived_at: "2026-11-15T10:05:00.000Z" });
    const events = await env.DB.prepare("SELECT note FROM events WHERE item_key = 'demo-app/slice-2'").all<{ note: string }>();
    expect(events.results.map((row) => row.note)).toContain("Left the plan");
  });

  it("refuses the whole call for one bad operation and names its key; nothing is written", async () => {
    const bad = { key: "demo-app/slice-9/check-1", project: PROJECT, type: "check", title: "No slice named", status: "open" };
    const reply = await batch([upsert(slice(1)), upsert(bad as TestItem), upsert(slice(2))]);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("demo-app/slice-9/check-1");
    expect(await countRows("items")).toBe(0);
    expect(await countRows("events")).toBe(0);
  });

  it("refuses a repeated key, another project's item, an unknown close and an unknown archive", async () => {
    await batch([upsert(slice(1))]);
    expect((await batch([upsert(slice(1)), close("demo-app/slice-1")])).text).toContain("operation 1 repeats key demo-app/slice-1");
    expect((await batch([upsert(slice(2, { project: "other" }))])).isError).toBe(true);
    expect((await batch([close("demo-app/slice-77")])).text).toContain("no item demo-app/slice-77");
    expect((await batch([archive("demo-app/slice-77")])).text).toContain("no item demo-app/slice-77");
    expect(await countRows("items")).toBe(1);
  });

  it("treats a close of an item already closed as a no-op, and leaves other items alone", async () => {
    await batch([upsert(slice(1)), upsert(slice(2))]);
    await batch([close("demo-app/slice-1")]);
    const again = await batch([close("demo-app/slice-1")]);
    expect(again.data).toMatchObject({ closed: 0, results: [{ outcome: "already_closed" }] });
    expect(await stored("demo-app/slice-2")).toMatchObject({ status: "open", in_doc_sync: 1 });
  });

  it("closes the parts and checks an upserted slice no longer lists, and keeps them when it sends no lists", async () => {
    const lists = { parts: [{ letter: "A", title: "One", done: false }, { letter: "B", title: "Two", done: false }], checks: [{ key: "demo-app/slice-1/check-1", title: "Try it" }] };
    await batch([upsert(slice(1, lists))]);
    await batch([upsert(slice(1))]);
    expect(await stored("demo-app/slice-1/part-B")).toMatchObject({ in_doc_sync: 1 });
    await batch([upsert(slice(1, { parts: [{ letter: "A", title: "One", done: true }], checks: [] }))]);
    expect(await stored("demo-app/slice-1/part-B")).toMatchObject({ in_doc_sync: 0, status: "done" });
    expect(await stored("demo-app/slice-1/part-A")).toMatchObject({ in_doc_sync: 1, status: "done" });
    expect(await stored("demo-app/slice-1/check-1")).toMatchObject({ in_doc_sync: 0 });
  });

  it("refuses a read token, and an upsert or close from a caller that may not write plan documents", async () => {
    expect((await batch([upsert(slice(1))], READ_TOKEN)).isError).toBe(true);
    const repo = new D1ItemRepository(env.DB);
    const clock = { now: () => new Date() };
    const input = (operation: unknown) => ({ project: PROJECT, operations: [operation as never] });
    await expect(applyBatch(repo, input({ op: BatchOp.Upsert, item: slice(1) }), clock, false)).rejects.toThrow(/need the static write token/);
    await expect(applyBatch(repo, input({ op: BatchOp.Close, key: "demo-app/slice-1" }), clock, false)).rejects.toThrow(/need the static write token/);
    expect(await countRows("items")).toBe(0);
  });
});

describe("upsert_item", () => {
  it("adds and updates one item with its parts and checks, and closes nothing else", async () => {
    await callTool("upsert_item", slice(1));
    await callTool("upsert_item", slice(2));
    at(5);
    const reply = await callTool("upsert_item", slice(1, { title: "Renamed", parts: [{ letter: "A", title: "Work", done: false }] }));
    expect(reply.data).toMatchObject({ op: "upsert", key: "demo-app/slice-1", outcome: "updated", raced: 0 });
    expect(await stored("demo-app/slice-1/part-A")).toMatchObject({ in_doc_sync: 1 });
    expect(await stored("demo-app/slice-2")).toMatchObject({ status: "open", in_doc_sync: 1 });
    const same = await callTool("upsert_item", slice(1, { title: "Renamed", parts: [{ letter: "A", title: "Work", done: false }] }));
    expect(same.data).toMatchObject({ outcome: "unchanged" });
  });

  it("refuses a read token and the same key in another project", async () => {
    expect((await callTool("upsert_item", slice(1), READ_TOKEN)).isError).toBe(true);
    await callTool("upsert_item", slice(1));
    const other = await callTool("upsert_item", slice(1, { project: "other" }));
    expect(other.isError).toBe(true);
    expect(other.text).toContain("belongs to project demo-app");
  });
});

describe("list_synced", () => {
  const lists = { parts: [{ letter: "A", title: "One", done: true }], checks: [{ key: "demo-app/slice-2/check-1", title: "Try it" }] };

  it("lists top-level doc-sync items by key with the hash of what was sent, parts and checks inside it", async () => {
    const two = slice(2, lists);
    await batch([upsert(slice(1)), upsert(two), upsert(slice(3, { type: "waiting_for_me", status: "open", details_md: "Steps" }))]);
    const reply = await callTool("list_synced", { project: PROJECT });
    expect(reply.data).toEqual([
      { key: "demo-app/slice-1", status: "open", hash: docHash(slice(1)) },
      { key: "demo-app/slice-2", status: "open", hash: docHash(two) },
      { key: "demo-app/slice-3", status: "open", hash: docHash(slice(3, { type: "waiting_for_me", status: "open", details_md: "Steps" })) },
    ]);
  });

  it("pages by key, lists an archived item flagged, and leaves out closed and other projects' items", async () => {
    await batch([upsert(slice(1)), upsert(slice(2)), upsert(slice(3)), upsert(slice(4)), upsert(slice(5))]);
    await callTool("upsert_item", slice(6, { project: "other" }));
    await batch([close("demo-app/slice-2"), archive("demo-app/slice-4")]);
    const first = (await callTool("list_synced", { project: PROJECT, limit: 2 })).data as { key: string }[];
    expect(first.map((e) => e.key)).toEqual(["demo-app/slice-1", "demo-app/slice-3"]);
    const next = (await callTool("list_synced", { project: PROJECT, limit: 2, after_key: "demo-app/slice-3" })).data as { key: string; archived?: true; hash: string }[];
    expect(next.map((e) => e.key)).toEqual(["demo-app/slice-4", "demo-app/slice-5"]);
    expect(next[0]).toEqual({ key: "demo-app/slice-4", status: "open", hash: docHash(slice(4)), archived: true });
    expect(next[1]?.archived).toBeUndefined();
    expect((await callTool("list_synced", { project: PROJECT, after_key: "demo-app/slice-5" })).data).toEqual([]);
  });

  it("an archived item with archived parts and checks keeps the hash of what the documents listed", async () => {
    const full = slice(2, lists);
    await batch([upsert(full)]);
    await batch([archive("demo-app/slice-2")]);
    const [entry] = (await callTool("list_synced", { project: PROJECT })).data as { hash: string; archived?: true }[];
    expect(entry).toMatchObject({ hash: docHash(full), archived: true });
  });

  it("changes the hash when the documents change the item, and not when a live report moves its status", async () => {
    await batch([upsert(slice(1))]);
    const before = ((await callTool("list_synced", { project: PROJECT })).data as { hash: string }[])[0]!.hash;
    at(2);
    await callTool("report_progress", { key: "demo-app/slice-1", status: "in_progress" });
    expect(((await callTool("list_synced", { project: PROJECT })).data as { hash: string }[])[0]!.hash).toBe(before);
    await batch([upsert(slice(1, { title: "New words" }))]);
    expect(((await callTool("list_synced", { project: PROJECT })).data as { hash: string }[])[0]!.hash).not.toBe(before);
  });

  it("can be read with a read token", async () => {
    await batch([upsert(slice(1))]);
    expect((await callTool("list_synced", { project: PROJECT }, READ_TOKEN)).isError).toBe(false);
  });
});
