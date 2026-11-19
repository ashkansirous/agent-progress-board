import { describe, expect, it } from "vitest";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { boardReducer, INITIAL_STATE, isFreshData, isFreshLoad, nextScroll } from "../web/src/boardState";
import type { StepState } from "../src/domain/stepTypes";
import { storedStep } from "./stepFixtures";
import { groupBoard } from "../src/domain/boardGroups";
import { activeTasks, projectLabel } from "../web/src/model";
import { eventKeys, waitingText } from "../web/src/cards";
import { closeHashFor, hashOfUrl, isDrawerHash, looseChecksHash, looseProjectOf, nextOrigin, openItemHash, openKeyOf, Route, routeOf } from "../web/src/route";
import { currentStepText, durationText, leafCounts, progressText, secondLine, shownState, stateText, stepWords, timesText } from "../web/src/stepsText";
import { translator } from "../web/src/strings";
import { looksFor, paletteVars } from "../web/src/theme";
import { ageText, clockTime, hoursSince, isTime, minutesSince, UNKNOWN_TIME } from "../web/src/time";

const NOW = Date.parse("2026-11-15T13:48:00.000Z");

function item(over: Partial<BoardItemDto>): BoardItemDto {
  return {
    key: "p/x", project: "p", parent: null, parent_slice: null, parent_key: null, slice: null, checks: null, type: ItemType.Slice, priority: Priority.P2, status: ItemStatus.Open,
    title: "T", why: null, details_md: null, links: [], heartbeat_at: "2026-11-15T10:00:00.000Z",
    created_at: "2026-11-15T09:00:00.000Z", done_at: null, environment: null, environment_label: null,
    agent: null, model: null, needs_you: null, after_answer: null, needs_you_at: null, steps: null, progress: null, working: false, parts: null, parts_progress: null, active_part_key: null, events: [], ...over,
  };
}

describe("grouping and order", () => {
  const items = [
    item({ key: "a/1", project: "a", priority: Priority.P2 }),
    item({ key: "a/2", project: "a", priority: Priority.P0 }),
    item({ key: "a/w1", project: "a", type: ItemType.WaitingForMe, priority: Priority.P1, created_at: "2026-11-15T12:00:00.000Z" }),
    item({ key: "a/w0", project: "a", type: ItemType.WaitingForMe, priority: Priority.P1, created_at: "2026-11-15T11:00:00.000Z" }),
    item({ key: "a/d1", project: "a", status: ItemStatus.Done, done_at: "2026-11-15T10:00:00.000Z" }),
    item({ key: "a/d2", project: "a", status: ItemStatus.Done, done_at: "2026-11-15T12:00:00.000Z" }),
    item({ key: "z/1", project: "z" }),
    item({ key: "b/1", project: "b" }),
  ];
  const projects = [{ id: "z", label: "Zed" }, { id: "empty", label: "Nothing" }, { id: "a", label: "Alpha" }];

  const ids = projects.map((p) => p.id);

  it("lists configured projects first, in config order, then others by id, and skips empty ones", () => {
    expect(groupBoard(items, [], ids).map((g) => g.id)).toEqual(["z", "a", "b"]);
  });

  it("sorts waiting by priority then oldest ask, planned by number then key, done newest first", () => {
    const alpha = groupBoard(items, [], ids).find((g) => g.id === "a")!;
    expect(alpha.needs_you).toEqual(["a/w0", "a/w1"]);
    expect(alpha.planned.map((s) => s.key)).toEqual(["a/1", "a/2"]);
    expect(alpha.done.recent.map((row) => row.key)).toEqual(["a/d2", "a/d1"]);
  });

  it("labels unknown projects by id", () => {
    expect(projectLabel("q", projects)).toBe("q");
    expect(projectLabel("a", projects)).toBe("Alpha");
  });
});

