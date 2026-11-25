import { describe, expect, it } from "vitest";
import { ItemStatus } from "../src/domain/item";
import { isBlockedOnOwner, normalizeSteps, stepProgress } from "../src/domain/steps";
import { type Step, type StepInput, StepState, TimeSource, WaitsOn } from "../src/domain/stepTypes";

const T0 = "2026-11-25T10:00:00.000Z";
const T1 = "2026-11-25T10:05:00.000Z";
const T2 = "2026-11-25T10:50:00.000Z";
const T3 = "2026-11-25T11:00:00.000Z";

const only = (steps: Step[] | null): Step => steps![0]!;
const done = (extra: Partial<StepInput> = {}): StepInput => ({ id: "a", label: "A", state: StepState.Done, ...extra });

describe("reported step times (Slice 51 B)", () => {
  it("keeps the times a report sends and marks them reported", () => {
    const built = only(normalizeSteps([done({ started_at: T0, done_at: T1 })], { now: T3 }));
    expect([built.started_at, built.done_at, built.started_source, built.done_source]).toEqual([T0, T1, TimeSource.Reported, TimeSource.Reported]);
  });

  it("stamps with the report time and marks the times stamped when none were sent", () => {
    const built = only(normalizeSteps([done()], { now: T3 }));
    expect([built.started_at, built.done_at, built.started_source, built.done_source]).toEqual([T3, T3, TimeSource.Stamped, TimeSource.Stamped]);
  });

  it("drops a time in the future or unreadable and stamps that end, never refusing the report", () => {
    const future = only(normalizeSteps([done({ started_at: T0, done_at: "2026-11-25T12:00:00.000Z" })], { now: T3 }));
    expect([future.started_at, future.done_at, future.done_source]).toEqual([T0, T3, TimeSource.Stamped]);
    const bad = only(normalizeSteps([done({ started_at: T0, done_at: "soon" })], { now: T3 }));
    expect([bad.done_at, bad.done_source]).toEqual([T3, TimeSource.Stamped]);
  });

  it("accepts only an ISO time with a zone: a bare number, a year or a date without a zone is dropped and stamped", () => {
    for (const odd of ["3", "2026", "Nov 3", "2026-11-25T10:00:00", "2026-11-25"]) {
      const built = only(normalizeSteps([done({ started_at: odd, done_at: T1 })], { now: T3 }));
      expect([built.started_at, built.started_source]).toEqual([T1, TimeSource.Stamped]);
    }
    const offset = only(normalizeSteps([done({ started_at: "2026-11-25T11:00:00+01:00", done_at: T1 })], { now: T3 }));
    expect([offset.started_at, offset.started_source]).toEqual([T0, TimeSource.Reported]);
  });

  it("allows a time a few seconds ahead of the board clock", () => {
    const ahead = "2026-11-25T11:00:30.000Z";
    const built = only(normalizeSteps([done({ done_at: ahead })], { now: T3 }));
    expect([built.done_at, built.done_source]).toEqual([ahead, TimeSource.Reported]);
  });

  it("stamps the end, keeping the tree, when a reported start is after the end", () => {
    const built = only(normalizeSteps([done({ started_at: T2, done_at: T1 })], { now: T3 }));
    expect([built.started_at, built.done_at, built.done_source]).toEqual([T2, T3, TimeSource.Stamped]);
  });

  it("never lets a start inside the skew fail the report when the end is stamped before it", () => {
    const ahead = "2026-11-25T11:00:30.000Z";
    const built = only(normalizeSteps([done({ started_at: ahead })], { now: T3 }));
    expect([built.started_at, built.done_at]).toEqual([ahead, ahead]);
    expect(built.done_source).toBe(TimeSource.Stamped);
  });

  it("moves a guessed start back to a reported end instead of refusing", () => {
    const built = only(normalizeSteps([done({ done_at: T1 })], { now: T3 }));
    expect([built.started_at, built.done_at, built.started_source]).toEqual([T1, T1, TimeSource.Stamped]);
  });
});

