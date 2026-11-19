import { describe, expect, it } from "vitest";
import { ItemStatus } from "../src/domain/item";
import {
  isWorkingNow,
  MAX_STEP_DEPTH,
  MAX_STEP_ID,
  MAX_STEP_LABEL,
  MAX_STEP_NOTE,
  MAX_STEPS,
  normalizeSteps,
  parseStoredSteps,
  replaceChildren,
  stepProgress,
  STORED_STEPS_READ_MAX,
  type WorkingRow,
} from "../src/domain/steps";
import { isExpired } from "../src/domain/stale";
import { type Step, type StepInput, StepState } from "../src/domain/stepTypes";
import { DomainError } from "../src/domain/upsert";
import { storedStep } from "./stepFixtures";

const NOW = new Date("2026-11-16T13:48:00.000Z");
const MINUTES = 120;
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function steps(done: number, active: number, pending: number): Step[] {
  const states = [
    ...Array<StepState>(done).fill(StepState.Done),
    ...Array<StepState>(active).fill(StepState.Active),
    ...Array<StepState>(pending).fill(StepState.Pending),
  ];
  return states.map((state, i) => storedStep(`Step ${i + 1}`, state));
}

describe("normalizeSteps", () => {
  it("keeps the order and makes a missing or empty note null", () => {
    const given: StepInput[] = [
      { label: "Implementation", state: StepState.Done },
      { label: "Review 1", state: StepState.Active, note: "Two helper agents count under this step" },
      { label: "Merging", state: StepState.Pending, note: "" },
    ];
    expect(normalizeSteps(given)).toEqual([
      storedStep("Implementation", StepState.Done),
      storedStep("Review 1", StepState.Active, { note: "Two helper agents count under this step" }),
      storedStep("Merging", StepState.Pending),
    ]);
  });

  it("treats null, undefined and an empty list as no list", () => {
    expect(normalizeSteps(null)).toBeNull();
    expect(normalizeSteps(undefined)).toBeNull();
    expect(normalizeSteps([])).toBeNull();
  });

  it("stores the trimmed label and note, so outer whitespace is not a change", () => {
    const plain = normalizeSteps([{ label: "Build", state: StepState.Active, note: "going" }]);
    const padded = normalizeSteps([{ label: "  Build ", state: StepState.Active, note: " going\n" }]);
    expect(padded).toEqual(plain);
  });

  it("accepts the limits and refuses one past them, naming the field", () => {
    const label = "x".repeat(MAX_STEP_LABEL);
    const note = "n".repeat(MAX_STEP_NOTE);
    expect(normalizeSteps([{ label, state: StepState.Done, note }])).toHaveLength(1);
    expect(normalizeSteps(steps(0, 0, MAX_STEPS))).toHaveLength(MAX_STEPS);
    const bad: StepInput[][] = [
      [{ label: "", state: StepState.Done }],
      [{ label: "  \t ", state: StepState.Done }],
      [{ label: label + "x", state: StepState.Done }],
      [{ label: "ok", state: StepState.Done, note: note + "n" }],
      steps(0, 0, MAX_STEPS + 1),
    ];
    for (const list of bad) {
      expect(() => normalizeSteps(list)).toThrow(DomainError);
      expect(() => normalizeSteps(list)).toThrow(/field steps/);
    }
  });
});

describe("stepProgress", () => {
  it("reads 1 of 7 as 14% with the active step's label", () => {
    expect(stepProgress(steps(1, 1, 5), ItemStatus.InProgress)).toEqual({ done: 1, total: 7, percent: 14, running: 1, current: "Step 2" });
  });

  it("follows a list that shrinks: six steps with two done is 33%", () => {
    expect(stepProgress(steps(2, 1, 3), ItemStatus.InProgress)).toMatchObject({ done: 2, total: 6, percent: 33 });
  });

  it("is null for no list or an empty one, and has no current step while none is active", () => {
    expect(stepProgress(null, ItemStatus.InProgress)).toBeNull();
    expect(stepProgress(undefined, ItemStatus.InProgress)).toBeNull();
    expect(stepProgress([], ItemStatus.InProgress)).toBeNull();
    expect(stepProgress(steps(0, 0, 3), ItemStatus.InProgress)).toEqual({ done: 0, total: 3, percent: 0, running: 0, current: null });
  });

  it("shows 100% for a done item whatever its list says", () => {
    expect(stepProgress(steps(1, 1, 5), ItemStatus.Done)).toEqual({ done: 7, total: 7, percent: 100, running: 0, current: null });
  });
});

