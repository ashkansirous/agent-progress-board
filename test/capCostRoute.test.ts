import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_JWT_HEADER, type AccessKeys } from "../src/api/access";
import { route, type RouterEnv } from "../src/api/router";
import type { UsageResponse } from "../src/api/usageDto";
import { reportProgress } from "../src/application/board";
import { reportCap, reportUsage } from "../src/application/usage";
import { ItemStatus, ItemType } from "../src/domain/item";
import { MultiplierState } from "../src/domain/capCost";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { resetBoard } from "./helpers";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const KEY_ID = "test-key";
const NOW = new Date("2026-11-16T12:00:00.000Z");
const MS_PER_HOUR = 3_600_000;
const START = Date.parse("2026-11-12T00:00:00.000Z");
const MILLION = 1_000_000;
/** The true weight: 2.5 points of the cap per million tokens, so 400,000 tokens use 1%. */
const POINTS_PER_MILLION = 2.5;
const FIRST_RESET = "2026-11-13T08:00:00.000Z";
const SECOND_RESET = "2026-11-20T08:00:00.000Z";
const PLAN = "plan-a";
const TASK = "demo-app/task-1";

let privateKey: CryptoKey;
let accessKeys: AccessKeys;
const routerEnv: RouterEnv = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: AUD };
const repo = () => new D1ItemRepository(env.DB);
const clock = { now: () => NOW };
const hour = (n: number): string => new Date(START + n * MS_PER_HOUR).toISOString();

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }] });
  accessKeys = () => keySet;
});

beforeEach(resetBoard);

async function getUsage(query: string): Promise<UsageResponse> {
  const jwt = await new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime("1h")
    .sign(privateKey);
  const request = new Request(`http://example.com/api/usage${query}`, { headers: { [ACCESS_JWT_HEADER]: jwt } });
  const response = await route(request, routerEnv, { repo: repo(), clock, accessKeys });
  expect(response.status).toBe(200);
  return (await response.json()) as UsageResponse;
}

async function useOneMillion(at: number, environment?: string): Promise<void> {
  await reportUsage(
    repo(),
    {
      agent_key: "demo-app/session-1",
      model: "model-large",
      record_at: hour(at),
      input_tokens: MILLION * (at + 1),
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      output_tokens: 0,
      task_key: TASK,
      agent_kind: "implementer",
      step: "build",
      ...(environment ? { environment } : {}),
    },
    clock,
  );
}

async function readCap(at: number, percent: number, resetAt: string): Promise<void> {
  await reportCap(repo(), { taken_at: hour(at), plan: PLAN, windows: [{ kind: "weekly", percent, reset_at: resetAt }] });
}

/** Hourly use of one million tokens that moves the cap 2.5 points, across a reset from 77.5% to 0%. */
async function seedWeekWithReset(environment?: string): Promise<void> {
  for (let h = 0; h <= 31; h++) {
    await useOneMillion(h, environment);
    if (h <= 31 - 1) await readCap(h, h * POINTS_PER_MILLION, FIRST_RESET);
  }
  await readCap(32, 0, SECOND_RESET);
  await useOneMillion(32, environment);
  for (let h = 33; h <= 42; h++) {
    await useOneMillion(h, environment);
    await readCap(h, (h - 32) * POINTS_PER_MILLION, SECOND_RESET);
  }
}