describe("which step time wins (Slice 51 F)", () => {
  const stored = (extra: Partial<StepInput>): Step[] => normalizeSteps([done(extra)], { now: T3 })!;

  it("keeps an observed end through a later batched report, with or without a reported time", () => {
    const seen = stored({ started_at: T0, done_at: T1, started_source: TimeSource.Observed, done_source: TimeSource.Observed });
    const later = only(normalizeSteps([done({ done_at: T2 })], { previous: seen, now: T3 }));
    expect([later.done_at, later.done_source]).toEqual([T1, TimeSource.Observed]);
    const bare = only(normalizeSteps([done()], { previous: seen, now: T3 }));
    expect([bare.started_at, bare.done_at, bare.done_source]).toEqual([T0, T1, TimeSource.Observed]);
  });

  it("lets a reported time replace a stamped one, and never lets a stamped one replace a reported one", () => {
    const guessed = stored({});
    const reported = only(normalizeSteps([done({ started_at: T0, done_at: T1 })], { previous: guessed, now: T3 }));
    expect([reported.started_at, reported.done_at, reported.done_source]).toEqual([T0, T1, TimeSource.Reported]);
    const again = only(normalizeSteps([done()], { previous: [reported], now: "2026-11-25T11:30:00.000Z" }));
    expect([again.started_at, again.done_at, again.done_source]).toEqual([T0, T1, TimeSource.Reported]);
  });

  it("lets an observed time replace a reported one, and a later reported one replace an older reported one", () => {
    const first = stored({ started_at: T0, done_at: T1 });
    const seen = only(normalizeSteps([done({ done_at: T1, done_source: TimeSource.Observed })], { previous: first, now: T3 }));
    expect(seen.done_source).toBe(TimeSource.Observed);
    const corrected = only(normalizeSteps([done({ done_at: T2 })], { previous: first, now: T3 }));
    expect([corrected.done_at, corrected.done_source]).toEqual([T2, TimeSource.Reported]);
  });

  it("does not turn a guess into a report when a client sends back what it read (the same time, or source stamped)", () => {
    const guessed = stored({});
    const echoed = only(normalizeSteps([done({ started_at: T3, done_at: T3 })], { previous: guessed, now: "2026-11-25T11:30:00.000Z" }));
    expect([echoed.started_source, echoed.done_source]).toEqual([TimeSource.Stamped, TimeSource.Stamped]);
    const named = only(normalizeSteps([done({ done_at: T1, done_source: TimeSource.Stamped })], { previous: guessed, now: T3 }));
    expect([named.done_at, named.done_source]).toEqual([T3, TimeSource.Stamped]);
  });

  it("reads a stored step with times but no source as stamped (a row from before Slice 51)", () => {
    const legacy: Step[] = [{ id: "a", label: "A", state: StepState.Done, note: null, started_at: T0, done_at: T1, started_source: null, done_source: null, waits_on: null, link: null, compactions: 0, children: [] }];
    const next = only(normalizeSteps([done({ done_at: T2 })], { previous: legacy, now: T3 }));
    expect([next.started_at, next.done_at, next.done_source]).toEqual([T0, T2, TimeSource.Reported]);
  });
});

