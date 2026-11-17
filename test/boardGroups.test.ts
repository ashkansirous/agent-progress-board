import { describe, expect, it } from "vitest";
import { type GroupItem, groupBoard, RECENT_DONE_COUNT, SliceState } from "../src/domain/boardGroups";
import type { CheckRow } from "../src/domain/checks";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";

const PROJECT = "demo-app";
const NOW = Date.parse("2026-11-17T13:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function item(key: string, over: Partial<GroupItem> = {}): GroupItem {
  return {
    key,
    project: PROJECT,
    type: ItemType.Unplanned,
    priority: Priority.P2,
    status: ItemStatus.Open,
    title: key,
    parent: null,
    created_at: minutesAgo(600),
    heartbeat_at: minutesAgo(5),
    done_at: null,
    agent: null,
    needs_you: null,
    needs_you_at: null,
    working: false,
    slice: null,
    parent_slice: null,
    ...over,
  };
}

const slice = (n: number, over: Partial<GroupItem> = {}) =>
  item(`${PROJECT}/slice-${n}`, { type: ItemType.Slice, title: `Slice ${n} · S${n}`, slice: { number: n, title: `S${n}` }, ...over });

const check = (key: string, parent: string | null, over: Partial<CheckRow> = {}): CheckRow => ({
  key,
  title: key,
  project: PROJECT,
  status: ItemStatus.Open,
  parent_key: parent,
  ...over,
});

const question = (key: string, asked: number) => item(key, { status: ItemStatus.InProgress, needs_you: "Which?", needs_you_at: minutesAgo(asked) });
const only = (items: GroupItem[], checks: CheckRow[] = []) => groupBoard(items, checks, [PROJECT])[0]!;

