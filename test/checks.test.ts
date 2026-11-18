import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardResponse } from "../src/api/boardDto";
import { parseConfig } from "../src/config";
import { itemProblem, MAX_CHECKS } from "../src/domain/checks";
import { splitSliceTitle } from "../src/domain/docSync";
import { ItemType } from "../src/domain/item";
import { BOARD_WHERE, D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, resetBoard } from "./helpers";

const PROJECT = "demo-app";
const SLICE = "demo-app/slice-12";
const CHECK_A = `${SLICE}/check-1`;
const CHECK_B = `${SLICE}/check-2`;
const LOOSE = "demo-app/slice-3/check-1";

const slice = (over: Record<string, unknown> = {}) => ({
  key: SLICE,
  project: PROJECT,
  type: "slice",
  title: "Slice 12 · App crashes on start",
  status: "in_progress",
  ...over,
});
const checks = (...keys: string[]) => keys.map((key) => ({ key, title: `Check ${key.slice(-1)}` }));
const sync = (items: unknown[]) => callTool("sync_snapshot", { project: PROJECT, items });

async function board(): Promise<BoardResponse> {
  const response = await boardResponse(new D1ItemRepository(env.DB), parseConfig(undefined), { now: () => new Date() });
  return (await response.json()) as BoardResponse;
}

async function statusOf(key: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM items WHERE key = ?").bind(key).first<{ status: string }>();
  return row?.status;
}

beforeEach(resetBoard);

