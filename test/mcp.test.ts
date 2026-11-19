import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Item, ItemStatus } from "../src/domain/item";
import { newItem, type ReportInput } from "../src/domain/upsert";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { fitItem, fitList, MAX_RESULT_CHARS } from "../src/mcp/tools";
import { callTool, countRows, fetchWithEnv, postMcp, READ_TOKEN, resetBoard, WRITE_TOKEN } from "./helpers";

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
  }, 30_000); // the first call of the file starts the Worker: slow beside another suite (Slice 45)

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
    await repo.save({ insert: stale, input, now: "2099-11-15T11:00:00.000Z" });
    const second = await repo.save({ insert: stale, input, now: "2099-11-15T12:00:00.000Z" });
    expect(second).toMatchObject({ status: "blocked", updated_at: "2099-11-15T11:00:00.000Z" });
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
    const request = new Request("https://example.com/mcp", {
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
    const response = await fetchWithEnv(request, { BOARD_CONFIG: "null" });
    expect(response.status).toBe(200);
    expect(await countRows("items")).toBe(1);
    log.mockRestore();
  });

  it("ask_human creating a waiting item does not read the config, so a bad one cannot fail it (Slice 45)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${WRITE_TOKEN}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "ask_human", arguments: { key: "demo-app/ask-1", project: "demo-app", title: "Pick one", needs_you: "Which?" } },
      }),
    });
    const response = await fetchWithEnv(request, { BOARD_CONFIG: "{ not json" });
    expect(response.status).toBe(200);
    expect(await countRows("items")).toBe(1);
    log.mockRestore();
  });

  it("lists open items with an out-of-range max_hours or window_hours", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await callTool("report_progress", SLICE);
    for (const args of [{}, { window_hours: 1e12 }]) {
      const request = new Request("https://example.com/mcp", {
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
      const response = await fetchWithEnv(request, { BOARD_CONFIG: '{"window":{"max_hours":1e12}}' });
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

describe("outcome (Slice 41)", () => {
  it("stores the outcome, keeps it on a later report that omits it, and clears it with null", async () => {
    await callTool("report_progress", { ...SLICE, status: "in_progress", outcome: "Code merged to main" });
    const first = (await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>;
    expect(first.outcome).toBe("Code merged to main");
    await callTool("report_progress", { key: SLICE.key, status: "in_progress" });
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>).outcome).toBe("Code merged to main");
    await callTool("report_progress", { key: SLICE.key, outcome: null });
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>).outcome).toBeNull();
  });

  it("refuses an outcome over 200 characters and makes a blank one null", async () => {
    const tooLong = await callTool("report_progress", { ...SLICE, outcome: "x".repeat(201) });
    expect(tooLong.isError).toBe(true);
    const blank = await callTool("report_progress", { ...SLICE, outcome: "   " });
    expect(blank.isError).toBe(false);
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>).outcome).toBeNull();
  });
});

