import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { type BudgetsConfig, DEFAULT_PEAK_CONTEXT_BUDGET, parseConfig } from "../src/config";
import { breachOf, withBreaches } from "../src/domain/budgets";
import { type Step, StepState, TimeSource } from "../src/domain/stepTypes";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { breachText, firstBreach } from "../web/src/stepsText";
import { translator } from "../web/src/strings";
import { callTool, resetBoard } from "./helpers";
import { storedStep } from "./stepFixtures";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const t = translator();

const BUDGETS: BudgetsConfig = {
  defaultPeakContext: 150_000,
  processes: { "build/run-tests": { minutes: 6 }, "docs/write": { tokens: 1_000_000, peakContext: 200_000 } },
};

const running = (minutes: number, extra: Partial<Step> = {}): Step =>
  storedStep("Run tests", StepState.Active, { started_at: minutesAgo(minutes), started_source: TimeSource.Reported, process: "build/run-tests", ...extra });

const costed = (peak: number, total: number, compactions: number, extra: Partial<Step> = {}): Step =>
  storedStep("Write", StepState.Done, {
    process: "docs/write",
    cost: {
      models: [], input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, total_tokens: total, peak_context: peak,
      compactions, duration_seconds: 60, started_source: TimeSource.Observed, ended_source: TimeSource.Observed,
    },
    ...extra,
  });