describe("isWorkingNow", () => {
  const working: WorkingRow = {
    status: ItemStatus.InProgress,
    heartbeat_at: ago(5),
    doc_status_at: null,
    live_status_at: ago(5),
    steps: steps(1, 1, 1),
    agent: null,
  };

  it("needs in progress, a steps list or an agent, and a heartbeat that has not expired", () => {
    expect(isWorkingNow(working, MINUTES, NOW)).toBe(true);
    expect(isWorkingNow({ ...working, steps: null, agent: "Fixer" }, MINUTES, NOW)).toBe(true);
    expect(isWorkingNow({ ...working, steps: null }, MINUTES, NOW)).toBe(false);
    expect(isWorkingNow({ ...working, steps: [] }, MINUTES, NOW)).toBe(false);
    for (const status of [ItemStatus.Open, ItemStatus.Blocked, ItemStatus.Done, ItemStatus.Stale]) {
      expect(isWorkingNow({ ...working, status }, MINUTES, NOW)).toBe(false);
    }
  });

  it("leaves a task whose heartbeat is older than the expiry, before the cron marks it stale", () => {
    expect(isWorkingNow({ ...working, heartbeat_at: ago(120) }, MINUTES, NOW)).toBe(true);
    expect(isWorkingNow({ ...working, heartbeat_at: ago(121) }, MINUTES, NOW)).toBe(false);
  });

  it("leaves a doc-sourced in progress task with an old heartbeat, which the cron never sweeps", () => {
    const docSourced = { ...working, live_status_at: null, heartbeat_at: ago(300) };
    expect(isExpired(docSourced, MINUTES, NOW)).toBe(false);
    expect(isWorkingNow(docSourced, MINUTES, NOW)).toBe(false);
    expect(isWorkingNow({ ...docSourced, heartbeat_at: ago(5) }, MINUTES, NOW)).toBe(true);
  });
});

describe("step text lengths are checked on the trimmed text", () => {
  it("accepts a label or note that only its padding pushes over the limit, and stores it trimmed", () => {
    const label = `  ${"a".repeat(MAX_STEP_LABEL)}  `;
    const note = ` ${"n".repeat(MAX_STEP_NOTE)} `;
    expect(normalizeSteps([{ label, note, state: StepState.Active }])).toEqual([
      storedStep("a".repeat(MAX_STEP_LABEL), StepState.Active, { note: "n".repeat(MAX_STEP_NOTE) }),
    ]);
    expect(() => normalizeSteps([{ label: "a".repeat(MAX_STEP_LABEL + 1), state: StepState.Done }])).toThrow();
  });
});

const T1 = "2026-11-18T13:00:00.000Z";
const T2 = "2026-11-18T13:20:00.000Z";
const T3 = "2026-11-18T13:40:00.000Z";

function nested(levels: number): StepInput[] {
  const leaf: StepInput = { label: `L${levels}`, state: StepState.Pending };
  return levels <= 1 ? [leaf] : [{ label: `L${levels}`, state: StepState.Pending, children: nested(levels - 1) }];
}

