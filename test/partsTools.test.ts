import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { parseConfig } from "../src/config";
import { CHAIN_ROWS, D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, resetBoard } from "./helpers";

const PROJECT = "demo-app";
const SLICE = "demo-app/slice-5";
const B = `${SLICE}/part-B`;
const MS_PER_HOUR = 3_600_000;

const slice = (parts?: unknown[], over: Record<string, unknown> = {}) => ({
  key: SLICE,
  project: PROJECT,
  type: "slice",
  title: "Parts demo",
  status: "open",
  parts,
  ...over,
});

const FIVE = [
  { letter: "A", title: "Server", done: true },
  { letter: "B", title: "Page", done: false },
  { letter: "C", title: "Tests", done: false },
  { letter: "D", title: "Docs", done: false },
  { letter: "E", title: "Release", done: false },
];

const REVIEWING = [
  { label: "Implementation", state: "done" },
  { label: "Review 1", state: "active" },
  { label: "Fixing", state: "pending" },
  { label: "Review 2", state: "pending" },
  { label: "Merging", state: "pending" },
];

const sync = (items: unknown[]) => callTool("sync_snapshot", { project: PROJECT, items });
const holdB = (extra: Record<string, unknown> = {}) =>
  callTool("report_progress", { key: B, parent_key: SLICE, status: "in_progress", steps: REVIEWING, agent: "Implementer", ...extra });

async function board(now: Date = new Date()): Promise<BoardResponse> {
  const response = await boardResponse(new D1ItemRepository(env.DB), parseConfig(undefined), { now: () => now });
  return (await response.json()) as BoardResponse;
}

async function itemOf(key: string, now?: Date): Promise<BoardItemDto> {
  const found = (await board(now)).items.find((item) => item.key === key);
  if (!found) throw new Error(`no item ${key} on the board`);
  return found;
}

const later = (hours: number): Date => new Date(Date.now() + hours * MS_PER_HOUR);

beforeEach(resetBoard);

describe("sync_snapshot parts", () => {
  it("stores each part as an item of type part linked to its slice, and a second sync changes nothing", async () => {
    const first = await sync([slice(FIVE)]);
    expect(first.data).toMatchObject({ created: 6, updated: 0, closed: 0 });
    const part = (await callTool("get_item", { key: B })).data as { type: string; parent_key: string; title: string; status: string };
    expect(part).toMatchObject({ type: "part", parent_key: SLICE, title: "Page", status: "open" });
    expect(((await callTool("get_item", { key: `${SLICE}/part-A` })).data as { status: string }).status).toBe("done");
    expect((await sync([slice(FIVE)])).data).toMatchObject({ created: 0, updated: 0, unchanged: 6 });
  });

  it("lets the document own a part's title and done state", async () => {
    await sync([slice(FIVE)]);
    const edited = FIVE.map((p) => (p.letter === "B" ? { ...p, title: "Page and drawer", done: true } : p));
    await sync([slice(edited)]);
    expect(await itemOf(B)).toMatchObject({ title: "Page and drawer", status: "done" });
  });

  it("rejects a bad letter without storing anything", async () => {
    const reply = await sync([slice([{ letter: "b", title: "x", done: false }])]);
    expect(reply.isError).toBe(true);
    expect(await countRows("items")).toBe(0);
  });
});

