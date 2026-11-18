import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { parseConfig } from "../src/config";
import { reportProgress } from "../src/application/board";
import { StepsChangedError } from "../src/application/ports";
import { normalizeSteps } from "../src/domain/steps";
import { type StepInput, StepState } from "../src/domain/stepTypes";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, resetBoard } from "./helpers";

const NOW = new Date();
const TASK = {
  key: "demo-app/slice-7/part-a",
  project: "demo-app",
  type: "slice",
  title: "Part A · Sample",
  status: "in_progress",
  parent: "Slice 7",
};

const step = (label: string, state: string, note?: string) => ({ label, state, ...(note ? { note } : {}) });

const SEVEN = [
  step("Implementation", "done"),
  step("Review 1", "active", "Two helper agents count under this step"),
  step("Fixing", "pending"),
  step("Review 2", "pending"),
  step("Phone test", "pending"),
  step("Tablet test", "pending"),
  step("Merging", "pending"),
];

const SIX_TWO_DONE = [
  step("Implementation", "done"),
  step("Review 1", "done"),
  step("Fixing", "active"),
  step("Review 2", "pending"),
  step("Phone test", "pending"),
  step("Merging", "pending"),
];

async function board(rawConfig?: string, now: Date = NOW): Promise<BoardResponse> {
  const response = await boardResponse(new D1ItemRepository(env.DB), parseConfig(rawConfig), { now: () => now });
  return (await response.json()) as BoardResponse;
}

async function itemOf(key: string, rawConfig?: string): Promise<BoardItemDto> {
  const found = (await board(rawConfig)).items.find((item) => item.key === key);
  if (!found) throw new Error(`no item ${key} on the board`);
  return found;
}

beforeEach(resetBoard);

describe("report_progress steps", () => {
  it("reads seven steps with one done and one active back as 14% with the active label", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN, agent: "Implementer", model: "model-mid" });
    const item = await itemOf(TASK.key);
    expect(item.progress).toEqual({ done: 1, total: 7, percent: 14, running: 1, current: "Review 1" });
    expect(item.steps?.[1]).toMatchObject({ id: "Review 1", label: "Review 1", state: "active", note: "Two helper agents count under this step", children: [] });
    expect(item.steps?.[1]?.started_at).toEqual(expect.any(String));
    expect(item).toMatchObject({ agent: "Implementer", model: "model-mid", working: true });
  });

  it("lets the newest list win: six steps with two done reads back as 33%", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    await callTool("report_progress", { key: TASK.key, steps: SIX_TWO_DONE });
    const item = await itemOf(TASK.key);
    expect(item.progress).toEqual({ done: 2, total: 6, percent: 33, running: 1, current: "Fixing" });
    expect(item.steps).toHaveLength(6);
  });

  it("keeps the list when a report leaves it out, and clears it with null", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN, agent: "Implementer" });
    await callTool("report_progress", { key: TASK.key, why: "A heartbeat" });
    expect((await itemOf(TASK.key)).steps).toHaveLength(7);
    await callTool("report_progress", { key: TASK.key, steps: null, agent: null });
    expect(await itemOf(TASK.key)).toMatchObject({ steps: null, progress: null, agent: null, working: false });
  });

  it("counts a report that changes the steps as a change, and one that resends the same list as a heartbeat", async () => {
    const detail = async () =>
      (await callTool("get_item", { key: TASK.key })).data as { updated_at: string; events: { note: string | null }[] };
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    const created = (await detail()).updated_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await callTool("report_progress", { key: TASK.key, steps: SEVEN });
    expect((await detail()).events[0]?.note).toBe("Heartbeat");
    expect((await detail()).updated_at).toBe(created);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await callTool("report_progress", { key: TASK.key, steps: SIX_TWO_DONE });
    expect((await detail()).events[0]?.note).not.toBe("Heartbeat");
    expect((await detail()).updated_at).not.toBe(created);
  });

  it("refuses a long label and a long note, and writes nothing", async () => {
    const longLabel = [step("x".repeat(81), "done")];
    const longNote = [step("A", "done", "n".repeat(121))];
    for (const steps of [longLabel, longNote]) {
      const reply = await callTool("report_progress", { ...TASK, steps });
      expect(reply.isError).toBe(true);
    }
    expect((await callTool("report_progress", { ...TASK, steps: longNote })).text).toContain("steps");
    expect(await countRows("items")).toBe(0);
  });

  it("refuses more than 200 steps in all, and a tree deeper than 4 levels", async () => {
    const many = Array.from({ length: 201 }, (_, i) => step(`Step ${i}`, "pending"));
    expect((await callTool("report_progress", { ...TASK, steps: many })).isError).toBe(true);
    const deep = { ...step("L1", "active"), children: [{ ...step("L2", "active"), children: [{ ...step("L3", "active"), children: [{ ...step("L4", "active"), children: [step("L5", "active")] }] }] }] };
    const refused = await callTool("report_progress", { ...TASK, steps: [deep] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/at most 4 levels/);
    expect(await countRows("items")).toBe(0);
  });

  it("returns steps, agent, model and environment from get_item and list_open", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN, agent: "Fixer", model: "model-small", environment: "laptop" });
    const got = (await callTool("get_item", { key: TASK.key })).data as Record<string, unknown>;
    expect(got).toMatchObject({ agent: "Fixer", model: "model-small", environment: "laptop" });
    expect(got.steps).toHaveLength(7);
    const [listed] = (await callTool("list_open", {})).data as Record<string, unknown>[];
    expect(listed).toMatchObject({ agent: "Fixer", model: "model-small", environment: "laptop" });
    expect(listed?.steps).toHaveLength(7);
    expect(Object.keys(listed ?? {})).not.toContain("expiry");
  });
});

