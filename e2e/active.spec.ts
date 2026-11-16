import { expect, type Locator, type Page, test } from "@playwright/test";
import type { BoardResponse } from "../src/api/boardDto";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { activeBoard, activeTasks, CRASH, PART_B, PART_C, STALE } from "./activeFixture";
import { demoBoard, SERVER_TIME } from "./fixture";

const BOARD_ROUTE = "**/api/board";
const SLOW_MS = 1500;

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

  test("the header says how many tasks run and when it was updated, as drawn for the size", async ({ page }) => {
    await openActive(page);
    if (isPhone()) {
      await expect(page.getByText("3 tasks running · updated 13:48")).toBeVisible();
    } else {
      await expect(
        page.getByText("Tasks an agent is working on now, across projects · updated 13:48 · a task that stops reporting turns stale and leaves this page"),
      ).toBeVisible();
    }
  });

  test("the Active work tab is current and shows the number of cards", async ({ page }) => {
    await openActive(page);
    const tab = tabs(page).getByRole("link", { name: /^Active work/ });
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(tab.locator(".tab-count")).toHaveText("3");
  });

  test("the tab count is left out when nothing is working, and the empty card shows", async ({ page }) => {
    const idle = activeBoard(activeTasks().map((task) => ({ ...task, working: false })));
    await openActive(page, idle);
    await expect(page.getByText("No agent is working right now")).toBeVisible();
    await expect(page.getByText("Tasks show here while an agent reports progress on them. Stale tasks move back to the board.")).toBeVisible();
    await expect(tabs(page).locator(".tab-count")).toHaveCount(0);
    expect(await css(page.locator(".state-card"), "row-gap")).toBe("14px");
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

  test("the toggle opens and closes the full list with Done, Now, Next and Later and the notes", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    const toggle = part.getByRole("button", { name: "Show all 7 steps" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(part.locator(".step-row")).toHaveCount(0);
    expect(await css(toggle, "min-height")).toBe("44px");
    await toggle.click();
    const hide = part.getByRole("button", { name: "Hide steps" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(part.locator(".step-row .step-state")).toHaveText(["Done", "Done", "Done", "Now", "Next", "Later", "Later"]);
    await expect(part.locator(".step-row-active .step-note")).toHaveText("Two helper agents count under this step");
    await expect(part.locator(".step-row-active")).toHaveAttribute("aria-current", "step");
    expect(await css(part.locator(".step-row-active"), "background-color")).toBe(rgbOf(palette().stepActiveRow));
    expect(await css(part.locator(".step-row-done .step-mark").first(), "background-color")).toBe(rgbOf(palette().stepDone));
    await hide.click();
    await expect(part.locator(".step-row")).toHaveCount(0);
    await expect(part.getByRole("button", { name: "Show all 7 steps" })).toBeVisible();
  });

  test("a note shows under its label on the bug's pending step", async ({ page }) => {
    await openActive(page);
    const bug = card(page, "Crash opening an empty bed");
    await bug.getByRole("button", { name: "Show all 4 steps" }).click();
    await expect(bug.locator(".step-note")).toHaveText("No tablet test: no tablet code changed");
    await expect(bug.locator(".step-row .step-state")).toHaveText(["Done", "Now", "Next", "Later"]);
  });

  test("a task with no active step reads Starting", async ({ page }) => {
    const starting = activeTasks().map((task) =>
      task.key === PART_B ? { ...task, progress: { done: 0, total: 5, percent: 0, current: null } } : task,
    );
    await openActive(page, activeBoard(starting));
    await expect(card(page, "Part B · Search box").locator(".progress-now")).toHaveText("Starting");
  });

  test("the link back opens the board with that task's detail", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    await part.getByRole("button", { name: "Show all 7 steps" }).click();
    const link = part.getByRole("link", { name: "Back to Slice 9 · Frost alerts on the board" });
    await expect(link).toHaveAttribute("href", `#/open/${encodeURIComponent(PART_C)}`);
    await link.click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Part C · Notification channel");
  });

  test("closing the opened detail resets the address, so a reload keeps it closed and back and forward move it", async ({ page }) => {
    await openActive(page);
    const part = card(page, "Part C · Notification channel");
    await part.getByRole("button", { name: "Show all 7 steps" }).click();
    await part.getByRole("link", { name: "Back to Slice 9 · Frost alerts on the board" }).click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#/");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/open/${encodeURIComponent(PART_C)}`);
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await expect(dialog).toHaveCount(0);
  });

  test("a failed first load keeps the open-item address", async ({ page }) => {
    const hash = `#/open/${encodeURIComponent(PART_C)}`;
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ status: 500, json: { error: "down" } }));
    await page.goto(`/${hash}`);
    await expect(page.getByRole("alert").or(page.locator(".state-card")).first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(new URL(page.url()).hash).toBe(hash);
  });

  test("the Active work count stays in the tab bar on the Usage view", async ({ page }) => {
    await openActive(page);
    await expect(tabs(page).locator(".tab-count")).toHaveText("3");
    await tabs(page).getByRole("link", { name: /Usage/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
    await expect(tabs(page).locator(".tab-count")).toHaveText("3");
  });

  test("a wait over 500 ms shows the loading card, then the cards", async ({ page }) => {
    await page.route(BOARD_ROUTE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      await route.fulfill({ json: activeBoard() });
    });
    await page.goto("/#/active");
    await page.waitForTimeout(250);
    await expect(page.getByText("Loading active work…")).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Loading active work…" })).toBeVisible({ timeout: 1000 });
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

  const sliceNine = (page: Page) =>
    page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText("Slice 9 · Frost alerts", { exact: true }) });

  test("the board's Active work tab carries the count", async ({ page }) => {
    await openBoard(page);
    await expect(tabs(page).getByRole("link", { name: /^Active work/ }).locator(".tab-count")).toHaveText("1");
  });

  test("a task's tile shows the step now, the counts and the bar in the type's colours", async ({ page }) => {
    await openBoard(page);
    const tile = sliceNine(page);
    await expect(tile.locator(".tile-steps-now")).toHaveText("Review 2");
    await expect(tile.locator(".tile-steps-count")).toHaveText("3 of 7 steps · 43%");
    const bar = tile.locator(".step-bar");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(await css(bar, "height")).toBe("6px");
    const type = exampleConfig.types.slice[scheme()];
    const colours = await bar.locator(".seg").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    expect(colours).toEqual([...Array<string>(3).fill(rgbOf(type.fg)), rgbOf(type.border), ...Array<string>(3).fill(rgbOf(palette().stepPendingTile))]);
  });

  test("a task with no steps list has no steps row on its tile", async ({ page }) => {
    await openBoard(page);
    const plain = page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText("Slice 4 · Tag search", { exact: true }) });
    await expect(plain).toBeVisible();
    await expect(plain.locator(".tile-steps")).toHaveCount(0);
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
    await page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText("Slice 4 · Tag search", { exact: true }) }).click();
    await expect(page.getByRole("dialog", { name: "Item details" })).toBeVisible();
    await expect(page.locator(".steps-section")).toHaveCount(0);
  });

  test("a done task reads 100% on its tile whatever its list says", async ({ page }) => {
    const board = demoBoard();
    const done = board.items.map((item) =>
      item.key === "garden-planner/slice-9"
        ? { ...item, status: "done" as const, done_at: SERVER_TIME, progress: { done: 7, total: 7, percent: 100, current: null }, working: false }
        : item,
    );
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: { ...board, items: done } }));
    await page.goto("/");
    const tile = sliceNine(page);
    await expect(tile.locator(".tile-steps-count")).toHaveText("7 of 7 steps · 100%");
    await expect(tile.locator(".tile-steps-now")).toHaveText("Done");
  });
});

test("the stale task keeps its steps on the board but is not counted", async ({ page }) => {
  const board = activeBoard();
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: board }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const stale = page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText("Slice 10 · Seed inventory", { exact: true }) });
  await expect(stale).toContainText("Stale");
  await expect(stale.locator(".tile-steps-count")).toHaveText("1 of 3 steps · 33%");
  expect(STALE).toBe("garden-planner/slice-10");
  await expect(tabs(page).getByRole("link", { name: /^Active work/ }).locator(".tab-count")).toHaveText("3");
});