describe("blocked steps (Slice 51 A)", () => {
  const blocked = (extra: Partial<StepInput> = {}): StepInput => ({ id: "b", label: "B", state: StepState.Blocked, note: "waits on slice 52", ...extra });

  it("needs a note saying what it waits on, defaults to other work and keeps a safe link", () => {
    expect(() => normalizeSteps([blocked({ note: null })], { now: T3 })).toThrow(/must say what it waits on/);
    const built = only(normalizeSteps([blocked({ link: "https://example.com/pr/1" })], { now: T3 }));
    expect([built.state, built.waits_on, built.link, built.started_source]).toEqual([StepState.Blocked, WaitsOn.Work, "https://example.com/pr/1", TimeSource.Stamped]);
    const dropped = only(normalizeSteps([blocked({ link: "javascript:alert(1)", waits_on: "nobody" as WaitsOn })], { now: T3 }));
    expect([dropped.link, dropped.waits_on]).toEqual([null, WaitsOn.Work]);
    const doneWithBadLink = only(normalizeSteps([{ id: "d", label: "D", state: StepState.Done, link: "nope" }], { now: T3 }));
    expect(doneWithBadLink.link).toBeNull();
  });

  it("keeps waits_on and link only on a blocked step, and has no end time", () => {
    const owner = only(normalizeSteps([blocked({ waits_on: WaitsOn.Owner })], { now: T3 }));
    expect([owner.waits_on, owner.done_at]).toEqual([WaitsOn.Owner, null]);
    const active = only(normalizeSteps([{ id: "b", label: "B", state: StepState.Active, waits_on: WaitsOn.Owner, link: "https://example.com" }], { now: T3 }));
    expect([active.waits_on, active.link]).toEqual([null, null]);
  });

  it("finds a step blocked on the owner anywhere in the tree, and counts blocked leaves in the progress", () => {
    const tree = normalizeSteps([{ id: "p", label: "P", state: StepState.Pending, children: [done(), blocked({ waits_on: WaitsOn.Owner })] }], { now: T3 })!;
    expect(isBlockedOnOwner(tree)).toBe(true);
    expect(isBlockedOnOwner(normalizeSteps([blocked()], { now: T3 }))).toBe(false);
    expect(stepProgress(tree, ItemStatus.InProgress)).toMatchObject({ done: 1, total: 2, blocked: 1, running: 0, current: null });
  });
});

describe("progress counts a slice's open checks (Slice 51 C)", () => {
  it("reads 11 done steps and one open check as 11 of 12, never 100%, even when the slice is done", () => {
    const steps = normalizeSteps(Array.from({ length: 11 }, (_, i) => ({ label: `S${i}`, state: StepState.Done })), { now: T3 })!;
    expect(stepProgress(steps, ItemStatus.InProgress, 1)).toMatchObject({ done: 11, total: 12, percent: 92, open_checks: 1 });
    expect(stepProgress(steps, ItemStatus.Done, 1)).toMatchObject({ done: 11, total: 12, percent: 92 });
    expect(stepProgress(steps, ItemStatus.Done)).toMatchObject({ done: 11, total: 11, percent: 100 });
  });

  it("caps a rounded 100 at 99 while a check is open", () => {
    const steps = normalizeSteps(Array.from({ length: 300 }, () => ({ label: "S", state: StepState.Done })).slice(0, 199).map((s, i) => ({ ...s, id: `s${i}` })), { now: T3 })!;
    expect(stepProgress(steps, ItemStatus.InProgress, 1)!.percent).toBe(99);
  });
});

describe("a report without children and times keeps both (Slice 51 G replay)", () => {
  const first: StepInput[] = [
    done({ id: "write", label: "Write", started_at: T0, done_at: T1 }),
    { id: "refine", label: "Refine", state: StepState.Active, started_at: T1, children: [
      { id: "g-tools", label: "Tools", state: StepState.Done, started_at: T1, done_at: T2 },
      { id: "g-hooks", label: "Hooks", state: StepState.Active },
      { id: "q", label: "Questions", state: StepState.Pending },
    ] },
  ];

  it("keeps the three children of a step sent without children, and every done step's reported times", () => {
    const stored = normalizeSteps(first, { now: T2 })!;
    const resent: StepInput[] = [done({ id: "write", label: "Write" }), { id: "refine", label: "Refine", state: StepState.Active }];
    const next = normalizeSteps(resent, { previous: stored, now: T3 })!;
    expect(next[1]!.children.map((child) => child.id)).toEqual(["g-tools", "g-hooks", "q"]);
    expect([next[0]!.started_at, next[0]!.done_at]).toEqual([T0, T1]);
    expect([next[1]!.children[0]!.started_at, next[1]!.children[0]!.done_at]).toEqual([T1, T2]);
  });
});