describe("Slice 36: open address, origin and loose checks", () => {
  it("closes to the page the drawer was opened from, else the board", () => {
    expect(closeHashFor("#/active")).toBe("#/active");
    expect(closeHashFor("#/active/demo%2Fslice-7")).toBe("#/active/demo%2Fslice-7");
    expect(closeHashFor("#/usage")).toBe("#/usage");
    expect(closeHashFor(null)).toBe("#/");
    expect(closeHashFor("")).toBe("#/");
    expect(closeHashFor(openItemHash("a/b"))).toBe("#/");
    expect(closeHashFor(looseChecksHash("demo"))).toBe("#/");
  });

  it("remembers the page a drawer opened from, keeps it while the drawer changes, and drops it on close", () => {
    const opened = nextOrigin(null, "#/active", openItemHash("a/b"));
    expect(opened).toBe("#/active");
    expect(nextOrigin(opened, openItemHash("a/b"), openItemHash("a/c"))).toBe("#/active");
    expect(nextOrigin(opened, openItemHash("a/b"), "#/active")).toBeNull();
    expect(nextOrigin(null, "", openItemHash("a/b"))).toBe("");
    expect(hashOfUrl("http://localhost:4176/#/active/x")).toBe("#/active/x");
    expect(hashOfUrl("http://localhost:4176/")).toBe("");
  });

  it("opens a project's loose checks at their own address, so an item key that looks like one is still an item", () => {
    const hash = looseChecksHash("demo app");
    expect(looseProjectOf(hash)).toBe("demo app");
    expect(openKeyOf(hash)).toBeNull();
    expect(routeOf(hash)).toBe(Route.Board);
    expect(looseProjectOf(openItemHash("loose-checks:demo"))).toBeNull();
    expect(openKeyOf(openItemHash("loose-checks:demo"))).toBe("loose-checks:demo");
    expect(looseProjectOf("#/loose/%E0%A4%A")).toBeNull();
    expect(isDrawerHash(hash)).toBe(true);
    expect(isDrawerHash("#/active")).toBe(false);
  });

  it("counts data as fresh only after a load that settled since the page mounted, never after a failed one (Slice 47 1a)", () => {
    const cached = boardReducer(INITIAL_STATE, { type: "success", data: {} as BoardResponse, at: new Date() });
    const reloading = boardReducer(cached, { type: "start" });
    expect(isFreshData(cached, cached.settles)).toBe(false);
    expect(isFreshData(reloading, cached.settles)).toBe(false);
    const fresh = boardReducer(reloading, { type: "success", data: {} as BoardResponse, at: new Date() });
    expect(isFreshData(fresh, cached.settles)).toBe(true);
    const failed = boardReducer(fresh, { type: "failure", status: 500 });
    expect(failed.settles).toBe(cached.settles + 2);
    expect(isFreshLoad(failed, cached.settles)).toBe(true);
    expect(isFreshData(failed, cached.settles)).toBe(false);
    expect(boardReducer(failed, { type: "aborted" }).settles).toBe(failed.settles);
  });

  it("scrolls to the questions only on fresh data, once per arrival, and records it only when the section was found (Slice 47 review #3, #4)", () => {
    const address = "#/needs-you";
    expect(nextScroll(false, address, address, null, true).scroll).toBe(false);
    const missing = nextScroll(true, address, address, null, false);
    expect(missing).toEqual({ scroll: false, scrolledFor: null });
    const first = nextScroll(true, address, address, missing.scrolledFor, true);
    expect(first).toEqual({ scroll: true, scrolledFor: address });
    expect(nextScroll(true, address, address, first.scrolledFor, true).scroll).toBe(false);
    const left = nextScroll(true, "#/", address, first.scrolledFor, true);
    expect(nextScroll(true, address, address, left.scrolledFor, true).scroll).toBe(true);
  });

  it("does not take an address with nothing to open for a drawer (Slice 47 1p)", () => {
    expect(isDrawerHash("#/open/")).toBe(false);
    expect(isDrawerHash("#/loose/")).toBe(false);
    expect(isDrawerHash("#/open/demo%2Fslice-1")).toBe(true);
  });

  it("keeps no flag of dropped data: a failed load clears the data and the address stays with the page", () => {
    const loaded = boardReducer(INITIAL_STATE, { type: "success", data: {} as BoardResponse, at: new Date() });
    const failed = boardReducer(loaded, { type: "failure", status: 503 });
    expect(failed.data).toBeNull();
    expect(failed.error).toEqual({ status: 503 });
    expect("dataDropped" in failed).toBe(false);
  });
});

