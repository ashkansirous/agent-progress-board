import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_JWT_HEADER, type AccessKeys } from "../src/api/access";
import { route, type RouterEnv } from "../src/api/router";
import type { UsagePageResponse, UsageResponse } from "../src/api/usageDto";
import { thinOldUsage } from "../src/application/usage";
import worker from "../src/index";
import { totalOf, useBetween, usageDeltas } from "../src/domain/usage";
import { D1ItemRepository, SAMPLES_FROM, THIN_ROWS } from "../src/infrastructure/d1Repository";
import { callTool, countRows, READ_TOKEN, resetBoard } from "./helpers";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const KEY_ID = "test-key";
const NOW = new Date("2026-11-16T12:00:00.000Z");
const USAGE_URL = "http://example.com/api/usage";
const MS_PER_MINUTE = 60_000;

let privateKey: CryptoKey;
let accessKeys: AccessKeys;

const baseEnv: RouterEnv = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: AUD };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }] });
  accessKeys = () => keySet;
});

beforeEach(resetBoard);

async function getUsage(query = "", routerEnv: RouterEnv = baseEnv): Promise<UsageResponse> {
  const jwt = await new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime("1h")
    .sign(privateKey);
  const request = new Request(`${USAGE_URL}${query}`, { headers: { [ACCESS_JWT_HEADER]: jwt } });
  const response = await route(request, routerEnv, { repo: new D1ItemRepository(env.DB), clock: { now: () => NOW }, accessKeys });
  expect(response.status).toBe(200);
  return (await response.json()) as UsageResponse;
}

const USAGE = {
  agent_key: "demo-app/session-1",
  model: "model-large",
  record_at: "2026-11-15T09:00:00Z",
  input_tokens: 100,
  cache_write_tokens: 50,
  cache_read_tokens: 500,
  output_tokens: 20,
};

describe("report_usage", () => {
  it("refuses a read token and stores nothing", async () => {
    const reply = await callTool("report_usage", USAGE, READ_TOKEN);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("read-only");
    expect(await countRows("usage_samples")).toBe(0);
  });

  it("stores the same report once, and a second report with the same identity and other totals is ignored", async () => {
    const first = await callTool("report_usage", { ...USAGE, agent_kind: "reviewer", environment: "laptop" });
    const again = await callTool("report_usage", { ...USAGE, agent_kind: "reviewer", environment: "laptop" });
    const changed = await callTool("report_usage", { ...USAGE, input_tokens: 999, environment: "laptop" });
    expect(first.data).toEqual({ stored: true });
    expect(again.data).toEqual({ stored: false });
    expect(changed.data).toEqual({ stored: false });
    expect(await countRows("usage_samples")).toBe(1);
    const row = await env.DB.prepare("SELECT input_tokens FROM usage_samples").first<{ input_tokens: number }>();
    expect(row?.input_tokens).toBe(100);
    expect(await countRows("usage_series")).toBe(3);
  });

  it("keeps one agent key in two environments as two samples, and stores a missing environment as null", async () => {
    await callTool("report_usage", { ...USAGE, environment: "laptop" });
    await callTool("report_usage", { ...USAGE, environment: "cloud-vm" });
    await callTool("report_usage", USAGE);
    await callTool("report_usage", USAGE);
    expect(await countRows("usage_samples")).toBe(3);
    const rows = await env.DB.prepare("SELECT environment FROM usage_samples ORDER BY id").all<{ environment: string | null }>();
    expect(rows.results.map((r) => r.environment)).toEqual(["laptop", "cloud-vm", null]);
  });

  it("names the field for bad input and writes nothing", async () => {
    const negative = await callTool("report_usage", { ...USAGE, output_tokens: -1 });
    const longEnvironment = await callTool("report_usage", { ...USAGE, environment: "x".repeat(41) });
    const badTime = await callTool("report_usage", { ...USAGE, record_at: "yesterday" });
    expect([negative, longEnvironment, badTime].every((r) => r.isError)).toBe(true);
    expect(negative.text).toContain("output_tokens");
    expect(longEnvironment.text).toContain("environment");
    expect(badTime.text).toContain("record_at");
    expect(await countRows("usage_samples")).toBe(0);
  });
});

