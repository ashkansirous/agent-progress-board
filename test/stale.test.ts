import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markStaleItems } from "../src/application/board";
import worker from "../src/index";
import { ItemStatus, ItemType } from "../src/domain/item";
import {
  EXPIRING_STATUSES,
  type ExpiryRow,
  isExpired,
  isWaitingClosable,
  movesLiveStatus,
  SESSION_AGENT,
  staleCutoff,
  WAITING_CLOSED_NOTE,
} from "../src/domain/stale";
import { D1ItemRepository, EXPIRED_ROWS, WAITING_ROWS } from "../src/infrastructure/d1Repository";
import { callTool, countRows, resetBoard } from "./helpers";

const NOW = new Date();
const MINUTES = 120;
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const ITEM = { key: "demo-app/slice-1", project: "demo-app", type: "slice", title: "Sample slice" };

describe("isExpired", () => {
  const live: ExpiryRow = {
    status: ItemStatus.InProgress,
    heartbeat_at: ago(121),
    doc_status_at: null,
    live_status_at: ago(300),
  };

  it("expires a live in-progress or blocked item whose heartbeat is older than the expiry", () => {
    expect(isExpired(live, MINUTES, NOW)).toBe(true);
    expect(isExpired({ ...live, status: ItemStatus.Blocked }, MINUTES, NOW)).toBe(true);
  });

  it("keeps an item whose heartbeat is exactly at or inside the expiry", () => {
    expect(isExpired({ ...live, heartbeat_at: ago(120) }, MINUTES, NOW)).toBe(false);
    expect(isExpired({ ...live, heartbeat_at: ago(10) }, MINUTES, NOW)).toBe(false);
  });

  it("never expires open, done or already stale items", () => {
    for (const status of [ItemStatus.Open, ItemStatus.Done, ItemStatus.Stale]) {
      expect(isExpired({ ...live, status }, MINUTES, NOW)).toBe(false);
    }
  });

  it("never expires an item only the docs set (no live status, or the docs are newer)", () => {
    expect(isExpired({ ...live, live_status_at: null, doc_status_at: ago(500) }, MINUTES, NOW)).toBe(false);
    expect(isExpired({ ...live, live_status_at: ago(300), doc_status_at: ago(200) }, MINUTES, NOW)).toBe(false);
    expect(isExpired({ ...live, live_status_at: ago(300), doc_status_at: ago(400) }, MINUTES, NOW)).toBe(true);
  });

  it("computes the cutoff in whole minutes before now", () => {
    expect(staleCutoff(NOW, 120)).toBe(ago(120));
  });

  it("expires a session card after 15 minutes, whatever the configured expiry", () => {
    const session = { ...live, agent: SESSION_AGENT };
    expect(isExpired({ ...session, heartbeat_at: ago(16) }, MINUTES, NOW)).toBe(true);
    expect(isExpired({ ...session, heartbeat_at: ago(15) }, MINUTES, NOW)).toBe(false);
    expect(isExpired({ ...session, heartbeat_at: ago(5) }, MINUTES, NOW)).toBe(false);
    expect(isExpired({ ...live, agent: "Implementer", heartbeat_at: ago(16) }, MINUTES, NOW)).toBe(false);
  });
});

interface SqlRow extends ExpiryRow {
  key: string;
}

async function insertRow(row: SqlRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO items (key, project, type, priority, status, title, links, heartbeat_at, created_at, updated_at,
       live_status_at, doc_status_at, in_doc_sync, agent)
     VALUES (?1, 'demo-app', 'slice', 'P2', ?2, 'T', '[]', ?3, ?3, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      row.key, row.status, row.heartbeat_at, row.live_status_at, row.doc_status_at, row.doc_status_at ? 1 : 0,
      row.agent ?? null,
    )
    .run();
}

async function statusOf(key: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT status FROM items WHERE key = ?").bind(key).first<{ status: string }>();
  return row?.status;
}

async function setHeartbeat(key: string, at: string): Promise<void> {
  await env.DB.prepare("UPDATE items SET heartbeat_at = ?2 WHERE key = ?1").bind(key, at).run();
}

async function runCron(): Promise<void> {
  const controller = createScheduledController({ scheduledTime: NOW, cron: "*/15 * * * *" });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env);
  await waitOnExecutionContext(ctx);
}

beforeEach(resetBoard);