describe("the board's parts", () => {
  it("reads one of five parts done as 20%, with the next part and no active one", async () => {
    await sync([slice(FIVE)]);
    const item = await itemOf(SLICE);
    expect(item.parts_progress).toEqual({ done: 1, total: 5, percent: 20 });
    expect(item.parts?.map((p) => [p.letter, p.state])).toEqual([
      ["A", "done"], ["B", "pending"], ["C", "pending"], ["D", "pending"], ["E", "pending"],
    ]);
    expect(item.active_part_key).toBeNull();
    expect(item.status).toBe("open");
  });

  it("shows the slice in flight at 20% with B active after a live report, without changing its stored status", async () => {
    await sync([slice(FIVE)]);
    await holdB();
    const item = await itemOf(SLICE);
    expect(item).toMatchObject({ status: "in_progress", active_part_key: B, parts_progress: { done: 1, total: 5, percent: 20 } });
    expect(item.parts?.find((p) => p.letter === "B")).toMatchObject({ state: "active", step: "Review 1", steps_done: 1, steps_total: 5 });
    expect(((await callTool("get_item", { key: SLICE })).data as { status: string }).status).toBe("open");
  });

  it("gives a working part's card its slice as the parent text and keeps the part on the active list", async () => {
    await sync([slice(FIVE)]);
    await holdB();
    const part = await itemOf(B);
    expect(part).toMatchObject({
      working: true,
      parent_key: SLICE,
      parent: null,
      parent_slice: { key: SLICE, number: 5, title: "Parts demo" },
      type: "part",
    });
    expect((await board()).working_count).toBe(1);
  });

  it("returns the slice as data with no number when its key has none, and no copy text", async () => {
    await sync([slice(FIVE, { key: `${PROJECT}/s58` })]);
    await callTool("report_progress", { key: `${PROJECT}/s58/part-B`, parent_key: `${PROJECT}/s58`, project: PROJECT, type: "part", title: "Page", status: "in_progress" });
    const part = await itemOf(`${PROJECT}/s58/part-B`);
    expect(part.parent_slice).toEqual({ key: `${PROJECT}/s58`, number: null, title: "Parts demo" });
    expect(part.parent).toBeNull();
  });

  it("reads a part whose steps stopped as stale: the slice is not in flight and has nothing to follow", async () => {
    await sync([slice(FIVE)]);
    await holdB();
    const item = await itemOf(SLICE, later(5));
    expect(item.parts?.find((p) => p.letter === "B")?.state).toBe("stale");
    expect(item).toMatchObject({ status: "open", active_part_key: null });
    expect((await itemOf(B, later(5))).working).toBe(false);
  });

  it("reads all parts done, and keeps a part done long ago on the list of a slice still open", async () => {
    await sync([slice(FIVE.map((p) => ({ ...p, done: true })))]);
    const item = await itemOf(SLICE, later(30));
    expect(item.parts_progress).toEqual({ done: 5, total: 5, percent: 100 });
    await sync([slice(FIVE.map((p) => ({ ...p, done: p.letter === "A" })))]);
    const stillOpen = await itemOf(SLICE, later(30));
    expect(stillOpen.parts).toHaveLength(5);
    expect(stillOpen.parts_progress?.done).toBe(1);
  });

  it("drops a part that left the documents from the slice's list, and every part when none are listed", async () => {
    await sync([slice(FIVE)]);
    expect((await sync([slice(FIVE.slice(0, 4))])).data).toMatchObject({ closed: 1 });
    expect((await itemOf(SLICE)).parts_progress).toEqual({ done: 1, total: 4, percent: 25 });
    await sync([slice([])]);
    expect(await itemOf(SLICE)).toMatchObject({ parts: null, parts_progress: null, active_part_key: null });
  });

  it("leaves the stored parts alone when a re-sync sends no parts field, and closes them for an empty list", async () => {
    await sync([slice(FIVE)]);
    expect((await sync([slice()])).data).toMatchObject({ closed: 0, updated: 0 });
    expect((await itemOf(SLICE)).parts_progress).toEqual({ done: 1, total: 5, percent: 20 });
    expect((await sync([slice([])])).data).toMatchObject({ closed: 5 });
    expect((await itemOf(SLICE)).parts).toBeNull();
  });

  it("has no parts for a slice the documents list none for", async () => {
    await sync([slice()]);
    expect(await itemOf(SLICE)).toMatchObject({ parts: null, parts_progress: null, active_part_key: null });
  });

  it("never lists a live-only part (the documents never named it) in the slice's parts, total or progress", async () => {
    await sync([slice(FIVE.slice(0, 2))]);
    await callTool("report_progress", { key: `${SLICE}/part-F`, parent_key: SLICE, project: PROJECT, type: "part", title: "Wrong letter", status: "in_progress", steps: REVIEWING });
    const item = await itemOf(SLICE);
    expect(item.parts?.map((p) => p.letter)).toEqual(["A", "B"]);
    expect(item.parts_progress).toEqual({ done: 1, total: 2, percent: 50 });
    expect(item.active_part_key).toBeNull();
    expect(item.status).toBe("open");
    expect(await itemOf(`${SLICE}/part-F`)).toMatchObject({ working: true, parent_slice: { key: SLICE, number: 5, title: "Parts demo" } });
  });

  it("lists a live-only slice's part nowhere: a slice the documents gave no parts stays without a bar", async () => {
    await sync([slice([])]);
    await holdB({ project: PROJECT, type: "part", title: "Page" });
    expect(await itemOf(SLICE)).toMatchObject({ parts: null, parts_progress: null });
    expect((await itemOf(B)).working).toBe(true);
  });

  it("lists a part once the documents name it, after a live report came first", async () => {
    await sync([slice([])]);
    await holdB({ project: PROJECT, type: "part", title: "Page" });
    await sync([slice(FIVE)]);
    expect((await itemOf(SLICE)).parts?.map((p) => p.letter)).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("a snapshot with parts is bounded in two steps", () => {
  it("accepts 60 slices of 5 parts (360 items), more than the 200 slices cap alone would allow", async () => {
    const slices = Array.from({ length: 60 }, (_, i) => slice(FIVE, { key: `${PROJECT}/slice-${i + 1}` }));
    const reply = await sync(slices);
    expect(reply.isError).toBe(false);
    expect(reply.data).toMatchObject({ created: 360 });
  });

  it("refuses an expanded set over the item bound, and a slice list over 200", async () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ letter: String.fromCharCode(65 + i), title: "x", done: false }));
    const slices = Array.from({ length: 40 }, (_, i) => slice(many, { key: `${PROJECT}/slice-${i + 1}` }));
    const reply = await sync(slices);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("at most 1000 items");
    expect(await countRows("items")).toBe(0);
    const tooMany = Array.from({ length: 201 }, (_, i) => slice(undefined, { key: `${PROJECT}/slice-${i + 1}` }));
    expect((await sync(tooMany)).isError).toBe(true);
  });
});