describe("breachOf (Slice 56)", () => {
  it("flags a running step past its minutes, rounded up, and not one inside them", () => {
    expect(breachOf(running(9), BUDGETS, NOW)).toEqual({ kind: "time", used: 9, budget: 6, compacted: false });
    expect(breachOf(running(6.5), BUDGETS, NOW)).toMatchObject({ kind: "time", used: 7, budget: 6 });
    expect(breachOf(running(6), BUDGETS, NOW)).toBeNull();
    expect(breachOf(running(3), BUDGETS, NOW)).toBeNull();
  });

  it("checks time only for a running step with a start and a process key the config names", () => {
    expect(breachOf(running(30, { state: StepState.Done, done_at: null }), BUDGETS, NOW)).toBeNull();
    expect(breachOf(running(30, { state: StepState.Pending }), BUDGETS, NOW)).toBeNull();
    expect(breachOf(running(30, { started_at: null }), BUDGETS, NOW)).toBeNull();
    expect(breachOf(running(30, { process: undefined }), BUDGETS, NOW)).toBeNull();
    expect(breachOf(running(30, { process: "other/key" }), BUDGETS, NOW)).toBeNull();
  });

  it("flags a cost row over the default peak context, with or without a process key, and says whether it was compacted", () => {
    expect(breachOf(costed(180_000, 10, 0, { process: undefined }), BUDGETS, NOW)).toEqual({ kind: "context", used: 180_000, budget: 150_000, compacted: false });
    expect(breachOf(costed(180_000, 10, 2, { process: "other/key" }), BUDGETS, NOW)).toMatchObject({ kind: "context", compacted: true });
    expect(breachOf(costed(150_000, 10, 0, { process: undefined }), BUDGETS, NOW)).toBeNull();
  });

  it("uses the process's own peak context and tokens budgets, context first", () => {
    expect(breachOf(costed(180_000, 10, 0), BUDGETS, NOW)).toBeNull();
    expect(breachOf(costed(210_000, 2_000_000, 0), BUDGETS, NOW)).toMatchObject({ kind: "context", budget: 200_000 });
    expect(breachOf(costed(100_000, 2_000_000, 0), BUDGETS, NOW)).toEqual({ kind: "tokens", used: 2_000_000, budget: 1_000_000, compacted: false });
  });

  it("shows no time breach for a running step on a card that is not live, but keeps a cost breach", () => {
    expect(breachOf(running(2880), BUDGETS, NOW, false)).toBeNull();
    expect(breachOf(running(2880), BUDGETS, NOW, true)).toMatchObject({ kind: "time" });
    expect(breachOf(costed(300_000, 1, 0), BUDGETS, NOW, false)?.kind).toBe("context");
  });

  it("keeps a time breach once the step has finished, from the cost duration else done_at minus started_at", () => {
    const withCost = running(30, { state: StepState.Done, cost: { ...costed(1, 1, 0).cost!, duration_seconds: 15 * 60 } });
    expect(breachOf(withCost, BUDGETS, NOW, false)).toEqual({ kind: "time", used: 15, budget: 6, compacted: false });
    const byTimes = running(30, { state: StepState.Done, done_at: minutesAgo(10) });
    expect(breachOf(byTimes, BUDGETS, NOW, false)).toMatchObject({ kind: "time", used: 20, budget: 6 });
    expect(breachOf(running(30, { state: StepState.Done, done_at: minutesAgo(27) }), BUDGETS, NOW)).toBeNull();
  });

  it("shows the context breach before the time breach on a finished step, then tokens before time", () => {
    const slow = { ...costed(1, 1, 0).cost!, duration_seconds: 15 * 60, peak_context: 300_000 };
    const step = running(30, { state: StepState.Done, cost: slow });
    expect(breachOf(step, BUDGETS, NOW)).toMatchObject({ kind: "context", used: 300_000, budget: 150_000 });
    const lean = { ...slow, peak_context: 1 };
    expect(breachOf(running(30, { state: StepState.Done, cost: lean }), BUDGETS, NOW)).toMatchObject({ kind: "time", used: 15 });
  });

  it("trusts no stamped time: no fallback duration, and a cost row with a stamped time drives no breach", () => {
    const stamped = running(30, { state: StepState.Done, done_at: minutesAgo(10), done_source: TimeSource.Stamped });
    expect(breachOf(stamped, BUDGETS, NOW)).toBeNull();
    const untrusted = { ...costed(1, 1, 0).cost!, duration_seconds: 40 * 60, peak_context: 300_000, started_source: TimeSource.Stamped };
    expect(breachOf(running(30, { state: StepState.Done, done_at: minutesAgo(10), done_source: TimeSource.Stamped, cost: untrusted }), BUDGETS, NOW)).toBeNull();
  });

  it("keeps a cost breach once the step has finished, and flags nothing for a step with no cost", () => {
    expect(breachOf(costed(300_000, 1, 0), BUDGETS, NOW)?.kind).toBe("context");
    expect(breachOf(storedStep("Plain", StepState.Done), BUDGETS, NOW)).toBeNull();
  });

  it("sets the breach on a copy of the tree and leaves the stored steps alone", () => {
    const stored = [storedStep("Parent", StepState.Active, { children: [running(9)] })];
    const shown = withBreaches(stored, BUDGETS, NOW, true)!;
    expect(shown[0]!.children[0]!.breach).toMatchObject({ kind: "time" });
    expect("breach" in shown[0]!).toBe(false);
    expect("breach" in stored[0]!.children[0]!).toBe(false);
    expect(withBreaches(null, BUDGETS, NOW, true)).toBeNull();
  });
});

describe("the breach text (Slice 56)", () => {
  const text = (step: Step) => breachText({ ...step, breach: breachOf(step, BUDGETS, NOW) }, t);

  it("words a time, tokens and context breach, and adds the missing compaction", () => {
    expect(text(running(9))).toBe("over budget: 9 min of 6");
    expect(text(costed(180_000, 10, 0, { process: undefined }))).toBe("over budget: 180 k context of 150 k · no compaction");
    expect(text(costed(180_000, 10, 1, { process: undefined }))).toBe("over budget: 180 k context of 150 k");
    expect(text(costed(100_000, 2_000_000, 0))).toBe("over budget: 2 M tokens of 1 M");
    expect(text(running(3))).toBeNull();
  });

  it("finds the first step with a breach, parents before children", () => {
    const over = { ...running(9), breach: breachOf(running(9), BUDGETS, NOW) };
    expect(firstBreach([storedStep("a", StepState.Done), storedStep("b", StepState.Active, { children: [over] })])?.id).toBe("Run tests");
    expect(firstBreach([storedStep("a", StepState.Done)])).toBeNull();
  });

  it("prefers a running step's breach over a finished step's earlier in the tree", () => {
    const done = { ...costed(300_000, 1, 0), breach: breachOf(costed(300_000, 1, 0), BUDGETS, NOW) };
    const over = { ...running(9), breach: breachOf(running(9), BUDGETS, NOW) };
    expect(firstBreach([done, over])?.id).toBe("Run tests");
    expect(firstBreach([done])?.id).toBe("Write");
  });
});

