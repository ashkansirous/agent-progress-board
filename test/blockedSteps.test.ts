import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { parseConfig } from "../src/config";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, resetBoard } from "./helpers";

const PROJECT = "demo-app";
const SLICE = `${PROJECT}/slice-7`;
const CHECK = `${SLICE}/check-a`;
const TASK = `${PROJECT}/task-x`;

async function board(): Promise<BoardResponse> {
  const response = await boardResponse(new D1ItemRepository(env.DB), parseConfig(undefined), { now: () => new Date() });
  return (await response.json()) as BoardResponse;
}

async function itemOf(key: string): Promise<BoardItemDto> {
  const found = (await board()).items.find((item) => item.key === key);
  if (!found) throw new Error(`no item ${key} on the board`);
  return found;
}

const sliceItem = (status: string, checks: { key: string; title: string }[] = []) => ({
  key: SLICE,
  project: PROJECT,
  type: "slice",
  title: "Slice 7 · Sample",
  status,
  checks,
});

const sync = (items: unknown[]) => callTool("sync_snapshot", { project: PROJECT, items });
const elevenDone = Array.from({ length: 11 }, (_, i) => ({ label: `Step ${i + 1}`, state: "done" }));

beforeEach(resetBoard);

describe("a slice card with an open check (Slice 51 C, D)", () => {
  it("reads 11 of 12 and never 100%, and groups as Built, when its 11 steps are done and a check is open", async () => {
    await sync([sliceItem("done", [{ key: CHECK, title: "Try it on a phone" }])]);
    await callTool("report_progress", { key: SLICE, steps: elevenDone });
    const item = await itemOf(SLICE);
    expect(item.progress).toMatchObject({ done: 11, total: 12, percent: 92, open_checks: 1 });
    expect(item.checks?.map((check) => [check.title, check.status])).toEqual([["Try it on a phone", "open"]]);
    const group = (await board()).groups.find((one) => one.id === PROJECT)!;
    expect(group.built.map((slice) => slice.key)).toEqual([SLICE]);
  });

  it("keeps a done slice with an open check done when the docs say in progress, and shows no reopen reason", async () => {
    await sync([sliceItem("done", [{ key: CHECK, title: "Try it on a phone" }])]);
    await sync([sliceItem("in_progress", [{ key: CHECK, title: "Try it on a phone" }])]);
    const item = await itemOf(SLICE);
    expect(item.status).toBe("done");
    expect(item.reopened).toBeNull();
  });

  it("writes the reason when the docs reopen a done slice, and the card carries it", async () => {
    await sync([sliceItem("done")]);
    await sync([sliceItem("in_progress")]);
    const item = await itemOf(SLICE);
    expect(item.status).toBe("in_progress");
    expect(item.reopened).toMatchObject({ status: "in_progress" });
    expect(item.events[0]!.note).toBe("Docs reopened it: the plan now says in_progress");
  });

  it("keeps the reopen reason after the agent resumes and heartbeats", async () => {
    await sync([sliceItem("done")]);
    await sync([sliceItem("in_progress")]);
    await callTool("report_progress", { key: SLICE, status: "in_progress" });
    await callTool("report_progress", { key: SLICE, status: "in_progress" });
    expect((await itemOf(SLICE)).reopened).toMatchObject({ status: "in_progress" });
  });

  it("reads 11 of 12 and groups as Built with one blocked check, listed and counted", async () => {
    await sync([sliceItem("done", [{ key: CHECK, title: "Try it on a phone" }])]);
    await callTool("report_progress", { key: CHECK, status: "blocked" });
    await callTool("report_progress", { key: SLICE, steps: elevenDone });
    const item = await itemOf(SLICE);
    expect(item.progress).toMatchObject({ done: 11, total: 12, open_checks: 1 });
    expect(item.checks?.map((check) => check.status)).toEqual(["blocked"]);
    expect((await board()).groups.find((one) => one.id === PROJECT)!.built.map((slice) => slice.key)).toEqual([SLICE]);
  });

  it("reopens a done slice once the check it lists was done, and not while the check is still to do", async () => {
    const listed = [{ key: CHECK, title: "Try it on a phone" }];
    await sync([sliceItem("done", listed)]);
    await callTool("report_progress", { key: CHECK, status: "done" });
    await sync([sliceItem("in_progress", listed)]);
    expect((await itemOf(SLICE)).status).toBe("in_progress");
  });
});

