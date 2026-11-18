import { describe, expect, it } from "vitest";
import { ItemStatus } from "../src/domain/item";
import {
  isWorkingNow,
  MAX_STEP_LABEL,
  MAX_STEP_NOTE,
  MAX_STEPS,
  normalizeSteps,
  stepProgress,
  type WorkingRow,
} from "../src/domain/steps";
import { isExpired } from "../src/domain/stale";
import { type Step, type StepInput, StepState } from "../src/domain/stepTypes";
import { DomainError } from "../src/domain/upsert";

const NOW = new Date("2026-11-16T13:48:00.000Z");
const MINUTES = 120;
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function steps(done: number, active: number, pending: number): Step[] {
  const states = [
    ...Array<StepState>(done).fill(StepState.Done),
    ...Array<StepState>(active).fill(StepState.Active),
    ...Array<StepState>(pending).fill(StepState.Pending),
  ];
  return states.map((state, i) => ({ label: `Step ${i + 1}`, state, note: null }));
}

describe("normalizeSteps", () => {
  it("keeps the order and makes a missing or empty note null", () => {
    const given: StepInput[] = [
      { label: "Implementation", state: StepState.Done },
      { label: "Review 1", state: StepState.Active, note: "Two helper agents count under this step" },
      { label: "Merging", state: StepState.Pending, note: "" },
    ];
    expect(normalizeSteps(given)).toEqual([
      { label: "Implementation", state: "done", note: null },
      { label: "Review 1", state: "active", note: "Two helper agents count under this step" },
      { label: "Merging", state: "pending", note: null },
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
      steps(0, 2, 1),
    ];
    for (const list of bad) {
      expect(() => normalizeSteps(list)).toThrow(DomainError);
      expect(() => normalizeSteps(list)).toThrow(/field steps/);
    }
  });
});

describe("stepProgress", () => {
  it("reads 1 of 7 as 14% with the active step's label", () => {
    expect(stepProgress(steps(1, 1, 5), ItemStatus.InProgress)).toEqual({ done: 1, total: 7, percent: 14, current: "Step 2" });
  });

  it("follows a list that shrinks: six steps with two done is 33%", () => {
    expect(stepProgress(steps(2, 1, 3), ItemStatus.InProgress)).toMatchObject({ done: 2, total: 6, percent: 33 });
  });

  it("is null for no list or an empty one, and has no current step while none is active", () => {
    expect(stepProgress(null, ItemStatus.InProgress)).toBeNull();
    expect(stepProgress(undefined, ItemStatus.InProgress)).toBeNull();
    expect(stepProgress([], ItemStatus.InProgress)).toBeNull();
    expect(stepProgress(steps(0, 0, 3), ItemStatus.InProgress)).toEqual({ done: 0, total: 3, percent: 0, current: null });
  });

  it("shows 100% for a done item whatever its list says", () => {
    expect(stepProgress(steps(1, 1, 5), ItemStatus.Done)).toEqual({ done: 7, total: 7, percent: 100, current: null });
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
      { label: "a".repeat(MAX_STEP_LABEL), state: StepState.Active, note: "n".repeat(MAX_STEP_NOTE) },
    ]);
    expect(() => normalizeSteps([{ label: "a".repeat(MAX_STEP_LABEL + 1), state: StepState.Done }])).toThrow();
  });
});
