import { beforeEach, describe, expect, it } from "vitest";
import { medianOf, p90Of, ProcessSource, type ProcessStat, processKeyOf, processStatsOf, type RunRow, runRowsOf } from "../src/domain/processStats";
// @ts-expect-error The plugin hook is plain JavaScript with no type declarations.
import { splitSubject } from "../plugin/scripts/hooks/hook-input.mjs";
import { badFieldSteps, hookStepsInput, isProcessKey, MAX_PROCESS_KEY, MAX_STEP_COUNTS, normalizeSteps, parseStoredSteps, TASK_ROW_PREFIX } from "../src/domain/steps";
import { type Step, type StepCost, StepState, TimeSource } from "../src/domain/stepTypes";
import { type ItemRepository, PROCESS_COST_ITEM_LIMIT, PROCESS_ITEM_LIMIT, type StepListRow } from "../src/application/ports";
import { processStats, queryRuns } from "../src/application/processRuns";
import { fitList, runDropped } from "../src/mcp/tools";
import { callTool, resetBoard } from "./helpers";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const RANGE = { from: "2026-10-26T12:00:00.000Z", to: NOW.toISOString() };

function costOf(seconds: number, tokens: number, peak: number): StepCost {
  return {
    models: [],
    input_tokens: tokens,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    total_tokens: tokens,
    peak_context: peak,
    compactions: 0,
    duration_seconds: seconds,
    started_source: TimeSource.Observed,
    ended_source: TimeSource.Observed,
  };
}

function doneStep(id: string, seconds: number, extra: Partial<Step> = {}): Step {
  const done = new Date(NOW.getTime() - 3_600_000);
  return {
    id,
    label: `Step ${id}`,
    state: StepState.Done,
    note: null,
    started_at: new Date(done.getTime() - seconds * 1000).toISOString(),
    done_at: done.toISOString(),
    started_source: TimeSource.Observed,
    done_source: TimeSource.Observed,
    waits_on: null,
    link: null,
    children: [],
    ...extra,
  };
}

function source(steps: Step[], agent: string | null = null) {
  return { key: "demo-app/slice-1", project: "demo-app", agent, steps };
}

