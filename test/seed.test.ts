import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardResponse } from "../src/api/boardDto";
import { parseConfig } from "../src/config";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callFor, PLANNING_SEED_ITEMS, SEED_ITEMS, SESSION_SEED_ITEMS, seedCalls } from "../scripts/seed-data";
import { callTool, countRows, resetBoard } from "./helpers";

beforeEach(resetBoard);

describe("seed data", () => {
  it("has 15 made-up items in three projects covering every type and status", () => {
    expect(SEED_ITEMS).toHaveLength(15);
    expect(new Set(SEED_ITEMS.map((i) => i.project))).toEqual(new Set(["recipe-box", "garden-planner", "home-lab"]));
    expect(new Set(SEED_ITEMS.map((i) => i.type))).toEqual(new Set(Object.values(ItemType).filter((type) => type !== ItemType.Check)));
    expect(new Set(SEED_ITEMS.map((i) => i.status))).toEqual(new Set(Object.values(ItemStatus)));
    expect(new Set(SEED_ITEMS.map((i) => i.priority))).toEqual(new Set(Object.values(Priority)));
    expect(SEED_ITEMS.filter((i) => i.status === ItemStatus.Done)).toHaveLength(3);
  });

  it("uses unique keys across every seed list and only http(s) links", () => {
    const all = [...SEED_ITEMS, ...SESSION_SEED_ITEMS, ...PLANNING_SEED_ITEMS];
    expect(new Set(all.map((i) => i.key)).size).toBe(all.length);
    for (const link of all.flatMap((i) => i.links)) expect(link.url).toMatch(/^https:\/\//);
  });

  it("asks a human for waiting items and reports the rest", () => {
    const names = seedCalls(SEED_ITEMS).map((c) => c.name);
    expect(names.filter((n) => n === "ask_human")).toHaveLength(3);
    expect(names.filter((n) => n === "report_progress")).toHaveLength(12);
    const waiting = SEED_ITEMS.find((i) => i.type === ItemType.WaitingForMe)!;
    expect(callFor(waiting).arguments).not.toHaveProperty("type");
  });

  it("is accepted by the real MCP tools: every call writes its item", async () => {
    for (const call of seedCalls()) {
      const reply = await callTool(call.name, call.arguments);
      expect(reply.isError, `${String(call.arguments.key)}: ${reply.text}`).toBe(false);
    }
    expect(await countRows("items")).toBe(SEED_ITEMS.length + SESSION_SEED_ITEMS.length + PLANNING_SEED_ITEMS.length);
    const stale = await env.DB.prepare("SELECT status FROM items WHERE key = ?").bind("garden-planner/slice-10").first();
    expect(stale?.status).toBe(ItemStatus.Stale);
  });

  it("sends no note that repeats the question marker the server writes itself", () => {
    const notes = seedCalls(SESSION_SEED_ITEMS).map((call) => call.arguments.note);
    expect(notes.filter((note) => typeof note === "string" && note.startsWith("needs_you:"))).toEqual([]);
  });

  it("puts the session cards' questions on the question fields, one card per session", async () => {
    for (const call of seedCalls(SESSION_SEED_ITEMS)) await callTool(call.name, call.arguments);
    const asked = await env.DB.prepare("SELECT key, needs_you, after_answer, type FROM items WHERE needs_you IS NOT NULL ORDER BY key")
      .all<{ key: string; type: string }>();
    expect(asked.results.map((row) => row.key)).toEqual(["example-app/session-4f2a", "tools/session-51e0"]);
    expect(asked.results.every((row) => row.type === ItemType.Unplanned)).toBe(true);
    const sessions = SESSION_SEED_ITEMS.filter((item) => item.agent === "session");
    expect(sessions.length).toBeGreaterThanOrEqual(6);
  });

  it("gives example-app the mock's planning numbers: 3 planned slices, 22 loose checks, 2 problems", async () => {
    for (const call of seedCalls([...SESSION_SEED_ITEMS, ...PLANNING_SEED_ITEMS])) {
      const reply = await callTool(call.name, call.arguments);
      expect(reply.isError, `${String(call.arguments.key)}: ${reply.text}`).toBe(false);
    }
    const response = await boardResponse(new D1ItemRepository(env.DB), parseConfig(undefined), { now: () => new Date() });
    const group = ((await response.json()) as BoardResponse).groups.find((g) => g.id === "example-app")!;
    expect(group.planned.map((s) => [s.number, s.state, s.checks.length])).toEqual([[12, "in_progress", 3], [13, "planned", 5], [11, "parked", 0]]);
    expect(group.loose_checks).toHaveLength(22);
    expect(group.problems.map((p) => [p.kind, p.slice?.number ?? null])).toEqual([["bug", 12], ["problem", null]]);
    expect(group.summary.checks_not_tried).toBe(30);
  });
});
