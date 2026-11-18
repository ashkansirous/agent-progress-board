import { expect, type Locator, type Page, test } from "@playwright/test";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { PLANNING_SEED_ITEMS, SESSION_SEED_ITEMS } from "../scripts/seed-data";
import { boardOfSeeds, SERVER_TIME } from "./fixture";
import { project } from "./projectBlock";
import { planningBoard } from "./sessionFixture";

const BOARD_ROUTE = "**/api/board";
const SUMMARY = "1 needs you · 3 working · 3 planned · 2 problems · 30 checks not tried";
const LOOSE_COUNT = 22;
const DONE_COUNT = 12;
const NEWEST_DONE = 5;

const isPhone = () => test.info().project.name === "phone";
const scheme = () => (isPhone() ? "dark" : "light");
const palette = () => exampleConfig.palettes[scheme()];

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

async function openBoard(page: Page) {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: planningBoard() }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const example = (page: Page): Locator => project(page, "example-app");

const sliceCard = (page: Page, words: string): Locator =>
  page.locator("button.slice-card").filter({ has: page.locator(".slice-title").getByText(words, { exact: true }) });

test.describe("checks are counts, never cards", () => {
  test("the summary line, the slice cards and the loose-checks card agree on 30 checks", async ({ page }) => {
    await openBoard(page);
    const project = example(page);
    await expect(project.locator(".project-summary")).toHaveText(SUMMARY);
    const perSlice = await project.locator(".slice-checks").allTextContents();
    expect(perSlice).toEqual([
      "3 checks not tried on a device",
      "5 checks not tried on a device",
      "All checks tried",
    ]);
    await expect(project.locator(".loose-line")).toHaveText(`${LOOSE_COUNT} checks with no open slice`);
    await expect(project.locator(".loose-note")).toHaveText("Not tried on a device; their slices are not on the board");
    expect(3 + 5 + LOOSE_COUNT).toBe(30);
  });

  test("no check line is a card or a tile anywhere on the board", async ({ page }) => {
    await openBoard(page);
    await expect(page.getByText("Cold start on the iPhone 8 with no network")).toHaveCount(0);
    await expect(page.getByText("Closed-slice check 1", { exact: true })).toHaveCount(0);
    await expect(page.locator("button.tile")).toHaveCount(0);
  });
});

