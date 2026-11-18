import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { boardResponse } from "../src/api/board";
import type { BoardResponse } from "../src/api/boardDto";
import { configFromRecord } from "../src/config";
import { ANSWERED_NOTE, ItemStatus, NEEDS_YOU_NOTE_PREFIX, NOTE_SEPARATOR } from "../src/domain/item";
import { hasOpenQuestion, SESSION_AGENT } from "../src/domain/stale";
import { checkReport, MAX_AFTER_ANSWER, MAX_NEEDS_YOU, withQuestion } from "../src/domain/upsert";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, resetBoard } from "./helpers";

const NOW = new Date();
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const KEY = "example-app/session-4f2a";
const SESSION = { key: KEY, project: "example-app", type: "unplanned", title: "Find the device", agent: "session" };
const QUESTION = "Which iPhone should I read the crash log from?";

interface Stored {
  needs_you: string | null;
  after_answer: string | null;
  needs_you_at: string | null;
  status: string;
  events: { note: string | null }[];
}

async function stored(key = KEY): Promise<Stored> {
  return (await callTool("get_item", { key })).data as Stored;
}

beforeEach(resetBoard);

describe("withQuestion (the question rules)", () => {
  const asked = { needs_you: QUESTION, needs_you_at: "2026-11-17T10:00:00.000Z", status: ItemStatus.Blocked };
  const askedInProgress = { ...asked, status: ItemStatus.InProgress };
  const NOW_ISO = "2026-11-17T10:30:00.000Z";

  it("stamps a new question now and writes a history note with its first line", () => {
    const out = withQuestion({ key: "k", needs_you: "First line\nSecond" }, null, NOW_ISO);
    expect(out).toMatchObject({ needs_you_at: NOW_ISO, note: `${NEEDS_YOU_NOTE_PREFIX}First line` });
  });

  it("keeps the first-asked time and adds no note when the same text is sent again", () => {
    const out = withQuestion({ key: "k", needs_you: QUESTION }, asked, NOW_ISO);
    expect(out.needs_you_at).toBe(asked.needs_you_at);
    expect(out.note).toBeUndefined();
  });

  it("clears the question, its after-text and its time on null, in progress and done, noting the answer once", () => {
    for (const input of [{ needs_you: null }, { status: ItemStatus.InProgress }, { status: ItemStatus.Done }]) {
      expect(withQuestion({ key: "k", ...input }, asked, NOW_ISO)).toMatchObject({
        needs_you: null, after_answer: null, needs_you_at: null, note: ANSWERED_NOTE,
      });
    }
    expect(withQuestion({ key: "k", status: ItemStatus.InProgress }, null, NOW_ISO).note).toBeUndefined();
  });

  it("leaves the question alone on a heartbeat, a blocked status or an open one", () => {
    for (const input of [{}, { status: ItemStatus.Blocked }, { status: ItemStatus.Open }]) {
      expect(withQuestion({ key: "k", ...input }, asked, NOW_ISO)).toEqual({ key: "k", ...input });
    }
  });

  it("keeps the question when an in-progress item is reported in progress again (a step tick or hook)", () => {
    const input = { key: "k", status: ItemStatus.InProgress, note: "Reading the logs" };
    expect(withQuestion(input, askedInProgress, NOW_ISO)).toEqual(input);
    expect(withQuestion({ key: "k", status: ItemStatus.Done }, askedInProgress, NOW_ISO)).toMatchObject({ needs_you: null, note: ANSWERED_NOTE });
    expect(withQuestion({ key: "k", needs_you: null }, askedInProgress, NOW_ISO)).toMatchObject({ needs_you: null, note: ANSWERED_NOTE });
  });

  it("clears the question and writes 'answered' when a stale item moves to in progress", () => {
    const resume = { key: "k", status: ItemStatus.InProgress };
    expect(withQuestion(resume, { ...asked, status: ItemStatus.Stale }, NOW_ISO)).toMatchObject({
      needs_you: null, after_answer: null, needs_you_at: null, note: ANSWERED_NOTE,
    });
    expect(withQuestion(resume, askedInProgress, NOW_ISO)).toEqual(resume);
    expect(withQuestion({ key: "k", needs_you: null }, askedInProgress, NOW_ISO)).toMatchObject({ needs_you: null });
  });

  it("writes the server's marker and keeps the caller's own note beside it", () => {
    const answer = withQuestion({ key: "k", status: ItemStatus.InProgress, note: "Reading the logs" }, asked, NOW_ISO);
    expect(answer.note).toBe(`${ANSWERED_NOTE}${NOTE_SEPARATOR}Reading the logs`);
    const ask = withQuestion({ key: "k", needs_you: "Which?", note: "Asking" }, null, NOW_ISO);
    expect(ask.note).toBe(`${NEEDS_YOU_NOTE_PREFIX}Which?${NOTE_SEPARATOR}Asking`);
  });

  it("checks the lengths and reads a blank question as none", () => {
    expect(() => checkReport({ key: "k", needs_you: "x".repeat(MAX_NEEDS_YOU + 1) })).toThrow("needs_you");
    expect(() => checkReport({ key: "k", after_answer: "x".repeat(MAX_AFTER_ANSWER + 1) })).toThrow("after_answer");
    expect(checkReport({ key: "k", needs_you: "  " }).needs_you).toBeNull();
  });
});