describe("GET /api/board active work", () => {
  it("carries the environment and its label from the config, the report time and the working count", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN, environment: "cloud-vm" });
    await callTool("report_progress", { ...TASK, key: "demo-app/other", title: "Other", environment: "custom-box" });
    const data = await board(JSON.stringify({ usage: { environmentLabels: { "cloud-vm": "Cloud VM" } } }));
    const task = data.items.find((i) => i.key === TASK.key)!;
    expect(task).toMatchObject({ environment: "cloud-vm", environment_label: "Cloud VM" });
    expect(Date.parse(task.heartbeat_at)).not.toBeNaN();
    const other = data.items.find((i) => i.key === "demo-app/other")!;
    expect(other).toMatchObject({ environment: "custom-box", environment_label: "custom-box", working: false });
    expect(data.working_count).toBe(1);
  });

  it("shows a done task at 100% and keeps its list", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    await callTool("mark_done", { key: TASK.key });
    const item = await itemOf(TASK.key);
    expect(item.progress).toMatchObject({ done: 7, total: 7, percent: 100 });
    expect(item.steps).toHaveLength(7);
    expect(item.working).toBe(false);
  });

  it("drops a task from the working set when its heartbeat has expired, before the cron runs", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    const later = new Date(NOW.getTime() + 121 * 60_000);
    const data = await board(undefined, later);
    expect(data.items[0]).toMatchObject({ status: "in_progress", working: false });
    expect(data.working_count).toBe(0);
  });

  it("does not count an item with no steps and no agent, or one that is only open", async () => {
    await callTool("report_progress", { ...TASK, key: "demo-app/plain" });
    await callTool("report_progress", { ...TASK, key: "demo-app/open", status: "open", steps: SEVEN });
    expect((await board()).working_count).toBe(0);
  });

  it("counts an item with only an agent set as working", async () => {
    await callTool("report_progress", { ...TASK, agent: "Reviewer" });
    const item = await itemOf(TASK.key);
    expect(item).toMatchObject({ working: true, progress: null, steps: null });
  });

  it("stores a whitespace-only agent or model as absent, on create and on update", async () => {
    await callTool("report_progress", { ...TASK, agent: "   ", model: " \t " });
    expect(await itemOf(TASK.key)).toMatchObject({ agent: null, model: null, working: false });
    await callTool("report_progress", { key: TASK.key, agent: "Reviewer", model: "model-mid" });
    await callTool("report_progress", { key: TASK.key, agent: "  ", model: "  " });
    expect(await itemOf(TASK.key)).toMatchObject({ agent: null, model: null });
  });

  it("refuses a whitespace-only step label and stores a whitespace-only note as none", async () => {
    const blank = await callTool("report_progress", { ...TASK, steps: [step("   ", "done")] });
    expect(blank.isError).toBe(true);
    expect(await countRows("items")).toBe(0);
    await callTool("report_progress", { ...TASK, steps: [step("A", "active", "   ")] });
    expect((await itemOf(TASK.key)).steps?.[0]).toMatchObject({ label: "A", state: "active", note: null });
  });

  it("reads an old flat stored list (no ids, times or children) as a tree of depth 1", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    const flat = JSON.stringify([{ label: "A", state: "done", note: null }, { label: "B", state: "active", note: "now" }]);
    await env.DB.prepare("UPDATE items SET steps = ? WHERE key = ?").bind(flat, TASK.key).run();
    const item = await itemOf(TASK.key);
    expect(item.steps).toEqual([
      { id: "A", label: "A", state: "done", note: null, started_at: null, done_at: null, children: [] },
      { id: "B", label: "B", state: "active", note: "now", started_at: null, done_at: null, children: [] },
    ]);
    expect(item.progress).toMatchObject({ done: 1, total: 2, running: 1, current: "B" });
  });

  it("reads a row whose stored steps are not a valid list as no steps, and the board still loads", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    await callTool("report_progress", { ...TASK, key: "demo-app/other", title: "Other" });
    for (const bad of ["{not json", '{"a":1}', '[{"label":5}]', "[]"]) {
      await env.DB.prepare("UPDATE items SET steps = ? WHERE key = ?").bind(bad, TASK.key).run();
      const data = await board();
      expect(data.items).toHaveLength(2);
      expect(data.items.find((i) => i.key === TASK.key)).toMatchObject({ steps: null, progress: null });
    }
  });
});

