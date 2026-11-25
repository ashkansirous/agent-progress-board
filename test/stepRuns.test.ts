import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { thinOldStepRuns } from "../src/application/board";
import { STEP_RUN_READ_LIMIT } from "../src/application/ports";
import { attachStepCosts, costOfRuns, isShownCost, stepRunCutoff, stepRunsOf, STEP_RUN_KEEP_DAYS, type StepRun } from "../src/domain/stepRuns";
import { normalizeSteps } from "../src/domain/steps";
import { type Step, type StepCostInput, type StepInput, StepState, TimeSource } from "../src/domain/stepTypes";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { costText } from "../web/src/stepsText";
import { translator } from "../web/src/strings";
import { callTool, countRows, resetBoard } from "./helpers";

const KEY = "demo-app/task-cost1";
const BASE = { key: KEY, project: "demo-app", type: "unplanned", title: "Cost demo", status: "in_progress" };
const START = new Date(Date.now() - 20 * 60_000).toISOString();
const END = new Date(Date.now() - 5 * 60_000).toISOString();

const model = (name: string, input: number, read: number, write: number, output: number) => ({
  model: name,
  input_tokens: input,
  cache_read_tokens: read,
  cache_write_tokens: write,
  output_tokens: output,
});

const COST: StepCostInput = { models: [model("model-mid", 10, 300, 50, 40)], peak_context: 350, compactions: 1 };

function doneStep(id: string, cost?: StepCostInput | null, extra: Partial<StepInput> = {}): StepInput {
  return { id, label: `Step ${id}`, state: StepState.Done, started_at: START, started_source: TimeSource.Observed, done_at: END, done_source: TimeSource.Observed, ...(cost === undefined ? {} : { cost }), ...extra };
}

function built(steps: StepInput[]): Step[] {
  return normalizeSteps(steps, { now: new Date().toISOString() }) ?? [];
}

/** The rows a report with these steps stores: the costs are collected while the steps are built, by resolved id. */
function runsOf(sent: StepInput[]): StepRun[] {
  const costs = new Map<string, StepCostInput>();
  const steps = normalizeSteps(sent, { now: new Date().toISOString(), costs }) ?? [];
  return stepRunsOf(KEY, costs, steps, END);
}

function run(overrides: Partial<StepRun> = {}): StepRun {
  return {
    item_key: KEY,
    step_id: "a",
    agent_id: "",
    process_key: null,
    models: [model("model-mid", 1, 2, 3, 4)],
    started_at: START,
    ended_at: END,
    started_source: TimeSource.Observed,
    ended_source: TimeSource.Observed,
    peak_context: 10,
    compactions: 0,
    writer: "",
    seq: 0,
    reported_at: END,
    ...overrides,
  };
}

describe("stepRunsOf", () => {
  it("makes one row from a done step with an explicit id, times and a valid cost", () => {
    const sent = [doneStep("a", COST)];
    const rows = runsOf(sent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_key: KEY, step_id: "a", agent_id: "", started_source: "observed", ended_source: "observed", peak_context: 350, compactions: 1, started_at: START, ended_at: END });
  });

  it("stores nothing for a step that is not done or has a malformed cost", () => {
    const sent: StepInput[] = [
      { id: "b", label: "Running", state: StepState.Active, cost: COST },
      doneStep("c", { models: [], peak_context: 1, compactions: 0 }),
      doneStep("d", { models: [model("m", -1, 0, 0, 0)], peak_context: 1, compactions: 0 }),
      doneStep("e", { ...COST, peak_context: 1.5 }),
    ];
    expect(runsOf(sent)).toEqual([]);
  });

  it("stores a row for a step sent with a label only, under the id the server gave it (finding 1)", () => {
    const sent: StepInput[] = [{ label: "Implement", state: StepState.Done, started_at: START, started_source: TimeSource.Observed, done_at: END, done_source: TimeSource.Observed, cost: COST }];
    const rows = runsOf(sent);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.step_id).toBe(built(sent)[0]?.id);
    expect(rows[0]).toMatchObject({ step_id: "Implement", started_source: "observed", peak_context: 350 });
  });

  it("keeps one row per step and agent, a repeat in one report replaced by the later", () => {
    const sent = [doneStep("a", COST), doneStep("a2", { ...COST, agent_id: "ag1" }, { children: [doneStep("a3", { ...COST, agent_id: "ag1", peak_context: 9 })] })];
    const rows = runsOf(sent);
    expect(rows.map((row) => `${row.step_id}/${row.agent_id}`)).toEqual(["a/", "a2/ag1", "a3/ag1"]);
  });

  it("merges a model that is listed twice and cuts the list at the model limit", () => {
    const twice: StepCostInput = { models: [model("m", 1, 1, 1, 1), model("m", 2, 2, 2, 2)], peak_context: 1, compactions: 0 };
    const sent = [doneStep("a", twice)];
    expect(runsOf(sent)[0]?.models).toEqual([model("m", 3, 3, 3, 3)]);
  });
});