describe("report_progress with a question", () => {
  it("sets needs_you, after_answer and needs_you_at on the same card and keeps the time on a resend", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress" });
    await callTool("report_progress", { key: KEY, needs_you: QUESTION, after_answer: "I read the log." });
    const first = await stored();
    expect(first).toMatchObject({ needs_you: QUESTION, after_answer: "I read the log.", status: "in_progress" });
    expect(first.needs_you_at).toEqual(expect.any(String));
    expect(first.events[0]?.note).toBe(`${NEEDS_YOU_NOTE_PREFIX}${QUESTION}`);
    await callTool("report_progress", { key: KEY, needs_you: QUESTION });
    expect((await stored()).needs_you_at).toBe(first.needs_you_at);
  });

  it("clears the question when a report moves the card to in progress, and records the answer", async () => {
    await callTool("report_progress", { ...SESSION, status: "blocked", needs_you: QUESTION });
    await callTool("report_progress", { key: KEY, status: "in_progress" });
    const after = await stored();
    expect(after).toMatchObject({ needs_you: null, after_answer: null, needs_you_at: null });
    expect(after.events[0]?.note).toBe(ANSWERED_NOTE);
  });

  it("keeps the question when an in-progress card is reported in progress again", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", needs_you: QUESTION });
    const first = await stored();
    await callTool("report_progress", { key: KEY, status: "in_progress", note: "Reading the logs" });
    expect(await stored()).toMatchObject({ needs_you: QUESTION, needs_you_at: first.needs_you_at });
  });

  it("clears it on null and on done, and a plain heartbeat keeps it", async () => {
    await callTool("report_progress", { ...SESSION, needs_you: QUESTION });
    await callTool("report_progress", { key: KEY, note: "still here" });
    expect((await stored()).needs_you).toBe(QUESTION);
    await callTool("report_progress", { key: KEY, needs_you: null });
    expect((await stored()).needs_you).toBeNull();
    await callTool("report_progress", { key: KEY, needs_you: QUESTION });
    await callTool("mark_done", { key: KEY });
    expect((await stored()).needs_you).toBeNull();
  });

  it("refuses a question over the limit", async () => {
    const reply = await callTool("report_progress", { ...SESSION, needs_you: "x".repeat(MAX_NEEDS_YOU + 1) });
    expect(reply.isError).toBe(true);
  });

  it("refuses a blank question, and a blank why on ask_human keeps the open question", async () => {
    await callTool("report_progress", { ...SESSION, needs_you: QUESTION });
    for (const blank of ["", "   "]) {
      expect((await callTool("report_progress", { key: KEY, needs_you: blank })).isError).toBe(true);
    }
    expect((await stored()).needs_you).toBe(QUESTION);
    const before = await stored();
    await callTool("ask_human", { key: KEY, project: "example-app", title: "Pick one", why: "  " });
    expect(await stored()).toMatchObject({ needs_you: QUESTION, needs_you_at: before.needs_you_at });
  });

  it("ask_human refuses a part and a doc-synced item, and asks with the title when nothing is open", async () => {
    const PART = { key: "example-app/slice-1/part-A", project: "example-app", type: "part", title: "Part A" };
    await callTool("report_progress", PART);
    const part = await callTool("ask_human", { key: PART.key, project: "example-app", title: "Q" });
    expect(part.isError).toBe(true);
    await callTool("report_progress", { ...SESSION, status: "in_progress" });
    await env.DB.prepare("UPDATE items SET in_doc_sync = 1 WHERE key = ?1").bind(KEY).run();
    expect((await callTool("ask_human", { key: KEY, project: "example-app", title: "Q" })).isError).toBe(true);
    await env.DB.prepare("UPDATE items SET in_doc_sync = 0 WHERE key = ?1").bind(KEY).run();
    await callTool("ask_human", { key: KEY, project: "example-app", title: "Pick one", why: "  " });
    expect((await stored()).needs_you).toBe("Pick one");
  });

  it("ask_human with no text does not resurrect a question whose expiry has passed", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", needs_you: QUESTION });
    await env.DB.prepare("UPDATE items SET heartbeat_at = ?1, status = 'stale' WHERE key = ?2").bind(ago(130), KEY).run();
    await callTool("ask_human", { key: KEY, project: "example-app", title: "Pick one" });
    expect((await stored()).needs_you).toBe("Pick one");
  });

  it("ask_human on another type clears with needs_you null, and keeps why beside a needs_you", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", needs_you: QUESTION });
    await callTool("ask_human", { key: KEY, project: "example-app", title: "Q", needs_you: null });
    expect(await stored()).toMatchObject({ needs_you: null, needs_you_at: null });
    await callTool("ask_human", { key: KEY, project: "example-app", title: "Q", needs_you: "Which?", why: "Context" });
    const row = await env.DB.prepare("SELECT why, needs_you FROM items WHERE key = ?1").bind(KEY).first<{ why: string; needs_you: string }>();
    expect(row).toEqual({ why: "Context", needs_you: "Which?" });
  });

  it("ask_human with only why sets the question and leaves the item's stored why unchanged", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", why: "The item's own goal" });
    await callTool("ask_human", { key: KEY, project: "example-app", title: "Q", why: "Which one?" });
    const row = await env.DB.prepare("SELECT why, needs_you FROM items WHERE key = ?1").bind(KEY).first<{ why: string; needs_you: string }>();
    expect(row).toEqual({ why: "The item's own goal", needs_you: "Which one?" });
  });

  it("measures needs_you on its trimmed text", async () => {
    expect(checkReport({ key: "k", needs_you: `${"x".repeat(MAX_NEEDS_YOU)}\n` }).needs_you).toHaveLength(MAX_NEEDS_YOU);
  });

  it("ask_human sets needs_you and links on its own waiting_for_me item", async () => {
    const key = "example-app/waiting-1";
    await callTool("ask_human", { key, project: "example-app", title: "Approve", needs_you: "Merge it?", links: [{ label: "PR", url: "https://example.com/pr" }] });
    const row = await env.DB.prepare("SELECT needs_you, links FROM items WHERE key = ?1").bind(key).first<{ needs_you: string; links: string }>();
    expect(row?.needs_you).toBe("Merge it?");
    expect(row?.links).toContain("https://example.com/pr");
  });

  it("does not store a question on an item reported done", async () => {
    await callTool("report_progress", { ...SESSION, status: "done", needs_you: QUESTION });
    expect((await stored()).needs_you).toBeNull();
  });
});