describe("groupBoard", () => {
  it("gives the numbers of a quiet project: 1 needs you, nothing running, 2 planned", () => {
    const group = only([question("q", 3), slice(1), slice(2)]);
    expect(group.summary).toEqual({ needs_you: 1, working: 0, planned: 2, problems: 0, checks_not_tried: 0 });
    expect(group.needs_you).toEqual(["q"]);
    expect(group.working_now).toEqual([]);
  });

  it("puts a blocked slice in planned as parked, after the in-progress and planned ones", () => {
    const group = only([
      slice(1, { status: ItemStatus.Blocked }),
      slice(2),
      slice(3, { status: ItemStatus.InProgress }),
    ]);
    expect(group.planned.map((s) => [s.number, s.state])).toEqual([
      [3, SliceState.InProgress],
      [2, SliceState.Planned],
      [1, SliceState.Parked],
    ]);
  });

  it("lists a working item in working_now, and a slice with a live agent in both lists", () => {
    const working = item("w", { status: ItemStatus.InProgress, working: true, agent: "session" });
    const busy = slice(4, { status: ItemStatus.InProgress, working: true });
    const group = only([working, busy]);
    expect(group.working_now.sort()).toEqual([busy.key, "w"].sort());
    expect(group.planned.map((s) => s.key)).toEqual([busy.key]);
    expect(group.summary).toMatchObject({ working: 2, planned: 1 });
  });

  it("orders questions oldest first, then waiting items by priority", () => {
    const waitingLow = item("wait-low", { type: ItemType.WaitingForMe, priority: Priority.P3 });
    const waitingHigh = item("wait-high", { type: ItemType.WaitingForMe, priority: Priority.P0 });
    const group = only([waitingLow, question("new", 1), waitingHigh, question("old", 40)]);
    expect(group.needs_you).toEqual(["old", "new", "wait-high", "wait-low"]);
  });

  it("puts bugs and problems in their own list with the slice they name", () => {
    const bug = item("bug", { type: ItemType.Bug, parent_slice: { key: "s", number: 12 } });
    const problem = item("prob", { type: ItemType.Problem, status: ItemStatus.Blocked });
    const group = only([bug, problem]);
    expect(group.problems).toEqual([
      { key: "bug", kind: ItemType.Bug, slice: { key: "s", number: 12 } },
      { key: "prob", kind: ItemType.Problem, slice: null },
    ]);
    expect(group.summary.problems).toBe(2);
  });

  it("counts the checks of planned slices and the loose ones in the summary", () => {
    const s12 = slice(12);
    const rows = [
      check("c1", s12.key),
      check("c2", s12.key),
      check("c3", s12.key, { status: ItemStatus.Done }),
      check("l1", `${PROJECT}/slice-3`),
      check("l2", null),
    ];
    const group = only([s12, slice(5, { status: ItemStatus.Done, done_at: minutesAgo(20) })], rows.filter((row) => row.parent_key));
    expect(group.planned[0]!.checks.map((c) => c.key)).toEqual(["c1", "c2"]);
    expect(group.loose_checks.map((c) => c.key)).toEqual(["l1"]);
    expect(group.summary.checks_not_tried).toBe(3);
  });

  it("treats the checks of a finished slice as loose", () => {
    const done = slice(7, { status: ItemStatus.Done, done_at: minutesAgo(30) });
    const group = only([done], [check("c", done.key)]);
    expect(group.planned).toEqual([]);
    expect(group.loose_checks.map((c) => c.key)).toEqual(["c"]);
  });

  it("holds the done count, the newest five and a stopped session card as stale", () => {
    const finished = Array.from({ length: 6 }, (_, i) => item(`d${i}`, { status: ItemStatus.Done, done_at: minutesAgo(10 + i * 10) }));
    const stopped = item("session", { agent: "session", status: ItemStatus.Stale, heartbeat_at: minutesAgo(25) });
    const group = only([...finished, stopped]);
    expect(group.done.count).toBe(7);
    expect(group.done.recent).toHaveLength(RECENT_DONE_COUNT);
    expect(group.done.recent.map((row) => row.key)).toEqual(["d0", "d1", "session", "d2", "d3"]);
    expect(group.done.recent.find((row) => row.key === "session")?.stale).toBe(true);
    expect(group.done.recent[0]!.stale).toBe(false);
    expect(group.done.more.map((row) => row.key)).toEqual(["d4", "d5"]);
    expect(group.working_now).toEqual([]);
  });

  it("never gives a part or a check its own card", () => {
    const part = item("p", { type: ItemType.Part, status: ItemStatus.InProgress, working: true });
    const group = only([slice(1), part]);
    expect(group.working_now).toEqual([]);
    expect(group.other).toEqual([]);
  });

  it("keeps an unplanned item nobody holds in other, so it is not hidden", () => {
    const group = only([item("idle")]);
    expect(group.other).toEqual(["idle"]);
  });

  it("orders the configured projects first, drops one with nothing, and adds unknown ones by id", () => {
    const stray = item("z", { project: "zeta" });
    const lone = item("a", { project: "alpha" });
    const groups = groupBoard([stray, lone], [], ["beta", "alpha"]);
    expect(groups.map((g) => g.id)).toEqual(["alpha", "zeta"]);
  });

  it("counts a waiting item that also has a live agent once, in needs_you", () => {
    const both = item("w", { type: ItemType.WaitingForMe, status: ItemStatus.InProgress, agent: "a", working: true });
    const group = only([both]);
    expect(group.needs_you).toEqual(["w"]);
    expect(group.working_now).toEqual([]);
    expect(group.summary).toMatchObject({ needs_you: 1, working: 0 });
  });

  it("lists a check or part holding a question in needs_you, never a done one", () => {
    const ask = (key: string, type: ItemType, status = ItemStatus.Open) => item(key, { type, status, needs_you: "Which?", needs_you_at: minutesAgo(2) });
    const group = only([ask("c", ItemType.Check), ask("p", ItemType.Part), ask("d", ItemType.Part, ItemStatus.Done)]);
    expect(group.needs_you.sort()).toEqual(["c", "p"]);
  });
});
