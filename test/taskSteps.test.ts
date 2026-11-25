import { describe, expect, it } from "vitest";
// @ts-expect-error Vite's ?raw import has no type declaration in this project's tsconfig.
import pluginSource from "../plugin/scripts/hooks/background-agents.mjs?raw";
import { hookStepsInput, keepMirroredRows, normalizeSteps, parseStoredSteps, replaceChildren, TASK_ROW_PREFIX } from "../src/domain/steps";
import { type Step, type StepInput, StepState, TimeSource } from "../src/domain/stepTypes";

const T0 = "2026-11-25T10:00:00.000Z";
const T1 = "2026-11-25T10:05:00.000Z";
const T2 = "2026-11-25T10:50:00.000Z";

const only = (steps: Step[] | null): Step => steps![0]!;

describe("task tools as steps (Slice 53)", () => {
  it("a step with no compaction count stores 0, and a report's count is kept", () => {
    expect(only(normalizeSteps([{ id: "a", label: "A", state: StepState.Active }])).compactions).toBe(0);
    expect(only(normalizeSteps([{ id: "a", label: "A", state: StepState.Active, compactions: 2 }])).compactions).toBe(2);
  });

  it("the count only grows: a later report with a smaller or no count keeps the stored one", () => {
    const first = normalizeSteps([{ id: "a", label: "A", state: StepState.Active, compactions: 3 }]);
    const second = only(normalizeSteps([{ id: "a", label: "A", state: StepState.Active }], { previous: first }));
    expect(second.compactions).toBe(3);
    const smaller = only(normalizeSteps([{ id: "a", label: "A", state: StepState.Active, compactions: 1 }], { previous: first }));
    expect(smaller.compactions).toBe(3);
    const larger = only(normalizeSteps([{ id: "a", label: "A", state: StepState.Active, compactions: 4 }], { previous: first }));
    expect(larger.compactions).toBe(4);
  });

  it("the count survives a round trip through the stored column", () => {
    const stored = normalizeSteps([{ id: "a", label: "A", state: StepState.Done, compactions: 2 }]);
    expect(only(parseStoredSteps(JSON.stringify(stored))).compactions).toBe(2);
    expect(only(parseStoredSteps(JSON.stringify([{ label: "old", state: "active" }]))).compactions).toBe(0);
  });

  it("an agent row sent with task rows keeps the helper's own children and takes the task rows", () => {
    const stored = normalizeSteps([
      { id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: "h1", label: "Helper step", state: StepState.Active }, { id: `${TASK_ROW_PREFIX}old`, label: "Old task", state: StepState.Done }] },
    ]);
    const sent: StepInput[] = [{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: `${TASK_ROW_PREFIX}t1`, label: "New task", state: StepState.Active }] }];
    const built = only(normalizeSteps(hookStepsInput(stored, sent), { previous: stored }));
    expect(built.children.map((child) => child.id)).toEqual(["h1", `${TASK_ROW_PREFIX}t1`]);
  });

  it("an agent row nested under a step keeps the helper's own children and takes the task rows", () => {
    const stored = normalizeSteps([
      { id: "s1", label: "Build", state: StepState.Active, children: [{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: "h1", label: "H1", state: StepState.Done }, { id: "h2", label: "H2", state: StepState.Active }] }] },
    ]);
    const sent: StepInput[] = [
      { id: "s1", label: "Build", state: StepState.Active, children: [{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: `${TASK_ROW_PREFIX}t1`, label: "T1", state: StepState.Active }] }] },
    ];
    const built = only(normalizeSteps(hookStepsInput(stored, sent), { previous: stored }));
    expect(built.children[0]!.children.map((child) => child.id)).toEqual(["h1", "h2", `${TASK_ROW_PREFIX}t1`]);
  });

  it("an agent row sent with no children keeps the helper's children and clears the task rows", () => {
    const stored = normalizeSteps([{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: "h1", label: "Helper step", state: StepState.Active }, { id: `${TASK_ROW_PREFIX}t1`, label: "T", state: StepState.Active }] }]);
    const built = only(normalizeSteps(hookStepsInput(stored, [{ id: "agent-a1", label: "Helper", state: StepState.Active }]), { previous: stored }));
    expect(built.children.map((child) => child.id)).toEqual(["h1"]);
  });

  it("a helper's own child named Task 1 or task-1 survives a hook report", () => {
    const stored = normalizeSteps([{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ label: "Task 1", state: StepState.Active }, { id: "task-1", label: "Own", state: StepState.Active }] }]);
    const sent: StepInput[] = [{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: `${TASK_ROW_PREFIX}1`, label: "Mirrored", state: StepState.Active }] }];
    const built = only(normalizeSteps(hookStepsInput(stored, sent), { previous: stored }));
    expect(built.children.map((child) => child.id)).toEqual(["agent-a1/Task 1", "task-1", `${TASK_ROW_PREFIX}1`]);
  });

  it("no label makes an id with the task prefix", () => {
    const built = normalizeSteps([{ label: `${TASK_ROW_PREFIX}x`, state: StepState.Active }]);
    expect(only(built).id.startsWith(TASK_ROW_PREFIX)).toBe(false);
  });

  it("the plugin's task id prefix equals the server's", () => {
    expect(/export const TASK_ID_PREFIX = '([^']+)'/.exec(pluginSource as string)?.[1]).toBe(TASK_ROW_PREFIX);
  });

  describe("a report that is not a hook's keeps the mirrored task rows", () => {
    const task = (id: string): StepInput => ({ id: `${TASK_ROW_PREFIX}${id}`, label: `Task ${id}`, state: StepState.Active });
    const stored = (): Step[] => normalizeSteps([
      { id: "s1", label: "Build", state: StepState.Active, children: [{ id: "agent-a1", label: "Helper", state: StepState.Active, children: [{ id: "h1", label: "H1", state: StepState.Active }, task("a")] }] },
      task("root"),
    ])!;
    const ids = (steps: readonly Step[]): string[] => steps.map((step) => step.id);

    it("a whole-list report sends no task rows: it neither drops nor adds any", () => {
      const before = stored();
      const sent: StepInput[] = [
        { id: "s1", label: "Build", state: StepState.Done, children: [{ id: "agent-a1", label: "Helper", state: StepState.Done, children: [{ id: "h1", label: "H1", state: StepState.Done }, task("forged")] }] },
        task("forged-root"),
      ];
      const built = normalizeSteps(keepMirroredRows(before, sent), { previous: before })!;
      expect(ids(built)).toEqual(["s1", `${TASK_ROW_PREFIX}root`]);
      expect(ids(built[0]!.children[0]!.children)).toEqual(["h1", `${TASK_ROW_PREFIX}a`]);
    });

    it("an under_step report keeps the task rows under that step, after the rows it sends", () => {
      const before = stored();
      const merged = replaceChildren(before, "agent-a1", [{ label: "Own", state: StepState.Active }, task("forged")]);
      const built = normalizeSteps(keepMirroredRows(before, merged), { previous: before })!;
      expect(ids(built[0]!.children[0]!.children)).toEqual(["agent-a1/Own", `${TASK_ROW_PREFIX}a`]);
      expect(ids(built)).toEqual(["s1", `${TASK_ROW_PREFIX}root`]);
    });

    it("a step sent with no children keeps its stored children, task rows with them", () => {
      const before = stored();
      const built = normalizeSteps(keepMirroredRows(before, [{ id: "s1", label: "Build", state: StepState.Active }]), { previous: before })!;
      expect(ids(built[0]!.children[0]!.children)).toEqual(["h1", `${TASK_ROW_PREFIX}a`]);
    });

    it("a hook report with no task rows clears them all", () => {
      const before = stored();
      const sent: StepInput[] = [{ id: "s1", label: "Build", state: StepState.Active, children: [{ id: "agent-a1", label: "Helper", state: StepState.Active }] }];
      const built = normalizeSteps(hookStepsInput(before, sent), { previous: before })!;
      expect(ids(built)).toEqual(["s1"]);
      expect(ids(built[0]!.children[0]!.children)).toEqual(["h1"]);
    });
  });

  it("a whole-list report is not refused for stored task rows it did not send: the oldest finished ones are trimmed to fit", () => {
    const minute = (index: number): string => new Date(Date.parse(T0) + index * 60000).toISOString();
    const rows: StepInput[] = Array.from({ length: 80 }, (_, index) => ({ id: `${TASK_ROW_PREFIX}t${index}`, label: `Task ${index}`, state: StepState.Done, done_at: minute(index), done_source: TimeSource.Observed }));
    const before = normalizeSteps(rows, { now: minute(200) })!;
    const sent: StepInput[] = Array.from({ length: 150 }, (_, index) => ({ id: `s${index}`, label: `Step ${index}`, state: StepState.Active }));
    const built = normalizeSteps(keepMirroredRows(before, sent), { previous: before, now: T2 })!;
    expect(built).toHaveLength(200);
    const kept = built.filter((step) => step.id.startsWith(TASK_ROW_PREFIX)).map((step) => step.id);
    expect(kept).toHaveLength(50);
    expect(kept[0]).toBe(`${TASK_ROW_PREFIX}t30`);
    expect(kept[49]).toBe(`${TASK_ROW_PREFIX}t79`);
  });

  it("a step sent without children keeping stored task rows is fitted, not refused, when the final tree is over", () => {
    const rows: StepInput[] = Array.from({ length: 190 }, (_, index) => ({ id: `${TASK_ROW_PREFIX}t${index}`, label: `Task ${index}`, state: StepState.Done, done_at: new Date(Date.parse(T0) + index * 60000).toISOString(), done_source: TimeSource.Observed }));
    const before = normalizeSteps([{ id: "a", label: "A", state: StepState.Active, children: rows }], { now: T1 })!;
    expect(before[0]!.children).toHaveLength(190);
    const sent: StepInput[] = [{ id: "a", label: "A", state: StepState.Active }, ...Array.from({ length: 15 }, (_, index) => ({ id: `n${index}`, label: `New ${index}`, state: StepState.Pending }))];
    const built = normalizeSteps(keepMirroredRows(before, sent), { previous: before, now: T2 })!;
    expect(built).toHaveLength(16);
    expect(built[0]!.children).toHaveLength(184);
    expect(built[0]!.children[0]!.id).toBe(`${TASK_ROW_PREFIX}t6`);
  });

  it("a non-hook report marking a step done leaves its mirrored task rows as they are", () => {
    const before = normalizeSteps([
      { id: "s1", label: "Build", state: StepState.Active, children: [{ id: `${TASK_ROW_PREFIX}w`, label: "Write tests", state: StepState.Active }, { id: `${TASK_ROW_PREFIX}p`, label: "Ship", state: StepState.Pending }] },
    ], { now: T0 })!;
    const viaKept = normalizeSteps(keepMirroredRows(before, [{ id: "s1", label: "Build", state: StepState.Done }]), { previous: before, now: T2 })!;
    expect(viaKept[0]!.children.map((child) => [child.state, child.done_at])).toEqual([[StepState.Active, null], [StepState.Pending, null]]);
    const viaSent = normalizeSteps(keepMirroredRows(before, [{ id: "s1", label: "Build", state: StepState.Done, children: [{ id: "own", label: "Own", state: StepState.Active }] }]), { previous: before, now: T2 })!;
    expect(viaSent[0]!.children.map((child) => child.state)).toEqual([StepState.Done, StepState.Active, StepState.Pending]);
  });

  it("a hook report over the cap because of helper rows it cannot see is fitted, not refused", () => {
    const helper: StepInput[] = Array.from({ length: 150 }, (_, index) => ({ id: `h${index}`, label: `Helper ${index}`, state: StepState.Done }));
    const before = normalizeSteps([{ id: "agent-a1", label: "Helper", state: StepState.Active, children: helper }], { now: T1 })!;
    const sent: StepInput[] = [
      { id: "agent-a1", label: "Helper", state: StepState.Active, children: Array.from({ length: 80 }, (_, index) => ({ id: `${TASK_ROW_PREFIX}t${index}`, label: `Task ${index}`, state: index < 40 ? StepState.Done : StepState.Active })) },
    ];
    const built = normalizeSteps(hookStepsInput(before, sent), { previous: before, now: T2 })!;
    expect(built[0]!.children).toHaveLength(199);
    expect(built[0]!.children.filter((child) => child.id.startsWith(TASK_ROW_PREFIX))).toHaveLength(49);
  });

  it("a report is still refused when its own rows are over the limit", () => {
    const own: StepInput[] = Array.from({ length: 201 }, (_, index) => ({ id: `s${index}`, label: `Step ${index}`, state: StepState.Active }));
    expect(() => normalizeSteps(keepMirroredRows(null, own))).toThrow(/at most 200 steps/);
  });

  it("an under_step report is not refused for stored task rows it did not send", () => {
    const rows: StepInput[] = Array.from({ length: 80 }, (_, index) => ({ id: `${TASK_ROW_PREFIX}t${index}`, label: `Task ${index}`, state: StepState.Done }));
    const before = normalizeSteps([{ id: "s1", label: "Build", state: StepState.Active }, ...rows], { now: T1 })!;
    const merged = replaceChildren(before, "s1", Array.from({ length: 150 }, (_, index) => ({ id: `c${index}`, label: `Child ${index}`, state: StepState.Active })));
    const built = normalizeSteps(keepMirroredRows(before, merged), { previous: before, now: T2 })!;
    expect(built[0]!.children).toHaveLength(150);
    expect(built.length).toBeLessThanOrEqual(50);
  });

  it("the hook's observed times beat a later batched report's stamped ones (create, start 10:00, complete 10:05, batched done 10:50)", () => {
    const hookSent = normalizeSteps(
      [{ id: "s1", label: "Write", state: StepState.Done, started_at: T0, started_source: TimeSource.Observed, done_at: T1, done_source: TimeSource.Observed }],
      { now: T1 },
    );
    const batched = only(normalizeSteps([{ id: "s1", label: "Write", state: StepState.Done }], { previous: hookSent, now: T2 }));
    expect([batched.started_at, batched.done_at, batched.started_source, batched.done_source]).toEqual([T0, T1, TimeSource.Observed, TimeSource.Observed]);
  });
});