describe("Slice 36: counts, plurals and times", () => {
  it("takes the working tasks from the server's flag, never from the heartbeat", () => {
    const stale = item({ key: "p/stale", working: false, heartbeat_at: "2026-11-15T13:47:00.000Z" });
    const quiet = item({ key: "p/quiet", working: true, heartbeat_at: "2026-11-01T00:00:00.000Z" });
    const fresh = item({ key: "p/fresh", working: true, heartbeat_at: "2026-11-15T13:00:00.000Z" });
    expect(activeTasks([stale, quiet, fresh]).map((i) => i.key)).toEqual(["p/fresh", "p/quiet"]);
  });

  it("chooses singular and plural from the locale's own rule", () => {
    const en = translator();
    expect(en(en.plural(1, "projectOne", "projectMany"), { n: 1 })).toBe("1 project");
    expect(en(en.plural(0, "projectOne", "projectMany"), { n: 0 })).toBe("0 projects");
    expect(en(en.plural(2, "projectOne", "projectMany"), { n: 2 })).toBe("2 projects");
  });

  it("never prints NaN for an unreadable time", () => {
    const t = translator();
    const asked = item({ needs_you: "Q", needs_you_at: "yesterday-ish" });
    expect(isTime("yesterday-ish")).toBe(false);
    expect(minutesSince("yesterday-ish", NOW)).toBeNaN();
    expect(ageText("yesterday-ish", NOW, t)).toBe(UNKNOWN_TIME);
    expect(clockTime("yesterday-ish")).toBe(UNKNOWN_TIME);
    expect(waitingText(asked, NOW, t)).toBeNull();
    expect(waitingText(item({ needs_you: "Q", needs_you_at: "2026-11-15T13:30:00.000Z" }), NOW, t)).toBe("waiting 18 min");
  });

  it("gives each history row a key from its content, in the server's order, with a counter for equal rows", () => {
    const row = (at: string, note: string | null) => ({ at, status: ItemStatus.InProgress, note, marker: null });
    const events = [row("2026-11-15T13:00:00.000Z", "Heartbeat"), row("2026-11-15T12:00:00.000Z", "Heartbeat"), row("2026-11-15T12:00:00.000Z", "Heartbeat")];
    const keys = eventKeys(events);
    expect(new Set(keys).size).toBe(3);
    expect(eventKeys([row("2026-11-15T14:00:00.000Z", null), ...events]).slice(1)).toEqual(keys);
  });

  it("keeps every older row's key when a new row at the top reads the same as an older one (Slice 47 1g)", () => {
    const row = (at: string, note: string | null) => ({ at, status: ItemStatus.InProgress, note, marker: null });
    const events = [row("2026-11-15T12:00:00.000Z", "Heartbeat"), row("2026-11-15T12:00:00.000Z", "Heartbeat")];
    const keys = eventKeys(events);
    const longer = eventKeys([row("2026-11-15T12:00:00.000Z", "Heartbeat"), ...events]);
    expect(longer.slice(1)).toEqual(keys);
  });
});

describe("time text", () => {
  const t = translator();

  it("gives minutes, hours and days, never less than 1 min", () => {
    expect(ageText("2026-11-15T13:23:00.000Z", NOW, t)).toBe("25 min ago");
    expect(ageText("2026-11-15T13:47:59.000Z", NOW, t)).toBe("1 min ago");
    expect(ageText("2026-11-15T11:40:00.000Z", NOW, t)).toBe("2 h ago");
    expect(ageText("2026-11-12T13:00:00.000Z", NOW, t)).toBe("3 d ago");
    expect(hoursSince("2026-11-15T10:40:00.000Z", NOW)).toBe(3);
  });

  it("formats HH:mm with a leading zero in local time", () => {
    expect(clockTime(new Date(2026, 10, 15, 7, 5))).toBe("07:05");
    expect(clockTime(new Date(2026, 10, 15, 13, 48).toISOString())).toBe("13:48");
  });
});

describe("strings", () => {
  it("fills placeholders and always answers in English", () => {
    expect(translator()("askedAge", { age: "5 min ago", parent: "Plan" })).toBe("Asked 5 min ago · Plan");
    expect(translator()("retry")).toBe("Retry");
  });
});