describe("the budgets config (Slice 56)", () => {
  it("defaults to a 150k peak context and no process budgets", () => {
    expect(parseConfig(undefined).budgets).toEqual({ defaultPeakContext: DEFAULT_PEAK_CONTEXT_BUDGET, processes: {} });
    expect(DEFAULT_PEAK_CONTEXT_BUDGET).toBe(150_000);
  });

  it("reads valid budgets and skips a bad entry or a bad default, logging each", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = parseConfig(
      JSON.stringify({
        budgets: {
          defaultPeakContext: "big",
          processes: { "build/run-tests": { minutes: 6 }, "Bad Key": { minutes: 1 }, "docs/write": { tokens: -5 }, "x/y": { minutes: 2, colour: "red" }, "a/b": "no" },
        },
      }),
    );
    expect(config.budgets).toEqual({ defaultPeakContext: 150_000, processes: { "build/run-tests": { minutes: 6 }, "x/y": { minutes: 2 } } });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("drops only a bad field of an entry, keeps its valid fields and names the bad value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = parseConfig(JSON.stringify({ budgets: { processes: { "build/run-tests": { minutes: 6, peakContxt: 200_000, tokens: 0 } } } }));
    expect(config.budgets.processes).toEqual({ "build/run-tests": { minutes: 6 } });
    const logged = error.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("peakContxt");
    expect(logged).toContain("got 0");
    expect(logged).not.toContain("NaN");
    error.mockRestore();
  });

  it("reads all three limits and a default of its own", () => {
    const raw = parseConfig(JSON.stringify({ budgets: { defaultPeakContext: 120_000, processes: { "build/run-tests": { minutes: 6, tokens: 5, peakContext: 7 } } } }));
    expect(raw.budgets).toEqual({ defaultPeakContext: 120_000, processes: { "build/run-tests": { minutes: 6, tokens: 5, peakContext: 7 } } });
  });
});

describe("the board response (Slice 56)", () => {
  const TASK = "demo-app/task-budget";
  const config = parseConfig(JSON.stringify({ budgets: { processes: { "build/run-tests": { minutes: 1 } } } }));

  beforeEach(resetBoard);

  async function itemOf(clockNow: Date): Promise<BoardItemDto> {
    const response = await boardResponse(new D1ItemRepository(env.DB), config, { now: () => clockNow });
    const found = ((await response.json()) as BoardResponse).items.find((item) => item.key === TASK);
    if (!found) throw new Error("no task on the board");
    return found;
  }

  it("shows no time breach on a running step of a card whose heartbeat expired", async () => {
    const started = new Date();
    await callTool("report_progress", {
      key: TASK, project: "demo-app", type: "unplanned", title: "Budget demo", status: "in_progress",
      steps: [{ id: "tests", label: "Run tests", state: "active", process: "build/run-tests", started_at: started.toISOString() }],
    });
    const twoDays = await itemOf(new Date(started.getTime() + 2 * 24 * 60 * 60_000));
    expect(twoDays.steps![0]!.breach).toBeUndefined();
  });

  it("flags a running step with a 1 minute budget once it has run 2 minutes, never storing it", async () => {
    const started = new Date();
    await callTool("report_progress", {
      key: TASK, project: "demo-app", type: "unplanned", title: "Budget demo", status: "in_progress",
      steps: [{ id: "tests", label: "Run tests", state: "active", process: "build/run-tests", started_at: started.toISOString() }],
    });
    expect((await itemOf(new Date(started.getTime() + 30_000))).steps![0]!.breach).toBeUndefined();
    const late = await itemOf(new Date(started.getTime() + 2 * 60_000));
    expect(late.steps![0]!.breach).toEqual({ kind: "time", used: 2, budget: 1, compacted: false });
    const stored = await env.DB.prepare("SELECT steps FROM items WHERE key = ?").bind(TASK).first<{ steps: string }>();
    expect(stored!.steps).not.toContain("breach");
  });
});