describe("markStale (SQL) agrees with isExpired", () => {
  it("turns exactly the rows the domain rule names stale, with one event each", async () => {
    const cases: SqlRow[] = [
      { key: "a", status: ItemStatus.InProgress, heartbeat_at: ago(200), doc_status_at: null, live_status_at: ago(300) },
      { key: "b", status: ItemStatus.Blocked, heartbeat_at: ago(200), doc_status_at: ago(400), live_status_at: ago(300) },
      { key: "c", status: ItemStatus.InProgress, heartbeat_at: ago(60), doc_status_at: null, live_status_at: ago(300) },
      { key: "d", status: ItemStatus.InProgress, heartbeat_at: ago(200), doc_status_at: ago(100), live_status_at: ago(300) },
      { key: "e", status: ItemStatus.InProgress, heartbeat_at: ago(200), doc_status_at: ago(300), live_status_at: null },
      { key: "f", status: ItemStatus.Open, heartbeat_at: ago(200), doc_status_at: null, live_status_at: ago(300) },
      { key: "g", status: ItemStatus.Done, heartbeat_at: ago(200), doc_status_at: null, live_status_at: ago(300) },
      { key: "h", status: ItemStatus.InProgress, heartbeat_at: ago(16), doc_status_at: null, live_status_at: ago(300), agent: SESSION_AGENT },
      { key: "i", status: ItemStatus.InProgress, heartbeat_at: ago(14), doc_status_at: null, live_status_at: ago(300), agent: SESSION_AGENT },
      { key: "j", status: ItemStatus.InProgress, heartbeat_at: ago(16), doc_status_at: null, live_status_at: ago(300), agent: "Implementer" },
    ];
    for (const row of cases) await insertRow(row);
    const repo = new D1ItemRepository(env.DB);
    const { stale: turned } = await markStaleItems(repo, MINUTES, { now: () => NOW });
    const expected = cases.filter((row) => isExpired(row, MINUTES, NOW)).map((row) => row.key);
    expect(expected).toEqual(["a", "b", "h"]);
    expect(turned).toBe(3);
    for (const row of cases) {
      expect(await statusOf(row.key)).toBe(expected.includes(row.key) ? "stale" : row.status);
    }
    const events = await env.DB.prepare("SELECT item_key, at, status, note FROM events ORDER BY item_key").all();
    expect(events.results).toEqual(
      expected.map((key) => ({ item_key: key, at: NOW.toISOString(), status: "stale", note: "Heartbeat expired" })),
    );
  });
});

describe("the cron trigger", () => {
  it("marks a killed session's item stale and keeps heartbeat_at for the label", async () => {
    await callTool("report_progress", { ...ITEM, status: "in_progress" });
    const heartbeat = ago(180);
    await setHeartbeat(ITEM.key, heartbeat);
    await runCron();
    const item = (await callTool("get_item", { key: ITEM.key })).data as { status: string; heartbeat_at: string; events: { status: string; note: string | null }[] };
    expect(item.status).toBe("stale");
    expect(item.heartbeat_at).toBe(heartbeat);
    expect(item.events[0]).toMatchObject({ status: "stale", note: "Heartbeat expired" });
  });

  it("leaves a fresh heartbeat alone and writes no event", async () => {
    await callTool("report_progress", { ...ITEM, status: "in_progress" });
    const before = await countRows("events");
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("in_progress");
    expect(await countRows("events")).toBe(before);
  });

  it("run twice, writes one stale event only", async () => {
    await callTool("report_progress", { ...ITEM, status: "in_progress" });
    await setHeartbeat(ITEM.key, ago(180));
    await runCron();
    const after = await countRows("events");
    await runCron();
    expect(await countRows("events")).toBe(after);
  });

  it("uses staleAfterMinutes from BOARD_CONFIG", async () => {
    await callTool("report_progress", { ...ITEM, status: "in_progress" });
    await setHeartbeat(ITEM.key, ago(90));
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("in_progress");
    const controller = createScheduledController({ scheduledTime: NOW, cron: "*/15 * * * *" });
    const ctx = createExecutionContext();
    await worker.scheduled(controller, { ...env, BOARD_CONFIG: '{"staleAfterMinutes":60}' });
    await waitOnExecutionContext(ctx);
    expect(await statusOf(ITEM.key)).toBe("stale");
  });

  it("never touches an item only doc sync set", async () => {
    await callTool("sync_snapshot", {
      project: "demo-app",
      items: [{ key: ITEM.key, project: "demo-app", type: "slice", title: "Sample slice", status: "in_progress" }],
    });
    await setHeartbeat(ITEM.key, ago(900));
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("in_progress");
  });
});