const RECORD = [
  step("Write", "done"),
  { ...step("Record audio", "active"), children: [step("English", "active"), step("French", "pending")] },
];

describe("report_progress under_step and the tree (Slice 39)", () => {
  it("shows several running leaves: a parent with three running children reads 3 running", async () => {
    const steps = [{ ...step("Record audio", "active"), children: [step("English", "active"), step("French", "active"), step("German", "active")] }];
    await callTool("report_progress", { ...TASK, steps });
    expect((await itemOf(TASK.key)).progress).toMatchObject({ done: 0, total: 3, running: 3, current: null });
  });

  it("replaces only that step's children with under_step and leaves the rest as stored", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    const before = (await itemOf(TASK.key)).steps!;
    const reply = await callTool("report_progress", { key: TASK.key, under_step: "Record audio", steps: [step("Dutch", "active"), step("Polish", "pending")] });
    expect(reply.isError).toBeFalsy();
    const after = (await itemOf(TASK.key)).steps!;
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.children.map((s) => s.id)).toEqual(["Record audio/Dutch", "Record audio/Polish"]);
    expect(after[1]).toMatchObject({ id: "Record audio", started_at: before[1]!.started_at });
  });

  it("keeps the stamps of a child across a report that resends it, and stamps the time a child turns done", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    const first = (await itemOf(TASK.key)).steps![1]!.children[0]!;
    expect(first.started_at).toEqual(expect.any(String));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await callTool("report_progress", { key: TASK.key, under_step: "Record audio", steps: [step("English", "done"), step("French", "pending")] });
    const second = (await itemOf(TASK.key)).steps![1]!.children[0]!;
    expect(second).toMatchObject({ state: "done", started_at: first.started_at });
    expect(second.done_at).toEqual(expect.any(String));
  });

  it("refuses an unknown under_step id with the known ids, and writes nothing", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    const reply = await callTool("report_progress", { key: TASK.key, under_step: "Nope", steps: [step("X", "active")] });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("known ids: Write, Record audio, Record audio/English, Record audio/French");
    expect((await itemOf(TASK.key)).steps).toHaveLength(2);
  });

  it("refuses under_step without steps, and under_step on a task with no list", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    expect((await callTool("report_progress", { key: TASK.key, under_step: "Write" })).isError).toBe(true);
    await callTool("report_progress", { ...TASK, key: "demo-app/bare" });
    const bare = await callTool("report_progress", { key: "demo-app/bare", under_step: "Write", steps: [step("X", "active")] });
    expect(bare.isError).toBe(true);
  });

  it("clears a step's children with an empty list", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    await callTool("report_progress", { key: TASK.key, under_step: "Record audio", steps: [] });
    expect((await itemOf(TASK.key)).steps![1]!.children).toEqual([]);
  });

  it("keeps a parent's children when the whole list is resent without them", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    await callTool("report_progress", { key: TASK.key, steps: [step("Write", "done"), step("Record audio", "active")] });
    expect((await itemOf(TASK.key)).steps![1]!.children).toHaveLength(2);
  });

  it("counts a resent identical tree as a heartbeat", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    await callTool("report_progress", { key: TASK.key, steps: RECORD });
    const detail = (await callTool("get_item", { key: TASK.key })).data as { events: { note: string | null }[] };
    expect(detail.events[0]?.note).toBe("Heartbeat");
  });

  it("keeps generated ids within 80 characters so a stored id can be sent back, and under_step takes it", async () => {
    const long = (c: string) => c.repeat(80);
    const steps = [{ ...step(long("a"), "active"), children: [{ ...step(long("b"), "active"), children: [step(long("c"), "active")] }] }];
    expect((await callTool("report_progress", { ...TASK, steps })).isError).toBeFalsy();
    const stored = (await itemOf(TASK.key)).steps!;
    const ids = [stored[0]!.id, stored[0]!.children[0]!.id, stored[0]!.children[0]!.children[0]!.id];
    expect(ids.every((id) => id.length <= 80)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    const reply = await callTool("report_progress", { key: TASK.key, under_step: ids[1]!, steps: [step("Deep", "done")] });
    expect(reply.isError).toBeFalsy();
    expect((await callTool("report_progress", { key: TASK.key, steps: stored })).isError).toBeFalsy();
  });

  it("finishes the kept children when a flat resend sends the parent done without them", async () => {
    await callTool("report_progress", { ...TASK, steps: RECORD });
    await callTool("report_progress", { key: TASK.key, steps: [step("Write", "done"), step("Record audio", "done")] });
    const item = await itemOf(TASK.key);
    expect(item.steps![1]!.children.map((s) => s.state)).toEqual(["done", "done"]);
    expect(item.progress).toMatchObject({ done: 3, total: 3, running: 0, percent: 100 });
  });

  it("accepts a stored tree echoed back from get_item, four levels deep, and refuses a non-empty fifth level", async () => {
    const four = { ...step("L1", "active"), children: [{ ...step("L2", "active"), children: [{ ...step("L3", "active"), children: [step("L4", "active")] }] }] };
    await callTool("report_progress", { ...TASK, steps: [four] });
    const echoed = (await itemOf(TASK.key)).steps!;
    expect((await callTool("report_progress", { key: TASK.key, steps: echoed })).isError).toBeFalsy();
  });
});