describe("the board DTO carries the question and the card's data", () => {
  async function board(now: Date = NOW): Promise<BoardResponse> {
    const config = configFromRecord({});
    const response = await boardResponse(new D1ItemRepository(env.DB), config, { now: () => now });
    return (await response.json()) as BoardResponse;
  }

  it("returns needs_you, after_answer and needs_you_at, with the session fields as data", async () => {
    await callTool("report_progress", {
      ...SESSION, status: "in_progress", parent: "session 4f2a", environment: "laptop", why: "For Slice 12",
      steps: [{ label: "Ask", state: "active" }], details_md: "Found two devices", needs_you: QUESTION, after_answer: "Read it.",
    });
    const [item] = (await board()).items;
    expect(item).toMatchObject({
      needs_you: QUESTION, after_answer: "Read it.", parent: "session 4f2a", environment: "laptop", agent: SESSION_AGENT,
      details_md: "Found two devices", why: "For Slice 12", working: true,
    });
    expect(item?.needs_you_at).toEqual(expect.any(String));
    expect(item?.heartbeat_at).toEqual(expect.any(String));
    expect(item?.steps).toHaveLength(1);
  });

  it("keeps a stale session card's question until the configured expiry, then drops it", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", needs_you: QUESTION });
    await env.DB.prepare("UPDATE items SET heartbeat_at = ?1, status = 'stale' WHERE key = ?2").bind(ago(30), KEY).run();
    const stale = (await board()).items[0]!;
    expect(stale).toMatchObject({ needs_you: QUESTION, working: false });
    await env.DB.prepare("UPDATE items SET heartbeat_at = ?1 WHERE key = ?2").bind(ago(130), KEY).run();
    expect((await board()).items[0]).toMatchObject({ needs_you: null, after_answer: null, needs_you_at: null });
  });

  it("shows no question and no working-now for a done item that still has a live in_progress row", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", steps: [{ label: "Ask", state: "active" }], needs_you: QUESTION });
    await env.DB.prepare("UPDATE items SET status = 'done', done_at = ?2, doc_status = 'done', in_doc_sync = 1 WHERE key = ?1").bind(KEY, ago(1)).run();
    expect((await board()).items[0]).toMatchObject({ status: "done", needs_you: null, working: false });
  });

  it("counts a working card with an open question in working_count too, and never counts a check", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress", steps: [{ label: "Ask", state: "active" }], needs_you: QUESTION });
    const asking = await board();
    expect(asking.items[0]).toMatchObject({ needs_you: QUESTION, working: true });
    expect(asking.working_count).toBe(1);
    await callTool("report_progress", { key: "example-app/slice-1", project: "example-app", type: "slice", title: "Slice 1" });
    const check = { key: "example-app/slice-1/check-1", project: "example-app", type: "check", parent_key: "example-app/slice-1", title: "Check", agent: "session", status: "in_progress", steps: [{ label: "Go", state: "active" }], needs_you: "Which?" };
    await callTool("report_progress", check);
    const after = await board();
    expect(after.items.find((item) => item.key === check.key)).toMatchObject({ working: false, parent_slice: { key: "example-app/slice-1" } });
    expect(after.working_count).toBe(1);
  });

  it("takes a session card out of working now after 15 minutes", async () => {
    await callTool("report_progress", { ...SESSION, status: "in_progress" });
    await env.DB.prepare("UPDATE items SET heartbeat_at = ?1 WHERE key = ?2").bind(ago(16), KEY).run();
    expect((await board()).items[0]?.working).toBe(false);
    await env.DB.prepare("UPDATE items SET heartbeat_at = ?1 WHERE key = ?2").bind(ago(14), KEY).run();
    expect((await board()).items[0]?.working).toBe(true);
  });
});

describe("hasOpenQuestion", () => {
  const row = { needs_you: QUESTION, status: ItemStatus.InProgress, heartbeat_at: ago(30) };

  it("holds while the heartbeat is inside the configured expiry and the item is not done", () => {
    expect(hasOpenQuestion(row, 120, NOW)).toBe(true);
    expect(hasOpenQuestion({ ...row, heartbeat_at: ago(130) }, 120, NOW)).toBe(false);
    expect(hasOpenQuestion({ ...row, status: ItemStatus.Done }, 120, NOW)).toBe(false);
    expect(hasOpenQuestion({ ...row, needs_you: null }, 120, NOW)).toBe(false);
  });
});

describe("ask_human on an existing item of another type", () => {
  it("ignores project and links, keeping the stored ones", async () => {
    await callTool("report_progress", { ...SESSION, links: [{ label: "doc", url: "https://example.com/a" }] });
    await callTool("ask_human", { key: KEY, title: "x", project: "other-app", links: [], needs_you: QUESTION });
    const item = (await callTool("get_item", { key: KEY })).data as { project: string; links: unknown[]; needs_you: string };
    expect(item.project).toBe("example-app");
    expect(item.links).toHaveLength(1);
    expect(item.needs_you).toBe(QUESTION);
  });
});