describe("blocked steps and reported times through report_progress (Slice 51 A, B)", () => {
  const base = { key: TASK, project: PROJECT, type: "unplanned", title: "Task", status: "in_progress", agent: "session" };

  it("takes a blocked step with its note, target and link, and lists a card blocked on the owner under Needs you", async () => {
    const reply = await callTool("report_progress", {
      ...base,
      steps: [
        { label: "Write", state: "done" },
        { label: "Approve", state: "blocked", waits_on: "owner", note: "needs your OK on the design", link: "https://example.com/pr/9" },
      ],
    });
    expect(reply.isError).toBeFalsy();
    const item = await itemOf(TASK);
    expect(item.steps?.[1]).toMatchObject({ state: "blocked", waits_on: "owner", link: "https://example.com/pr/9" });
    expect(item.blocked_on_owner).toBe(true);
    expect(item.progress).toMatchObject({ blocked: 1, running: 0 });
    const group = (await board()).groups.find((one) => one.id === PROJECT)!;
    expect(group.needs_you).toEqual([TASK]);
    expect(item.needs_you_at).toBe(item.steps?.[1]?.started_at);
    expect(item.needs_you_at).not.toBeNull();
  });

  it("refuses a blocked step with no note, naming the step", async () => {
    const reply = await callTool("report_progress", { ...base, steps: [{ label: "Approve", state: "blocked" }] });
    expect(reply.isError).toBe(true);
    expect(JSON.stringify(reply)).toContain("must say what it waits on");
  });

  it("keeps the times a late report sends, and an observed end through a later batched report", async () => {
    const start = new Date(Date.now() - 60 * 60_000).toISOString();
    const seen = new Date(Date.now() - 50 * 60_000).toISOString();
    const late = new Date(Date.now() - 5 * 60_000).toISOString();
    await callTool("report_progress", { ...base, steps: [{ id: "r", label: "Review", state: "done", started_at: start, done_at: seen, done_source: "observed" }] });
    await callTool("report_progress", { ...base, steps: [{ id: "r", label: "Review", state: "done", done_at: late }] });
    const step = (await itemOf(TASK)).steps![0]!;
    expect([step.started_at, step.done_at, step.started_source, step.done_source]).toEqual([start, seen, "reported", "observed"]);
  });

  it("drops a time in the future and stamps that end, keeping the rest of the report", async () => {
    const reply = await callTool("report_progress", { ...base, steps: [{ id: "a", label: "A", state: "done", done_at: new Date(Date.now() + 3_600_000).toISOString() }, { id: "b", label: "B", state: "active" }] });
    expect(reply.isError).toBeFalsy();
    const steps = (await itemOf(TASK)).steps!;
    expect(steps.map((step) => step.id)).toEqual(["a", "b"]);
    expect(steps[0]!.done_source).toBe("stamped");
  });
});

describe("the two reports of bug-steps-kept, replayed (Slice 51 G)", () => {
  const base = { key: TASK, project: PROJECT, type: "unplanned", title: "Task", status: "in_progress", agent: "session" };

  it("keeps the three children and the done steps' times when a later report sends refine without children", async () => {
    const t0 = new Date(Date.now() - 40 * 60_000).toISOString();
    const t1 = new Date(Date.now() - 30 * 60_000).toISOString();
    await callTool("report_progress", {
      ...base,
      steps: [
        { id: "scope", label: "Scope", state: "done", started_at: t0, done_at: t1 },
        { id: "refine", label: "Refine", state: "active", children: [{ id: "g-tools", label: "Tools", state: "done" }, { id: "g-hooks", label: "Hooks", state: "active" }, { id: "q", label: "Questions", state: "pending" }] },
      ],
    });
    await callTool("report_progress", { ...base, steps: [{ id: "scope", label: "Scope", state: "done" }, { id: "refine", label: "Refine", state: "active" }] });
    const steps = (await itemOf(TASK)).steps!;
    expect(steps[1]!.children.map((child) => child.id)).toEqual(["g-tools", "g-hooks", "q"]);
    expect([steps[0]!.started_at, steps[0]!.done_at]).toEqual([t0, t1]);
  });
});