describe("parts and parent_key are checked", () => {
  it("rejects parts on an item that is not a slice, storing nothing", async () => {
    const reply = await sync([slice(FIVE, { type: "bug" })]);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("only a slice has parts");
    expect(await countRows("items")).toBe(0);
  });

  it("rejects a parent_key that names an item of another project, and keeps one that does not exist yet", async () => {
    await callTool("report_progress", { key: "other-app/slice-1", project: "other-app", type: "slice", title: "Foreign" });
    const foreign = await callTool("report_progress", { key: B, project: PROJECT, type: "part", title: "Page", parent_key: "other-app/slice-1" });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toContain("parent_key");
    const dangling = await callTool("report_progress", { key: B, project: PROJECT, type: "part", title: "Page", parent_key: SLICE });
    expect(dangling.isError).toBe(false);
  });

  it("checks an existing item's project when a later report sets parent_key", async () => {
    await callTool("report_progress", { key: "other-app/slice-1", project: "other-app", type: "slice", title: "Foreign" });
    await callTool("report_progress", { key: B, project: PROJECT, type: "part", title: "Page" });
    expect((await callTool("report_progress", { key: B, parent_key: "other-app/slice-1" })).isError).toBe(true);
  });
});

describe("report_progress parent_key", () => {
  it("stores it, keeps it when a report leaves it out and clears it with null", async () => {
    await callTool("report_progress", { key: B, project: PROJECT, type: "part", title: "Page", parent_key: SLICE });
    await callTool("report_progress", { key: B, why: "heartbeat" });
    expect((await itemOf(B)).parent_key).toBe(SLICE);
    await callTool("report_progress", { key: B, parent_key: null });
    expect((await itemOf(B)).parent_key).toBeNull();
  });

  it("rejects a parent cycle of three items, and does not refuse a report that leaves a stored legacy parent alone", async () => {
    const [u1, u2, u3] = ["demo-app/u1", "demo-app/u2", "demo-app/u3"];
    await callTool("report_progress", { key: u3, project: PROJECT, type: "unplanned", title: "u3" });
    await callTool("report_progress", { key: u2, project: PROJECT, type: "unplanned", title: "u2", parent_key: u3 });
    await callTool("report_progress", { key: u1, project: PROJECT, type: "unplanned", title: "u1", parent_key: u2 });
    const loop = await callTool("report_progress", { key: u3, parent_key: u1 });
    expect(loop.isError).toBe(true);
    expect((await itemOf(u3)).parent_key).toBeNull();
    await callTool("report_progress", { key: "demo-app/bug-9", project: PROJECT, type: "bug", title: "Legacy" });
    await env.DB.prepare("UPDATE items SET parent_key = ?1 WHERE key = ?2").bind(u1, "demo-app/bug-9").run();
    const heartbeat = await callTool("report_progress", { key: "demo-app/bug-9", status: "in_progress" });
    expect(heartbeat.isError).toBeFalsy();
    const changed = await callTool("report_progress", { key: "demo-app/bug-9", parent_key: "demo-app/bug-9" });
    expect(changed.isError).toBe(true);
  });

  it("reads an item and its ancestors in one query, nearest first, cut at the limit and at a stored loop (Slice 48 9)", async () => {
    const [u1, u2, u3] = ["demo-app/u1", "demo-app/u2", "demo-app/u3"];
    await callTool("report_progress", { key: u3, project: PROJECT, type: "unplanned", title: "u3" });
    await callTool("report_progress", { key: u2, project: PROJECT, type: "unplanned", title: "u2", parent_key: u3 });
    await callTool("report_progress", { key: u1, project: PROJECT, type: "unplanned", title: "u1", parent_key: u2 });
    const repo = new D1ItemRepository(env.DB);
    expect((await repo.findChain(u1, 20)).map((item) => item.key)).toEqual([u1, u2, u3]);
    expect((await repo.findChain(u1, 2)).map((item) => item.key)).toEqual([u1, u2]);
    expect(await repo.findChain("demo-app/none", 20)).toEqual([]);
    expect(await repo.findChain(u1, 0)).toEqual([]);
    expect((await repo.findChain(u1, 1)).map((item) => item.key)).toEqual([u1]);
    await env.DB.prepare("UPDATE items SET parent_key = ?1 WHERE key = ?2").bind(u1, u3).run();
    expect((await repo.findChain(u1, 20)).map((item) => item.key)).toEqual([u1, u2, u3]);
    const { results } = await env.DB.prepare(CHAIN_ROWS).bind(u1, 20).all<{ key: string }>();
    expect(results.map((row) => row.key)).toEqual([u1, u2, u3]); // from SQL itself, not cut by findChain (Slice 49 2)
  });

  it("rejects an item that is its own parent", async () => {
    const reply = await callTool("report_progress", { key: B, project: PROJECT, type: "part", title: "Page", parent_key: B });
    expect(reply.isError).toBe(true);
  });
});