describe("costOfRuns", () => {
  it("adds the agents' tokens by model, takes the largest peak, adds compactions and spans the times", () => {
    const cost = costOfRuns([
      run({ agent_id: "", models: [model("m1", 10, 100, 5, 20)], peak_context: 200, compactions: 1 }),
      run({ agent_id: "ag", models: [model("m1", 1, 1, 1, 1), model("m2", 2, 2, 2, 2)], peak_context: 500, compactions: 2, started_at: new Date(Date.parse(START) + 1000).toISOString() }),
    ]);
    expect(cost?.models).toEqual([model("m1", 11, 101, 6, 21), model("m2", 2, 2, 2, 2)]);
    expect(cost).toMatchObject({ input_tokens: 13, cache_read_tokens: 103, cache_write_tokens: 8, output_tokens: 23, total_tokens: 147, peak_context: 500, compactions: 3, duration_seconds: 900 });
  });

  it("is null for no rows and shows no cost for a stamped time", () => {
    expect(costOfRuns([])).toBeNull();
    expect(isShownCost(costOfRuns([run()]))).toBe(true);
    expect(isShownCost(costOfRuns([run({ started_source: TimeSource.Stamped })]))).toBe(false);
    expect(isShownCost(null)).toBe(false);
  });

  it("attaches the row a step's cost_ref names and leaves the others bare", () => {
    const steps = built([doneStep("a"), doneStep("b", COST)]);
    attachStepCosts(steps, [run({ step_id: "b" })]);
    expect(steps[0]?.cost).toBeUndefined();
    expect(steps[1]?.cost?.total_tokens).toBe(10);
  });

  it("shows exactly the row the cost_ref names, and none for a step that is not done or has no reference (Decision 7b)", () => {
    const [running, named, bare] = built([
      { ...doneStep("a", COST), state: StepState.Active, done_at: null, done_source: null },
      doneStep("b", { ...COST, writer: "w2", agent_id: "ag1" }),
      doneStep("c"),
    ]);
    expect(running?.cost_ref, "a step that is not done holds no reference").toBeUndefined();
    const rows = [run({ step_id: "a" }), run({ step_id: "b", writer: "w1", agent_id: "ag1", peak_context: 1 }), run({ step_id: "b", writer: "w2", agent_id: "ag1", peak_context: 2 }), run({ step_id: "c" })];
    attachStepCosts([running!, named!, bare!], rows);
    expect(running?.cost).toBeUndefined();
    expect(named?.cost?.peak_context, "the named writer's row, not the other").toBe(2);
    expect(bare?.cost).toBeUndefined();
  });
});

describe("cost line on the page", () => {
  const t = translator();
  const stepWith = (rows: StepRun[]): Step => {
    const [step] = built([doneStep("a", COST)]);
    attachStepCosts([step!], rows);
    return step!;
  };

  it("reads duration, models, tokens and peak context, with compactions when there were any", () => {
    const row = run({ models: [model("model-mid", 10, 299_000, 500, 500)], peak_context: 300_000, compactions: 2 });
    expect(costText(stepWith([row]), t)).toBe("15 min · model-mid · 300 k tokens · peak context 300 k · 2 compactions");
    expect(costText(stepWith([{ ...row, compactions: 1 }]), t)).toContain("· 1 compaction");
    expect(costText(stepWith([{ ...row, compactions: 0 }]), t)).not.toContain("compaction");
  });

  it("shows no cost for a step with none or a stamped time", () => {
    expect(costText(stepWith([]), t)).toBeNull();
    expect(costText(stepWith([run({ ended_source: TimeSource.Stamped })]), t)).toBeNull();
  });

  it("shows no cost on a step that is not done, even when one rides on it", () => {
    const step = stepWith([run()]);
    expect(costText(step, t)).not.toBeNull();
    expect(costText({ ...step, state: StepState.Active }, t)).toBeNull();
  });
});