describe("report_progress environment", () => {
  it("stores the environment on a new item, changes it, and clears it with null", async () => {
    const item = { key: "demo-app/slice-1", project: "demo-app", type: "slice", title: "Sample slice" };
    expect(((await callTool("report_progress", { ...item, environment: "laptop" })).data as { environment: string }).environment).toBe("laptop");
    expect(((await callTool("report_progress", { key: item.key, environment: "cloud-vm" })).data as { environment: string }).environment).toBe("cloud-vm");
    expect(((await callTool("report_progress", { key: item.key })).data as { environment: string }).environment).toBe("cloud-vm");
    expect(((await callTool("report_progress", { key: item.key, environment: null })).data as { environment: null }).environment).toBeNull();
  });
});

describe("report_cap", () => {
  const CAP = {
    taken_at: "2026-11-15T10:00:00Z",
    plan: "plan-a",
    windows: [{ kind: "weekly", percent: 40.5, reset_at: "2026-11-17T08:00:00Z" }, { kind: "short", percent: 41 }],
  };

  it("stores one raw reading per window, once, and refuses a read token", async () => {
    expect((await callTool("report_cap", CAP, READ_TOKEN)).isError).toBe(true);
    expect((await callTool("report_cap", CAP)).data).toEqual({ stored: 2, windows: 2 });
    expect((await callTool("report_cap", CAP)).data).toEqual({ stored: 0, windows: 2 });
    expect(await countRows("cap_readings")).toBe(2);
  });

  it("names the field for a percent over 100", async () => {
    const reply = await callTool("report_cap", { ...CAP, windows: [{ kind: "weekly", percent: 120 }] });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("percent");
  });
});

async function seedUsage(): Promise<void> {
  await callTool("report_progress", { key: "demo-app/slice-8", project: "demo-app", type: "slice", title: "Usage reports" });
  const weekly = (takenAt: string, percent: number) => ({
    taken_at: takenAt,
    plan: "plan-a",
    windows: [{ kind: "weekly", percent, reset_at: "2026-11-17T08:00:00Z" }],
  });
  await callTool("report_cap", weekly("2026-11-14T10:00:00Z", 20));
  await callTool("report_cap", weekly("2026-11-15T10:00:00Z", 40));
  await callTool("report_cap", { ...weekly("2026-11-15T12:00:00Z", 35), windows: [{ kind: "weekly", percent: 35, reset_at: "2026-11-17T08:00:00Z" }, { kind: "short", percent: 41 }] });
  const task = "demo-app/slice-8";
  await callTool("report_usage", { ...USAGE, task_key: task, agent_kind: "reviewer", environment: "laptop" });
  await callTool("report_usage", { ...USAGE, record_at: "2026-11-16T09:00:00Z", input_tokens: 300, cache_read_tokens: 1500, output_tokens: 60, task_key: task, agent_kind: "reviewer", environment: "laptop" });
  const small = { ...USAGE, agent_key: "demo-app/session-2", model: "model-small", cache_write_tokens: 0, cache_read_tokens: 0 };
  await callTool("report_usage", { ...small, record_at: "2026-11-16T10:00:00Z", input_tokens: 10, output_tokens: 5, task_key: task, environment: "cloud-vm" });
  await callTool("report_usage", { ...small, agent_key: "demo-app/session-3", record_at: "2026-11-16T11:00:00Z", input_tokens: 7, output_tokens: 3, task_key: "other-app/slice-1" });
}