describe("the step tree (Slice 39)", () => {
  const book: StepInput[] = [
    { label: "Write", state: StepState.Done },
    {
      label: "Record audio",
      state: StepState.Active,
      children: [
        { label: "English", state: StepState.Active },
        { label: "French", state: StepState.Active },
        { label: "German", state: StepState.Pending },
      ],
    },
  ];

  it("allows several active steps and makes ids from the label path, with #2 on a repeat", () => {
    const tree = normalizeSteps([...book, { label: "Write", state: StepState.Pending }])!;
    expect(tree.map((step) => step.id)).toEqual(["Write", "Record audio", "Write#2"]);
    expect(tree[1]!.children.map((step) => step.id)).toEqual(["Record audio/English", "Record audio/French", "Record audio/German"]);
    expect(stepProgress(tree, ItemStatus.InProgress)).toEqual({ done: 1, total: 5, percent: 20, running: 2, current: null });
  });

  it("counts leaves for progress and names the running leaf when exactly one runs", () => {
    const one = normalizeSteps([{ label: "P", state: StepState.Active, children: [{ label: "Only", state: StepState.Active }, { label: "Next", state: StepState.Pending }] }])!;
    expect(stepProgress(one, ItemStatus.InProgress)).toMatchObject({ total: 2, running: 1, current: "Only" });
    expect(stepProgress(one, ItemStatus.Done)).toMatchObject({ done: 2, total: 2, running: 0, current: null });
  });

  it("keeps an explicit id, refuses a repeated one, and refuses a blank or long one", () => {
    expect(normalizeSteps([{ id: "rec", label: "A", state: StepState.Done }])![0]!.id).toBe("rec");
    const twice: StepInput[] = [{ id: "x", label: "A", state: StepState.Done }, { id: "x", label: "B", state: StepState.Done }];
    expect(() => normalizeSteps(twice)).toThrow(/unique/);
    expect(() => normalizeSteps([{ id: " ", label: "A", state: StepState.Done }])).toThrow(/id/);
    expect(() => normalizeSteps([{ id: "i".repeat(MAX_STEP_ID + 1), label: "A", state: StepState.Done }])).toThrow(/id/);
  });

  it("accepts 4 levels and refuses a fifth, and accepts 200 steps in all and refuses 201", () => {
    expect(normalizeSteps(nested(MAX_STEP_DEPTH))).toHaveLength(1);
    expect(() => normalizeSteps(nested(MAX_STEP_DEPTH + 1))).toThrow(/levels/);
    const parent = (count: number): StepInput[] => [
      { label: "P", state: StepState.Active, children: Array.from({ length: count }, (_, i) => ({ label: `c${i}`, state: StepState.Pending })) },
    ];
    expect(normalizeSteps(parent(MAX_STEPS - 1))).toHaveLength(1);
    expect(() => normalizeSteps(parent(MAX_STEPS))).toThrow(/at most 200/);
  });

  it("lets a flat resend name a stored child by id next to its parent without an id collision", () => {
    const stored = normalizeSteps([{ label: "P", state: StepState.Active, children: [{ label: "x", state: StepState.Active, id: "a" }, { label: "y", state: StepState.Pending }] }], { now: T1 })!;
    const resent = normalizeSteps([{ label: "P", state: StepState.Active }, { label: "x", state: StepState.Active, id: "a" }], { previous: stored, now: T1 })!;
    expect(resent.map((s) => s.id)).toEqual(["P", "a"]);
    expect(resent[0]!.children.map((s) => s.label)).toEqual(["y"]);
  });

  it("gives the same ids and acceptance whatever the sibling order, even when a generated id meets a kept child's id", () => {
    const stored = normalizeSteps([{ label: "A", state: StepState.Active, children: [{ label: "x", state: StepState.Active }] }, { label: "B", state: StepState.Pending }], { now: T1 })!;
    expect(stored[0]!.children[0]!.id).toBe("A/x");
    const report: StepInput[] = [
      { label: "A/x", state: StepState.Pending },
      { label: "A", state: StepState.Active },
      { label: "B", state: StepState.Pending },
      { label: "C", state: StepState.Pending },
    ];
    const orders = [[0, 1, 2, 3], [1, 0, 2, 3], [3, 2, 1, 0], [2, 3, 0, 1]];
    const idsOf = (steps: Step[]): Record<string, string[]> =>
      Object.fromEntries(steps.map((s) => [s.label, [s.id, ...s.children.map((c) => c.id)]]));
    const results = orders.map((order) => idsOf(normalizeSteps(order.map((i) => report[i]!), { previous: stored, now: T2 })!));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]!["A"]).toEqual(["A", "A/x"]);
    expect(results[0]!["A/x"]![0]).toBe("A/x#2");
  });

  it("lets a stored child named by an explicit id nested elsewhere move there in every sibling order", () => {
    const stored = normalizeSteps([{ label: "P", state: StepState.Active, children: [{ label: "x", state: StepState.Active, id: "a" }] }], { now: T1 })!;
    const parent: StepInput = { label: "P", state: StepState.Active };
    const moved: StepInput = { label: "Q", state: StepState.Active, children: [{ label: "x", state: StepState.Active, id: "a" }] };
    for (const report of [[parent, moved], [moved, parent]]) {
      const built = normalizeSteps(report, { previous: stored, now: T2 })!;
      expect(built.find((s) => s.label === "P")!.children).toEqual([]);
      expect(built.find((s) => s.label === "Q")!.children.map((s) => s.id)).toEqual(["a"]);
    }
  });

  it("finishes every descendant under a done parent, whether the children were sent or kept", () => {
    const stored = normalizeSteps(book, { now: T1 })!;
    const kept = normalizeSteps([{ label: "Write", state: StepState.Done }, { label: "Record audio", state: StepState.Done }], { previous: stored, now: T2 })!;
    const sent = normalizeSteps(
      [{ label: "Write", state: StepState.Done }, { label: "Record audio", state: StepState.Done, children: [{ label: "English", state: StepState.Active }, { label: "French", state: StepState.Pending, children: [{ label: "deep", state: StepState.Active }] }] }],
      { previous: stored, now: T2 },
    )!;
    for (const built of [kept, sent]) {
      const states = (steps: Step[]): StepState[] => steps.flatMap((s) => [s.state, ...states(s.children)]);
      expect(states(built[1]!.children).every((s) => s === StepState.Done)).toBe(true);
      expect(stepProgress(built, ItemStatus.InProgress)!.running).toBe(0);
    }
  });

  it("stamps started_at and done_at on a change of state and keeps them across reports by id", () => {
    const first = normalizeSteps([{ label: "A", state: StepState.Active }, { label: "B", state: StepState.Pending }], { now: T1 })!;
    expect(first.map((s) => [s.started_at, s.done_at])).toEqual([[T1, null], [null, null]]);
    const second = normalizeSteps([{ label: "A", state: StepState.Done }, { label: "B", state: StepState.Active }], { previous: first, now: T2 })!;
    expect(second.map((s) => [s.started_at, s.done_at])).toEqual([[T1, T2], [T2, null]]);
    const third = normalizeSteps([{ label: "A", state: StepState.Done }, { label: "B", state: StepState.Active }], { previous: second, now: T3 })!;
    expect(third).toEqual(second);
  });

  it("keeps the stored children of a step sent without children, and clears them for an empty list", () => {
    const stored = normalizeSteps(book, { now: T1 })!;
    const flat: StepInput[] = [{ label: "Write", state: StepState.Done }, { label: "Record audio", state: StepState.Active }];
    expect(normalizeSteps(flat, { previous: stored, now: T2 })).toEqual(stored);
    const cleared = normalizeSteps([flat[0]!, { ...flat[1]!, children: [] }], { previous: stored, now: T2 })!;
    expect(cleared[1]!.children).toEqual([]);
  });

  it("replaces only one step's children with replaceChildren, and refuses an unknown id listing the known ones", () => {
    const stored = normalizeSteps(book, { now: T1 })!;
    const merged = replaceChildren(stored, "Record audio", [{ label: "Dutch", state: StepState.Active }]);
    const tree = normalizeSteps(merged, { previous: stored, now: T2 })!;
    expect(tree[0]).toEqual(stored[0]);
    expect(tree[1]!.children.map((s) => s.id)).toEqual(["Record audio/Dutch"]);
    expect(() => replaceChildren(stored, "nope", [])).toThrow(/known ids: Write, Record audio, Record audio\/English/);
    expect(() => replaceChildren(null, "nope", [])).toThrow(/none/);
  });

  it("reads an old flat stored list as a tree of depth 1, and a stored tree back as it was", () => {
    const old = JSON.stringify([{ label: "A", state: "done", note: null }, { label: "B", state: "active", note: "now" }]);
    expect(parseStoredSteps(old)).toEqual([storedStep("A", StepState.Done), storedStep("B", StepState.Active, { note: "now" })]);
    const tree = normalizeSteps(book, { now: T1 })!;
    expect(parseStoredSteps(JSON.stringify(tree))).toEqual(tree);
    expect(parseStoredSteps(JSON.stringify([{ label: "A", state: "bogus" }]))).toBeNull();
    expect(parseStoredSteps("[]")).toBeNull();
  });

  it("does not read a stored list far over the write limit, so a legacy row cannot make every board read build it (Slice 47 2b)", () => {
    const rows = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ label: `S${i}`, state: "done", note: null })));
    expect(parseStoredSteps(rows(STORED_STEPS_READ_MAX))).toHaveLength(STORED_STEPS_READ_MAX);
    expect(parseStoredSteps(rows(STORED_STEPS_READ_MAX + 1))).toBeNull();
  });
});