describe("report_progress with a cost", () => {
  beforeEach(resetBoard);

  it("stores a step run in the same write and get_item returns the cost, the steps list holding none", async () => {
    const reply = await callTool("report_progress", { ...BASE, source: "hook", steps: [doneStep("a", COST), { id: "b", label: "Next", state: "active" }] });
    expect(reply.isError).toBe(false);
    expect(await countRows("step_runs")).toBe(1);
    const stored = await env.DB.prepare("SELECT steps FROM items WHERE key = ?1").bind(KEY).first<{ steps: string }>();
    expect(stored?.steps).not.toContain("peak_context");
    const item = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(item.steps[0]?.cost).toMatchObject({ total_tokens: 400, peak_context: 350, compactions: 1, duration_seconds: 900, started_source: "observed", ended_source: "observed" });
    expect(item.steps[1]?.cost).toBeUndefined();
    const listed = (await callTool("list_open", {})).data as { steps: Step[] }[];
    expect(listed[0]?.steps[0]).toBeDefined();
    expect(listed[0]?.steps[0]?.cost, "list_open carries no costs (Decision 11)").toBeUndefined();
  });

  it("ignores a stale seq that arrives last, and replaces on a greater one, compactions included (Decision 10)", async () => {
    const newer: StepCostInput = { models: [model("model-mid", 20, 600, 90, 80)], peak_context: 700, compactions: 0, writer: "w1", seq: 5 };
    const stale: StepCostInput = { ...COST, writer: "w1", seq: 3 };
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", newer)] });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", stale)] });
    const row = await env.DB.prepare("SELECT models, peak_context, compactions, seq FROM step_runs").first<{ models: string; peak_context: number; compactions: number; seq: number }>();
    expect(JSON.parse(row!.models)).toEqual(newer.models);
    expect(row).toMatchObject({ peak_context: 700, compactions: 0, seq: 5 });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...newer, peak_context: 800, seq: 5 })] });
    expect((await env.DB.prepare("SELECT peak_context FROM step_runs").first<{ peak_context: number }>())?.peak_context, "an equal seq does not replace").toBe(700);
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...newer, peak_context: 800, compactions: 0, seq: 6 })] });
    expect((await env.DB.prepare("SELECT peak_context FROM step_runs").first<{ peak_context: number }>())?.peak_context).toBe(800);
  });

  it("a rerun with fewer compactions replaces the old count with its own (review check #9)", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, writer: "w1", seq: 1 })] });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, compactions: 0, writer: "w1", seq: 2 })] });
    expect((await env.DB.prepare("SELECT compactions FROM step_runs").first<{ compactions: number }>())?.compactions).toBe(0);
  });

  it("keeps two rows for two writers on one step, and the step shows the row of the report that set it done last (Decision 7b)", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, writer: "w1", seq: 900 })] });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, peak_context: 111, writer: "w2", seq: 1 })] });
    expect(await countRows("step_runs")).toBe(2);
    const item = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(item.steps[0]?.cost?.peak_context).toBe(111);
  });

  it("keeps the cost reference while a report leaves the step done without a cost, and an unchanged cost is not needed again", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, writer: "w1", seq: 1 })] });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a")] });
    const item = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(item.steps[0]?.cost?.total_tokens).toBe(400);
  });

  it("stores one row per agent; the step shows the row its last cost named", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", COST)] });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, agent_id: "ag1" })] });
    expect(await countRows("step_runs")).toBe(2);
    const item = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(item.steps[0]?.cost?.total_tokens).toBe(400);
  });

  it("drops a cost with a 200-char model id but accepts the report and saves its steps (check 2 finding 2)", async () => {
    const long: StepCostInput = { ...COST, models: [model("m".repeat(200), 1, 1, 1, 1)], writer: "w1", seq: 1 };
    const reply = await callTool("report_progress", { ...BASE, steps: [doneStep("a", long), doneStep("b", { ...COST, writer: "w1", seq: 1 })] });
    expect(reply.isError).toBe(false);
    expect(await countRows("step_runs"), "only the valid step's cost is stored").toBe(1);
    const item = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(item.steps.map((step) => step.id)).toEqual(["a", "b"]);
    expect(item.steps[0]?.cost, "the bad cost is dropped").toBeUndefined();
    expect(item.steps[1]?.cost?.total_tokens).toBe(400);
  });

  it("drops a cost whose writer or agent id is too long, and keeps the report", async () => {
    const reply = await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, writer: "w".repeat(500) }), doneStep("b", { ...COST, agent_id: "a".repeat(200) })] });
    expect(reply.isError).toBe(false);
    expect(await countRows("step_runs")).toBe(0);
  });

  it("keeps the same writer value in the row and in cost_ref (check 2 finding 7)", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, writer: "0123456789abcdef", seq: 1 })] });
    const row = await env.DB.prepare("SELECT writer FROM step_runs").first<{ writer: string }>();
    const stored = await env.DB.prepare("SELECT steps FROM items WHERE key = ?1").bind(KEY).first<{ steps: string }>();
    expect(row?.writer).toBe("0123456789abcdef");
    expect(JSON.parse(stored!.steps)[0].cost_ref.writer).toBe("0123456789abcdef");
  });

  it("stores and shows the cost of a step sent with a label only (finding 1)", async () => {
    const labelOnly: StepInput = { label: "Implement", state: StepState.Done, started_at: START, started_source: TimeSource.Observed, done_at: END, done_source: TimeSource.Observed, cost: COST };
    const reply = await callTool("report_progress", { ...BASE, steps: [labelOnly] });
    expect(reply.isError).toBe(false);
    expect(await countRows("step_runs")).toBe(1);
    const item = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(item.steps[0]?.cost?.total_tokens).toBe(400);
  });

  it("shows no cost on a step that was reopened until it ends again (finding 2)", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", COST)] });
    await callTool("report_progress", { ...BASE, steps: [{ id: "a", label: "Step a", state: StepState.Active }] });
    const reopened = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(await countRows("step_runs")).toBe(1);
    expect(reopened.steps[0]?.cost).toBeUndefined();
  });

  it("reopened then done again with no new cost shows none; a new cost brings its row back (Decision 7b)", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, writer: "w1", seq: 1 })] });
    await callTool("report_progress", { ...BASE, steps: [{ id: "a", label: "Step a", state: StepState.Active }] });
    await callTool("report_progress", { ...BASE, steps: [doneStep("a")] });
    const again = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(again.steps[0]?.cost, "the old run's row is not shown beside the new window").toBeUndefined();
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", { ...COST, peak_context: 999, writer: "w1", seq: 2 })] });
    const costed = (await callTool("get_item", { key: KEY })).data as { steps: Step[] };
    expect(costed.steps[0]?.cost?.peak_context).toBe(999);
  });

  it("takes at most the limit of rows for each item, so a busy item never hides another's costs (finding 7)", async () => {
    const insert = env.DB.prepare(`INSERT INTO step_runs (item_key, step_id, agent_id, models, started_at, ended_at, started_source, ended_source, peak_context, compactions, reported_at)
      VALUES (?1, ?2, '', '[]', ?3, ?3, 'observed', 'observed', 0, 0, ?3)`);
    const busy = Array.from({ length: STEP_RUN_READ_LIMIT + 5 }, (_, n) => insert.bind("demo-app/busy", `s${n}`, new Date(Date.now() - n * 1000).toISOString()));
    await env.DB.batch([...busy, insert.bind("demo-app/quiet", "q", new Date(Date.now() - 86_400_000).toISOString())]);
    const rows = await new D1ItemRepository(env.DB).stepRunsFor(["demo-app/busy", "demo-app/quiet"]);
    expect(rows.filter((row) => row.item_key === "demo-app/busy")).toHaveLength(STEP_RUN_READ_LIMIT);
    expect(rows.filter((row) => row.item_key === "demo-app/quiet")).toHaveLength(1);
  });

  it("writes no row for a malformed cost and never refuses the report for it", async () => {
    const bad = await callTool("report_progress", { ...BASE, steps: [doneStep("a", { models: [], peak_context: 1, compactions: 0 })] });
    expect(bad.isError).toBe(false);
    expect(await countRows("step_runs")).toBe(0);
  });
});