describe("GET /api/usage", () => {
  it("refuses a request with no Access token", async () => {
    const response = await route(new Request(USAGE_URL), baseEnv, { repo: new D1ItemRepository(env.DB), clock: { now: () => NOW }, accessKeys });
    expect(response.status).toBe(403);
  });

  it("carries the page palettes from config", async () => {
    const config = JSON.stringify({ palettes: { light: { page: "#f0f0f0" }, dark: { page: "#101010" } } });
    const usage = (await getUsage("", { ...baseEnv, BOARD_CONFIG: config })) as UsagePageResponse;
    expect(usage.palettes.light?.page).toBe("#f0f0f0");
    expect(usage.palettes.dark?.page).toBe("#101010");
    expect(usage.palettes.light?.pillSureBg).toBeDefined();
    expect(usage.palettes.dark?.markInk).toBeDefined();
  });

  it("answers 400 naming the field for a bad range or offset", async () => {
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: KEY_ID }).setIssuer(TEAM).setAudience(AUD).setExpirationTime("1h").sign(privateKey);
    const deps = { repo: new D1ItemRepository(env.DB), clock: { now: () => NOW }, accessKeys };
    for (const query of ["?range=year", "?utc_offset=abc", "?utc_offset=9999"]) {
      const response = await route(new Request(`${USAGE_URL}${query}`, { headers: { [ACCESS_JWT_HEADER]: jwt } }), baseEnv, deps);
      expect(response.status).toBe(400);
    }
  });

  it("returns totals, tasks, environments and the cap, with a dropped reading and what it lost to", async () => {
    await seedUsage();
    const usage = await getUsage("?range=30d");
    expect(usage.plan).toBe("plan-a");
    expect(usage.plans).toEqual(["plan-a"]);
    expect(usage.totals_by_model.map((m) => [m.model, m.total])).toEqual([["model-large", 1910], ["model-small", 25]]);
    expect(usage.totals_by_token_kind).toMatchObject({ input: 317, cache_write: 50, cache_read: 1500, output: 68, total: 1935 });
    expect(usage.base_environment).toBe("laptop");
    expect(usage.environments).toEqual([
      { value: "laptop", label: "laptop", tokens: 1920, reports: 3 },
      { value: "cloud-vm", label: "cloud-vm", tokens: 15, reports: 1 },
    ]);
    expect(usage.top_tasks).toEqual([
      { key: "demo-app/slice-8", title: "Usage reports", project: "demo-app", tokens: 1925, cap_points: null },
      { key: "other-app/slice-1", title: "other-app/slice-1", project: "other-app", tokens: 10, cap_points: null },
    ]);
    expect(usage.other_tasks).toBeNull();
    expect(usage.agent_kinds).toEqual([{ name: "reviewer", color_index: 0, tokens: 1910, cap_points: null }]);
    expect(usage.cap_cost.ready).toBe(false);
    expect(usage.cap.weekly.windows).toHaveLength(1);
    expect(usage.cap.weekly.windows[0]?.readings.map((r) => r.percent)).toEqual([20, 40]);
    expect(usage.cap.weekly.dropped).toEqual([{ taken_at: "2026-11-15T12:00:00.000Z", percent: 35, stored_percent: 40 }]);
    expect(usage.cap.weekly.latest?.percent).toBe(40);
    expect(usage.cap.short.latest?.percent).toBe(41);
    expect(usage.buckets).toHaveLength(31);
  });

  it("counts a report with no environment under the configured base, and filters by environment", async () => {
    await seedUsage();
    const config = JSON.stringify({ usage: { baseEnvironment: "cloud-vm", environmentLabels: { "cloud-vm": "Cloud VM" } } });
    const usage = await getUsage("?range=30d&environment=cloud-vm", { ...baseEnv, BOARD_CONFIG: config });
    expect(usage.base_environment).toBe("cloud-vm");
    expect(usage.totals_by_model.map((m) => [m.model, m.total])).toEqual([["model-small", 25]]);
    expect(usage.environments.map((e) => e.label)).toEqual(["laptop", "Cloud VM"]);
    expect(usage.cap.weekly.latest?.percent).toBe(40);
  });

  it("subtracts the sample before the range for the first delta in it (24 h) and buckets by hour", async () => {
    await seedUsage();
    const usage = await getUsage("?range=24h");
    expect(usage.bucket_unit).toBe("hour");
    expect(usage.totals_by_model.find((m) => m.model === "model-large")?.total).toBe(1240);
    const hour = usage.splits.model.find((s) => s.name === "model-large")?.values;
    expect(hour?.[usage.buckets.indexOf("2026-11-16T09")]).toBe(1240);
  });

  it("covers the last 7 days with empty cap parts when no weekly reading exists", async () => {
    await callTool("report_usage", { ...USAGE, record_at: "2026-11-14T09:00:00Z" });
    const usage = await getUsage();
    expect(usage.plan).toBeNull();
    expect(usage.from).toBe("2026-11-09T12:00:00.000Z");
    expect(usage.cap.weekly).toEqual({ windows: [], dropped: [], latest: null });
    expect(usage.totals_by_model[0]?.total).toBe(670);
  });

  it("leaves other plans' use out and keeps the plan list", async () => {
    await seedUsage();
    await callTool("report_cap", { taken_at: "2026-11-16T09:30:00Z", plan: "plan-b", windows: [{ kind: "weekly", percent: 1 }] });
    const onB = await getUsage("?range=30d&plan=plan-b");
    expect(onB.plans).toEqual(["plan-a", "plan-b"]);
    expect(onB.totals_by_model.map((m) => m.model)).toEqual(["model-small"]);
    expect(onB.totals_by_model[0]?.total).toBe(25);
  });
});