describe("the cap cost in the usage route", () => {
  it("fits 400,000 tokens per 1% across a reset, with nothing negative and the task cost counted after it", async () => {
    await seedWeekWithReset();
    const usage = await getUsage("?range=30d");
    const cost = usage.cap_cost;
    expect(cost.ready).toBe(true);
    const model = cost.models[0];
    expect(model?.mode).toBe("per_kind");
    expect(model?.tokens_per_percent.input).toBeCloseTo(400_000, -1);
    for (const value of Object.values(model?.tokens_per_percent ?? {})) expect(value === null || value > 0).toBe(true);
    const task = usage.top_tasks.find((t) => t.key === TASK);
    expect(task?.cap_points).toBeCloseTo((task?.tokens ?? 0) / 400_000, 1);
    expect(task?.cap_points ?? 0).toBeGreaterThan(80);
    expect(usage.agent_kinds[0]?.cap_points).toBeCloseTo(task?.cap_points ?? 0, 6);
    expect(cost.steps[0]).toMatchObject({ step: "build" });
    expect(cost.unexplained?.share ?? 1).toBeLessThan(0.01);
    for (const stretch of cost.unexplained_stretches) expect(stretch.points).toBeGreaterThanOrEqual(0);
  });

  it("reports the estimate not ready, with no cap figure, while the plan has too few stretches", async () => {
    await useOneMillion(0);
    await useOneMillion(1);
    await readCap(0, 0, FIRST_RESET);
    await readCap(1, 3, FIRST_RESET);
    const usage = await getUsage("?range=30d");
    expect(usage.cap_cost).toMatchObject({ ready: false, stretches: 1, min_stretches: 3, models: [], unexplained: null });
    expect(usage.top_tasks[0]?.cap_points).toBeNull();
    expect(usage.agent_kinds[0]?.cap_points).toBeNull();
  });

  it("lists each environment with its multiplier: the base at 1x, one with too few stretches as not enough data", async () => {
    await seedWeekWithReset("laptop");
    await reportUsage(
      repo(),
      { agent_key: "demo-app/session-2", model: "model-large", record_at: hour(40), input_tokens: 5, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, environment: "cloud" },
      clock,
    );
    const usage = await getUsage("?range=30d");
    const byValue = new Map(usage.cap_cost.environments.map((e) => [e.value, e]));
    expect(byValue.get("laptop")).toMatchObject({ multiplier: 1, state: MultiplierState.Base });
    expect(byValue.get("cloud")).toMatchObject({ multiplier: 1, state: MultiplierState.NotEnough });
    expect(usage.base_environment).toBe("laptop");
  });

  it("keeps the base environment and the multipliers the same for every range", async () => {
    await seedWeekWithReset("laptop");
    await reportUsage(
      repo(),
      { agent_key: "demo-app/session-2", model: "model-large", record_at: hour(41), input_tokens: 20 * MILLION, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, environment: "cloud" },
      clock,
    );
    const month = await getUsage("?range=30d");
    const day = await getUsage("?range=window");
    expect(day.base_environment).toBe("laptop");
    expect(day.base_environment).toBe(month.base_environment);
    expect(day.cap_cost.environments.map((e) => [e.value, e.multiplier, e.state])).toEqual(
      month.cap_cost.environments.map((e) => [e.value, e.multiplier, e.state]),
    );
  });

  it("shows no cap figure for a task whose model has no fitted weight, never 0%", async () => {
    await seedWeekWithReset();
    await reportUsage(
      repo(),
      { agent_key: "demo-app/session-9", model: "model-unseen", record_at: hour(43), input_tokens: MILLION, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, task_key: "demo-app/task-unseen", agent_kind: "scout" },
      clock,
    );
    const usage = await getUsage("?range=30d");
    expect(usage.cap_cost.models.map((m) => m.model)).not.toContain("model-unseen");
    const unseen = usage.top_tasks.find((t) => t.key === "demo-app/task-unseen");
    expect(unseen).toBeDefined();
    expect(unseen?.cap_points).toBeNull();
    expect(usage.agent_kinds.find((k) => k.name === "scout")?.cap_points).toBeNull();
  });

  it("shows no cap figure for an environment whose use includes a model with no fitted weight", async () => {
    await seedWeekWithReset("laptop");
    await reportUsage(
      repo(),
      { agent_key: "demo-app/session-9", model: "model-unseen", record_at: hour(43), input_tokens: MILLION, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, environment: "cloud" },
      clock,
    );
    const usage = await getUsage("?range=30d");
    const byValue = new Map(usage.cap_cost.environments.map((e) => [e.value, e]));
    expect(byValue.get("laptop")?.cap_points).toBeGreaterThan(0);
    expect(byValue.get("cloud")?.cap_points).toBeNull();
  });

  it("compares the kinds with the heaviest one when fresh input weighs nothing", async () => {
    for (let h = 0; h <= 20; h++) {
      await reportUsage(
        repo(),
        { agent_key: "demo-app/session-1", model: "model-large", record_at: hour(h), input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: MILLION * (h + 1), output_tokens: 0 },
        clock,
      );
      if (h > 0) await readCap(h, h * POINTS_PER_MILLION, SECOND_RESET);
    }
    const model = (await getUsage("?range=30d")).cap_cost.models[0];
    expect(model?.mode).toBe("per_kind");
    expect(model?.kind_ratio_reference).toBe("cache_read");
    expect(model?.kind_ratios?.cache_read).toBe(1);
  });
});