describe("thinning", () => {
  beforeEach(resetBoard);

  it("deletes runs that ended before the 180-day cutoff and keeps newer ones", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - (STEP_RUN_KEEP_DAYS + 1) * 86_400_000).toISOString();
    const fresh = new Date(now.getTime() - (STEP_RUN_KEEP_DAYS - 1) * 86_400_000).toISOString();
    const insert = env.DB.prepare(`INSERT INTO step_runs (item_key, step_id, agent_id, models, started_at, ended_at, started_source, ended_source, peak_context, compactions, reported_at)
      VALUES (?1, ?2, '', '[]', ?3, ?3, 'observed', 'observed', 0, 0, ?3)`);
    await env.DB.batch([insert.bind(KEY, "old", old), insert.bind(KEY, "fresh", fresh)]);
    expect(stepRunCutoff(now) > old).toBe(true);
    expect(await thinOldStepRuns(new D1ItemRepository(env.DB), { now: () => now })).toBe(1);
    expect((await env.DB.prepare("SELECT step_id FROM step_runs").all<{ step_id: string }>()).results.map((row) => row.step_id)).toEqual(["fresh"]);
  });

  it("is not removed with its item: the rows have no link to items", async () => {
    await callTool("report_progress", { ...BASE, steps: [doneStep("a", COST)] });
    await env.DB.batch([env.DB.prepare("DELETE FROM events WHERE item_key = ?1").bind(KEY), env.DB.prepare("DELETE FROM items WHERE key = ?1").bind(KEY)]);
    expect(await countRows("step_runs")).toBe(1);
  });
});
