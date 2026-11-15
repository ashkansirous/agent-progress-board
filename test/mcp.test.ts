import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { route } from "../src/api/router";
import { type Item, ItemStatus } from "../src/domain/item";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, countRows, postMcp, READ_TOKEN, resetBoard, WRITE_TOKEN } from "./helpers";

interface BoardItem {
  key: string;
  parent: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  heartbeat_at: string;
  events: { note: string | null; status: string }[];
}

const SLICE = {
  key: "demo-app/slice-1",
  project: "demo-app",
  type: "slice",
  title: "Sample slice",
  parent: "Wave 3",
};

beforeEach(resetBoard);

describe("auth", () => {
  it("answers 401 without a token or with a wrong one", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await postMcp(body)).status).toBe(401);
    expect((await postMcp(body, "nope")).status).toBe(401);
  });

  it("lets the read token read and refuses a write without writing", async () => {
    const refused = await callTool("report_progress", SLICE, READ_TOKEN);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("read-only");
    expect(await countRows("items")).toBe(0);
    expect((await callTool("list_open", {}, READ_TOKEN)).isError).toBe(false);
  });
});

describe("report_progress", () => {
  it("creates once, then updates the same row with a heartbeat event", async () => {
    await callTool("report_progress", SLICE);
    const again = await callTool("report_progress", SLICE);
    expect(await countRows("items")).toBe(1);
    const item = again.data as BoardItem;
    expect(item.parent).toBe("Wave 3");
    expect(item.updated_at).toBe(item.created_at);
    const detail = (await callTool("get_item", { key: SLICE.key })).data as BoardItem;
    expect(detail.events.map((e) => e.note)).toEqual(["Heartbeat", null]);
  });

  it("names the field for an unknown enum value and writes nothing", async () => {
    const reply = await callTool("report_progress", { ...SLICE, status: "sleeping" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("status");
    expect(await countRows("items")).toBe(0);
  });

  it("names the missing field for a new key", async () => {
    const reply = await callTool("report_progress", { key: "demo-app/x", project: "demo-app", type: "bug" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("title");
  });
});

describe("report_progress safety", () => {
  it("keeps both callers' fields when two reports on one new key overlap", async () => {
    await Promise.all([
      callTool("report_progress", { ...SLICE, why: "Because" }),
      callTool("report_progress", { ...SLICE, parent: undefined, priority: "P0" }),
    ]);
    const item = (await callTool("get_item", { key: SLICE.key })).data as BoardItem & Record<string, unknown>;
    expect(item).toMatchObject({ parent: "Wave 3", why: "Because", priority: "P0" });
    expect(await countRows("items")).toBe(1);
  });

  it("keeps a status change when a field-only report overlaps it", async () => {
    await callTool("report_progress", SLICE);
    await Promise.all([
      callTool("report_progress", { key: SLICE.key, status: "done" }),
      callTool("report_progress", { key: SLICE.key, why: "Late reason" }),
    ]);
    const item = (await callTool("get_item", { key: SLICE.key })).data as BoardItem & Record<string, unknown>;
    expect(item).toMatchObject({ status: "done", why: "Late reason" });
    expect(item.done_at).not.toBeNull();
  });

  it("writes the right note when a no-change report follows a concurrent change", async () => {
    const repo = new D1ItemRepository(env.DB);
    const created = await callTool("report_progress", SLICE);
    const stale = created.data as Item;
    const input = { key: SLICE.key, status: ItemStatus.Blocked };
    await repo.save({ insert: stale, input, now: "2026-11-15T11:00:00.000Z" });
    const second = await repo.save({ insert: stale, input, now: "2026-11-15T12:00:00.000Z" });
    expect(second).toMatchObject({ status: "blocked", updated_at: "2026-11-15T11:00:00.000Z" });
    const detail = (await callTool("get_item", { key: SLICE.key })).data as BoardItem;
    expect(detail.events).toHaveLength(3);
    expect(detail.events.filter((e) => e.note === "Heartbeat")).toHaveLength(1);
  });

  it("clears an optional field with null, keeps it when omitted", async () => {
    await callTool("report_progress", {
      ...SLICE,
      why: "Because",
      details_md: "Details",
      source: "agent",
      links: [{ label: "x", url: "https://example.com" }],
    });
    const kept = (await callTool("report_progress", { key: SLICE.key, note: "Ping" })).data;
    expect(kept).toMatchObject({ parent: "Wave 3", why: "Because", details_md: "Details", source: "agent" });
    const cleared = (
      await callTool("report_progress", {
        key: SLICE.key,
        parent: null,
        why: null,
        details_md: null,
        links: null,
        source: null,
      })
    ).data;
    expect(cleared).toMatchObject({ parent: null, why: null, details_md: null, links: [], source: null });
    const stored = (await callTool("get_item", { key: SLICE.key })).data as BoardItem;
    expect(stored).toMatchObject({ parent: null });
    expect(stored.updated_at).not.toBe(stored.created_at);
  });

  it("rejects an empty string for note, why, details_md and parent, naming the field", async () => {
    for (const field of ["note", "why", "details_md", "parent"]) {
      const reply = await callTool("report_progress", { ...SLICE, [field]: "" });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(field);
    }
    expect(await countRows("items")).toBe(0);
  });

  it("keeps done_at on a repeat done and clears it on reopening", async () => {
    await callTool("report_progress", SLICE);
    const done = (await callTool("mark_done", { key: SLICE.key })).data as BoardItem;
    const again = (await callTool("mark_done", { key: SLICE.key })).data as BoardItem;
    expect(again.done_at).toBe(done.done_at);
    const reopened = (await callTool("report_progress", { key: SLICE.key, status: "open" })).data as BoardItem;
    expect(reopened.done_at).toBeNull();
  });

  it("rejects non-http links and writes nothing", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "nope"]) {
      const reply = await callTool("report_progress", { ...SLICE, links: [{ label: "x", url }] });
      expect(reply.isError).toBe(true);
    }
    expect(await countRows("items")).toBe(0);
  });

  it("still writes when BOARD_CONFIG is broken", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("http://example.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${WRITE_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "report_progress", arguments: SLICE },
      }),
    });
    const response = await route(
      request,
      { BOARD_WRITE_TOKEN: WRITE_TOKEN, BOARD_CONFIG: "null" },
      { repo: new D1ItemRepository(env.DB), clock: { now: () => new Date() } },
    );
    expect(response.status).toBe(200);
    expect(await countRows("items")).toBe(1);
    log.mockRestore();
  });

  it("lists open items with an out-of-range max_hours or window_hours", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await callTool("report_progress", SLICE);
    for (const args of [{}, { window_hours: 1e12 }]) {
      const request = new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${READ_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_open", arguments: args },
        }),
      });
      const response = await route(
        request,
        { BOARD_READ_TOKEN: READ_TOKEN, BOARD_CONFIG: '{"window":{"max_hours":1e12}}' },
        { repo: new D1ItemRepository(env.DB), clock: { now: () => new Date() } },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("internal error");
    }
    log.mockRestore();
  });

  it("answers 405 with Allow: POST for other methods", async () => {
    const response = await exports.default.fetch("http://example.com/mcp", { method: "GET" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe("mark_done, ask_human, get_item", () => {
  it("ask_human refuses an existing non-waiting_for_me key and writes nothing", async () => {
    await callTool("report_progress", SLICE);
    const reply = await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("key");
    const item = (await callTool("get_item", { key: SLICE.key })).data as BoardItem & { type: string };
    expect(item.type).toBe("slice");
    expect(item.events).toHaveLength(1);
  });

  it("a repeat ask_human reopens a done waiting_for_me item", async () => {
    const ask = { key: "demo-app/ask-2", project: "demo-app", title: "Approve" };
    await callTool("ask_human", ask);
    await callTool("mark_done", { key: ask.key });
    const again = (await callTool("ask_human", ask)).data as BoardItem;
    expect(again.status).toBe("open");
    expect(again.done_at).toBeNull();
  });

  it("marks done, sets done_at and errors for an unknown key", async () => {
    await callTool("report_progress", SLICE);
    const done = (await callTool("mark_done", { key: SLICE.key, note: "Shipped" })).data as BoardItem;
    expect(done.status).toBe("done");
    expect(done.done_at).not.toBeNull();
    expect((await callTool("mark_done", { key: "demo-app/none" })).isError).toBe(true);
  });

  it("ask_human creates a waiting_for_me item with the mock's fields", async () => {
    const reply = await callTool("ask_human", {
      key: "demo-app/ask-1",
      project: "demo-app",
      title: "Approve the store text",
      priority: "P1",
      why: "Needs the owner's login",
      links: [{ label: "Console", url: "https://example.com/console" }],
    });
    expect(reply.data).toMatchObject({ type: "waiting_for_me", status: "open", priority: "P1" });
  });

  it("get_item returns an item with all events, newest first", async () => {
    await callTool("report_progress", SLICE);
    await callTool("report_progress", { key: SLICE.key, status: "in_progress", note: "Started" });
    const detail = (await callTool("get_item", { key: SLICE.key })).data as BoardItem;
    expect(detail.events.map((e) => e.status)).toEqual(["in_progress", "open"]);
  });
});

describe("list_open", () => {
  it("returns open items and recent done items, not old done ones", async () => {
    await callTool("report_progress", SLICE);
    await callTool("report_progress", { ...SLICE, key: "demo-app/slice-2", title: "Done now" });
    await callTool("mark_done", { key: "demo-app/slice-2" });
    await seedOldDone("demo-app/slice-3");
    const items = (await callTool("list_open", {})).data as BoardItem[];
    expect(items.map((i) => i.key).sort()).toEqual(["demo-app/slice-1", "demo-app/slice-2"]);
    expect(items.every((i) => i.events.length > 0)).toBe(true);
  });

  it("returns an item done inside the window and drops one done before it", async () => {
    await seedDone("demo-app/inside", 6);
    await seedDone("demo-app/outside", 20);
    const items = (await callTool("list_open", {})).data as BoardItem[];
    expect(items.map((i) => i.key)).toEqual(["demo-app/inside"]);
    const wider = (await callTool("list_open", { window_hours: 24 })).data as BoardItem[];
    expect(wider.map((i) => i.key).sort()).toEqual(["demo-app/inside", "demo-app/outside"]);
  });

  it("caps the window at the configured max and filters by project and type", async () => {
    await seedOldDone("demo-app/slice-3");
    expect(((await callTool("list_open", { window_hours: 100000 })).data as BoardItem[]).length).toBe(0);
    await callTool("report_progress", SLICE);
    await callTool("report_progress", { ...SLICE, key: "other/bug-1", project: "other", type: "bug" });
    const bugs = (await callTool("list_open", { type: "bug" })).data as BoardItem[];
    expect(bugs.map((i) => i.key)).toEqual(["other/bug-1"]);
    const demo = (await callTool("list_open", { project: "demo-app" })).data as BoardItem[];
    expect(demo.map((i) => i.key)).toEqual(["demo-app/slice-1"]);
  });

  it("limits events per item to the latest 20", async () => {
    await callTool("report_progress", SLICE);
    for (let i = 0; i < 25; i++) await callTool("report_progress", { key: SLICE.key, note: `n${i}` });
    const [item] = (await callTool("list_open", {})).data as BoardItem[];
    expect(item?.events).toHaveLength(20);
    expect(item?.events[0]?.note).toBe("n24");
    const detail = (await callTool("get_item", { key: SLICE.key })).data as BoardItem;
    expect(detail.events).toHaveLength(26);
  });
});

async function seedOldDone(key: string): Promise<void> {
  await seedDone(key, 200);
}

async function seedDone(key: string, hoursAgo: number): Promise<void> {
  const old = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO items (key, project, type, priority, status, title, heartbeat_at, created_at, updated_at, done_at)
     VALUES (?1, 'demo-app', 'slice', 'P2', 'done', 'Old', ?2, ?2, ?2, ?2)`,
  )
    .bind(key, old)
    .run();
}

describe("raw http", () => {
  it("works as a plain POST without initialize", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 7, method: "tools/list" }, WRITE_TOKEN);
    const json = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(json.result.tools.map((t) => t.name).sort()).toEqual([
      "ask_human",
      "get_item",
      "list_open",
      "mark_done",
      "report_progress",
    ]);
  });
});
