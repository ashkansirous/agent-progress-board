import { describe, expect, it } from "vitest";
import type { BoardItemDto } from "../src/api/boardDto";
import { ANSWERED_NOTE, HEARTBEAT_NOTE, ItemStatus, ItemType, NEEDS_YOU_NOTE_PREFIX, NOTE_SEPARATOR, Priority } from "../src/domain/item";
import {
  cardLabel,
  doneSoFar,
  fillBoardAddress,
  historyWords,
  isOwnerStep,
  isQuestion,
  isStaleSession,
  isWorkingCard,
  opensCardDrawer,
  ownerStepDetails,
  cardQuestion,
  linkBoardAddress,
  ownerStepFallback,
  purposeText,
  questionStart,
  resolveBoardAddress,
  sessionLabel,
  stepUrls,
  withoutBoardPages,
  waitingText,
} from "../web/src/cards";
import { groupBoard } from "../src/domain/boardGroups";
import { translator } from "../web/src/strings";

const NOW = Date.parse("2026-11-17T13:48:00.000Z");
const t = translator();

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
    expect(sessionLabel(item({ parent: "session 9c1e", environment: "laptop", environment_label: "Laptop" }), t)).toBe("session 9c1e · Laptop");
    expect(sessionLabel(item({ parent: "wave 3", environment: "edge", environment_label: null }), t)).toBe("wave 3 · edge");
    expect(sessionLabel(item({ key: "p/k" }), t)).toBe("p/k");
    expect(sessionLabel(item({ key: "demo-app/waiting-sess-9" }), t)).toBe("session sess");
    expect(sessionLabel(item({ key: "demo-app/waiting-sess-9", environment: "laptop", environment_label: "Laptop" }), t)).toBe("session sess · Laptop");
  });

  it("labels a card with an outcome by what it is: 'task' or 'slice card', then the environment", () => {
    const task = item({ key: "p/task-1", outcome: "A plan", environment: "laptop", environment_label: "Laptop" });
    expect(sessionLabel(task, t)).toBe("task · Laptop");
    expect(sessionLabel(item({ key: "p/slice-9", type: ItemType.Slice, agent: null, outcome: "Code merged", environment: "vm", environment_label: "Cloud VM" }), t)).toBe("slice card · Cloud VM");
    expect(sessionLabel(item({ key: "p/slice-9", agent: null, outcome: "Code merged" }), t)).toBe("slice card");
  });

  it("treats an item with an outcome and no agent as a working card", () => {
    expect(isWorkingCard(item({ key: "p/slice-9", type: ItemType.Slice, agent: null, outcome: "Code merged" }))).toBe(true);
    expect(isWorkingCard(item({ key: "p/slice-9", type: ItemType.Slice, agent: null, outcome: null }))).toBe(false);
  });

  it("lowers the first letter of an outcome word, except 'I' and a word whose second letter is not lower case", () => {
    const line = (outcome: string) => purposeText(item({ outcome, why: null }), t);
    expect(line("Fix build passes")).toBe("Outcome: fix build passes");
    expect(line("I fixed it")).toBe("Outcome: I fixed it");
    expect(line("CI passes")).toBe("Outcome: CI passes");
    expect(line("A plan")).toBe("Outcome: a plan");
  });

  it("Slice 45: a brand name keeps its capital after the label, an ordinary word does not", () => {
    const line = (outcome: string) => purposeText(item({ outcome, why: null }), t);
    expect(line("Cloudflare Worker deployed")).toBe("Outcome: Cloudflare Worker deployed");
    expect(line("GitHub PR merged")).toBe("Outcome: GitHub PR merged");
    expect(line("Cloudflare's cache cleared")).toBe("Outcome: Cloudflare's cache cleared");
    expect(line("Deploy the Worker")).toBe("Outcome: deploy the Worker");
  });

  it("says how long a question has waited, in minutes then hours, and nothing without a first-asked time", () => {
    expect(waitingText(item({ needs_you_at: "2026-11-17T13:42:00.000Z" }), NOW, t)).toBe("waiting 6 min");
    expect(waitingText(item({ needs_you_at: "2026-11-17T13:48:00.000Z" }), NOW, t)).toBe("waiting 1 min");
    expect(waitingText(item({ needs_you_at: "2026-11-17T03:40:00.000Z" }), NOW, t)).toBe("waiting 10 h");
    expect(waitingText(item({ needs_you_at: null }), NOW, t)).toBeNull();
  });

  it("words the drawer's purpose line: outcome then why, each lower case after its label, and only the why with no outcome", () => {
    const both = item({ outcome: "The cause written into Slice 12", why: "For Slice 12: app crashes on start" });
    expect(purposeText(both, t)).toBe("Outcome: the cause written into Slice 12 · for Slice 12: app crashes on start");
    expect(purposeText(item({ outcome: "API docs published", why: null }), t)).toBe("Outcome: API docs published");
    expect(purposeText(item({ outcome: null, why: "For Slice 12" }), t)).toBe("For Slice 12");
    expect(purposeText(item({ outcome: null, why: null }), t)).toBeNull();
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

  it("labels an owner step \"Your step\" and an agent's question \"Question\" (Slice 43)", () => {
    const step = item({ key: "p/slice-4/check-0a1b2c3d", type: ItemType.WaitingForMe, agent: null, status: ItemStatus.Open, working: false });
    expect(isOwnerStep(step)).toBe(true);
    expect(opensCardDrawer(step)).toBe(true);
    expect(cardLabel(step, t)).toBe("Your step");
    expect(cardLabel(item({ key: "p/q", needs_you: "Which?" }), t)).toBe("Question");
    expect(isOwnerStep(item({ ...step, key: "p/waiting-9c1e" }))).toBe(false);
    expect(isOwnerStep(item({ ...step, needs_you: "Which?" }))).toBe(false);
  });

  it("an owner step with no why still asks its title; another card asks nothing without a why (Slice 43)", () => {
    const step = item({ key: "p/slice-4/check-0a1b2c3d", title: "Connect the phone", type: ItemType.WaitingForMe, agent: null, status: ItemStatus.Open, why: null });
    expect(ownerStepFallback(step)).toBe("Connect the phone");
    expect(ownerStepFallback(item({ ...step, key: "p/waiting-9c1e" }))).toBeNull();
    expect(ownerStepFallback(item({ ...step, key: "p/waiting-9c1e", why: "Because" }))).toBe("Connect the phone");
  });

  it("an owner step's details_md is its steps; no other card has steps, and its links are read from the text (Slice 44)", () => {
    const step = item({ key: "p/slice-4/check-0a1b2c3d", title: "Slice 4: Set the variables", type: ItemType.WaitingForMe, agent: null, status: ItemStatus.Open, details_md: "Go to https://claude.ai/code, then open <board address>/#/setup." });
    expect(ownerStepDetails(step)).toBe("Go to https://claude.ai/code, then open <board address>/#/setup.");
    expect(ownerStepDetails(item({ ...step, details_md: null }))).toBeNull();
    expect(ownerStepDetails(item({ ...step, key: "p/waiting-9c1e" }))).toBeNull();
    expect(ownerStepFallback(step)).toBe("Slice 4: Set the variables");
    expect(stepUrls("Go to https://claude.ai/code, then https://x.test/a?b=1. Done (https://y.test)")).toEqual(["https://claude.ai/code", "https://x.test/a?b=1", "https://y.test"]);
    expect(stepUrls("Open https://console.example/path(1)/x. Or (see https://z.test/a(b)).")).toEqual(["https://console.example/path(1)/x", "https://z.test/a(b)"]);
  });

  it("reads <board address> as the page's origin and links a board page (Slice 43)", () => {
    const origin = "https://board.example.test";
    expect(resolveBoardAddress("open <board address>/#/setup, then <board address>/#/usage.", origin)).toEqual([
      { text: "open " },
      { text: `${origin}/#/setup`, href: `${origin}/#/setup` },
      { text: ", then " },
      { text: `${origin}/#/usage`, href: `${origin}/#/usage` },
      { text: "." },
    ]);
    expect(resolveBoardAddress("go to <board address> now", origin)).toEqual([{ text: "go to " }, { text: origin }, { text: " now" }]);
    expect(resolveBoardAddress("nothing here", origin)).toEqual([{ text: "nothing here" }]);
    expect(resolveBoardAddress("", origin)).toEqual([]);
    expect(resolveBoardAddress("(<board address>/#/open/p/slice-4)", origin)[1]).toEqual({ text: `${origin}/#/open/p/slice-4`, href: `${origin}/#/open/p/slice-4` });
  });

  it("fills every <board address> for text that holds no link (Slice 43)", () => {
    expect(fillBoardAddress("a <board address>/#/x and <board address>", "https://b.test")).toBe("a https://b.test/#/x and https://b.test");
  });

  it("Slice 45: the details text links a board page and writes a bare address as the origin", () => {
    const origin = "https://b.test";
    expect(linkBoardAddress("see <board address>/#/setup and <board address>.", origin)).toBe(`see [${origin}/#/setup](${origin}/#/setup) and ${origin}.`);
    expect(linkBoardAddress("nothing", origin)).toBe("nothing");
  });

  it("Slice 45 #1: an address inside a code span or an existing link is not wrapped in a second link", () => {
    const origin = "https://b.test";
    expect(linkBoardAddress("open `<board address>/#/usage` now", origin)).toBe(`open \`${origin}/#/usage\` now`);
    expect(linkBoardAddress("[usage page](<board address>/#/usage)", origin)).toBe(`[usage page](${origin}/#/usage)`);
    expect(linkBoardAddress("[<board address>/#/usage](https://x.test)", origin)).toBe(`[${origin}/#/usage](https://x.test)`);
  });

  it("Slice 45 #6: an address mid-label or mid-target of an existing link, or in a code span, never nests a link", () => {
    const origin = "https://b.test";
    expect(linkBoardAddress("[see <board address>/#/usage now](https://x.test)", origin)).toBe(`[see ${origin}/#/usage now](https://x.test)`);
    expect(linkBoardAddress("[see the page](<board address>/#/usage#top)", origin)).toBe(`[see the page](${origin}/#/usage#top)`);
    expect(linkBoardAddress("[<board address>](<board address>/#/x) and <board address>/#/y", origin)).toBe(`[${origin}](${origin}/#/x) and [${origin}/#/y](${origin}/#/y)`);
    expect(linkBoardAddress("`a <board address>/#/x b`", origin)).toBe(`\`a ${origin}/#/x b\``);
  });

  it("Slice 46 #9: a label with a ] or a target with a ) is still one link", () => {
    const origin = "https://b.test";
    expect(linkBoardAddress("[the [old] page <board address>/#/a](https://x.test) then <board address>/#/b", origin)).toBe(`[the [old] page ${origin}/#/a](https://x.test) then [${origin}/#/b](${origin}/#/b)`);
    expect(linkBoardAddress("[wiki](https://x.test/A_(b)) and <board address>/#/c", origin)).toBe(`[wiki](https://x.test/A_(b)) and [${origin}/#/c](${origin}/#/c)`);
  });

  it("Slice 45: one reading of what a card asks serves the card and the drawer heading", () => {
    const step = item({ type: ItemType.WaitingForMe, key: "p/slice-4/check-0a1b2c3d4e5f", title: "Open the page", needs_you: null });
    expect(cardQuestion(step)).toBe("Open the page");
    expect(cardQuestion(item({ needs_you: "Which phone?" }))).toBe("Which phone?");
    expect(cardQuestion(item({ needs_you: null, why: null }))).toBeNull();
  });

  it("Slice 45: a step's own link scan skips the board pages the link row already builds", () => {
    const text = "open <board address>/#/setup then https://claude.ai/code and <board address>.";
    expect(stepUrls(fillBoardAddress(withoutBoardPages(text), "https://b.test"))).toEqual(["https://claude.ai/code", "https://b.test"]);
  });
});
