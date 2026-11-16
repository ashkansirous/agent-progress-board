import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { parseConfig } from "../src/config";
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
    expect(item.progress).toEqual({ done: 1, total: 7, percent: 14, current: "Review 1" });
    expect(item.steps?.[1]).toEqual({ label: "Review 1", state: "active", note: "Two helper agents count under this step" });
    expect(item).toMatchObject({ agent: "Implementer", model: "model-mid", working: true });
  });

  it("lets the newest list win: six steps with two done reads back as 33%", async () => {
    await callTool("report_progress", { ...TASK, steps: SEVEN });
    await callTool("report_progress", { key: TASK.key, steps: SIX_TWO_DONE });
    const item = await itemOf(TASK.key);
    expect(item.progress).toEqual({ done: 2, total: 6, percent: 33, current: "Fixing" });
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

  it("refuses two active steps, a long label and a long note, and writes nothing", async () => {
    const twoActive = [step("A", "active"), step("B", "active")];
    const longLabel = [step("x".repeat(81), "done")];
    const longNote = [step("A", "done", "n".repeat(121))];
    for (const steps of [twoActive, longLabel, longNote]) {
      const reply = await callTool("report_progress", { ...TASK, steps });
      expect(reply.isError).toBe(true);
    }
    expect((await callTool("report_progress", { ...TASK, steps: twoActive })).text).toContain("steps");
    expect(await countRows("items")).toBe(0);
  });

  it("refuses more than 30 steps", async () => {
    const many = Array.from({ length: 31 }, (_, i) => step(`Step ${i}`, "pending"));
    expect((await callTool("report_progress", { ...TASK, steps: many })).isError).toBe(true);
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
    expect((await itemOf(TASK.key)).steps?.[0]).toEqual({ label: "A", state: "active", note: null });
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