describe("recovery after stale", () => {
  async function makeStale(status: string): Promise<void> {
    await callTool("report_progress", { ...ITEM, status });
    await setHeartbeat(ITEM.key, ago(180));
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("stale");
  }

  it("a report with a status brings the item back and writes the recovery event", async () => {
    await makeStale("in_progress");
    const reply = await callTool("report_progress", { key: ITEM.key, status: "in_progress" });
    expect(reply.data).toMatchObject({ status: "in_progress" });
    const detail = (await callTool("get_item", { key: ITEM.key })).data as { events: { status: string }[] };
    expect(detail.events.slice(0, 2).map((e) => e.status)).toEqual(["in_progress", "stale"]);
  });

  it("a heartbeat-only report brings a stale blocked item back to blocked", async () => {
    await makeStale("blocked");
    const reply = await callTool("report_progress", { key: ITEM.key });
    expect(reply.data).toMatchObject({ status: "blocked" });
    const detail = (await callTool("get_item", { key: ITEM.key })).data as { events: { status: string }[] };
    expect(detail.events[0]).toMatchObject({ status: "blocked" });
  });

  async function addEvent(status: string, at: string, source: string | null): Promise<void> {
    await env.DB.prepare("INSERT INTO events (item_key, at, status, source, note) VALUES (?1, ?2, ?3, ?4, NULL)")
      .bind(ITEM.key, at, status, source)
      .run();
  }

  it("a heartbeat-only report returns a blocked item to blocked when doc-sync events sit in its history", async () => {
    await callTool("report_progress", { ...ITEM, status: "blocked" });
    await addEvent("open", ago(500), "doc-sync");
    await setHeartbeat(ITEM.key, ago(180));
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("stale");
    await callTool("report_progress", { key: ITEM.key });
    expect(await statusOf(ITEM.key)).toBe("blocked");
  });

  it("a heartbeat-only report falls back to in_progress when the status the cron replaced was not live", async () => {
    await callTool("report_progress", { ...ITEM, status: "blocked" });
    await addEvent("done", ago(-1440), "doc-sync");
    await env.DB.prepare("UPDATE items SET status = 'stale' WHERE key = ?").bind(ITEM.key).run();
    await callTool("report_progress", { key: ITEM.key });
    expect(await statusOf(ITEM.key)).toBe("in_progress");
  });

  it("a client-set stale item with no live history comes back as in_progress", async () => {
    await callTool("report_progress", { ...ITEM, status: "stale" });
    await callTool("report_progress", { key: ITEM.key });
    expect(await statusOf(ITEM.key)).toBe("in_progress");
  });

  it("a report that lands before the cron keeps the item live", async () => {
    await callTool("report_progress", { ...ITEM, status: "in_progress" });
    await setHeartbeat(ITEM.key, ago(180));
    await callTool("report_progress", { key: ITEM.key, note: "Still working" });
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("in_progress");
  });

  it("a done report on a stale item closes it and the cron leaves it done", async () => {
    await makeStale("in_progress");
    await callTool("report_progress", { key: ITEM.key, status: "done" });
    expect(await statusOf(ITEM.key)).toBe("done");
    await runCron();
    expect(await statusOf(ITEM.key)).toBe("done");
  });
});

describe("the expiry query's index (Slice 34)", () => {
  const plan = async (sql: string, binds: string[]): Promise<string[]> => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>();
    return results.map((row) => row.detail);
  };

  it("plans: EXPIRED_ROWS seeks idx_items_status_heartbeat by status and heartbeat and never scans items", async () => {
    const lines = await plan(`SELECT key FROM items WHERE ${EXPIRED_ROWS}`, [ago(120), NOW.toISOString(), "note", ago(15)]);
    expect(lines.join("\n")).toMatch(/idx_items_status_heartbeat \(status=\? AND heartbeat_at<\?\)/);
    expect(lines.filter((line) => line.startsWith("SCAN items"))).toEqual([]);
  });

  it("plans: WAITING_ROWS seeks the partial index of open waiting cards and never scans items", async () => {
    const lines = await plan(`SELECT key FROM items WHERE ${WAITING_ROWS}`, [ago(1440)]);
    expect(lines.join("\n")).toMatch(/idx_items_waiting_open/);
    expect(lines.filter((line) => line.startsWith("SCAN items"))).toEqual([]);
  });

  it("lists in EXPIRED_ROWS the statuses of EXPIRING_STATUSES", () => {
    for (const status of EXPIRING_STATUSES) expect(EXPIRED_ROWS).toContain(`'${status}'`);
  });

  it("still turns the same rows stale with the extra bound in the query", async () => {
    await insertRow({ key: "far", status: ItemStatus.InProgress, heartbeat_at: ago(10_000), doc_status_at: null, live_status_at: ago(10_001) });
    await insertRow({ key: "near", status: ItemStatus.Blocked, heartbeat_at: ago(121), doc_status_at: null, live_status_at: ago(300) });
    await insertRow({ key: "fresh", status: ItemStatus.InProgress, heartbeat_at: ago(5), doc_status_at: null, live_status_at: ago(300) });
    expect(await markStaleItems(new D1ItemRepository(env.DB), MINUTES, { now: () => NOW })).toEqual({ stale: 2, waitingClosed: 0 });
  });
});

