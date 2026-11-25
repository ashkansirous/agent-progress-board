import { expect, type Locator, type Page, test } from "@playwright/test";
import type { BoardResponse } from "../src/api/boardDto";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { ItemStatus } from "../src/domain/item";
import { type Step, StepState, WaitsOn } from "../src/domain/stepTypes";
import { activeBoard, activeTasks, CRASH, PART_B, PART_C, STALE, treeTasks } from "./activeFixture";
import { demoBoard, SERVER_TIME } from "./fixture";
import { expectLoadingAfterDelay, holdBoardRoute, pageSettled, pausedClock } from "./loadingClock";
import { LAST_SCROLL_AT, STAMP_START, waitForQuietScrolls } from "./scrollQuiet";

const BOARD_ROUTE = "**/api/board";

const isPhone = () => test.info().project.name === "phone";
const scheme = () => (isPhone() ? "dark" : "light");
const palette = () => exampleConfig.palettes[scheme()];
const bugBorder = () => exampleConfig.types.bug[scheme()].border;
const bugFg = () => exampleConfig.types.bug[scheme()].fg;

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

async function openActive(page: Page, body: BoardResponse = activeBoard()) {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: body }));
  await page.goto("/#/active");
  await expect(page.getByRole("heading", { level: 1, name: "Active work" })).toBeVisible();
}