describe("check items", () => {
  it("accepts a check with a parent_key and refuses one without", async () => {
    const ok = await callTool("report_progress", { key: CHECK_A, project: PROJECT, type: "check", title: "Cold start", parent_key: SLICE });
    expect(ok.isError).toBe(false);
    const bad = await callTool("report_progress", { key: CHECK_B, project: PROJECT, type: "check", title: "No slice" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("parent_key");
    expect(await countRows("items")).toBe(1);
  });

  it("refuses a check key that does not start with its slice's key and a slash", async () => {
    const taken = await callTool("report_progress", { key: SLICE, project: PROJECT, type: "check", title: "x", parent_key: SLICE });
    expect(taken.isError).toBe(true);
    expect(taken.text).toContain("key");
    const other = await callTool("report_progress", { key: "demo-app/bug-1", project: PROJECT, type: "check", title: "x", parent_key: SLICE });
    expect(other.isError).toBe(true);
    expect(await countRows("items")).toBe(0);
  });

  it("refuses to turn a stored part into a check that has no slice parent, or one whose parent is no slice", async () => {
    await callTool("report_progress", { key: SLICE, project: PROJECT, type: "slice", title: "S" });
    const note = `${SLICE}/note-a`;
    await callTool("report_progress", { key: note, project: PROJECT, type: "unplanned", title: "A", parent_key: SLICE });
    const parentOfPart = `${note}/check-1`;
    await callTool("report_progress", { key: parentOfPart, project: PROJECT, type: "unplanned", title: "B", parent_key: note });
    const retyped = await callTool("report_progress", { key: parentOfPart, type: "check" });
    expect(retyped.isError).toBe(true);
    expect(await statusOf(parentOfPart)).toBe("open");
    const row = await env.DB.prepare("SELECT type FROM items WHERE key = ?").bind(parentOfPart).first<{ type: string }>();
    expect(row?.type).toBe("unplanned");
  });

  it("checks the final state of a report: a re-parent or retype to a check is refused", async () => {
    await callTool("report_progress", { key: SLICE, project: PROJECT, type: "slice", title: "S" });
    await callTool("report_progress", { key: CHECK_A, project: PROJECT, type: "check", title: "c", parent_key: SLICE });
    await callTool("report_progress", { key: "demo-app/slice-3", project: PROJECT, type: "slice", title: "S3" });
    const reparent = await callTool("report_progress", { key: CHECK_A, parent_key: "demo-app/slice-3" });
    expect(reparent.isError).toBe(true);
    await callTool("report_progress", { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "b" });
    const retype = await callTool("report_progress", { key: "demo-app/bug-1", type: "check", parent_key: SLICE });
    expect(retype.isError).toBe(true);
    expect((await callTool("report_progress", { key: CHECK_A, status: "done" })).isError).toBe(false);
  });

  it("refuses to clear the parent_key of a stored check", async () => {
    await callTool("report_progress", { key: CHECK_A, project: PROJECT, type: "check", title: "Cold start", parent_key: SLICE });
    const cleared = await callTool("report_progress", { key: CHECK_A, parent_key: null });
    expect(cleared.isError).toBe(true);
  });
});

describe("sync_snapshot checks", () => {
  it("stores each check as an item under its slice, and a second sync changes nothing", async () => {
    const first = await sync([slice({ checks: checks(CHECK_A, CHECK_B) })]);
    expect(first.data).toMatchObject({ created: 3, closed: 0 });
    const stored = (await callTool("get_item", { key: CHECK_A })).data as { type: string; parent_key: string; status: string };
    expect(stored).toMatchObject({ type: "check", parent_key: SLICE, status: "open" });
    expect((await sync([slice({ checks: checks(CHECK_A, CHECK_B) })])).data).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it("keeps a check that stays, adds a new one and closes the one that left the file", async () => {
    await sync([slice({ checks: checks(CHECK_A, CHECK_B) })]);
    const reply = await sync([slice({ checks: checks(CHECK_A, `${SLICE}/check-3`) })]);
    expect(reply.data).toMatchObject({ created: 1, closed: 1 });
    expect(await statusOf(CHECK_A)).toBe("open");
    expect(await statusOf(CHECK_B)).toBe("done");
    expect(await statusOf(`${SLICE}/check-3`)).toBe("open");
  });

  it("closes every check of a slice that sends an empty list, and keeps them when it sends none", async () => {
    await sync([slice({ checks: checks(CHECK_A) })]);
    await sync([slice()]);
    expect(await statusOf(CHECK_A)).toBe("open");
    await sync([slice({ checks: [] })]);
    expect(await statusOf(CHECK_A)).toBe("done");
  });

  it("closes the checks and the slice together when both leave the snapshot", async () => {
    await sync([slice({ checks: checks(CHECK_A) }), { key: "demo-app/slice-13", project: PROJECT, type: "slice", title: "Slice 13", status: "open" }]);
    await sync([{ key: "demo-app/slice-13", project: PROJECT, type: "slice", title: "Slice 13", status: "open" }]);
    expect(await statusOf(SLICE)).toBe("done");
    expect(await statusOf(CHECK_A)).toBe("done");
    expect(await statusOf("demo-app/slice-13")).toBe("open");
  });

  it("takes a top-level check for a slice that is not in the snapshot, and refuses one with no slice", async () => {
    const loose = { key: LOOSE, project: PROJECT, type: "check", title: "Dark desktop values", status: "open", parent_key: "demo-app/slice-3" };
    expect((await sync([loose])).isError).toBe(false);
    const orphan = { key: "demo-app/orphan", project: PROJECT, type: "check", title: "x", status: "open" };
    const reply = await sync([orphan]);
    expect(reply.isError).toBe(false);
    expect(reply.data).toMatchObject({ created: 0, skipped: [{ key: "demo-app/orphan", reason: expect.stringContaining("parent_key") }] });
    expect(await countRows("items")).toBe(1);
  });

  it("refuses a check key that is not under its slice, so a check never overwrites a slice or a bug", async () => {
    const nested = await sync([slice({ checks: [{ key: "demo-app/slice-3", title: "x" }] })]);
    expect(nested.data).toMatchObject({ skipped: [{ key: "demo-app/slice-3" }] });
    const top = await sync([{ key: "demo-app/slice-3", project: PROJECT, type: "check", title: "x", status: "open", parent_key: SLICE }]);
    expect(top.data).toMatchObject({ skipped: [{ key: "demo-app/slice-3" }] });
    expect(await statusOf("demo-app/slice-3")).toBeUndefined();
  });

  it("never closes a check the snapshot lists as its own item, even one its slice's checks list leaves out", async () => {
    await sync([slice({ checks: checks(CHECK_A) })]);
    const explicit = { key: CHECK_B, project: PROJECT, type: "check", title: "Own item", status: "open", parent_key: SLICE };
    const reply = await sync([slice({ checks: checks(CHECK_A) }), explicit]);
    expect(reply.data).toMatchObject({ closed: 0 });
    expect(await statusOf(CHECK_B)).toBe("open");
  });

  it("skips checks on an item that is not a slice, and a repeated check key", async () => {
    const onBug = await sync([{ key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "b", status: "open", checks: checks(CHECK_A) }]);
    expect(onBug.data).toMatchObject({ skipped: [{ key: "demo-app/bug-1", reason: expect.stringContaining("only a slice") }] });
    const empty = await sync([{ key: "demo-app/bug-2", project: PROJECT, type: "bug", title: "b", status: "open", checks: [] }]);
    expect(empty.data).toMatchObject({ created: 1, skipped: [] });
    const twice = await sync([slice({ checks: [...checks(CHECK_A), ...checks(CHECK_A)] })]);
    expect(twice.data).toMatchObject({ created: 2, skipped: [{ key: CHECK_A, reason: expect.stringContaining("twice") }] });
  });


  it("saves the rest of the snapshot when one check is bad, closes what left, and does not close a skipped key", async () => {
    await sync([slice({ checks: checks(CHECK_A, CHECK_B) }), { key: "demo-app/slice-3", project: PROJECT, type: "slice", title: "S3", status: "open" }]);
    const bad = { key: "demo-app/slice-3", title: "takes a slice key" };
    const loose = { key: LOOSE, project: PROJECT, type: "check", title: "Loose", status: "open" };
    const reply = await sync([slice({ checks: [...checks(CHECK_A), bad] }), loose]);
    expect(reply.isError).toBe(false);
    expect(reply.data).toMatchObject({ closed: 1, skipped: [{ key: "demo-app/slice-3" }, { key: LOOSE }] });
    expect(await statusOf(CHECK_A)).toBe("open");
    expect(await statusOf(CHECK_B)).toBe("done");
    expect(await statusOf("demo-app/slice-3")).toBe("open");
  });

  it("keeps the stored checks open when their skipped slice or the check itself is skipped", async () => {
    await sync([slice({ checks: checks(CHECK_A, CHECK_B) })]);
    const skippedSlice = await sync([slice({ type: "bug", checks: checks(CHECK_A) })]);
    expect(skippedSlice.data).toMatchObject({ closed: 0, skipped: [{ key: SLICE }] });
    expect(await statusOf(CHECK_A)).toBe("open");
    expect(await statusOf(CHECK_B)).toBe("open");
    const twice = await sync([slice({ checks: [...checks(CHECK_A), ...checks(CHECK_A)] })]);
    expect(twice.data).toMatchObject({ skipped: [{ key: CHECK_A, reason: expect.stringContaining("twice") }] });
    expect(await statusOf(CHECK_A)).toBe("open");
  });

  it("turns a key stored as a slice into a check when the snapshot sends it as a check", async () => {
    const old = `${SLICE}/check-9`;
    await sync([slice(), { key: old, project: PROJECT, type: "slice", title: "Old card", status: "open" }]);
    expect(((await callTool("get_item", { key: old })).data as { type: string }).type).toBe("slice");
    const reply = await sync([slice({ checks: [{ key: old, title: "Old card" }] })]);
    expect(reply.data).toMatchObject({ updated: 1, skipped: [] });
    expect((await callTool("get_item", { key: old })).data).toMatchObject({ type: "check", parent_key: SLICE });
  });
});

describe("GET /api/board checks and problems", () => {
  it("lists checks inside their slice and keeps them out of the items", async () => {
    await sync([slice({ checks: checks(CHECK_A, CHECK_B) })]);
    const data = await board();
    expect(data.items.map((item) => item.key)).toEqual([SLICE]);
    expect(data.items[0]).toMatchObject({ slice: { number: 12, title: "App crashes on start" }, checks: [{ key: CHECK_A }, { key: CHECK_B }] });
    const group = data.groups[0]!;
    expect(group.planned[0]).toMatchObject({ key: SLICE, number: 12, title: "App crashes on start", state: "in_progress" });
    expect(group.planned[0]!.checks).toHaveLength(2);
    expect(group.summary).toMatchObject({ planned: 1, checks_not_tried: 2 });
  });

  it("lists a finished slice with open checks as built, and counts checks of a slice that is not on the board as loose", async () => {
    await sync([slice({ checks: checks(CHECK_A) }), { key: LOOSE, project: PROJECT, type: "check", title: "Loose", status: "open", parent_key: "demo-app/slice-3" }]);
    await callTool("mark_done", { key: SLICE });
    const group = (await board()).groups[0]!;
    expect(group.planned).toEqual([]);
    expect(group.built.map((s) => [s.key, s.state, s.checks.map((c) => c.key)])).toEqual([[SLICE, "built", [CHECK_A]]]);
    expect(group.loose_checks.map((check) => check.key)).toEqual([LOOSE]);
    expect(group.summary.checks_not_tried).toBe(2);
  });

  it("keeps a done slice with an open check on the board after the window, and drops one with none", async () => {
    await sync([slice({ checks: checks(CHECK_A) })]);
    await callTool("mark_done", { key: SLICE });
    await env.DB.prepare("UPDATE items SET done_at = '2020-01-01T00:00:00.000Z' WHERE key = ?1").bind(SLICE).run();
    expect((await board()).groups[0]!.built.map((s) => s.key)).toEqual([SLICE]);
    await callTool("mark_done", { key: CHECK_A });
    expect((await board()).groups).toEqual([]);
  });

  it("plans: the board read probes a slice's open checks through idx_items_parent_key, never a scan of items per row", async () => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN SELECT * FROM items WHERE ${BOARD_WHERE} ORDER BY created_at DESC, key`)
      .bind("2026-11-10T00:00:00.000Z", null, null)
      .all<{ detail: string }>();
    const plan = results.map((row) => row.detail);
    expect(plan.some((line) => line.includes("idx_items_parent_key"))).toBe(true);
    expect(plan.filter((line) => /^(CORRELATED SCALAR SUBQUERY|SCAN) .*items (AS )?c\b/.test(line))).toEqual([]);
  });

  it("returns the slice a bug names, and null for a problem that names none or a key that is no slice", async () => {
    await sync([slice()]);
    await callTool("report_progress", { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "Crash", parent_key: SLICE });
    await callTool("report_progress", { key: "demo-app/problem-1", project: PROJECT, type: "problem", title: "Slow CI" });
    await callTool("report_progress", { key: "demo-app/bug-2", project: PROJECT, type: "bug", title: "Odd", parent_key: "demo-app/nothing" });
    const group = (await board()).groups[0]!;
    const byKey = new Map(group.problems.map((entry) => [entry.key, entry]));
    expect(byKey.get("demo-app/bug-1")).toMatchObject({ kind: "bug", slice: { key: SLICE, number: 12 } });
    expect(byKey.get("demo-app/problem-1")).toMatchObject({ kind: "problem", slice: null });
    expect(byKey.get("demo-app/bug-2")?.slice).toBeNull();
    expect(group.summary.problems).toBe(3);
  });
});

describe("itemProblem", () => {
  const slice = { project: PROJECT, type: ItemType.Slice };

  it("passes a check under its slice and a bug with no parent", () => {
    expect(itemProblem({ key: CHECK_A, type: ItemType.Check, parent_key: SLICE }, slice, PROJECT)).toBeNull();
    expect(itemProblem({ key: "demo-app/bug-1", type: ItemType.Bug, parent_key: null }, null, PROJECT)).toBeNull();
  });

  it("names the rule a check, a parent or a checks list breaks", () => {
    const check = { key: CHECK_A, type: ItemType.Check };
    expect(itemProblem({ ...check, parent_key: null }, null, PROJECT)).toMatch(/^parent_key:/);
    expect(itemProblem({ ...check, parent_key: "demo-app/slice-3" }, slice, PROJECT)).toMatch(/^key:/);
    expect(itemProblem({ ...check, parent_key: SLICE }, { project: PROJECT, type: ItemType.Bug }, PROJECT)).toMatch(/not a slice/);
    expect(itemProblem({ ...check, parent_key: SLICE }, { project: "other-app", type: ItemType.Slice }, PROJECT)).toMatch(/other-app/);
    expect(itemProblem({ key: SLICE, type: ItemType.Slice, parent_key: null, checks: MAX_CHECKS + 1 }, null, PROJECT)).toMatch(/at most 100/);
    expect(itemProblem({ key: SLICE, type: ItemType.Bug, parent_key: null, checks: 1 }, null, PROJECT)).toMatch(/only a slice/);
  });
});

describe("splitSliceTitle", () => {
  it("takes the number from a Slice N prefix and leaves the words", () => {
    expect(splitSliceTitle("a/slice-4", "Slice 4 · Tag search")).toEqual({ number: 4, title: "Tag search" });
    expect(splitSliceTitle("a/x", "Slice 12: App crashes")).toEqual({ number: 12, title: "App crashes" });
    expect(splitSliceTitle("a/x", "Slice 7 - Dash")).toEqual({ number: 7, title: "Dash" });
  });

  it("falls back to the key's number, and to no number", () => {
    expect(splitSliceTitle("a/slice-9", "Frost alerts")).toEqual({ number: 9, title: "Frost alerts" });
    expect(splitSliceTitle("a/thing", "Frost alerts")).toEqual({ number: null, title: "Frost alerts" });
  });

  it("leaves a title that is only the prefix whole", () => {
    expect(splitSliceTitle("a/slice-5", "Slice 5")).toEqual({ number: 5, title: "Slice 5" });
    expect(splitSliceTitle("a/thing", "Slice 12")).toEqual({ number: 12, title: "Slice 12" });
  });

  it("does not read the digits of a word as a number", () => {
    expect(splitSliceTitle("a/thing", "Slice 3D viewer")).toEqual({ number: null, title: "Slice 3D viewer" });
    expect(splitSliceTitle("a/thing", "Slice 3.5 foo")).toEqual({ number: null, title: "Slice 3.5 foo" });
    expect(splitSliceTitle("a/slice-3", "Slice 3D viewer")).toEqual({ number: 3, title: "Slice 3D viewer" });
    expect(splitSliceTitle("a/slice-3", "Slice 3.5 foo")).toEqual({ number: 3, title: "Slice 3.5 foo" });
  });

  it("lets the key's number win, and drops the prefix only when it names that number", () => {
    expect(splitSliceTitle("a/slice-14", "Slice 12 follow-up")).toEqual({ number: 14, title: "Slice 12 follow-up" });
    expect(splitSliceTitle("a/slice-14", "Slice 14: Foo")).toEqual({ number: 14, title: "Foo" });
  });
});

describe("sync_snapshot parent_key", () => {
  const OTHER = "other-app/slice-1";

  it("refuses a parent_key naming another project, on a bug and on a check", async () => {
    await callTool("sync_snapshot", { project: "other-app", items: [{ key: OTHER, project: "other-app", type: "slice", title: "S", status: "open" }] });
    const bug = await sync([{ key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "b", status: "open", parent_key: OTHER }, slice()]);
    expect(bug.data).toMatchObject({ created: 1, skipped: [{ key: "demo-app/bug-1", reason: expect.stringContaining("other-app") }] });
    const check = await sync([{ key: LOOSE, project: PROJECT, type: "check", title: "c", status: "open", parent_key: OTHER }]);
    expect(check.data).toMatchObject({ skipped: [{ key: LOOSE }] });
  });

  it("refuses a report whose parent_key names another project", async () => {
    await callTool("sync_snapshot", { project: "other-app", items: [{ key: OTHER, project: "other-app", type: "slice", title: "S", status: "open" }] });
    const report = await callTool("report_progress", { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "b", parent_key: OTHER });
    expect(report.isError).toBe(true);
    expect(report.text).toContain("parent_key");
  });

  it("refuses a check whose parent is not a slice, and takes a bug that names a slice", async () => {
    await sync([slice(), { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "b", status: "open", parent_key: SLICE }]);
    expect(await statusOf("demo-app/bug-1")).toBe("open");
    const onBug = await sync([{ key: LOOSE, project: PROJECT, type: "check", title: "c", status: "open", parent_key: "demo-app/bug-1" }]);
    expect(onBug.data).toMatchObject({ skipped: [{ key: LOOSE }] });
    expect(await statusOf(LOOSE)).toBeUndefined();
  });
});

describe("GET /api/board done children and questions", () => {
  it("does not list a bug done long ago just because it names an open slice", async () => {
    await sync([slice()]);
    await callTool("report_progress", { key: "demo-app/bug-1", project: PROJECT, type: "bug", title: "Old", parent_key: SLICE });
    await callTool("mark_done", { key: "demo-app/bug-1" });
    await env.DB.prepare("UPDATE items SET done_at = ? WHERE key = ?").bind("2020-01-01T00:00:00.000Z", "demo-app/bug-1").run();
    const data = await board();
    expect(data.items.map((item) => item.key)).not.toContain("demo-app/bug-1");
  });

  it("lists a check holding a needs_you question in Needs you", async () => {
    await sync([slice({ checks: checks(CHECK_A) })]);
    await callTool("report_progress", { key: CHECK_A, needs_you: "Which device?" });
    const group = (await board()).groups[0]!;
    expect(group.needs_you).toContain(CHECK_A);
    expect(group.summary.needs_you).toBe(1);
  });
});

describe("itemProblem relations (Slice 33)", () => {
  it("refuses a self parent, a two-item cycle, a part under a non-slice, and a part key outside its slice", () => {
    const slice = { project: PROJECT, type: ItemType.Slice, parent_key: null };
    expect(itemProblem({ key: "a/b", type: ItemType.Bug, parent_key: "a/b" }, null, PROJECT)).toContain("own parent");
    expect(itemProblem({ key: "a/b", type: ItemType.Bug, parent_key: "a/c" }, { ...slice, parent_key: "a/b" }, PROJECT)).toContain("own parent");
    expect(itemProblem({ key: "a/s/part-A", type: ItemType.Part, parent_key: "a/s" }, { project: PROJECT, type: ItemType.Bug }, PROJECT)).toContain("not a slice");
    expect(itemProblem({ key: "a/x/part-A", type: ItemType.Part, parent_key: "a/s" }, slice, PROJECT)).toContain("must start with");
    expect(itemProblem({ key: "a/s/part-A", type: ItemType.Part, parent_key: "a/s" }, slice, PROJECT)).toBeNull();
  });

  it("refuses a slice key too long for its part keys", () => {
    expect(itemProblem({ key: "k".repeat(194), type: ItemType.Slice, parent_key: null, parts: 1 }, null, PROJECT)).toContain("too long");
    expect(itemProblem({ key: "k".repeat(193), type: ItemType.Slice, parent_key: null, parts: 1 }, null, PROJECT)).toBeNull();
  });
});