describe("movesLiveStatus (SQL) agrees with the domain rule (Slice 34)", () => {
  const cases = [
    { name: "a status from an agent", input: { status: "blocked", source: "agent" }, statusGiven: true, source: "agent", stored: "in_progress" },
    { name: "a status with no source", input: { status: "blocked" }, statusGiven: true, source: undefined, stored: "in_progress" },
    { name: "a status from doc sync", input: { status: "blocked", source: "doc-sync" }, statusGiven: true, source: "doc-sync", stored: "in_progress" },
    { name: "no status on a live item", input: { why: "x" }, statusGiven: false, source: undefined, stored: "in_progress" },
    { name: "no status on a stale item (revival)", input: { why: "x" }, statusGiven: false, source: undefined, stored: "stale" },
  ];

  it("a status-less report older than the heartbeat revives nothing and moves nothing", async () => {
    const first = "2020-01-01T00:00:00.000Z";
    const future = "2099-01-01T00:00:00.000Z";
    await insertRow({ key: ITEM.key, status: ItemStatus.InProgress, heartbeat_at: future, doc_status_at: null, live_status_at: first });
    await env.DB.prepare("UPDATE items SET status = 'stale' WHERE key = ?1").bind(ITEM.key).run();
    await callTool("report_progress", { key: ITEM.key, why: "x" });
    const row = await env.DB.prepare("SELECT status, live_status_at FROM items WHERE key = ?1").bind(ITEM.key).first<{ status: string; live_status_at: string }>();
    expect(row).toEqual({ status: "stale", live_status_at: first });
    expect(movesLiveStatus({ statusGiven: false }, ItemStatus.Stale, false)).toBe(false);
  });

  for (const c of cases) {
    it(`${c.name}`, async () => {
      const first = "2020-01-01T00:00:00.000Z";
      await insertRow({ key: ITEM.key, status: ItemStatus.InProgress, heartbeat_at: first, doc_status_at: null, live_status_at: first });
      await env.DB.prepare("UPDATE items SET status = ?2 WHERE key = ?1").bind(ITEM.key, c.stored).run();
      await callTool("report_progress", { key: ITEM.key, ...c.input });
      const row = await env.DB.prepare("SELECT live_status_at FROM items WHERE key = ?1").bind(ITEM.key).first<{ live_status_at: string }>();
      const expected = movesLiveStatus({ statusGiven: c.statusGiven, source: c.source }, c.stored as ItemStatus);
      expect(row?.live_status_at !== first).toBe(expected);
    });
  }
});