function card(page: Page, title: string): Locator {
  return page.locator("li.active-card", { has: page.getByRole("heading", { level: 2, name: title, exact: true }) });
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Views" });

test.describe("active work page", () => {
  test("lists the three working tasks newest report first and leaves the stale one out", async ({ page }) => {
    await openActive(page);
    expect(await page.locator("li.active-card h2").allTextContents()).toEqual([
      "Part C · Notification channel",
      "Part B · Search box",
      "Crash opening an empty bed",
    ]);
    await expect(page.getByText("Slice 10 · Seed inventory")).toHaveCount(0);
  });

  test("the header gives two lines, the same on both layouts (ActiveV3)", async ({ page }) => {
    await openActive(page);
    const lines = page.locator(".header-text .subtitle");
    await expect(lines).toHaveText([
      "Tasks with an outcome that an agent is working on now · updated 13:48",
      "Plain chats and wave runners get no card here; each slice a wave builds has its own.",
    ]);
    expect(await css(lines.first(), "font-size")).toBe("13px");
    await expect(page.getByText("tasks running")).toHaveCount(0);
  });

  test("each card shows its outcome under the title, in the done colour with a 15px target", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    const outcome = part.locator(".outcome-line");
    await expect(outcome).toHaveText("Outcome: Code merged to main");
    expect(await css(outcome, "font-size")).toBe("14px");
    expect(await css(outcome, "font-weight")).toBe("600");
    expect(await css(outcome, "color")).toBe(rgbOf(palette().doneFg));
    await expect(outcome.locator("svg")).toHaveAttribute("width", "15");
    const order = await part.locator(".active-head").locator("h2, .outcome-line").evaluateAll((nodes) => nodes.map((node) => node.tagName));
    expect(order).toEqual(["H2", "SPAN"]);
  });

  test("the waiting-questions link is absent when no question is open", async ({ page }) => {
    await openActive(page);
    await expect(page.locator("a.waiting-link")).toHaveCount(0);
  });

  test("the waiting-questions link shows one question in the singular", async ({ page }) => {
    const one = activeTasks().map((task, i) => (i === 0 ? { ...task, needs_you: "Which one?", needs_you_at: SERVER_TIME } : task));
    await openActive(page, activeBoard(one));
    await expect(page.locator("a.waiting-link")).toHaveText("1 question is waiting on the board");
  });

  test("the waiting-questions link shows the real count and goes to the board", async ({ page }) => {
    const asking = activeTasks().map((task, i) => (i < 2 ? { ...task, needs_you: "Which one?", needs_you_at: SERVER_TIME } : task));
    await openActive(page, activeBoard(asking));
    const link = page.locator("a.waiting-link");
    await expect(link).toHaveText("2 questions are waiting on the board");
    await expect(link).toHaveAttribute("href", "#/needs-you");
    expect(await css(link, "min-height")).toBe("44px");
    expect(await css(link, "background-color")).toBe(rgbOf(palette().needBg));
    expect(await css(link, "color")).toBe(rgbOf(palette().needFg));
  });

  test("the view bar sits above the title on both layouts, as on the Board page (Slice 36)", async ({ page }) => {
    await openActive(page);
    const nav = await tabs(page).boundingBox();
    const title = await page.getByRole("heading", { level: 1, name: "Active work" }).boundingBox();
    expect((nav?.y ?? Number.MAX_VALUE) + (nav?.height ?? 0)).toBeLessThanOrEqual(title?.y ?? 0);
    expect(await css(tabs(page), "position")).not.toBe("sticky");
  });

  test("the top tab bar and the count pill fit the viewport without overflow, on the phone too (Slice 43)", async ({ page }) => {
    await openActive(page);
    const nav = await tabs(page).boundingBox();
    const pill = await tabs(page).locator(".tab-count").boundingBox();
    const viewport = page.viewportSize()?.width ?? 0;
    expect((nav?.x ?? -1) + (nav?.width ?? Number.MAX_VALUE)).toBeLessThanOrEqual(viewport);
    expect(pill?.x ?? -1).toBeGreaterThanOrEqual(nav?.x ?? Number.MAX_VALUE);
    expect((pill?.x ?? 0) + (pill?.width ?? Number.MAX_VALUE)).toBeLessThanOrEqual((nav?.x ?? 0) + (nav?.width ?? 0));
    const overflow = await tabs(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("the Active work tab is current and shows the number of cards", async ({ page }) => {
    await openActive(page);
    const tab = tabs(page).getByRole("link", { name: /^Active work/ });
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(tab.locator(".tab-count")).toHaveText("3");
    // C1: the current tab's text is the `text` key, #E8EAEE dark and #14171C light.
    expect(await css(tab, "color")).toBe(scheme() === "dark" ? "rgb(232, 234, 238)" : "rgb(20, 23, 28)");
  });

  test("the tab count is left out when nothing is working, and the empty card shows", async ({ page }) => {
    const idle = activeBoard(activeTasks().map((task) => ({ ...task, working: false })));
    await openActive(page, idle);
    await expect(page.getByText("No agent is working right now")).toBeVisible();
    await expect(page.getByText("Tasks show here while an agent reports progress on them. Stale tasks move back to the board.")).toBeVisible();
    await expect(tabs(page).locator(".tab-count")).toHaveCount(0);
    // Every centred state card keeps the mock's 12px gap, the empty card too (Slice 36).
    await expect(page.locator(".state-card")).not.toHaveClass(/state-gap-14/);
    expect(await css(page.locator(".state-card"), "row-gap")).toBe("12px");
  });

  test("a card names the project, type, parent, last report, agent, model and environment", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    const meta = part.locator(".active-meta");
    await expect(meta).toContainText("Garden Planner");
    await expect(meta).toContainText("Slice");
    await expect(meta).toContainText("Slice 9 · Frost alerts");
    await expect(meta).toContainText("Last report 1 min ago");
    await expect(part.locator(".chip")).toHaveText(["Implementer", "model-mid", "Cloud VM"]);
    expect(await css(part.locator(".chip-mono"), "font-family")).toContain("JetBrains Mono");
  });

  test("the environment chip is left out when the task has none", async ({ page }) => {
    const bare = activeTasks().map((task) => (task.key === CRASH ? { ...task, environment: null, environment_label: null } : task));
    await openActive(page, activeBoard(bare));
    await expect(card(page, "Crash opening an empty bed").locator(".chip")).toHaveText(["Fixer", "model-small"]);
    await expect(card(page, "Part C · Notification channel").locator(".chip")).toHaveCount(3);
  });

  test("the step now, the counts and one bar segment per step in the drawn colours", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    await expect(part.locator(".progress-now")).toHaveText("Review 2");
    await expect(part.locator(".progress-count")).toHaveText("3 of 7 steps · 43%");
    const bar = part.locator(".step-bar");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    const segments = bar.locator(".seg");
    await expect(segments).toHaveCount(7);
    const colours = await segments.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    const done = rgbOf(palette().link);
    const active = rgbOf(palette().stepActive);
    const pending = rgbOf(palette().hairline);
    expect(colours).toEqual([done, done, done, active, pending, pending, pending]);
    expect(await css(bar, "height")).toBe(isPhone() ? "8px" : "10px");
    expect(await segments.first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(10);
  });

  test("a bug card takes the type's border colour, a part card the plain hairline", async ({ page }) => {
    await openActive(page);
    expect(await css(card(page, "Crash opening an empty bed"), "border-top-color")).toBe(rgbOf(bugBorder()));
    expect(await css(card(page, "Part B · Search box"), "border-top-color")).toBe(rgbOf(palette().hairline));
    expect(await css(card(page, "Crash opening an empty bed").locator(".active-type"), "color")).toBe(rgbOf(bugFg()));
  });

  test("the full list is always open, with Done, Now, Next and Later and the notes, and no toggle", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    await expect(part.getByRole("button", { name: /^(Show all \d+ steps|Hide steps)$/ })).toHaveCount(0);
    await expect(part.locator(".step-row .step-state")).toHaveText(["Done", "Done", "Done", "Now", "Next", "Later", "Later"]);
    await expect(part.locator(".step-row-active .step-note")).toHaveText("Two helper agents count under this step");
    await expect(part.locator(".step-row-active")).toHaveAttribute("aria-current", "step");
    expect(await css(part.locator(".step-row-active"), "background-color")).toBe(rgbOf(palette().sliceBg));
    expect(await css(part.locator(".step-row-done .step-mark").first(), "background-color")).toBe(rgbOf(palette().doneFg));
  });

  test("a note shows under its label on the bug's pending step", async ({ page }) => {
    await openActive(page);
    const bug = card(page, "Crash opening an empty bed");
    await expect(bug.locator(".step-note")).toHaveText("No tablet test: no tablet code changed");
    await expect(bug.locator(".step-row .step-state")).toHaveText(["Done", "Now", "Next", "Later"]);
  });

  test("a blocked step reads orange with its note and link, a blocked-on-owner one reads red, and a slice card lists its open checks (Slice 51)", async ({ page }) => {
    const blocked = (id: string, label: string, waits_on: WaitsOn, note: string): Step => ({
      id, label, state: StepState.Blocked, note, started_at: null, done_at: null, started_source: null, done_source: null, waits_on, link: "https://example.com/pr/9", children: [],
    });
    const tasks = activeTasks().map((task) =>
      task.key === PART_B
        ? {
            ...task,
            steps: [blocked("w", "Wait for the parser", WaitsOn.Work, "waits on slice 52"), blocked("o", "Approve the design", WaitsOn.Owner, "needs your OK")],
            checks: [{ key: `${PART_B}/check-a`, title: "Try it on the phone", status: ItemStatus.Open }],
            reopened: { at: SERVER_TIME, status: ItemStatus.InProgress },
          }
        : task,
    );
    await openActive(page, activeBoard(tasks));
    const part = card(page, "Part B · Search box");
    await expect(part.locator(".step-row-blocked .step-state")).toHaveText(["Blocked", "Waiting on you"]);
    await expect(part.locator(".step-row-owner")).toHaveCount(1);
    await expect(part.locator(".seg-blocked.seg-owner")).toHaveCount(1);
    await expect(part.locator(".card-checks h3")).toHaveText("Checks · 1 not tried");
    await expect(part.locator(".card-checks .check-state")).toHaveText("Not tried");
    await expect(part.locator(".reopened-line")).toHaveText("Reopened by the docs: the plan now says in progress");
    await part.locator(".step-row").first().click();
    await expect(part.locator(".step-link").first()).toHaveAttribute("href", "https://example.com/pr/9");
  });

  test("a task with no active step reads Starting", async ({ page }) => {
    const starting = activeTasks().map((task) =>
      task.key === PART_B ? { ...task, progress: { done: 0, total: 5, percent: 0, running: 0, blocked: 0, open_checks: 0, current: null } } : task,
    );
    await openActive(page, activeBoard(starting));
    await expect(card(page, "Part B · Search box").locator(".progress-now")).toHaveText("Starting");
  });

  test("the link back opens the board with that task's detail", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    const link = part.getByRole("link", { name: "Back to Slice 9 · Frost alerts on the board" });
    await expect(link).toHaveAttribute("href", `#/open/${encodeURIComponent(PART_C)}`);
    await link.click();
    const dialog = page.getByRole("dialog", { name: "Card details" }); // a card with an outcome opens the card drawer (Slice 41)
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Part C · Notification channel");
  });

  test("closing a detail opened from Active work returns to Active work, and a reload keeps it closed (Slice 36)", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    await part.getByRole("link", { name: "Back to Slice 9 · Frost alerts on the board" }).click();
    const dialog = page.getByRole("dialog", { name: "Card details" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.hash === "#/active");
    await expect(page.getByRole("heading", { level: 1, name: "Active work" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Active work" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("a detail opened by its address closes to the board, and back and forward move it", async ({ page }) => {
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: activeBoard() }));
    await page.goto(`/#/open/${encodeURIComponent(PART_C)}`);
    const dialog = page.getByRole("dialog", { name: "Card details" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL((url) => url.hash === "#/");
    await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/open/${encodeURIComponent(PART_C)}`);
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await expect(dialog).toHaveCount(0);
  });

  test("a card named by #/active/<key> scrolls again when the address returns to it: A, B, A (Slice 48 4)", async ({ page }) => {
    await page.addInitScript(STAMP_START);
    await page.addInitScript((stampName) => {
      const scrolls: string[] = [];
      (window as unknown as { __cardScrolls: string[] }).__cardScrolls = scrolls;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<Element["scrollIntoView"]>) {
        if (this.classList.contains("active-card")) {
          scrolls.push(this.querySelector("h2")?.textContent ?? "");
          (window as unknown as Record<string, number>)[stampName] = performance.now();
        }
        return original.apply(this, args);
      };
    }, LAST_SCROLL_AT);
    await openActive(page);
    const scrolls = () => page.evaluate(() => (window as unknown as { __cardScrolls: string[] }).__cardScrolls);
    const goTo = (key: string) =>
      page.evaluate((hash) => {
        window.location.hash = hash;
      }, `#/active/${encodeURIComponent(key)}`);
    // Each visit must add a scroll beyond the count seen before it, ending on that visit's card (one naming may scroll its
    // card more than once, so the test reads the count before the visit, not a fixed number) (Slice 49 4).
    const visit = async (key: string, title: string) => {
      // Settled: no scroll for 300 ms by the page's clock, so a late duplicate scroll of the previous card has landed and
      // only this visit can raise the count.
      await waitForQuietScrolls(page);
      const before = (await scrolls()).length;
      await goTo(key);
      await expect.poll(async () => (await scrolls()).length).toBeGreaterThan(before);
      await expect.poll(async () => (await scrolls()).at(-1)).toBe(title);
    };
    await visit(PART_C, "Part C · Notification channel");
    await visit(PART_B, "Part B · Search box");
    await visit(PART_C, "Part C · Notification channel");
  });

  test("a failed first load keeps the open-item address", async ({ page }) => {
    const hash = `#/open/${encodeURIComponent(PART_C)}`;
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ status: 500, json: { error: "down" } }));
    await page.goto(`/${hash}`);
    await expect(page.getByRole("alert").or(page.locator(".state-card")).first()).toBeVisible();
    await pageSettled(page);
    await expect(page).toHaveURL((url) => url.hash === hash);
  });

  test("the Active work count stays in the tab bar on the Usage view", async ({ page }) => {
    await openActive(page);
    await expect(tabs(page).locator(".tab-count")).toHaveText("3");
    await tabs(page).getByRole("link", { name: /Usage/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
    await expect(tabs(page).locator(".tab-count")).toHaveText("3");
  });

  test("a wait over 500 ms shows the loading card, then the cards", async ({ page }) => {
    await pausedClock(page);
    const { release, requested } = await holdBoardRoute(page, activeBoard);
    await page.goto("/#/active");
    await requested;
    await expectLoadingAfterDelay(
      page,
      () => expect(page.getByText("Loading active work…")).toHaveCount(0),
      () => expect(page.getByRole("status", { name: "Loading active work…" })).toBeVisible(),
    );
    release();
    await expect(page.locator("li.active-card")).toHaveCount(3);
    await expect(page.getByText("Loading active work…")).toHaveCount(0);
  });

  test("a failed load shows the card with the status and Retry, and Retry loads again", async ({ page }) => {
    let failing = true;
    await page.route(BOARD_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, body: "no" }) : route.fulfill({ json: activeBoard() }),
    );
    await page.goto("/#/active");
    const alert = page.getByRole("alert");
    await expect(alert.getByText("Couldn’t load active work")).toBeVisible();
    await expect(alert).toContainText("503");
    expect(await css(alert, "row-gap")).toBe("12px");
    failing = false;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("li.active-card")).toHaveCount(3);
  });

  test("a task that turned stale is gone after the next refresh", async ({ page }) => {
    let current = activeBoard();
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: current }));
    await page.goto("/#/active");
    await expect(page.locator("li.active-card")).toHaveCount(3);
    current = activeBoard(activeTasks().map((task) => (task.key === PART_B ? { ...task, working: false } : task)));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator("li.active-card")).toHaveCount(2);
    await expect(tabs(page).locator(".tab-count")).toHaveText("2");
  });
});

