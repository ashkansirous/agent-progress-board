import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { callFor, SEED_ITEMS, seedCalls } from "../scripts/seed-data";
import { callTool, countRows, resetBoard } from "./helpers";

beforeEach(resetBoard);

describe("seed data", () => {
  it("has 14 made-up items in three projects covering every type and status", () => {
    expect(SEED_ITEMS).toHaveLength(14);
    expect(new Set(SEED_ITEMS.map((i) => i.project))).toEqual(new Set(["recipe-box", "garden-planner", "home-lab"]));
    expect(new Set(SEED_ITEMS.map((i) => i.type))).toEqual(new Set(Object.values(ItemType)));
    expect(new Set(SEED_ITEMS.map((i) => i.status))).toEqual(new Set(Object.values(ItemStatus)));
    expect(new Set(SEED_ITEMS.map((i) => i.priority))).toEqual(new Set(Object.values(Priority)));
    expect(SEED_ITEMS.filter((i) => i.status === ItemStatus.Done)).toHaveLength(3);
  });

  it("uses unique keys and only http(s) links", () => {
    expect(new Set(SEED_ITEMS.map((i) => i.key)).size).toBe(SEED_ITEMS.length);
    for (const link of SEED_ITEMS.flatMap((i) => i.links)) expect(link.url).toMatch(/^https:\/\//);
  });

  it("asks a human for waiting items and reports the rest", () => {
    const names = seedCalls().map((c) => c.name);
    expect(names.filter((n) => n === "ask_human")).toHaveLength(3);
    expect(names.filter((n) => n === "report_progress")).toHaveLength(11);
    const waiting = SEED_ITEMS.find((i) => i.type === ItemType.WaitingForMe)!;
    expect(callFor(waiting).arguments).not.toHaveProperty("type");
  });

  it("is accepted by the real MCP tools: every call writes its item", async () => {
    for (const call of seedCalls()) {
      const reply = await callTool(call.name, call.arguments);
      expect(reply.isError, `${String(call.arguments.key)}: ${reply.text}`).toBe(false);
    }
    expect(await countRows("items")).toBe(SEED_ITEMS.length);
    const stale = await env.DB.prepare("SELECT status FROM items WHERE key = ?").bind("garden-planner/slice-10").first();
    expect(stale?.status).toBe(ItemStatus.Stale);
  });
});
