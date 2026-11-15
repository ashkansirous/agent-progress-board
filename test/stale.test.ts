import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markStaleItems } from "../src/application/board";
import worker from "../src/index";
import { ItemStatus } from "../src/domain/item";
import { type ExpiryRow, isExpired, staleCutoff } from "../src/domain/stale";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
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
});

interface SqlRow extends ExpiryRow {
  key: string;
}

async function insertRow(row: SqlRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO items (key, project, type, priority, status, title, links, heartbeat_at, created_at, updated_at,
       live_status_at, doc_status_at, in_doc_sync)
     VALUES (?1, 'demo-app', 'slice', 'P2', ?2, 'T', '[]', ?3, ?3, ?3, ?4, ?5, ?6)`,
  )
    .bind(row.key, row.status, row.heartbeat_at, row.live_status_at, row.doc_status_at, row.doc_status_at ? 1 : 0)
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
    ];
    for (const row of cases) await insertRow(row);
    const repo = new D1ItemRepository(env.DB);
    const turned = await markStaleItems(repo, MINUTES, { now: () => NOW });
    const expected = cases.filter((row) => isExpired(row, MINUTES, NOW)).map((row) => row.key);
    expect(expected).toEqual(["a", "b"]);
    expect(turned).toBe(2);
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