test.describe("steps on the board", () => {
  async function openBoard(page: Page) {
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: demoBoard() }));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  /** Slice 9 is held by an agent with a steps list, so it is a card under Working now. */
  const sliceNine = (page: Page) =>
    page.locator("button.session-card").filter({ has: page.locator(".session-goal").getByText("Slice 9 · Frost alerts", { exact: true }) });
  const sliceCard = (page: Page, words: string) =>
    page.locator("button.slice-card").filter({ has: page.locator(".slice-title").getByText(words, { exact: true }) });

  test("the board's Active work tab carries the count", async ({ page }) => {
    await openBoard(page);
    await expect(tabs(page).getByRole("link", { name: /^Active work/ }).locator(".tab-count")).toHaveText("1");
  });

  test("a working task's card shows its steps with the one now marked", async ({ page }) => {
    await openBoard(page);
    const chips = sliceNine(page).getByRole("list", { name: "Steps" }).getByRole("listitem");
    await expect(chips).toHaveCount(7);
    await expect(chips.nth(3)).toHaveText("●Review 2");
    expect(await css(chips.nth(3), "background-color")).toBe(rgbOf(palette().nowBg));
  });

  test("a task with no steps list is not under Working now", async ({ page }) => {
    await openBoard(page);
    await expect(sliceCard(page, "Tag search")).toBeVisible();
    await expect(page.locator("button.session-card").filter({ hasText: "Tag search" })).toHaveCount(0);
  });

  test("the drawer has a Steps section after the fields, with who holds the task and no notes", async ({ page }) => {
    await openBoard(page);
    await sliceNine(page).click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    const section = dialog.locator(".steps-section");
    await expect(section.getByRole("heading", { level: 3, name: "Steps" })).toBeVisible();
    await expect(section.locator(".steps-who")).toHaveText("Implementer · model-mid · Cloud VM");
    await expect(section.locator(".steps-count")).toHaveText("3 of 7 steps · 43%");
    await expect(section.locator(".step-row .step-state")).toHaveText(["Done", "Done", "Done", "Now", "Next", "Later", "Later"]);
    await expect(section.locator(".step-note")).toHaveCount(0);
    expect(await css(section.locator(".step-bar"), "height")).toBe("8px");
    const order = await dialog.locator(".fields, .steps-section, .details").evaluateAll((els) => els.map((el) => el.className));
    expect(order.indexOf("fields")).toBeLessThan(order.findIndex((name) => name.includes("steps-section")));
  });

  test("a drawer of a task with no steps has no Steps section", async ({ page }) => {
    await openBoard(page);
    await sliceCard(page, "Tag search").click();
    await expect(page.getByRole("dialog", { name: "Item details" })).toBeVisible();
    await expect(page.locator(".steps-section")).toHaveCount(0);
  });

  test("a done task reads 100% in its drawer whatever its list says", async ({ page }) => {
    const board = demoBoard();
    const done = board.items.map((item) =>
      item.key === "garden-planner/slice-9"
        ? { ...item, status: ItemStatus.Done, done_at: SERVER_TIME, progress: { done: 7, total: 7, percent: 100, running: 0, blocked: 0, open_checks: 0, current: null }, working: false }
        : item,
    );
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: demoBoard(done) }));
    await page.goto("/");
    await page.locator("section.project", { hasText: "Garden Planner" }).getByRole("button", { name: /done in the last 12 hours/ }).click();
    await page.locator("button.done-row").filter({ hasText: "Slice 9 · Frost alerts" }).click();
    await expect(page.locator(".steps-count")).toHaveText("7 of 7 steps · 100%");
  });
});