describe("board state", () => {
  const response = { config: { projects: [] }, window_hours: 12, items: [], server_time: "x" } as unknown as BoardResponse;

  it("keeps the config but clears the board on a failure, and shows the loading state only when slow", () => {
    const ok = boardReducer(INITIAL_STATE, { type: "success", data: response, at: new Date(0) });
    expect(ok.data).toBe(response);
    const failed = boardReducer(ok, { type: "failure", status: 503 });
    expect(failed).toMatchObject({ data: null, error: { status: 503 }, loading: false });
    expect(failed.config).toBe(ok.config);
    expect(boardReducer(failed, { type: "start" })).toMatchObject({ loading: true, slow: false });
    expect(boardReducer({ ...failed, loading: false }, { type: "slow" }).slow).toBe(false);
    expect(boardReducer({ ...INITIAL_STATE }, { type: "slow" }).slow).toBe(true);
  });
});

describe("theme", () => {
  const config = {
    projects: [],
    types: { slice: { label: "Slice", color: "#000", dark: { bg: "#1", fg: "#2", border: "#3" } } },
    statuses: {},
    priorities: {},
    palettes: { light: { page: "#fff" }, dark: { page: "#000" } },
  } as unknown as Parameters<typeof looksFor>[0];

  it("reads a type's colours for the scheme and falls back to the page's own colours", () => {
    expect(looksFor(config, "dark").type(ItemType.Slice)).toEqual({ bg: "#1", fg: "#2", border: "#3", label: "Slice" });
    expect(looksFor(config, "light").type(ItemType.Slice).bg).toBe("var(--card)");
    expect(looksFor(null, "light").type(ItemType.Bug).label).toBe("bug");
    expect(looksFor(null, "dark").status(ItemStatus.Open).dot).toBe("transparent");
  });

  it("turns the palette into custom properties", () => {
    expect(paletteVars(config, "dark")).toMatchObject({ "--page": "#000", "--text": "#E8EAEE" });
    expect(paletteVars(null, "light")).toMatchObject({ "--page": "#F5F6F8", "--primaryBg": "#14171C" });
  });

  it("paints the step colours of the mock for both schemes", () => {
    expect(paletteVars(null, "light")).toMatchObject({ "--stepDone": "#0B6B4B", "--stepActive": "#9DBDFF", "--stepActiveRow": "#E6EEFC" });
    expect(paletteVars(null, "dark")).toMatchObject({ "--stepDone": "#2E8F6A", "--stepActive": "#3B5A94", "--stepPendingTile": "#0E1014" });
  });
});

describe("active work", () => {
  const working = (key: string, heartbeat: string) => item({ key, working: true, heartbeat_at: heartbeat });

  it("lists only the working tasks, the newest report first", () => {
    const items = [
      working("a/old", "2026-11-15T13:44:00.000Z"),
      item({ key: "a/idle" }),
      working("a/new", "2026-11-15T13:47:00.000Z"),
      working("a/mid", "2026-11-15T13:46:00.000Z"),
    ];
    expect(activeTasks(items).map((i) => i.key)).toEqual(["a/new", "a/mid", "a/old"]);
  });

  it("reads the view from the address hash and the open item from its own hash form", () => {
    expect(routeOf("#/active")).toBe(Route.Active);
    expect(routeOf("#/usage")).toBe(Route.Usage);
    expect(routeOf("#/")).toBe(Route.Board);
    expect(routeOf("#/open/a%2Fb")).toBe(Route.Board);
    expect(openKeyOf(openItemHash("demo/slice 7/part-a"))).toBe("demo/slice 7/part-a");
    expect(openKeyOf("#/active")).toBeNull();
    expect(openKeyOf("#/open/%E0%A4%A")).toBeNull();
  });

  it("names the steps Done, Now, Next and Later, and a finished task all Done", () => {
    const steps = ["done", "done", "active", "pending", "pending", "pending"].map((state, i) =>
      storedStep(`S${i}`, state as StepState),
    );
    expect(stepWords(steps, false).map((w) => w.key)).toEqual(["stepDone", "stepDone", "stepNow", "stepNext", "stepLater", "stepLater"]);
    expect(new Set(stepWords(steps, true).map((w) => w.key))).toEqual(new Set(["stepDone"]));
  });

  it("reads Starting before anything is done, the label while one leaf runs, N running for several, and Done once finished", () => {
    const t = translator();
    const none = { done: 0, total: 4, percent: 0, running: 0, current: null };
    const progress = { done: 1, total: 4, percent: 25, running: 0, current: null };
    expect(currentStepText(item({ progress: none }), t)).toBe("Starting");
    expect(currentStepText(item({ progress }), t)).toBe("Waiting for the next step");
    expect(currentStepText(item({ progress: { ...progress, running: 1, current: "Review 1" } }), t)).toBe("Review 1");
    expect(currentStepText(item({ progress: { ...progress, running: 3 } }), t)).toBe("3 running");
    expect(currentStepText(item({ progress, status: ItemStatus.Done }), t)).toBe("Done");
    expect(progressText(item({ progress }), t)).toBe("1 of 4 steps · 25%");
  });
});