describe("concurrent under_step reports (Slice 39)", () => {
  /** A repository whose first reads wait for each other, so two reports read the same stored tree before either writes. */
  function interleaved(inner: D1ItemRepository, readers: number): D1ItemRepository {
    let waiting = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const repo = Object.create(inner) as D1ItemRepository;
    repo.findWithStepsText = async (key) => {
      const read = await inner.findWithStepsText(key);
      waiting += 1;
      if (waiting >= readers) release();
      if (waiting <= readers) await gate;
      return read;
    };
    return repo;
  }

  it("keeps both helpers' subtrees when two report under different steps from the same read", async () => {
    await callTool("report_progress", { ...TASK, steps: [step("English", "active"), step("French", "active")] });
    const inner = new D1ItemRepository(env.DB);
    const repo = interleaved(inner, 2);
    const clock = { now: () => new Date() };
    const report = (under: string, label: string) =>
      reportProgress(repo, { key: TASK.key, under_step: under, steps: [{ label, state: StepState.Active }] }, clock);
    await Promise.all([report("English", "Record"), report("French", "Mix")]);
    const stored = (await inner.find(TASK.key))!.steps!;
    expect(stored.map((s) => s.children.map((c) => c.label))).toEqual([["Record"], ["Mix"]]);
  });

  it("adds no event for a guarded write that lost the compare-and-swap, even in the winner's millisecond", async () => {
    await callTool("report_progress", { ...TASK, steps: [step("English", "active")] });
    const repo = new D1ItemRepository(env.DB);
    const { item, stepsText } = await repo.findWithStepsText(TASK.key);
    const now = new Date().toISOString();
    const write = (steps: { label: string; state: StepState }[], ifStepsText: string | null) => ({
      insert: item!, input: { key: TASK.key, steps }, now, ifStepsText,
    });
    await repo.save(write([{ label: "Winner", state: StepState.Active }], stepsText));
    const events = await countRows("events");
    await expect(repo.save(write([{ label: "Loser", state: StepState.Active }], stepsText))).rejects.toBeInstanceOf(StepsChangedError);
    expect(await countRows("events")).toBe(events);
  });

  it.each([["whole list first", true], ["whole list second", false]])(
    "a whole-list report never drops a helper's subtree written from the same read (%s)",
    async (_name, wholeFirst) => {
      await callTool("report_progress", { ...TASK, steps: [step("English", "active"), step("French", "active")] });
      const inner = new D1ItemRepository(env.DB);
      const repo = interleaved(inner, 2);
      const clock = { now: () => new Date() };
      const whole = () => reportProgress(repo, { key: TASK.key, steps: [step("English", "done"), step("French", "active")] as never }, clock);
      const helper = () =>
        reportProgress(repo, { key: TASK.key, under_step: "English", steps: [{ label: "Record", state: StepState.Active }] }, clock);
      await Promise.all(wholeFirst ? [whole(), helper()] : [helper(), whole()]);
      const stored = (await inner.find(TASK.key))!.steps!;
      expect(stored[0]!.children.map((c) => c.label)).toEqual(["Record"]);
    },
  );

  it("adds exactly one event for a guarded write that won", async () => {
    await callTool("report_progress", { ...TASK, steps: [step("English", "active")] });
    const repo = new D1ItemRepository(env.DB);
    const { item, stepsText } = await repo.findWithStepsText(TASK.key);
    const events = await countRows("events");
    const input = { key: TASK.key, steps: [{ label: "Winner", state: StepState.Active }] };
    await repo.save({ insert: item!, input, now: new Date().toISOString(), ifStepsText: stepsText });
    expect(await countRows("events")).toBe(events + 1);
  });

  it("refuses a tree over the step limit before building any id", () => {
    const same = Array.from({ length: 20_000 }, () => ({ label: "Same", state: StepState.Pending }));
    const started = Date.now();
    expect(() => normalizeSteps([{ label: "Parent", state: StepState.Active, children: same }])).toThrow(/at most 200 steps/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("refuses a tree over the depth limit before building any id", () => {
    const deep = (n: number): StepInput => ({ label: `L${n}`, state: StepState.Active, children: n > 0 ? [deep(n - 1)] : undefined });
    expect(() => normalizeSteps([deep(5)])).toThrow(/at most 4 levels/);
  });

  it("refuses with a send-again message when the steps keep changing", async () => {
    await callTool("report_progress", { ...TASK, steps: [step("English", "active")] });
    const inner = new D1ItemRepository(env.DB);
    const repo = Object.create(inner) as D1ItemRepository;
    repo.save = async () => {
      throw new StepsChangedError();
    };
    const attempt = reportProgress(repo, { key: TASK.key, under_step: "English", steps: [{ label: "X", state: StepState.Active }] }, { now: () => new Date() });
    await expect(attempt).rejects.toThrow(/temporary.*send the same report again/);
    await expect(attempt).rejects.toMatchObject({ retryable: true });
  });
});