describe("waiting cards with no slice behind them (Slice 34)", () => {
  const WAITING = { key: "chats/session-1", project: "chats", type: "waiting_for_me", title: "Which colour?" };
  const SLICE_KEY = "demo-app/slice-7";
  const waiting = (over: Record<string, unknown> = {}) => callTool("report_progress", { ...WAITING, status: "open", ...over });
  const hoursAgo = (hours: number): string => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

  it("closes a chat's waiting card at 24 hours and leaves it open at 23, with one history row", async () => {
    await waiting();
    await setHeartbeat(WAITING.key, hoursAgo(23));
    await runCron();
    expect(await statusOf(WAITING.key)).toBe("open");
    await setHeartbeat(WAITING.key, hoursAgo(24.02));
    await runCron();
    expect(await statusOf(WAITING.key)).toBe("done");
    const events = await env.DB.prepare("SELECT status, note FROM events WHERE item_key = ?1 ORDER BY id DESC").bind(WAITING.key).all();
    expect(events.results[0]).toEqual({ status: "done", note: WAITING_CLOSED_NOTE });
    await runCron();
    expect(await countRows("events")).toBe(events.results.length);
  });

  it("counts the closed waiting cards apart from the stale ones", async () => {
    await waiting();
    await setHeartbeat(WAITING.key, hoursAgo(25));
    const result = await markStaleItems(new D1ItemRepository(env.DB), MINUTES, { now: () => NOW });
    expect(result).toEqual({ stale: 0, waitingClosed: 1 });
  });

  it("keeps a waiting card whose parent_key is a slice or a part, however old", async () => {
    await callTool("report_progress", { key: SLICE_KEY, project: "demo-app", type: "slice", title: "Slice 7" });
    await callTool("report_progress", { key: `${SLICE_KEY}/part-A`, project: "demo-app", type: "part", title: "Part", parent_key: SLICE_KEY });
    await callTool("report_progress", { key: "demo-app/bug-1", project: "demo-app", type: "bug", title: "A bug" });
    await waiting({ key: "demo-app/wait-slice", project: "demo-app", parent_key: SLICE_KEY });
    await waiting({ key: "demo-app/wait-part", project: "demo-app", parent_key: `${SLICE_KEY}/part-A` });
    await waiting({ key: "demo-app/wait-bug", project: "demo-app", parent_key: "demo-app/bug-1" });
    for (const key of ["demo-app/wait-slice", "demo-app/wait-part", "demo-app/wait-bug"]) await setHeartbeat(key, hoursAgo(30));
    await runCron();
    expect(await statusOf("demo-app/wait-slice")).toBe("open");
    expect(await statusOf("demo-app/wait-part")).toBe("open");
    expect(await statusOf("demo-app/wait-bug")).toBe("done");
  });

  it("keeps a waiting card the doc sync made", async () => {
    await waiting();
    await env.DB.prepare("UPDATE items SET in_doc_sync = 1 WHERE key = ?1").bind(WAITING.key).run();
    await setHeartbeat(WAITING.key, hoursAgo(30));
    await runCron();
    expect(await statusOf(WAITING.key)).toBe("open");
  });

  it("restarts the 24 hours with a report on the card", async () => {
    await waiting();
    await setHeartbeat(WAITING.key, hoursAgo(30));
    await waiting({ why: "Still waiting" });
    await runCron();
    expect(await statusOf(WAITING.key)).toBe("open");
  });

  it("agrees with isWaitingClosable", async () => {
    const rows = [
      { type: ItemType.WaitingForMe, status: ItemStatus.Open, heartbeat_at: hoursAgo(25), in_doc_sync: false, parent_type: null },
      { type: ItemType.WaitingForMe, status: ItemStatus.Open, heartbeat_at: hoursAgo(25), in_doc_sync: false, parent_type: ItemType.Slice },
      { type: ItemType.WaitingForMe, status: ItemStatus.Open, heartbeat_at: hoursAgo(25), in_doc_sync: false, parent_type: ItemType.Part },
      { type: ItemType.WaitingForMe, status: ItemStatus.Open, heartbeat_at: hoursAgo(25), in_doc_sync: false, parent_type: ItemType.Bug },
      { type: ItemType.WaitingForMe, status: ItemStatus.Open, heartbeat_at: hoursAgo(25), in_doc_sync: true, parent_type: null },
      { type: ItemType.WaitingForMe, status: ItemStatus.Open, heartbeat_at: hoursAgo(23), in_doc_sync: false, parent_type: null },
      { type: ItemType.WaitingForMe, status: ItemStatus.Done, heartbeat_at: hoursAgo(25), in_doc_sync: false, parent_type: null },
      { type: ItemType.Bug, status: ItemStatus.Open, heartbeat_at: hoursAgo(25), in_doc_sync: false, parent_type: null },
    ];
    const expected = rows.map((row) => isWaitingClosable(row, NOW));
    expect(expected).toEqual([true, false, false, true, false, false, false, false]);
    for (const [index, row] of rows.entries()) {
      const key = `rule-${index}`;
      if (row.parent_type) {
        await env.DB.prepare(
          `INSERT INTO items (key, project, type, priority, status, title, links, heartbeat_at, created_at, updated_at)
           VALUES (?1, 'p', ?2, 'P2', 'open', 'T', '[]', ?3, ?3, ?3)`,
        ).bind(`parent-${index}`, row.parent_type, row.heartbeat_at).run();
      }
      await env.DB.prepare(
        `INSERT INTO items (key, project, type, priority, status, title, links, heartbeat_at, created_at, updated_at, in_doc_sync, parent_key)
         VALUES (?1, 'p', ?2, 'P2', ?3, 'T', '[]', ?4, ?4, ?4, ?5, ?6)`,
      ).bind(key, row.type, row.status, row.heartbeat_at, row.in_doc_sync ? 1 : 0, row.parent_type ? `parent-${index}` : null).run();
    }
    const closable = await env.DB.prepare(`SELECT key FROM items WHERE key LIKE 'rule-%' AND ${WAITING_ROWS} ORDER BY key`)
      .bind(hoursAgo(24))
      .all<{ key: string }>();
    expect(closable.results.map((r) => r.key)).toEqual(rows.flatMap((_, i) => (expected[i] ? [`rule-${i}`] : [])));
  });
});
