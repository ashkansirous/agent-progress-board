import { describe, expect, it } from "vitest";
import type { BoardItemDto } from "../src/api/boardDto";
import { ANSWERED_NOTE, HEARTBEAT_NOTE, ItemStatus, ItemType, NEEDS_YOU_NOTE_PREFIX, NOTE_SEPARATOR, Priority } from "../src/domain/item";
import {
  doneSoFar,
  hasNoGoal,
  historyWords,
  isQuestion,
  isStaleSession,
  isWorkingCard,
  opensCardDrawer,
  questionStart,
  sessionLabel,
  waitingText,
} from "../web/src/cards";
import { StepState } from "../src/domain/stepTypes";
import { groupBoard } from "../src/domain/boardGroups";
import { translator } from "../web/src/strings";

const NOW = Date.parse("2026-11-17T13:48:00.000Z");
const t = translator("en");

function item(over: Partial<BoardItemDto>): BoardItemDto {
  return {
    key: "p/x", project: "p", parent: null, parent_slice: null, parent_key: null, slice: null, checks: null, type: ItemType.Unplanned, priority: Priority.P2,
    status: ItemStatus.InProgress, title: "T", why: null, details_md: null, links: [], heartbeat_at: "2026-11-17T13:46:00.000Z",
    created_at: "2026-11-17T13:00:00.000Z", done_at: null, environment: null, environment_label: null, agent: "session",
    model: null, needs_you: null, after_answer: null, needs_you_at: null, steps: null, progress: null, working: true, parts: null,
    parts_progress: null, active_part_key: null, events: [], ...over,
  };
}

describe("which card a session item is", () => {
  const working = item({ key: "p/w" });
  const asking = item({ key: "p/q", needs_you: "Which?", needs_you_at: "2026-11-17T13:42:00.000Z" });
  const staleStored = item({ key: "p/s", status: ItemStatus.Stale, working: false });
  const staleRead = item({ key: "p/r", working: false });

  it("sorts a session item into exactly one of working, question or stale", () => {
    expect([working, asking, staleStored, staleRead].map((i) => [isWorkingCard(i), isQuestion(i), isStaleSession(i)])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [false, false, true],
    ]);
  });

  it("keeps a stale card with a question under Needs you, and takes a plain item with a question there too", () => {
    const staleAsking = item({ status: ItemStatus.Stale, working: false, needs_you: "Q?" });
    expect(isQuestion(staleAsking)).toBe(true);
    expect(isStaleSession(staleAsking)).toBe(false);
    const slice = item({ type: ItemType.Slice, agent: null, working: false, needs_you: "Q?" });
    expect(isQuestion(slice)).toBe(true);
    expect(opensCardDrawer(slice)).toBe(true);
  });

  it("opens the card drawer only for a session item or a question", () => {
    expect(opensCardDrawer(item({ agent: null, working: false }))).toBe(false);
    expect(opensCardDrawer(item({ agent: "Implementer" }))).toBe(false);
    expect(opensCardDrawer(working)).toBe(true);
  });

  it("is not a card for a done session item or a part", () => {
    expect(isStaleSession(item({ status: ItemStatus.Done, working: false }))).toBe(false);
    expect(opensCardDrawer(item({ type: ItemType.Part, agent: "session" }))).toBe(false);
  });
});

describe("grouping session cards", () => {
  const items = [
    item({ key: "p/w", heartbeat_at: "2026-11-17T13:40:00.000Z" }),
    item({ key: "p/w2", heartbeat_at: "2026-11-17T13:45:00.000Z" }),
    item({ key: "p/q2", needs_you: "Second", needs_you_at: "2026-11-17T13:30:00.000Z" }),
    item({ key: "p/q1", needs_you: "First", needs_you_at: "2026-11-17T13:10:00.000Z" }),
    item({ key: "p/s", status: ItemStatus.Stale, working: false }),
    item({ key: "p/old", type: ItemType.WaitingForMe, agent: null, status: ItemStatus.Open, working: false }),
    item({ key: "p/tile", type: ItemType.Slice, agent: null, working: false }),
    item({ key: "p/d", status: ItemStatus.Done, working: false, done_at: "2026-11-17T12:00:00.000Z" }),
  ];

  it("puts each card in its own list and none twice", () => {
    const group = groupBoard(items, [], ["p"])[0]!;
    expect(group.needs_you).toEqual(["p/q1", "p/q2", "p/old"]);
    expect(group.working_now).toEqual(["p/w2", "p/w"]);
    expect(group.planned.map((s) => s.key)).toEqual(["p/tile"]);
    expect(group.done.recent.map((row) => [row.key, row.stale])).toEqual([["p/s", true], ["p/d", false]]);
    expect(group.other).toEqual([]);
  });

  it("shows a project that has only a question", () => {
    expect(groupBoard([items[3]!], [], ["p"])).toHaveLength(1);
  });
});