const SAMPLE_MINUTES = 5;
const DAYS_OF_REPORTS = 40;
const KEEP_DAYS = 30;
const RESTART_AT = 2000;
const CHUNK = 1000;

async function insertSeries(count: number, firstAt: number): Promise<void> {
  for (let start = 0; start < count; start += CHUNK) {
    const rows = Array.from({ length: Math.min(CHUNK, count - start) }, (_, offset) => {
      const i = start + offset;
      const sinceRestart = i < RESTART_AT ? i : i - RESTART_AT;
      return { at: new Date(firstAt + i * SAMPLE_MINUTES * MS_PER_MINUTE).toISOString(), n: sinceRestart };
    });
    await env.DB.prepare(
      `INSERT INTO usage_samples (agent_key, model, environment, record_at, reported_at, input_tokens,
         cache_write_tokens, cache_read_tokens, output_tokens)
       SELECT 'demo-app/session-1', 'model-large', NULL, json_extract(value, '$.at'), json_extract(value, '$.at'),
         json_extract(value, '$.n') * 10, json_extract(value, '$.n'), json_extract(value, '$.n') * 100, json_extract(value, '$.n') * 2
       FROM json_each(?1)`,
    ).bind(JSON.stringify(rows)).run();
  }
}

describe("thinning old samples", () => {
  it("keeps the last sample of each hour past the keep-time and every restart, leaving the use unchanged", async () => {
    const total = (DAYS_OF_REPORTS * 24 * 60) / SAMPLE_MINUTES;
    const first = NOW.getTime() - DAYS_OF_REPORTS * 24 * 60 * MS_PER_MINUTE;
    await insertSeries(total, first);
    const repo = new D1ItemRepository(env.DB);
    const use = async (): Promise<number> => totalOf(useBetween(usageDeltas(await repo.usageSamplesFrom("0")), null, NOW.toISOString()));
    const before = await use();
    const recent = await countRows("usage_samples");
    expect(recent).toBe(total);
    // The cron runs daily and thins a 3-day band: ten daily runs reach the oldest of the 10 old days.
    let deleted = 0;
    for (let ago = DAYS_OF_REPORTS - KEEP_DAYS - 1; ago >= 0; ago--) {
      deleted += await thinOldUsage(repo, KEEP_DAYS, { now: () => new Date(NOW.getTime() - ago * 24 * 60 * MS_PER_MINUTE) });
    }
    const rows = await countRows("usage_samples");
    // Measured: 11,520 rows -> 8,883: 8,640 inside the keep-time, 240 hourly rows for the 10 older days, 2 for the restart, 1 for the oldest row of the series.
    expect(rows).toBe(8883);
    expect(deleted).toBe(total - 8883);
    expect(rows).toBe(total - deleted);
    expect(await use()).toBe(before);
    expect(await thinOldUsage(repo, KEEP_DAYS, { now: () => NOW })).toBe(0);
    const old = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_samples WHERE record_at < ?1").bind(new Date(NOW.getTime() - KEEP_DAYS * 24 * 60 * MS_PER_MINUTE).toISOString()).first<{ n: number }>();
    expect(old?.n).toBeLessThan(24 * (DAYS_OF_REPORTS - KEEP_DAYS) + 5);
  });

  it("runs from the scheduled handler with the keep-time from config", async () => {
    await insertSeries(300, NOW.getTime() - 300 * SAMPLE_MINUTES * MS_PER_MINUTE);
    const config = JSON.stringify({ usage: { keepDays: 1 } });
    const controller = createScheduledController({ scheduledTime: NOW, cron: "*/15 * * * *" });
    const ctx = createExecutionContext();
    await worker.scheduled(controller, { ...env, BOARD_CONFIG: config });
    await waitOnExecutionContext(ctx);
    expect(await countRows("usage_samples")).toBeLessThan(300);
  });
});