test("the stale task keeps its steps on the board but is not counted", async ({ page }) => {
  const board = activeBoard();
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: board }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const stale = page.locator("button.slice-card").filter({ has: page.locator(".slice-title").getByText("Seed inventory", { exact: true }) });
  await expect(stale).toContainText("Planned");
  await stale.click();
  await expect(page.getByRole("dialog").locator(".steps-count")).toHaveText("1 of 3 steps · 33%");
  await page.keyboard.press("Escape");
  expect(STALE).toBe("garden-planner/slice-10");
  await expect(tabs(page).getByRole("link", { name: /^Active work/ }).locator(".tab-count")).toHaveText("3");
});

const BOOK_TITLE = "Implement Slice 7: audio in every language";

/** The row of a step by its path number ("3.1.2"): the `li` that holds its button and, when open, its box. */
function rowAt(owner: Locator, path: string): Locator {
  const exact = new RegExp(`^${path.replace(/\./g, "\\.")}$`);
  return owner.locator(".step-item").filter({ has: owner.page().locator(".step-mark", { hasText: exact }) });
}

async function openTree(page: Page, title: string): Promise<Locator> {
  await openActive(page, activeBoard(treeTasks()));
  return card(page, title);
}

test.describe("the step tree (Slice 39)", () => {
  test("the header says 3 running while three leaves run, and the count is over leaves", async ({ page }) => {
    await openActive(page, activeBoard(treeTasks()));
    const book = card(page, BOOK_TITLE);
    await expect(book.locator(".progress-now")).toHaveText("3 running");
    await expect(book.locator(".progress-count")).toHaveText("5 of 12 steps · 42%");
    await expect(book.locator(".step-bar .seg")).toHaveCount(12);
  });

  test("a wave with 26 of 30 done and none running reads Waiting for the next step, not Starting", async ({ page }) => {
    await openActive(page, activeBoard(treeTasks()));
    const wave = card(page, "Wave 3: thirty small steps");
    await expect(wave.locator(".progress-now")).toHaveText("Waiting for the next step");
    await expect(wave.locator(".progress-count")).toHaveText("26 of 30 steps · 87%");
    await expect(wave.locator(".step-state").nth(26)).toHaveText("Next");
    await expect(wave.locator(".step-state").nth(27)).toHaveText("Later");
  });

  test("tapping a parent unfolds its children in place, numbered by path and indented 26px per level", async ({ page }) => {
    const book = await openTree(page, BOOK_TITLE);
    await expect(book.locator(".step-row")).toHaveCount(5);
    const record = rowAt(book, "3");
    await expect(record.locator(".step-row")).toHaveAttribute("aria-expanded", "false");
    await record.locator(".step-row").click();
    await expect(record.locator(".step-row")).toHaveAttribute("aria-expanded", "true");
    const helper = rowAt(book, "3.1");
    await expect(helper).toBeVisible();
    expect(await css(helper, "padding-left")).toBe("26px");
    await helper.locator(".step-row").click();
    await expect(rowAt(book, "3.1.2")).toBeVisible();
    expect(await css(rowAt(book, "3.1.2"), "padding-left")).toBe("52px");
    await rowAt(book, "3.1.2").locator(".step-row").click();
    await expect(rowAt(book, "3.1.2.2")).toContainText("Check pronunciation");
    expect(await css(rowAt(book, "3.1.2.2"), "padding-left")).toBe("78px");
    await expect(book.locator(".step-row")).toHaveCount(5 + 1 + 6 + 3);
  });

  test("the arrow is drawn only on rows with children, and a leaf row opens too", async ({ page }) => {
    const book = await openTree(page, BOOK_TITLE);
    await expect(rowAt(book, "3").locator(".step-arrow svg")).toHaveCount(1);
    await expect(rowAt(book, "1").locator(".step-arrow svg")).toHaveCount(0);
    await rowAt(book, "1").locator(".step-row").click();
    await expect(rowAt(book, "1").locator(".step-box")).toBeVisible();
  });

  test("one row's open state does not close another's", async ({ page }) => {
    const book = await openTree(page, BOOK_TITLE);
    await rowAt(book, "1").locator(".step-row").click();
    await rowAt(book, "2").locator(".step-row").click();
    await expect(book.locator(".step-box")).toHaveCount(2);
    await rowAt(book, "1").locator(".step-row").click();
    await expect(book.locator(".step-box")).toHaveCount(1);
    await expect(rowAt(book, "2").locator(".step-box")).toBeVisible();
  });

  test("a parent reads X of Y sub-steps done with its running count, its state text and its open box", async ({ page }) => {
    const book = await openTree(page, BOOK_TITLE);
    const record = rowAt(book, "3");
    await expect(record.locator(".step-note")).toHaveText("3 of 8 sub-steps done · 3 running");
    await expect(record.locator(".step-state")).toHaveText("Running · 1 h 02 min");
    await record.locator(".step-row").click();
    const box = record.locator(".step-box");
    await expect(box.locator(".step-times")).toHaveText("Started 12:46 · running for 1 h 02 min");
    await expect(box.locator(".step-kids")).toHaveText("1 sub-steps below; tap one to open it");
    expect(await css(box, "margin-left")).toBe("62px");
  });

  test("a done leaf opens to its note and its start, finish and duration, and a waiting one says Not started yet", async ({ page }) => {
    const book = await openTree(page, BOOK_TITLE);
    await expect(rowAt(book, "2").locator(".step-state")).toHaveText("Done · 8 min, reported");
    await rowAt(book, "2").locator(".step-row").click();
    await expect(rowAt(book, "2").locator(".step-box")).toContainText("Text for 15 languages, 42 lines each");
    await expect(rowAt(book, "2").locator(".step-times")).toHaveText("Started 12:35 · finished 12:43 · took 8 min, reported");
    await expect(rowAt(book, "4").locator(".step-state")).toHaveText("Next");
    await expect(rowAt(book, "5").locator(".step-state")).toHaveText("Later");
    await rowAt(book, "4").locator(".step-row").click();
    await expect(rowAt(book, "4").locator(".step-times")).toHaveText("Not started yet");
  });

  test("every running step wears a ring that turns every 1.4 s, a parent included", async ({ page }) => {
    const book = await openTree(page, BOOK_TITLE);
    await rowAt(book, "3").locator(".step-row").click();
    await rowAt(book, "3.1").locator(".step-row").click();
    await rowAt(book, "3.1.2").locator(".step-row").click();
    await expect(book.locator(".step-ring")).toHaveCount(6);
    const ring = rowAt(book, "3.1.2.2").locator(".step-ring");
    expect(await css(ring, "animation-name")).toBe("ring-turn");
    expect(await css(ring, "animation-duration")).toBe("1.4s");
    expect(await css(ring, "animation-iteration-count")).toBe("infinite");
    await expect(rowAt(book, "3").locator(".step-ring circle")).toHaveAttribute("stroke-dasharray", "20 59");
    await expect(rowAt(book, "1").locator(".step-ring")).toHaveCount(0);
  });

  test("under reduced motion the rings stay drawn and do not turn", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const book = await openTree(page, BOOK_TITLE);
    const ring = rowAt(book, "3").locator(".step-ring");
    await expect(ring).toBeVisible();
    expect(await css(ring, "animation-name")).toBe("none");
  });
});
