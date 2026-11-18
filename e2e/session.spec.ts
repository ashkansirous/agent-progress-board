import { expect, type Locator, type Page, test } from "@playwright/test";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { CRASH_QUESTION, SEED_ITEMS } from "../scripts/seed-data";
import { SERVER_TIME, demoBoard, itemOf } from "./fixture";
import { project } from "./projectBlock";
import { sessionBoard } from "./sessionFixture";

const BOARD_ROUTE = "**/api/board";
const PHONE_WIDTH = 390;
const DRAWER_WIDTH = 480;
const CLOSE_SIZE = 44;

const isPhone = () => test.info().project.name === "phone";
const palette = () => exampleConfig.palettes[isPhone() ? "dark" : "light"];

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

async function openBoard(page: Page) {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: sessionBoard() }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const workingCard = (page: Page, goal: string): Locator =>
  page.locator("button.session-card").filter({ has: page.locator(".session-goal").getByText(goal, { exact: true }) });

const drawer = (page: Page): Locator => page.getByRole("dialog", { name: "Card details" });

test.describe("session cards", () => {
  test("a working card shows its session, goal, purpose and steps with the current step filled", async ({ page }) => {
    await openBoard(page);
    const example = project(page, "example-app");
    await expect(example.getByRole("heading", { name: "Working now · 3" })).toBeVisible();
    const card = workingCard(page, "Read the crash log on the iPhone 8");
    await expect(card).toContainText("session 9c1e · Laptop");
    await expect(card).toContainText("last activity 2 min ago");
    await expect(card).toContainText("For Slice 12: app crashes on start");
    const chips = card.getByRole("list", { name: "Steps" }).getByRole("listitem");
    await expect(chips).toHaveText(["✓Connect the phone", "●Read the logs", "Analyse", "Conclude", "Plan or fix"]);
    const now = chips.nth(1);
    expect(await css(now, "background-color")).toBe(rgbOf(palette().nowBg));
    expect(await css(now, "font-weight")).toBe("700");
    expect(await css(chips.nth(0), "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect(await css(card, "background-color")).toBe(rgbOf(palette().card));
  });

  test("a card with no goal is dashed and says how long ago it started", async ({ page }) => {
    await openBoard(page);
    const card = page.locator("button.session-card-nogoal");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Started 2 min ago, no goal reported yet");
    expect(await css(card, "border-top-style")).toBe("dashed");
    expect(await css(card.locator(".session-nogoal"), "font-style")).toBe("italic");
  });

  test("a stopped session leaves Working now and shows in Done as a dashed row", async ({ page }) => {
    await openBoard(page);
    await expect(page.locator("button.session-card").filter({ hasText: "Update the store screenshots" })).toHaveCount(0);
    await project(page, "example-app").getByRole("button", { name: /done in the last 12 hours/ }).click();
    const row = project(page, "example-app").locator("button.done-row-stale");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("session 7b3d · Update the store screenshots");
    await expect(row).toContainText("Stale: no activity for 15 min · 08:55");
    expect(await css(row, "border-top-style")).toBe("dashed");
    expect(await css(row, "background-color")).toBe(rgbOf(palette().chipBg));
  });
});

test.describe("question cards", () => {
  test("a tap on a question card's padding opens it, and the card is a named group (Slice 36)", async ({ page }) => {
    await openBoard(page);
    const card = page.locator(".question-card").filter({ hasText: "iPhone 8 or the iPad" });
    await expect(card).toHaveAttribute("role", "group");
    await expect(card).toHaveAttribute("aria-label", CRASH_QUESTION);
    await card.click({ position: { x: 3, y: 3 } });
    await expect(page.getByRole("dialog", { name: "Card details" })).toBeVisible();
  });

  test("a question card has the question in full, what follows, who asked and where to answer, and writes nothing", async ({ page }) => {
    await openBoard(page);
    const card = page.locator(".question-card").filter({ hasText: "iPhone 8 or the iPad" });
    await expect(card).toContainText(CRASH_QUESTION);
    await expect(card).toContainText("Then I read the log and write the cause into Slice 12.");
    await expect(card).toContainText("waiting 6 min");
    expect(await css(card, "background-color")).toBe(rgbOf(palette().needBg));
    // The mock's 1.5px border computes to a whole device pixel in Chromium at scale 1, so the width is not asserted.
    expect(await css(card, "border-top-style")).toBe("solid");
    expect(await css(card, "border-top-color")).toBe(rgbOf(palette().needBd));
    if (isPhone()) {
      await expect(card).toContainText("Asked by session 4f2a · Laptop");
      await expect(card).not.toContainText("answer in that session");
      await expect(card).toContainText("EXAMPLE-APP".toLowerCase());
    } else {
      await expect(card).toContainText("Asked by session 4f2a · Laptop · answer in that session");
      await expect(card).toContainText("Question");
    }
    await expect(page.locator("input, textarea, [contenteditable]")).toHaveCount(0);
  });

  test("questions sit under the project name on desktop and above the projects on the phone", async ({ page }) => {
    await openBoard(page);
    if (isPhone()) {
      await expect(page.getByRole("heading", { level: 2, name: "Needs you · 2" })).toBeVisible();
      await expect(project(page, "example-app").getByText("Its question is at the top of the page.")).toBeVisible();
      await expect(project(page, "example-app").locator(".question-card")).toHaveCount(0);
    } else {
      await expect(project(page, "example-app").getByRole("heading", { name: "Needs you · 1" })).toBeVisible();
      await expect(project(page, "tools").getByRole("heading", { name: "Needs you · 1" })).toBeVisible();
      await expect(project(page, "tools").locator(".question-card")).toContainText("Should I delete the 40 old backups");
    }
  });
});

test.describe("card drawer", () => {
  test("opens from a question with the question as its title and the after-answer box", async ({ page }) => {
    await openBoard(page);
    await page.locator(".question-card").filter({ hasText: "iPhone 8 or the iPad" }).click();
    const panel = drawer(page);
    await expect(panel).toBeVisible();
    await expect(panel.locator(".kicker")).toHaveText("Needs you");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(CRASH_QUESTION);
    await expect(panel).toContainText("session 4f2a · Laptop · waiting 6 min");
    await expect(panel.locator(".drawer-after")).toHaveText("After you answer: I read the log and write the cause into Slice 12.");
    await expect(panel.locator(".step-row .step-state")).toHaveText(["Done", "Now", "Next", "Later"]);
    await expect(panel.locator("input, textarea")).toHaveCount(0);
    const box = (await panel.boundingBox())!;
    if (isPhone()) {
      expect(box.x).toBe(0);
      expect(box.width).toBe(PHONE_WIDTH);
    } else {
      expect(box.width).toBe(DRAWER_WIDTH);
    }
  });

  test("opens from a working card with its steps, done so far, links and history in plain words", async ({ page }) => {
    await openBoard(page);
    await workingCard(page, "Read the crash log on the iPhone 8").click();
    const panel = drawer(page);
    await expect(panel.locator(".kicker")).toHaveText("Working now");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Read the crash log on the iPhone 8");
    await expect(panel).toContainText("session 9c1e · Laptop · last activity 2 min ago");
    await expect(panel.locator(".drawer-bullets li")).toHaveText([
      "Connected the iPhone 8 over USB",
      "Found 3 crash logs from release 2.3.1, all at start-up",
    ]);
    await expect(panel.locator(".step-row .step-state")).toHaveText(["Done", "Now", "Next", "Later", "Later"]);
    await expect(panel.getByRole("link", { name: "Pull request #88" })).toBeVisible();
    const rows = panel.locator(".drawer-history li");
    await expect(rows).toHaveText([
      "09:20Started",
      "09:31Needs you: Which iPhone should I read the crash log…",
      "09:38Answered",
      "09:52Finished turn",
      "10:05Started",
      "13:46Reading the logs",
    ]);
    expect(await css(panel.locator(".step-row-active"), "background-color")).toBe(rgbOf(palette().sliceBg));
  });

  test("opens from a stale row with the Stale kicker and the steps it had", async ({ page }) => {
    await openBoard(page);
    await project(page, "example-app").getByRole("button", { name: /done in the last 12 hours/ }).click();
    await page.locator("button.done-row-stale").click();
    const panel = drawer(page);
    await expect(panel.locator(".kicker")).toHaveText("Stale");
    await expect(panel).toContainText("session 7b3d · Cloud VM · no activity for 15 min");
    await expect(panel.locator(".step-label")).toHaveText(["Take the screenshots", "Add captions", "Upload"]);
    await expect(panel.locator(".drawer-history li").last()).toContainText("Stale: no activity for 15 min");
  });

  test("closes with the 44px Close button, the scrim and Escape", async ({ page }) => {
    await openBoard(page);
    const open = async () => {
      await workingCard(page, "Build Slices 9 and 10 overnight").click();
      await expect(drawer(page)).toBeVisible();
    };
    await open();
    const close = drawer(page).getByRole("button", { name: "Close", exact: true });
    const box = (await close.boundingBox())!;
    expect([box.width, box.height]).toEqual([CLOSE_SIZE, CLOSE_SIZE]);
    await close.click();
    await expect(drawer(page)).toHaveCount(0);
    await open();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    if (!isPhone()) {
      await open();
      await page.mouse.click(100, 400);
      await expect(drawer(page)).toHaveCount(0);
    }
  });
});

test.describe("Needs you cards say what is needed (Slice 27)", () => {
  async function openWith(page: Page, changes: Record<string, Partial<ReturnType<typeof itemOf>>>) {
    const board = demoBoard(SEED_ITEMS.map((seed) => ({ ...itemOf(seed), ...(changes[seed.key] ?? {}) })));
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: board }));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  test("a doc-sync card shows the step, why in full and its link", async ({ page }) => {
    const why = "Slice 4: Tag search \u2014 so that the release can go out, and a much longer reason follows so the line would be cut if it were one line only.";
    await openWith(page, { "recipe-box/ask-migration": { why, links: [{ label: "Slice file", url: "https://example.com/slice-4.md" }] } });
    const card = page.locator(".question-card").filter({ hasText: "Approve the tags migration" });
    await expect(card.locator(".question-text")).toHaveText("Approve the tags migration");
    await expect(card.locator(".question-why")).toHaveText(why);
    await expect(card.getByRole("link", { name: "Slice file" })).toHaveAttribute("href", "https://example.com/slice-4.md");
  });

  test("a card with no question and no why says so instead of repeating the title", async ({ page }) => {
    await openWith(page, { "recipe-box/ask-migration": { why: "", links: [] } });
    const card = page.locator(".question-card").filter({ hasText: "Approve the tags migration" });
    await expect(card.locator(".question-text")).toHaveText("No question recorded");
    await expect(card.locator(".question-work")).toHaveText("Approve the tags migration");
  });
});
