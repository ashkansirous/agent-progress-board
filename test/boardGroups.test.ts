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
    expect(group.summary).toEqual({ needs_you: 1, working: 0, planned: 2, built: 0, problems: 0, checks_not_tried: 0 });
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

  it("lists a done slice with open checks under built, not planned, done or loose", () => {
    const built = slice(7, { status: ItemStatus.Done, done_at: minutesAgo(30) });
    const later = slice(3, { status: ItemStatus.Done, done_at: minutesAgo(30) });
    const group = only([built, later], [check("c1", built.key), check("c2", built.key), check("c3", later.key)]);
    expect(group.planned).toEqual([]);
    expect(group.built.map((s) => [s.number, s.state, s.checks.length])).toEqual([[3, SliceState.Built, 1], [7, SliceState.Built, 2]]);
    expect(group.loose_checks).toEqual([]);
    expect(group.done.count).toBe(0);
    expect(group.summary.planned).toBe(0);
    expect(group.summary.checks_not_tried).toBe(3);
  });

  it("treats a built slice with an open question or active work like an open slice: Needs you and Working now", () => {
    const asking = slice(7, { status: ItemStatus.Done, done_at: minutesAgo(30), needs_you: "Which one?", needs_you_at: minutesAgo(3) });
    const busy = slice(8, { status: ItemStatus.Done, done_at: minutesAgo(30), working: true });
    const group = only([asking, busy], [check("c1", asking.key), check("c2", busy.key)]);
    expect(group.built.map((s) => s.number)).toEqual([7, 8]);
    expect(group.needs_you).toEqual([asking.key]);
    expect(group.working_now).toEqual([busy.key]);
    expect(group.summary).toMatchObject({ needs_you: 1, working: 1, built: 2 });
  });

  it("sends a done slice whose checks are all tried to done, and keeps the checks of an unknown slice loose", () => {
    const done = slice(7, { status: ItemStatus.Done, done_at: minutesAgo(30) });
    const group = only([done], [check("c", done.key, { status: ItemStatus.Done }), check("l", `${PROJECT}/slice-99`)]);
    expect(group.built).toEqual([]);
    expect(group.done.count).toBe(1);
    expect(group.loose_checks.map((c) => c.key)).toEqual(["l"]);
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

  it("lists open findings in their own group, by priority then newest report, and not in other", () => {
    const finding = (key: string, over: Partial<GroupItem> = {}) => item(key, { type: ItemType.Finding, ...over });
    const group = only([
      finding("f-old", { heartbeat_at: minutesAgo(50) }),
      finding("f-new", { heartbeat_at: minutesAgo(2) }),
      finding("f-p1", { priority: Priority.P1, heartbeat_at: minutesAgo(90) }),
      finding("f-done", { status: ItemStatus.Done, done_at: minutesAgo(10) }),
      finding("f-ask", { status: ItemStatus.InProgress, needs_you: "Approve?", needs_you_at: minutesAgo(3) }),
    ]);
    expect(group.findings).toEqual(["f-p1", "f-new", "f-old"]);
    expect(group.other).toEqual([]);
    expect(group.needs_you).toEqual(["f-ask"]);
    expect(group.done.recent.map((row) => row.key)).toEqual(["f-done"]);
  });

  it("shows a project that holds only a finding", () => {
    expect(groupBoard([item("f", { type: ItemType.Finding })], [], [PROJECT])).toHaveLength(1);
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

describe("loose checks and counted checks (Slice 33)", () => {
  it("does not count the checks of a finished or stopped slice on the board as loose", () => {
    const stopped = slice(4, { agent: "session", status: ItemStatus.InProgress });
    const group = only([stopped, slice(9)], [check("c1", stopped.key), check("c2", `${PROJECT}/slice-77`)]);
    expect(group.loose_checks.map((c) => c.key).sort()).toEqual(["c1", "c2"]);
  });

  it("shows a counted check whose parent is a known item that is no slice as loose, so it is counted", () => {
    const bug = item("bug-1", { type: ItemType.Bug });
    const group = only([bug], [check("c", bug.key)]);
    expect(group.loose_checks.map((c) => c.key)).toEqual(["c"]);
    expect(group.summary.checks_not_tried).toBe(1);
  });

  it("lists a done slice as built for a blocked check, but not for a stale one only (Slice 51)", () => {
    const blocked = slice(6, { status: ItemStatus.Done, done_at: minutesAgo(30) });
    const stale = slice(7, { status: ItemStatus.Done, done_at: minutesAgo(30) });
    const group = only([blocked, stale], [check("b", blocked.key, { status: ItemStatus.Blocked }), check("s", stale.key, { status: ItemStatus.Stale })]);
    expect(group.built.map((s) => s.key)).toEqual([blocked.key]);
    expect(group.summary).toMatchObject({ built: 1, checks_not_tried: 1 });
    expect(group.done.count).toBe(1);
  });

  it("shows a stale or blocked check under its slice with its state; a blocked one is counted, a stale one is not", () => {
    const s = slice(2);
    const group = only([s], [check("a", s.key), check("b", s.key, { status: ItemStatus.Blocked }), check("c", s.key, { status: ItemStatus.Stale }), check("d", s.key, { status: ItemStatus.InProgress }), check("e", s.key, { status: ItemStatus.Done })]);
    expect(group.planned[0]!.checks.map((c) => [c.key, c.status])).toEqual([
      ["a", ItemStatus.Open],
      ["b", ItemStatus.Blocked],
      ["c", ItemStatus.Stale],
      ["d", ItemStatus.InProgress],
    ]);
    expect(group.summary.checks_not_tried).toBe(3);
  });

  it("shows a stale check of a slice that is not on the board as loose, uncounted", () => {
    const group = only([slice(9)], [check("s", `${PROJECT}/slice-77`, { status: ItemStatus.Stale })]);
    expect(group.loose_checks.map((c) => c.key)).toEqual(["s"]);
    expect(group.summary.checks_not_tried).toBe(0);
  });

  it("lists a working card with a step blocked on the owner under Needs you, not under Working now (Slice 51)", () => {
    const waiting = item("demo-app/task-w", { status: ItemStatus.InProgress, working: true, blocked_on_owner: true });
    const busy = item("demo-app/task-b", { status: ItemStatus.InProgress, working: true });
    const group = only([waiting, busy]);
    expect(group.needs_you).toEqual(["demo-app/task-w"]);
    expect(group.working_now).toEqual(["demo-app/task-b"]);
    expect(group.summary.needs_you).toBe(1);
  });

  it("groups a done slice with an open check as Built whatever its steps say (Slice 51)", () => {
    const group = only([slice(5, { status: ItemStatus.Done, done_at: minutesAgo(60) })], [check("c", `${PROJECT}/slice-5`)]);
    expect(group.built.map((s) => s.number)).toEqual([5]);
    expect(group.planned).toEqual([]);
  });
});