describe("step tree text (Slice 39)", () => {
  const t = translator();
  const started = "2026-11-18T13:12:00.000Z";
  const finishedAt = "2026-11-18T13:20:00.000Z";
  const NOW_MS = Date.parse("2026-11-18T14:14:00.000Z");
  const clock = { finished: false, nowMs: NOW_MS };
  const leaf = (label: string, state: StepState, extra = {}) => storedStep(label, state, extra);

  it("shows a parent as running when any leaf below it runs, so it never reads Next beside a running ring", () => {
    const parent = leaf("P", "pending" as StepState, { children: [leaf("a", "done" as StepState), leaf("b", "active" as StepState)] });
    expect(shownState(parent, false)).toBe("active");
    expect(shownState(leaf("P", "pending" as StepState, { children: [leaf("a", "pending" as StepState)] }), false)).toBe("pending");
    expect(shownState(parent, true)).toBe("done");
    expect(shownState(leaf("P", "active" as StepState), false)).toBe("active");
  });

  it("words durations as N min and N h NN min", () => {
    expect(durationText(8 * 60_000, t)).toBe("8 min");
    expect(durationText(62 * 60_000, t)).toBe("1 h 02 min");
    expect(durationText(5_000, t)).toBe("1 min");
  });

  it("reads the state text: Done with its time, Running with its time, Next for the first waiting one, Later after", () => {
    const done = leaf("A", "done" as StepState, { started_at: started, done_at: finishedAt });
    const running = leaf("B", "active" as StepState, { started_at: "2026-11-18T13:12:00.000Z" });
    const waiting = leaf("C", "pending" as StepState);
    expect(stateText(done, clock, false, t)).toBe("Done · 8 min");
    expect(stateText(running, clock, false, t)).toBe("Running · 1 h 02 min");
    expect(stateText(waiting, clock, true, t)).toBe("Next");
    expect(stateText(waiting, clock, false, t)).toBe("Later");
    expect(stateText(waiting, { ...clock, finished: true }, true, t)).toBe("Done");
  });

  it("reads the open box's times line for done, running and waiting steps", () => {
    const done = leaf("A", "done" as StepState, { started_at: started, done_at: finishedAt });
    const running = leaf("B", "active" as StepState, { started_at: started });
    expect(timesText(done, clock, t)).toBe(`Started ${clockTime(started)} · finished ${clockTime(finishedAt)} · took 8 min`);
    expect(timesText(running, clock, t)).toBe(`Started ${clockTime(started)} · running for 1 h 02 min`);
    expect(timesText(leaf("C", "pending" as StepState), clock, t)).toBe("Not started yet");
  });

  it("counts a parent's leaves in its second line and leaves out the parts that are empty", () => {
    const children = [leaf("a", "done" as StepState), leaf("b", "active" as StepState), leaf("c", "active" as StepState), leaf("d", "pending" as StepState)];
    const parent = leaf("P", "active" as StepState, { children, note: "Helper agent" });
    expect(leafCounts(parent, false)).toEqual({ done: 1, total: 4, running: 2 });
    expect(secondLine(parent, false, t)).toBe("1 of 4 sub-steps done · 2 running · Helper agent");
    const calm = leaf("P", "pending" as StepState, { children: [leaf("a", "done" as StepState), leaf("b", "pending" as StepState)] });
    expect(secondLine(calm, false, t)).toBe("1 of 2 sub-steps done");
    expect(secondLine(leaf("L", "pending" as StepState, { note: "why" }), false, t)).toBe("why");
    expect(secondLine(leaf("L", "pending" as StepState), false, t)).toBeNull();
  });
});