interface RawSample {
  series?: string;
  at: string;
  n: number;
  task?: string | null;
  kind?: string | null;
}

async function insertRaw(rows: RawSample[]): Promise<void> {
  const insert = env.DB.prepare(
    `INSERT INTO usage_samples (agent_key, model, environment, record_at, reported_at, input_tokens,
       cache_write_tokens, cache_read_tokens, output_tokens, task_key, agent_kind)
     VALUES (?1, 'model-large', NULL, ?2, ?2, ?3, 0, 0, 0, ?4, ?5)`,
  );
  await env.DB.batch(rows.map((r) => insert.bind(r.series ?? "demo-app/s1", r.at, r.n, r.task ?? null, r.kind ?? null)));
}

/** Use per series, per task and per agent kind, as the read path works it out. */
async function useBreakdown(repo: D1ItemRepository): Promise<Record<string, number>> {
  const deltas = usageDeltas(await repo.usageSamplesFrom("0"));
  const sums: Record<string, number> = {};
  for (const { sample, used } of deltas) {
    for (const key of [`series:${sample.agentKey}`, `task:${sample.taskKey}`, `kind:${sample.agentKind}`]) {
      sums[key] = (sums[key] ?? 0) + totalOf(used);
    }
  }
  return sums;
}

const OLD_DAY = "2026-11-14T";
const THIN_CLOCK = { now: () => NOW };

describe("thinning keeps the use per series, task and agent kind", () => {
  it("is the same before and after when a series changes task or agent kind inside an hour, and a second run deletes nothing", async () => {
    await insertRaw([
      { at: `${OLD_DAY}07:30:00.000Z`, n: 5, task: "task-a", kind: "builder" },
      { at: `${OLD_DAY}08:05:00.000Z`, n: 10, task: "task-a", kind: "builder" },
      { at: `${OLD_DAY}08:10:00.000Z`, n: 20, task: "task-a", kind: "builder" },
      { at: `${OLD_DAY}08:20:00.000Z`, n: 30, task: "task-b", kind: "builder" },
      { at: `${OLD_DAY}08:40:00.000Z`, n: 45, task: "task-b", kind: "reviewer" },
      { at: `${OLD_DAY}08:50:00.000Z`, n: 60, task: "task-b", kind: "reviewer" },
      { series: "demo-app/s2", at: `${OLD_DAY}07:30:00.000Z`, n: 1, task: "task-c" },
      { series: "demo-app/s2", at: `${OLD_DAY}08:15:00.000Z`, n: 4, task: "task-c" },
      { series: "demo-app/s2", at: `${OLD_DAY}08:45:00.000Z`, n: 9, task: "task-c" },
      { series: "demo-app/s2", at: `${OLD_DAY}23:00:00.000Z`, n: 12, task: "task-c" },
    ]);
    const repo = new D1ItemRepository(env.DB);
    const before = await useBreakdown(repo);
    const deleted = await thinOldUsage(repo, 1, THIN_CLOCK);
    expect(deleted).toBeGreaterThan(0);
    expect(await useBreakdown(repo)).toEqual(before);
    expect(await thinOldUsage(repo, 1, THIN_CLOCK)).toBe(0);
  });

  it("keeps the oldest row of a series and the use of its hour", async () => {
    await insertRaw([
      { at: `${OLD_DAY}08:05:00.000Z`, n: 10 },
      { at: `${OLD_DAY}08:10:00.000Z`, n: 20 },
      { at: `${OLD_DAY}08:55:00.000Z`, n: 30 },
    ]);
    const repo = new D1ItemRepository(env.DB);
    const before = await useBreakdown(repo);
    await thinOldUsage(repo, 1, THIN_CLOCK);
    expect(await useBreakdown(repo)).toEqual(before);
    const oldest = await env.DB.prepare("SELECT MIN(record_at) AS at FROM usage_samples").first<{ at: string }>();
    expect(oldest?.at).toBe(`${OLD_DAY}08:05:00.000Z`);
  });
});