describe("mark_done, ask_human, get_item", () => {
  it("ask_human on an existing item of another type sets needs_you on it and keeps its type, title and status", async () => {
    await callTool("report_progress", { ...SLICE, status: "in_progress" });
    const reply = await callTool("ask_human", {
      key: SLICE.key, project: "demo-app", title: "Q", why: "Which phone?", after_answer: "I read its log.",
    });
    expect(reply.isError).toBe(false);
    const item = (await callTool("get_item", { key: SLICE.key })).data as BoardItem & Record<string, unknown>;
    expect(item).toMatchObject({
      type: "slice", status: "in_progress", title: SLICE.title, needs_you: "Which phone?", after_answer: "I read its log.",
    });
    expect(item.needs_you_at).toEqual(expect.any(String));
    expect(item.events[0]?.note).toBe("needs_you: Which phone?");
  });

  it("ask_human on another type keeps every stored field and ignores links the ask sends", async () => {
    await callTool("report_progress", { ...SLICE, status: "in_progress", priority: "P1", details_md: "Kept", source: "agent" });
    await callTool("ask_human", {
      key: SLICE.key, project: "demo-app", title: "Q", why: "Which phone?", links: [{ label: "Log", url: "https://example.com/log" }],
    });
    const item = (await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>;
    expect(item).toMatchObject({ priority: "P1", details_md: "Kept", source: "agent", links: [] });
    expect(item.needs_you).toBe("Which phone?");
  });

  it("a new ask replaces after_answer, keeps the stored one only for the same question, and clears it on null (Slice 45)", async () => {
    await callTool("report_progress", { ...SLICE, status: "in_progress" });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", why: "First?", after_answer: "Then deploy" });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", why: "First?" });
    const repeated = (await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>;
    expect(repeated).toMatchObject({ needs_you: "First?", after_answer: "Then deploy" });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", why: "Second?" });
    const changed = (await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>;
    expect(changed).toMatchObject({ needs_you: "Second?", after_answer: null });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", needs_you: "Third?", after_answer: "Then test" });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", needs_you: "Third?" });
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>)).toMatchObject({ needs_you: "Third?", after_answer: "Then test" });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", needs_you: "Fourth?" });
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>)).toMatchObject({ needs_you: "Fourth?", after_answer: null });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", needs_you: "Fifth?", after_answer: null });
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>)).toMatchObject({ needs_you: "Fifth?", after_answer: null });
  });

  it("Slice 45 #8: a blank needs_you with no why on an item of another type is refused (by the schema) and changes nothing", async () => {
    await callTool("report_progress", { ...SLICE, status: "in_progress" });
    await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", why: "Which phone?" });
    const blank = await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q", needs_you: "   " });
    expect(blank.isError).toBe(true);
    expect(blank.text).toContain("needs_you");
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>).needs_you).toBe("Which phone?");
  });

  it("ask_human on a done item of another type is an error result naming that it is done", async () => {
    await callTool("report_progress", SLICE);
    await callTool("mark_done", { key: SLICE.key });
    const reply = await callTool("ask_human", { key: SLICE.key, project: "demo-app", title: "Q" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("is done");
    expect(((await callTool("get_item", { key: SLICE.key })).data as Record<string, unknown>).needs_you).toBeNull();
  });

  it("ask_human on an unplanned key asks with the title when why is missing, and creates a waiting_for_me item for a missing key", async () => {
    await callTool("report_progress", { key: "demo-app/s", project: "demo-app", type: "unplanned", title: "Session goal" });
    await callTool("ask_human", { key: "demo-app/s", project: "demo-app", title: "Session goal" });
    const session = (await callTool("get_item", { key: "demo-app/s" })).data as Record<string, unknown>;
    expect(session).toMatchObject({ type: "unplanned", needs_you: "Session goal" });
    await callTool("ask_human", { key: "demo-app/new", project: "demo-app", title: "Approve" });
    const created = (await callTool("get_item", { key: "demo-app/new" })).data as Record<string, unknown>;
    expect(created).toMatchObject({ type: "waiting_for_me", status: "open", needs_you: null });
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

describe("step text at the tool boundary", () => {
  it("measures a step label and note after trimming, and refuses a whitespace-only label", async () => {
    const padded = { label: `  ${"l".repeat(80)}  `, state: "active", note: ` ${"n".repeat(120)} ` };
    const ok = await callTool("report_progress", { ...SLICE, steps: [padded] });
    expect(ok.isError).toBeFalsy();
    const blank = await callTool("report_progress", { ...SLICE, steps: [{ label: "   ", state: "pending" }] });
    expect(blank.isError).toBe(true);
  });
});

describe("result size limit", () => {
  /** The length of the reply a client receives for a fit result: data block plus note block. */
  function replyLength(fit: unknown): number {
    const reply = fit as { data?: unknown; note?: string };
    if (typeof reply.note === "string") return JSON.stringify(reply.data).length + reply.note.length;
    return JSON.stringify(fit).length;
  }

  it("fitList returns entries that already fit unchanged", () => {
    const entries = [{ key: "a" }, { key: "b" }];
    expect(fitList(entries)).toBe(entries);
  });

  it("fitList cuts one huge entry's long strings so the final reply is within the limit", () => {
    const entry = { key: "k", why: "y".repeat(80_000), events: [{ note: "n".repeat(80_000) }] };
    const fit = fitList([entry]);
    expect(replyLength(fit)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect((fit as { data: { key: string }[] }).data[0]!.key).toBe("k");
  });

  it("fitList falls back to an empty list with a note when no cut of the first entry fits", () => {
    const entry = Object.fromEntries(Array.from({ length: 3000 }, (_, n) => [`field_${n}`, "v".repeat(30)]));
    const fit = fitList([entry]);
    expect(replyLength(fit)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
  });

  it("fitList drops trailing entries of many so the final reply is within the limit", () => {
    const entries = Array.from({ length: 400 }, (_, n) => ({ key: `k${n}`, why: "w".repeat(400) }));
    const fit = fitList(entries) as { data: unknown[]; note: string };
    expect(fit.data.length).toBeLessThan(entries.length);
    expect(fit.data.length).toBeGreaterThan(0);
    expect(replyLength(fit)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(fit.note).toMatch(new RegExp(`^truncated: ${fit.data.length} of 400 items shown`));
    expect(fit.note).toContain(`(${400 - fit.data.length} dropped, first dropped key k${fit.data.length}; ask for it with get_item)`);
  });

  it("fitList's last-resort clip keeps key, project and time fields whole and cuts only free text", () => {
    const entry = { key: `p/${"k".repeat(60)}`, project: "p".repeat(60), updated_at: "2026-11-17T10:00:00.000Z", why: "y".repeat(80_000), events: [{ at: "2026-11-17T10:00:00.000Z", note: "n".repeat(80_000) }] };
    const out = (fitList([entry]) as { data: (typeof entry)[] }).data[0]!;
    expect(out.key).toBe(entry.key);
    expect(out.project).toBe(entry.project);
    expect(out.updated_at).toBe(entry.updated_at);
    expect(out.events[0]!.at).toBe(entry.events[0]!.at);
    expect(out.why.length).toBeLessThan(entry.why.length);
  });

  it("fitItem keeps the newest events and the final reply within the limit, for a huge item and for a huge history", () => {
    const huge = { key: "k", details_md: "d".repeat(90_000), events: [{ note: "n".repeat(90_000) }, { note: "m" }] };
    expect(replyLength(fitItem(huge))).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const history = { key: "k", events: Array.from({ length: 300 }, (_, n) => ({ n, note: "x".repeat(500) })) };
    const fit = fitItem(history) as { data: { events: { n: number }[] } };
    expect(replyLength(fit)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(fit.data.events[0]!.n).toBe(0);
    expect(fit.data.events.length).toBeLessThan(300);
  });

  it("Slice 45 #1: a clipped oversize reply keeps every link url whole", () => {
    const links = Array.from({ length: 2 }, (_, n) => ({ label: "l".repeat(300), url: `https://example.com/${n}/${"u".repeat(3000)}` }));
    const entry = { key: "k", why: "y".repeat(80_000), links };
    const out = (fitList([entry]) as { data: { links: { url: string }[] }[] }).data[0]!;
    expect(out.links.map((link) => link.url)).toEqual(links.map((link) => link.url));
  });

  it("Slice 46 review #7: an oversize reply with no links at all never says links were dropped, and links make it say so", () => {
    const bare = Object.fromEntries(Array.from({ length: 3000 }, (_, n) => [`field_${n}`, "v".repeat(30)]));
    const none = fitList([{ key: "k", ...bare }]) as { note?: string };
    expect(replyLength(none)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(none.note ?? "").not.toContain("links were dropped");
    const links = Array.from({ length: 5 }, (_, n) => ({ label: `l${n}`, url: `https://example.com/${n}/${"u".repeat(20_000)}` }));
    const withLinks = fitList([{ key: "k", title: "Kept", links }]) as { note: string };
    expect(withLinks.note).toContain("links were dropped");
  });

  it("Slice 45 #2: when links cannot fit, the last resort drops every link and the item stays listed", () => {
    const links = Array.from({ length: 5 }, (_, n) => ({ label: `l${n}`, url: `https://example.com/${n}/${"u".repeat(20_000)}` }));
    const entry = { key: "k", project: "p", title: "Kept", status: "open", links };
    const fit = fitList([entry, { key: "k2", title: "Second" }]) as { data: { key: string; title: string; links: { url: string }[] }[]; note: string };
    expect(replyLength(fit)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(fit.data[0]).toMatchObject({ key: "k", title: "Kept", status: "open", links: [] });
    expect(fit.note).toContain("links were dropped");
    const item = fitItem({ ...entry, events: [{ note: "n" }] }) as { data: { key: string; title: string; status: string }; note: string };
    expect(replyLength(item)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(item.data).toMatchObject({ key: "k", title: "Kept", status: "open" });
  });

  it("Slice 45 #3: a huge item keeps its key, title and status in the cut reply", () => {
    const fields = Object.fromEntries(Array.from({ length: 3000 }, (_, n) => [`field_${n}`, "v".repeat(30)]));
    const huge = { key: "k", project: "p", title: "Huge item", status: "in_progress", ...fields, events: [{ note: "n" }] };
    const fit = fitItem(huge) as { data: Record<string, unknown>; note: string };
    expect(replyLength(fit)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(fit.data).toMatchObject({ key: "k", title: "Huge item", status: "in_progress" });
    expect(fit.note).toContain("key, title and status");
  });

  it("list_open keeps the whole reply under the size limit when one item alone is huge", async () => {
    await callTool("report_progress", { ...SLICE, details_md: "d".repeat(9000) });
    for (let n = 0; n < 12; n++) await callTool("report_progress", { key: SLICE.key, note: `${n}-${"x".repeat(9000)}` });
    const response = await postMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_open", arguments: {} } },
      WRITE_TOKEN,
    );
    const { content } = ((await response.json()) as { result: { content: { text: string }[] } }).result;
    expect(content.reduce((sum, block) => sum + block.text.length, 0)).toBeLessThanOrEqual(MAX_RESULT_CHARS);
  });

  it("get_item cuts a huge history to the newest events and says so in a second block", async () => {
    await callTool("report_progress", SLICE);
    for (let n = 0; n < 14; n++) await callTool("report_progress", { key: SLICE.key, note: `${n}-${"x".repeat(19_000)}` });
    const response = await postMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_item", arguments: { key: SLICE.key } } },
      WRITE_TOKEN,
    );
    const { content } = ((await response.json()) as { result: { content: { text: string }[] } }).result;
    expect(content).toHaveLength(2);
    expect(content[1]!.text).toMatch(/^truncated: \d+ of \d+ events shown/);
    expect((JSON.parse(content[0]!.text) as BoardItem).events.length).toBeLessThan(15);
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
    expect(items.every((i) => !("parentSlice" in i) && !("expiry" in i) && !("docSync" in i))).toBe(true);
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
      "report_cap",
      "report_progress",
      "report_usage",
      "sync_snapshot",
    ]);
  });
});

describe("a delayed request and the history (Slice 34)", () => {
  const FIRST = "2099-01-01T10:00:00.000Z";
  const LATER = "2099-01-01T10:30:00.000Z";
  const EARLIER = "2099-01-01T10:10:00.000Z";
  const ITEM = { key: "demo-app/slice-1", status: ItemStatus.InProgress };
  /** What `save` inserts for a new key; the first call of each test creates the item with it, later ones find it stored. */
  const create = { ...SLICE, ...ITEM } as unknown as ReportInput;
  const seed = newItem(create, FIRST);

  async function stored(): Promise<{ heartbeat_at: string; updated_at: string; live_status_at: string | null }> {
    return (await env.DB.prepare("SELECT heartbeat_at, updated_at, live_status_at FROM items WHERE key = ?1")
      .bind(SLICE.key)
      .first())!;
  }

  async function notes(): Promise<(string | null)[]> {
    const { results } = await env.DB.prepare("SELECT note FROM events WHERE item_key = ?1 ORDER BY at, id")
      .bind(SLICE.key)
      .all<{ note: string | null }>();
    return results.map((row) => row.note);
  }

  it("keeps the later heartbeat_at, updated_at and live_status_at when a delayed request arrives", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: LATER });
    await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Blocked }, now: EARLIER });
    expect(await stored()).toEqual({ heartbeat_at: LATER, updated_at: LATER, live_status_at: LATER });
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: EARLIER });
    expect((await stored()).heartbeat_at).toBe(LATER);
  });

  it("still moves the times forward for a request that is newer", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Blocked }, now: LATER });
    expect(await stored()).toEqual({ heartbeat_at: LATER, updated_at: LATER, live_status_at: LATER });
  });

  it("never moves the status back for a delayed request: the later report wins for the status too", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: LATER });
    const saved = await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Blocked }, now: EARLIER });
    expect(saved.status).toBe(ItemStatus.InProgress);
    const newest = await env.DB.prepare("SELECT status FROM events WHERE item_key = ?1 ORDER BY at DESC, id DESC LIMIT 1")
      .bind(SLICE.key)
      .first<{ status: string }>();
    expect(newest?.status).toBe(ItemStatus.InProgress);
    // The dropped older status is named in its history row (Slice 34 follow-up #9), no longer a bare Heartbeat.
    expect(await notes()).toEqual(["Older status report ignored", null]);
  });

  it("does not say the status report was ignored when the same report also changed the title (Slice 47 review #3)", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: LATER });
    await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Blocked, title: "A new title" }, now: EARLIER });
    expect(await notes()).toEqual([null, null]);
  });

  it("applies an earlier status report that a later no-status heartbeat overtook (compared with live_status_at)", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: LATER });
    const saved = await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Done }, now: EARLIER });
    expect(saved.status).toBe(ItemStatus.Done);
    expect((await stored()).heartbeat_at).toBe(LATER);
  });

  it("gives a delayed report that changed the title its own history row, which a heartbeat never merges away", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: LATER });
    await repo.save({ insert: seed, input: { key: SLICE.key, title: "Renamed" }, now: EARLIER });
    expect(await notes()).toEqual([null, null, "Heartbeat"]);
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: "2099-01-01T11:00:00.000Z" });
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: "2099-01-01T11:01:00.000Z" });
    expect(await notes()).toEqual([null, null, "Heartbeat"]);
  });

  it("coalesces nothing when a save lost its compare-and-swap", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: LATER });
    await expect(
      repo.save({ insert: seed, input: { key: SLICE.key }, now: "2099-01-01T11:00:00.000Z", ifStepsText: "[\"stale\"]" }),
    ).rejects.toThrow();
    expect(await notes()).toEqual([null, "Heartbeat"]);
  });

  it("still applies a status given by a request that is newer", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    const saved = await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Blocked }, now: LATER });
    expect(saved.status).toBe(ItemStatus.Blocked);
    expect(await notes()).toEqual([null, null]);
  });

  it("coalesces a run of heartbeats into one history row that moves forward", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    for (const minute of [11, 12, 13, 14]) {
      await repo.save({ insert: seed, input: { key: SLICE.key }, now: `2099-01-01T10:${minute}:00.000Z` });
    }
    expect(await notes()).toEqual([null, "Heartbeat"]);
    const last = await env.DB.prepare("SELECT at FROM events WHERE note = 'Heartbeat'").first<{ at: string }>();
    expect(last?.at).toBe("2099-01-01T10:14:00.000Z");
    await repo.save({ insert: seed, input: { key: SLICE.key, status: ItemStatus.Blocked }, now: "2099-01-01T10:20:00.000Z" });
    await repo.save({ insert: seed, input: { key: SLICE.key }, now: "2099-01-01T10:21:00.000Z" });
    expect(await notes()).toEqual([null, "Heartbeat", null, "Heartbeat"]);
  });

  it("moves live_status_at when a report with no status revives a stale item", async () => {
    const repo = new D1ItemRepository(env.DB);
    await repo.save({ insert: seed, input: create, now: FIRST });
    await env.DB.prepare("UPDATE items SET status = 'stale', doc_status_at = ?2 WHERE key = ?1").bind(SLICE.key, LATER).run();
    const revived = await repo.save({ insert: seed, input: { key: SLICE.key }, now: "2099-01-01T11:00:00.000Z" });
    expect(revived.status).toBe("in_progress");
    expect((await stored()).live_status_at).toBe("2099-01-01T11:00:00.000Z");
  });
});