describe("percentiles", () => {
  it("takes the middle value, the mean of the two middle ones for an even count", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });

  it("takes the p90 by nearest rank", () => {
    expect(p90Of([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90Of([])).toBeNull();
  });
});

describe("process stats", () => {
  it("gives the expected median and p90 for 40 seeded runs of one key", () => {
    const steps = Array.from({ length: 40 }, (_, index) => {
      const n = index + 1;
      return doneStep(`s${n}`, n * 10, { process: "slice/implement", cost: costOf(n * 10, n * 1000, n * 100), counts: { findings: 1 } });
    });
    const [stat] = processStatsOf(runRowsOf([source(steps)], RANGE));
    expect(stat).toMatchObject({
      process: "slice/implement",
      process_source: ProcessSource.Reported,
      runs: 40,
      timed_runs: 40,
      median_seconds: 205,
      p90_seconds: 360,
      costed_runs: 40,
      median_tokens: 20_500,
      p90_tokens: 36_000,
      median_peak_context: 2050,
      p90_peak_context: 3600,
      counts: { findings: 40 },
    });
  });

  it("groups a step with no key under its agent type, then its label", () => {
    const rows = runRowsOf([source([doneStep("a", 60, { label: "Translate Pages" })], "Session")], RANGE);
    expect(rows[0]).toMatchObject({ process: "session/translate pages", process_source: ProcessSource.Derived });
    expect(processKeyOf(doneStep("b", 1, { label: "Plan" }), null).process).toBe("unknown/plan");
  });

  it("leaves a figure null when no run has it, never 0", () => {
    const [stat] = processStatsOf(runRowsOf([source([doneStep("a", 5, { process: "a/b", started_source: TimeSource.Stamped })])], RANGE)) as ProcessStat[];
    expect(stat).toMatchObject({ runs: 1, timed_runs: 0, median_seconds: null, p90_seconds: null, costed_runs: 0, median_tokens: null });
  });

  it("counts only done steps inside the range, and a parent only when it has a key", () => {
    const old = doneStep("old", 5, { done_at: "2026-09-01T00:00:00.000Z" });
    const parentPlain = doneStep("p1", 5, { children: [doneStep("c1", 5)] });
    const parentKeyed = doneStep("p2", 5, { process: "wave/run", children: [doneStep("c2", 5)] });
    const active = doneStep("act", 5, { state: StepState.Active });
    const ids = runRowsOf([source([old, parentPlain, parentKeyed, active])], RANGE).map((row: RunRow) => row.step_id);
    expect(ids.sort()).toEqual(["c1", "p2"]);
  });
});

describe("the plugin's key pattern and the server's accept the same strings", () => {
  const keys = ["a", "a/b", "slice/implement", "review/pass-2", "a_b/c-d", "a1/b2/c3", "a".repeat(MAX_PROCESS_KEY), "a".repeat(MAX_PROCESS_KEY + 1), "A", "a//b", "/a", "a/", "a-", "-a", "a b", "a--b", "a/B", "a.b", ""];

  it.each(keys)("agrees on %j", (key) => {
    const fromSubject = splitSubject(`[${key}] Name`) as { subject: string; process: string };
    expect(fromSubject.process !== "").toBe(isProcessKey(key));
  });
});

describe("a hook report clears a stale task-row key", () => {
  it("a task row sent with no process loses the key it had", () => {
    const row = { id: `${TASK_ROW_PREFIX}t1`, label: "Task", state: StepState.Active };
    const stored = normalizeSteps([{ ...row, process: "old/key" }])!;
    const kept = normalizeSteps(hookStepsInput(stored, [row]), { previous: stored })!;
    expect(kept[0]).not.toHaveProperty("process");
    const named = normalizeSteps(hookStepsInput(stored, [{ ...row, process: "new/key" }]), { previous: stored })!;
    expect(named[0]).toMatchObject({ process: "new/key" });
  });
});

describe("process and counts on a step", () => {
  const sent = (extra: Record<string, unknown>) => [{ id: "a", label: "A", state: StepState.Done, ...extra }];

  it("stores both and keeps them when a later report leaves them out", () => {
    const first = normalizeSteps(sent({ process: "review/pass-2", counts: { findings: 3, fixed: 2 } }), { now: NOW.toISOString() })!;
    expect(first[0]).toMatchObject({ process: "review/pass-2", counts: { findings: 3, fixed: 2 } });
    const again = normalizeSteps(sent({}), { previous: first, now: NOW.toISOString() })!;
    expect(again[0]).toMatchObject({ process: "review/pass-2", counts: { findings: 3, fixed: 2 } });
    const cleared = normalizeSteps(sent({ process: null, counts: null }), { previous: first, now: NOW.toISOString() })!;
    expect(cleared[0]).not.toHaveProperty("process");
    expect(cleared[0]).not.toHaveProperty("counts");
  });

  it("a malformed key is dropped, the report saves, the stored key stays, and the step is named", () => {
    const stored = normalizeSteps(sent({ process: "slice/implement" }))!;
    for (const bad of ["Slice/Implement", "a//b", `a/${"b".repeat(MAX_PROCESS_KEY)}`]) {
      expect(normalizeSteps(sent({ process: bad }))![0]).not.toHaveProperty("process");
      expect(normalizeSteps(sent({ process: bad }), { previous: stored })![0]).toMatchObject({ process: "slice/implement" });
      expect(badFieldSteps(sent({ process: bad }))).toEqual(["A"]);
    }
    expect(badFieldSteps(sent({ process: "a/b" }))).toEqual([]);
  });

  it("a wrong-typed process or counts value is dropped with a notice and never clears the stored ones", () => {
    const stored = normalizeSteps(sent({ process: "slice/implement", counts: { findings: 3 } }))!;
    for (const bad of [5, true, ["a/b"], { a: 1 }]) {
      expect(badFieldSteps(sent({ process: bad }))).toEqual(["A"]);
      expect(normalizeSteps(sent({ process: bad }), { previous: stored })![0]).toMatchObject({ process: "slice/implement" });
    }
    for (const bad of ["3", 5, [1], { findings: "3" }]) {
      expect(badFieldSteps(sent({ counts: bad }))).toEqual(["A"]);
      expect(normalizeSteps(sent({ counts: bad }), { previous: stored })![0]).toMatchObject({ counts: { findings: 3 } });
    }
  });

  it("an explicit empty process clears the stored key with no notice, like null", () => {
    const stored = normalizeSteps(sent({ process: "slice/implement" }))!;
    for (const clear of ["", "  ", null]) {
      expect(normalizeSteps(sent({ process: clear }), { previous: stored })![0]).not.toHaveProperty("process");
      expect(badFieldSteps(sent({ process: clear }))).toEqual([]);
    }
  });

  it("malformed counts never refuse the report: they are dropped, the stored counts stay, and the step is named", () => {
    const stored = normalizeSteps(sent({ counts: { findings: 3 } }))!;
    const eleven = Object.fromEntries(Array.from({ length: MAX_STEP_COUNTS + 1 }, (_, index) => [`c${index}`, 1]));
    for (const bad of [{ Findings: 1 }, { findings: 1.5 }, eleven]) {
      expect(normalizeSteps(sent({ counts: bad }))![0]).not.toHaveProperty("counts");
      expect(normalizeSteps(sent({ counts: bad }), { previous: stored })![0]).toMatchObject({ counts: { findings: 3 } });
      expect(badFieldSteps(sent({ counts: bad }))).toEqual(["A"]);
    }
    expect(normalizeSteps(sent({ counts: null }), { previous: stored })![0]).not.toHaveProperty("counts");
    expect(badFieldSteps(sent({ counts: null }))).toEqual([]);
  });

  it("reads a stored value that is no key as none", () => {
    const text = JSON.stringify([{ id: "a", label: "A", state: "done", process: 5, counts: { Bad: 1 } }]);
    expect(parseStoredSteps(text)![0]).not.toHaveProperty("process");
    expect(parseStoredSteps(text)![0]).not.toHaveProperty("counts");
  });
});

describe("query_runs and process_stats tools", () => {
  beforeEach(resetBoard);
  const KEY = "demo-app/task-runs1";
  const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
  const finished = (id: string, minutes: number, extra: Record<string, unknown> = {}) => ({
    id,
    label: `Run ${id}`,
    state: "done",
    started_at: minutesAgo(minutes + 10),
    done_at: minutesAgo(minutes),
    ...extra,
  });

  async function seed(): Promise<void> {
    const reply = await callTool("report_progress", {
      key: KEY,
      project: "demo-app",
      type: "unplanned",
      title: "Runs demo",
      status: "in_progress",
      agent: "session",
      steps: [
        finished("a", 30, { process: "review/pass-1", counts: { findings: 4, fixed: 3 } }),
        finished("b", 20, { process: "review/pass-1", counts: { findings: 2, fixed: 2 } }),
        finished("c", 10),
      ],
    });
    expect(reply.isError).toBe(false);
  }

  it("returns the rows with counts, filtered by process key", async () => {
    await seed();
    const all = (await callTool("query_runs", {})).data as RunRow[];
    expect(all.map((row) => row.step_id)).toEqual(["c", "b", "a"]);
    expect(all[0]).toMatchObject({ process: "session/run c", process_source: "derived", duration_seconds: 600, counts: null });
    const one = (await callTool("query_runs", { process: "review/pass-1", project: "demo-app" })).data as RunRow[];
    expect(one.map((row) => row.step_id)).toEqual(["b", "a"]);
    expect(one[1]!.counts).toEqual({ findings: 4, fixed: 3 });
    const none = (await callTool("query_runs", { process: "review/pass-1", to: minutesAgo(25) })).data as RunRow[];
    expect(none.map((row) => row.step_id)).toEqual(["a"]);
  });

  it("returns the stats per process key with the counts summed, readable with the read token", async () => {
    await seed();
    const reply = await callTool("process_stats", { window_days: 30 }, "test-read-token");
    expect(reply.isError).toBe(false);
    const stats = reply.data as ProcessStat[];
    expect(stats[0]).toMatchObject({ process: "review/pass-1", runs: 2, median_seconds: 600, counts: { findings: 6, fixed: 5 } });
    expect(stats[1]).toMatchObject({ process: "session/run c", runs: 1 });
  });

  it("refuses a bad date; a bad process key is dropped and the report saves", async () => {
    expect((await callTool("query_runs", { from: "yesterday-ish" })).isError).toBe(true);
    const bad = await callTool("report_progress", { key: KEY, project: "demo-app", type: "unplanned", title: "x", status: "in_progress", steps: [{ label: "A", state: "done", process: "Not A Key" }] });
    expect(bad.isError).toBe(false);
    expect((bad.data as { steps: object[] }).steps[0]).not.toHaveProperty("process");
  });

  it("leaves out an archived item", async () => {
    await seed();
    await callTool("archive_item", { key: KEY });
    expect((await callTool("query_runs", {})).data).toEqual([]);
  });
});

describe("what counts as a run", () => {
  const ids = (steps: Step[]): string[] => runRowsOf([source(steps)], RANGE).map((row) => row.step_id).sort();

  it("counts a keyed parent once, not its unkeyed children, and a keyed child as its own run", () => {
    const parent = doneStep("p", 600, { process: "slice/implement", children: [doneStep("c1", 100), doneStep("c2", 100, { process: "review/pass-1" }), doneStep("c3", 100, { children: [doneStep("g1", 10)] })] });
    expect(ids([parent])).toEqual(["c2", "p"]);
  });

  it("counts mirrored task and agent rows like any leaf, and not when a keyed ancestor holds them", () => {
    const rows = [doneStep("mirror-task:t1", 5), doneStep("agent-a1", 5), doneStep("mirror-task:t2", 5, { process: "tests/full" })];
    expect(ids(rows)).toEqual(["agent-a1", "mirror-task:t1", "mirror-task:t2"]);
    expect(ids([doneStep("k", 50, { process: "slice/implement", children: rows })])).toEqual(["k", "mirror-task:t2"]);
  });

  it("keeps a reported key and a derived key of the same text apart in the stats", () => {
    const rows = runRowsOf([source([doneStep("a", 5, { process: "session/build" }), doneStep("b", 5, { label: "Build" })], "session")], RANGE);
    const stats = processStatsOf(rows);
    expect(stats.map((stat) => [stat.process, stat.process_source, stat.runs])).toEqual([
      ["session/build", ProcessSource.Derived, 1],
      ["session/build", ProcessSource.Reported, 1],
    ]);
  });
});

describe("process reads on a repository", () => {
  const at = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const clock = { now: () => NOW };
  const costedStep = (id: string, minutes: number): Step => doneStep(id, 60, { done_at: at(minutes), started_at: at(minutes + 1), cost_ref: { writer: "hook", agent_id: "a1" } });

  function fakeRepo(rows: StepListRow[], cutAt: string | null) {
    const costReads: string[][] = [];
    const repo = {
      stepListsSince: async () => ({ rows, cutAt }),
      stepRunsFor: async (keys: string[]) => {
        costReads.push(keys);
        return [];
      },
    } as unknown as ItemRepository;
    return { repo, costReads };
  }

  const row = (key: string, steps: Step[]): StepListRow => ({ key, project: "demo-app", agent: "session", updated_at: at(1), steps });

  it("says when the item cap was hit, naming the oldest update read", async () => {
    const { repo } = fakeRepo([row("demo-app/a", [doneStep("x", 5)])], "2026-11-01T00:00:00.000Z");
    const read = await processStats(repo, { window_days: 180 }, clock);
    expect(read.notice).toContain("2026-11-01T00:00:00.000Z");
    expect(read.notice).toContain(String(PROCESS_ITEM_LIMIT));
    expect((await processStats(fakeRepo([], null).repo, {}, clock)).notice).toBe("");
  });

  it("reads step costs only for items with a costed step in the range, and bounds how many", async () => {
    const old = costedStep("old", 60 * 24 * 90);
    const { repo, costReads } = fakeRepo([row("demo-app/in", [costedStep("a", 30)]), row("demo-app/old", [old]), row("demo-app/none", [doneStep("b", 5)])], null);
    await queryRuns(repo, {}, clock);
    expect(costReads).toEqual([["demo-app/in"]]);
    const many = Array.from({ length: PROCESS_COST_ITEM_LIMIT + 5 }, (_, n) => row(`demo-app/m${n}`, [costedStep("a", 30)]));
    const bounded = fakeRepo(many, null);
    const read = await queryRuns(bounded.repo, {}, clock);
    expect(bounded.costReads[0]).toHaveLength(PROCESS_COST_ITEM_LIMIT);
    expect(read.notice).toContain("costs were read");
  });

  it("matches the process filter in any case and refuses a time with no zone", async () => {
    const { repo } = fakeRepo([row("demo-app/a", [doneStep("x", 5, { label: "Build It" })])], null);
    expect((await queryRuns(repo, { process: "Session/Build It" }, clock)).rows).toHaveLength(1);
    await expect(queryRuns(repo, { from: "2026-11-01" }, clock)).rejects.toThrow(/ISO/);
    await expect(queryRuns(repo, { to: "1" }, clock)).rejects.toThrow(/ISO/);
  });
});

describe("cutting a run reply", () => {
  const runRow = (n: number, extra: Record<string, unknown> = {}) => ({
    item_key: `demo-app/task-${n}`,
    step_id: `step-${n}-${"s".repeat(40)}`,
    process: `review/${"p".repeat(60)}`,
    process_source: "reported",
    label: "l".repeat(600),
    done_at: "2026-11-25T11:00:00.000Z",
    ...extra,
  });

  it("names the first dropped run by item key and step id, and keeps ids whole in the last-resort clip", () => {
    const entries = Array.from({ length: 300 }, (_, n) => runRow(n));
    const fit = fitList(entries, { what: "runs", dropped: runDropped }) as { data: ReturnType<typeof runRow>[]; note: string };
    expect(fit.data.length).toBeLessThan(300);
    expect(fit.note).toContain(`first dropped run ${entries[fit.data.length]!.item_key} step ${entries[fit.data.length]!.step_id}`);
    const huge = fitList([runRow(1, { label: "x".repeat(80_000) })], { what: "runs", dropped: runDropped }) as { data: ReturnType<typeof runRow>[] };
    expect(huge.data[0]).toMatchObject({ item_key: "demo-app/task-1", step_id: runRow(1).step_id, process: runRow(1).process });
    expect(huge.data[0]!.label.length).toBeLessThan(80_000);
  });

  it("names a dropped stat by its process key and carries a notice on a reply that fits", () => {
    const stats = Array.from({ length: 300 }, (_, n) => ({ process: `k/${n}`, why: "w".repeat(400) }));
    const fit = fitList(stats, { what: "process keys", dropped: runDropped, notice: "partial: test" }) as { data: unknown[]; note: string };
    expect(fit.note).toContain(`first dropped process key k/${fit.data.length}`);
    expect(fit.note).toContain("partial: test");
    const small = fitList([{ process: "a/b" }], { notice: "partial: test" }) as { data: unknown[]; note: string };
    expect(small).toMatchObject({ data: [{ process: "a/b" }], note: "partial: test" });
  });
});