describe("a report sent with a non-UTC offset", () => {
  it("is stored in UTC and lands in the right order and hour", async () => {
    await callTool("report_usage", { ...USAGE, record_at: "2026-11-15T10:30:00+02:00", input_tokens: 1 });
    await callTool("report_usage", { ...USAGE, record_at: "2026-11-15T08:10:00Z", input_tokens: 2 });
    await callTool("report_usage", { ...USAGE, record_at: "2026-11-15T02:50:00-06:00", input_tokens: 3 });
    const rows = await env.DB.prepare("SELECT record_at, input_tokens FROM usage_samples ORDER BY record_at").all<{ record_at: string; input_tokens: number }>();
    expect(rows.results).toEqual([
      { record_at: "2026-11-15T08:30:00.000Z", input_tokens: 1 },
      { record_at: "2026-11-15T08:10:00.000Z", input_tokens: 2 },
      { record_at: "2026-11-15T08:50:00.000Z", input_tokens: 3 },
    ].sort((a, b) => a.record_at.localeCompare(b.record_at)));
    const hours = await env.DB.prepare("SELECT DISTINCT substr(record_at, 1, 13) AS hour FROM usage_samples").all<{ hour: string }>();
    expect(hours.results).toEqual([{ hour: "2026-11-15T08" }]);
  });
});

describe("the read query", () => {
  it("returns the baseline only for series with a sample in the range", async () => {
    await insertRaw([
      { series: "demo-app/quiet", at: "2026-11-01T08:00:00.000Z", n: 10 },
      { series: "demo-app/busy", at: "2026-11-01T08:00:00.000Z", n: 10 },
      { series: "demo-app/busy", at: "2026-11-05T08:00:00.000Z", n: 20 },
      { series: "demo-app/busy", at: "2026-11-15T08:00:00.000Z", n: 30 },
    ]);
    const samples = await new D1ItemRepository(env.DB).usageSamplesFrom("2026-11-10T00:00:00.000Z");
    expect(samples.map((s) => [s.agentKey, s.recordAt])).toEqual([
      ["demo-app/busy", "2026-11-05T08:00:00.000Z"],
      ["demo-app/busy", "2026-11-15T08:00:00.000Z"],
    ]);
  });

  it("plans: the identity index for the baseline seek, the time index for the range and the thinning band", async () => {
    const plan = async (sql: string, binds: string[]): Promise<string[]> => {
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>();
      return results.map((r) => r.detail);
    };
    const read = await plan(SAMPLES_FROM, ["2026-11-10T00:00:00.000Z"]);
    const thin = await plan(`DELETE FROM usage_samples WHERE id IN (${THIN_ROWS})`, ["2026-11-14T00:00:00.000Z", "2026-11-11T00:00:00.000Z"]);
    console.log(`EXPLAIN read:\n${read.join("\n")}\nEXPLAIN thin:\n${thin.join("\n")}`);
    expect(read.join("\n")).toContain("idx_usage_samples_identity");
    expect(read.join("\n")).toContain("idx_usage_samples_time");
    expect(read.filter((line) => line.startsWith("SCAN usage_samples"))).toEqual([]);
    // The route's one call now starts at the fit's history (30 days back), the same statement with a far earlier bind.
    const history = await plan(SAMPLES_FROM, ["2026-10-17T12:00:00.000Z"]);
    expect(history.join("\n")).toContain("idx_usage_samples_identity");
    expect(history.filter((line) => line.startsWith("SCAN usage_samples"))).toEqual([]);
    expect(thin.join("\n")).toContain("idx_usage_samples_time");
  });
});