describe("cap growth inside a reported chat window (Slice 16)", () => {
  /** The week of `seedWeekWithReset`, then 6 points of growth in the hour after 42 that no token report explains. */
  async function seedUnexplainedHour(): Promise<void> {
    await seedWeekWithReset();
    await readCap(43, (42 - 32) * POINTS_PER_MILLION + 6, SECOND_RESET);
  }

  async function reportSession(environment: string | undefined, key: string, status: `${ItemStatus.InProgress}` | `${ItemStatus.Done}`, at: number): Promise<void> {
    await reportProgress(
      repo(),
      { key, project: "demo-app", type: ItemType.Unplanned, title: "A chat", agent: "session", status: status as ItemStatus, ...(environment ? { environment } : {}) },
      { now: () => new Date(hour(at)) },
    );
  }

  it("shows unexplained growth with no chat window as it was, and no chat environment", async () => {
    await seedUnexplainedHour();
    const usage = await getUsage("?range=30d");
    expect(usage.cap_cost.unexplained?.points).toBeGreaterThan(5.9);
    expect(usage.cap_cost.environments.map((e) => e.value)).not.toContain("Claude chat");
  });

  it("puts the growth inside the chat's first-to-last report against its environment, not unexplained", async () => {
    await seedUnexplainedHour();
    await reportSession("Claude chat", "demo-app/session-chat1", "in_progress", 42);
    await reportSession("Claude chat", "demo-app/session-chat1", "done", 42.5);
    const usage = await getUsage("?range=30d");
    const chat = usage.cap_cost.environments.find((e) => e.value === "Claude chat");
    expect(chat).toMatchObject({ tokens: null, reports: 0, multiplier: null });
    expect(chat?.cap_points).toBeCloseTo(3, 1);
    expect(usage.cap_cost.unexplained?.points).toBeGreaterThan(2.9);
    expect(usage.cap_cost.unexplained?.points).toBeLessThan(3.1);
  });

  it("places nothing against a chat while the environment filter names another environment", async () => {
    await seedUnexplainedHour();
    await reportSession("Claude chat", "demo-app/session-chat1", "in_progress", 42);
    await reportSession("Claude chat", "demo-app/session-chat1", "done", 42.5);
    const usage = await getUsage("?range=30d&environment=laptop");
    expect(usage.cap_cost.environments.map((e) => e.value)).not.toContain("Claude chat");
    expect(usage.cap_cost.unexplained?.points).toBeGreaterThan(5.9);
  });

  it("lists a placed environment once even when its sessions spell it differently", async () => {
    await seedUnexplainedHour();
    await reportSession("Claude chat", "demo-app/session-chat1", "in_progress", 42);
    await reportSession("Claude chat", "demo-app/session-chat1", "done", 42.25);
    await reportSession("claude chat ", "demo-app/session-chat2", "in_progress", 42.5);
    await reportSession("claude chat ", "demo-app/session-chat2", "done", 42.75);
    const usage = await getUsage("?range=30d");
    const names = usage.cap_cost.environments.map((e) => e.value.trim().toLowerCase()).filter((v) => v === "claude chat");
    expect(names).toHaveLength(1);
  });

  it("does not place growth against an environment that reports its own tokens, or a session with none", async () => {
    await seedUnexplainedHour();
    await reportSession("laptop", "demo-app/session-lap", "in_progress", 42);
    await reportSession("laptop", "demo-app/session-lap", "done", 43);
    await reportSession(undefined, "demo-app/session-bare", "in_progress", 42);
    await reportSession(undefined, "demo-app/session-bare", "done", 43);
    await reportUsage(
      repo(),
      { agent_key: "demo-app/session-lap", model: "model-large", record_at: hour(42), input_tokens: 1, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, environment: "laptop" },
      clock,
    );
    const usage = await getUsage("?range=30d");
    expect(usage.cap_cost.unexplained?.points).toBeGreaterThan(5.9);
  });
});