describe("card words", () => {
  it("labels a session '<parent> · <environment label>', the raw value with no label, the key with neither", () => {
    expect(sessionLabel(item({ parent: "session 9c1e", environment: "laptop", environment_label: "Laptop" }))).toBe("session 9c1e · Laptop");
    expect(sessionLabel(item({ parent: "wave 3", environment: "edge", environment_label: null }))).toBe("wave 3 · edge");
    expect(sessionLabel(item({ key: "p/k" }))).toBe("p/k");
    expect(sessionLabel(item({ key: "demo-app/waiting-sess-9" }))).toBe("session sess");
    expect(sessionLabel(item({ key: "demo-app/waiting-sess-9", environment: "laptop", environment_label: "Laptop" }))).toBe("session sess · Laptop");
  });

  it("says how long a question has waited, in minutes then hours, and nothing without a first-asked time", () => {
    expect(waitingText(item({ needs_you_at: "2026-11-17T13:42:00.000Z" }), NOW, t)).toBe("waiting 6 min");
    expect(waitingText(item({ needs_you_at: "2026-11-17T13:48:00.000Z" }), NOW, t)).toBe("waiting 1 min");
    expect(waitingText(item({ needs_you_at: "2026-11-17T03:40:00.000Z" }), NOW, t)).toBe("waiting 10 h");
    expect(waitingText(item({ needs_you_at: "2026-11-17T03:40:00.000Z" }), NOW, translator("de"))).toBe("wartet seit 10 Std.");
    expect(waitingText(item({ needs_you_at: null }), NOW, t)).toBeNull();
  });

  it("reads no goal as no purpose, no steps and a fallback title, and a real title, purpose or steps as a goal", () => {
    expect(hasNoGoal(item({ title: "main · p", why: null, steps: null }))).toBe(true);
    expect(hasNoGoal(item({ title: "Read the crash log", why: null, steps: null }))).toBe(false);
    expect(hasNoGoal(item({ why: "For Slice 12" }))).toBe(false);
    expect(hasNoGoal(item({ steps: [{ label: "A", state: StepState.Active, note: null }] }))).toBe(false);
  });

  it("turns details_md lines into plain bullets", () => {
    expect(doneSoFar(item({ details_md: "- Connected\n* Found logs\n\nPlain line" }))).toEqual(["Connected", "Found logs", "Plain line"]);
    expect(doneSoFar(item({ details_md: null }))).toEqual([]);
  });

  it("cuts a long question at a word with an ellipsis and leaves a short one whole", () => {
    expect(questionStart("Short one?")).toBe("Short one?");
    const cut = questionStart("Which iPhone should I read the crash log from: the iPhone 8 or the iPad?");
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(46);
    expect(cut).toBe("Which iPhone should I read the crash log…");
  });
});

describe("history in plain words", () => {
  const event = (status: ItemStatus, note: string | null) => ({ at: "2026-11-17T09:20:00.000Z", status, note });

  it("words each kind of row as the owner reads it", () => {
    expect(historyWords(event(ItemStatus.InProgress, null), t)).toBe("Started");
    expect(historyWords(event(ItemStatus.InProgress, `${NEEDS_YOU_NOTE_PREFIX}Which phone?`), t)).toBe("Needs you: Which phone?");
    expect(historyWords(event(ItemStatus.InProgress, ANSWERED_NOTE), t)).toBe("Answered");
    expect(historyWords(event(ItemStatus.Done, null), t)).toBe("Finished turn");
    expect(historyWords(event(ItemStatus.InProgress, HEARTBEAT_NOTE), t)).toBe("Last activity");
    expect(historyWords(event(ItemStatus.Stale, "Heartbeat expired"), t)).toBe("Stale: no activity for 15 min");
    expect(historyWords(event(ItemStatus.InProgress, "Reading the logs"), t)).toBe("Reading the logs");
  });

  it("keeps the caller's own note beside the server's marker", () => {
    expect(historyWords(event(ItemStatus.InProgress, `${ANSWERED_NOTE}${NOTE_SEPARATOR}Reading the logs`), t)).toBe("Answered · Reading the logs");
    const asked = `${NEEDS_YOU_NOTE_PREFIX}Which phone?${NOTE_SEPARATOR}Asking`;
    expect(historyWords(event(ItemStatus.InProgress, asked), t)).toBe("Needs you: Which phone? · Asking");
  });

  it("keeps a question that contains ' | ' whole", () => {
    const asked = `${NEEDS_YOU_NOTE_PREFIX}Use A | B or C?${NOTE_SEPARATOR}Asking | now`;
    expect(historyWords(event(ItemStatus.InProgress, asked), t)).toBe("Needs you: Use A | B or C? · Asking | now");
    const answered = `${ANSWERED_NOTE}${NOTE_SEPARATOR}Checked A | B`;
    expect(historyWords(event(ItemStatus.InProgress, answered), t)).toBe("Answered · Checked A | B");
  });

  it("sorts a question with no asked time last, in the server's groups (the page never sorts)", () => {
    const timed = item({ key: "p/t", needs_you: "Q", needs_you_at: "2026-11-17T10:00:00.000Z" });
    const untimed = item({ key: "p/u", needs_you: "Q", needs_you_at: null });
    expect(groupBoard([untimed, timed], [], ["p"])[0]!.needs_you).toEqual(["p/t", "p/u"]);
  });

  it("has the German words too", () => {
    const de = translator("de");
    expect(historyWords(event(ItemStatus.InProgress, ANSWERED_NOTE), de)).toBe("Beantwortet");
    expect(historyWords(event(ItemStatus.Stale, null), de)).toContain("15");
  });
});