test.describe("planned slice cards", () => {
  test("show the number, the status pill, the title, a lettered bar, the part now and the counts", async ({ page }) => {
    await openBoard(page);
    const project = example(page);
    await expect(project.getByRole("heading", { level: 3, name: "Planned · 3" })).toBeVisible();
    const card = sliceCard(page, "App crashes on start");
    await expect(card.locator(".slice-number")).toHaveText("Slice 12");
    await expect(card.locator(".slice-pill")).toHaveText("In progress");
    await expect(card.locator(".slice-seg")).toHaveText(["A", "B", "C", "D", "E"]);
    await expect(card.locator(".slice-now-line")).toHaveText("Now: part C, Fix the start-up race");
    await expect(card.locator(".slice-now-count")).toHaveText("2 of 5 parts");
    expect(await css(card, "background-color")).toBe(rgbOf(exampleConfig.types.slice[scheme()].bg));
    expect(await css(card, "border-top-color")).toBe(rgbOf(palette().sliceBd));
    expect(await css(card, "border-top-left-radius")).toBe("12px");
    expect(await css(card, "padding")).toBe("14px 16px");
    expect(await css(card.locator(".slice-title"), "font-size")).toBe("15px");
    expect(await css(card.locator(".slice-pill"), "background-color")).toBe(rgbOf(palette().card));
  });

  test("a planned slice says Not started, a parked one says where it stopped and is faded", async ({ page }) => {
    await openBoard(page);
    const planned = sliceCard(page, "Offline mode");
    await expect(planned.locator(".slice-pill")).toHaveText("Planned");
    await expect(planned.locator(".slice-now-line")).toHaveText("Not started");
    await expect(planned.locator(".slice-now-count")).toHaveText("0 of 4 parts");
    const parked = sliceCard(page, "Share sheet");
    await expect(parked.locator(".slice-pill")).toHaveText("Parked");
    await expect(parked.locator(".slice-now-line")).toHaveText("Parked after part A");
    expect(await css(parked.locator("xpath=.."), "opacity")).toBe("0.7");
    expect(await css(planned.locator("xpath=.."), "opacity")).toBe("1");
  });

  test("the dashed card opens the list of the checks whose slice is closed", async ({ page }) => {
    await openBoard(page);
    const loose = example(page).locator("button.loose-card");
    expect(await css(loose, "border-top-style")).toBe("dashed");
    expect(await css(loose, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await loose.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(`${LOOSE_COUNT} checks with no open slice`);
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(`Checks not tried on a device · ${LOOSE_COUNT}`);
    await expect(dialog.locator(".check-row")).toHaveCount(LOOSE_COUNT);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("problems and bugs", () => {
  test("list a bug that names its slice and a problem with none, in the kind colours", async ({ page }) => {
    await openBoard(page);
    const project = example(page);
    await expect(project.getByRole("heading", { level: 3, name: "Problems and bugs · 2" })).toBeVisible();
    const bug = project.locator("button.problem-bug");
    await expect(bug.locator(".problem-kind")).toHaveText("Bug");
    await expect(bug.locator(".problem-what")).toHaveText("App crashes on start on iOS 16");
    await expect(bug.locator(".problem-where")).toHaveText("Found in the crash log of release 2.3.1, iPhone 8");
    await expect(bug.locator(".problem-chip")).toHaveText("Slice 12 planned");
    expect(await css(bug, "background-color")).toBe(rgbOf(palette().bugBg));
    expect(await css(bug, "border-top-color")).toBe(rgbOf(palette().bugBd));
    expect(await css(bug.locator(".problem-kind"), "color")).toBe(rgbOf(palette().bugFg));
    expect(await css(bug.locator(".problem-chip"), "border-top-style")).toBe("solid");
    const problem = project.locator("button.problem-problem");
    await expect(problem.locator(".problem-kind")).toHaveText("Problem");
    await expect(problem.locator(".problem-chip")).toHaveText("No slice yet");
    expect(await css(problem.locator(".problem-chip"), "border-top-style")).toBe("dashed");
    expect(await css(problem, "background-color")).toBe(rgbOf(palette().probBg));
  });
});

test.describe("the drawer lists parts and checks", () => {
  test("a slice's drawer has its checks after its parts, and nothing for an empty list", async ({ page }) => {
    await openBoard(page);
    await sliceCard(page, "App crashes on start").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { level: 3, name: "Checks not tried on a device · 3" })).toBeVisible();
    const checks = dialog.locator(".checks-section").filter({ has: page.getByRole("heading", { level: 3, name: "Checks not tried on a device · 3" }) });
    await expect(checks.locator(".check-label")).toHaveText([
      "Cold start on the iPhone 8 with no network",
      "Start after an update from 2.3.0",
      "Start with 500 saved notes",
    ]);
    await page.keyboard.press("Escape");
    await sliceCard(page, "Share sheet").click();
    await expect(page.getByRole("dialog").getByRole("heading", { level: 3, name: /^Checks not tried/ })).toHaveCount(0);
  });

  test("a working card's drawer lists the parts and checks of the slice it names", async ({ page }) => {
    await openBoard(page);
    await page.locator("button.session-card").filter({ hasText: "Read the crash log on the iPhone 8" }).click();
    const dialog = page.getByRole("dialog", { name: "Card details" });
    await expect(dialog.getByRole("heading", { level: 3, name: "Slice 12 parts · 2 of 5 done" })).toBeVisible();
    await expect(dialog.locator(".check-row-done .check-state")).toHaveText(["Done", "Done"]);
    await expect(dialog.locator(".check-row-active .check-state")).toHaveText("Working now");
    await expect(dialog.getByRole("heading", { level: 3, name: "Slice 12 checks not tried on a device · 3" })).toBeVisible();
  });
});

test.describe("the done list", () => {
  test("is a closed button with the count, then the newest five and Show all", async ({ page }) => {
    await openBoard(page);
    const project = example(page);
    const toggle = project.getByRole("button", { name: `${DONE_COUNT} done in the last 12 hours` });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await css(toggle, "min-height")).toBe("44px");
    await expect(project.locator(".done-row")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(project.locator(".done-row-title")).toHaveCount(NEWEST_DONE + 1);
    await expect(project.locator(".done-row-title").first()).toHaveText("Slice 10 · part B merged");
    await expect(project.locator(".done-row-stale")).toHaveText(/session 7b3d · Update the store screenshots/);
    await project.getByRole("button", { name: `Show all ${DONE_COUNT}` }).click();
    await expect(project.locator(".done-row-title")).toHaveCount(DONE_COUNT);
    await expect(project.getByRole("button", { name: /^Show all/ })).toHaveCount(0);
  });
});

const BUILT_KEY = "example-app/slice-9";

/** The planning board plus Slice 9: done, with two checks not tried (Slice 42), built from copies of Slice 13's seed rows. */
function boardWithBuilt() {
  const template = PLANNING_SEED_ITEMS.find((seed) => seed.key === "example-app/slice-13");
  const checkTemplate = PLANNING_SEED_ITEMS.find((seed) => seed.type === "check" && seed.parentKey === "example-app/slice-13");
  if (!template || !checkTemplate) throw new Error("the planning seed lost Slice 13 or one of its checks");
  const built = { ...template, key: BUILT_KEY, status: "done", title: "Slice 9 · Share a link", doneMinutesAgo: 30 };
  const checks = [1, 2].map((n) => ({ ...checkTemplate, key: `${BUILT_KEY}/check-${n}`, title: `Built check ${n}`, parentKey: BUILT_KEY }));
  return boardOfSeeds([...SESSION_SEED_ITEMS, ...PLANNING_SEED_ITEMS, built, ...checks]);
}

test.describe("a built slice with checks not tried (Slice 42)", () => {
  test("is listed under Built with the Built pill and its check count, and is not counted as planned", async ({ page }) => {
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: boardWithBuilt() }));
    await page.goto("/");
    const project = example(page);
    await expect(project.locator(".project-summary")).toHaveText("1 needs you · 3 working · 3 planned · 1 built · 2 problems · 32 checks not tried");
    await expect(project.getByRole("heading", { level: 3, name: "Planned · 3" })).toBeVisible();
    const toggle = project.getByRole("button", { name: "Built · 1" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sliceCard(page, "Share a link")).toHaveCount(0);
    await toggle.click();
    const card = sliceCard(page, "Share a link");
    await expect(card.locator(".slice-pill")).toHaveText("Built");
    await expect(card.locator(".slice-checks")).toHaveText("2 checks not tried on a device");
    await expect(project.locator(".planned-section button.slice-card").filter({ hasText: "Share a link" })).toHaveCount(0);
  });
});
