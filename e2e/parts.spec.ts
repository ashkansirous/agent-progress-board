import { expect, type Locator, type Page, test } from "@playwright/test";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { SERVER_TIME } from "./fixture";
import { partsBoard } from "./partsFixture";
import { openAllProjects } from "./projectBlock";

const BOARD_ROUTE = "**/api/board";

const isPhone = () => test.info().project.name === "phone";
const scheme = () => (isPhone() ? "dark" : "light");
const palette = () => exampleConfig.palettes[scheme()];
const sliceColours = () => exampleConfig.types.slice[scheme()];

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

async function openAt(page: Page, hash = "/") {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: partsBoard() }));
  await page.goto(hash);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // A drawer opened by the address makes the page inert, and then no card is clicked.
  if (hash === "/") await openAllProjects(page);
}

/** The card button of the planned slice with this title ("Slice 4 · Tag search" shows as the number and "Tag search"). */
function tileTitled(page: Page, title: string): Locator {
  const words = /^Slice \d+ · (.+)$/.exec(title)![1]!;
  return page.locator("button.slice-card").filter({ has: page.locator(".slice-title").getByText(words, { exact: true }) });
}

const cardOf = (tile: Locator): Locator => tile.locator("xpath=..");

const FIVE_TITLE = "Slice 4 · Tag search";
const STALE_TITLE = "Slice 9 · Frost alerts";
const DONE_TITLE = "Slice 2 · Backup rotation";
const NONE_TITLE = "Slice 10 · Seed inventory";

test.describe("parts bar on the slice card", () => {
  test("draws one lettered segment per part, the part now and the counts in the slice's colours", async ({ page }) => {
    await openAt(page);
    const card = tileTitled(page, FIVE_TITLE);
    await expect(card.locator(".slice-now-line")).toHaveText("Now: part B, Search box");
    await expect(card.locator(".slice-now-count")).toHaveText("1 of 5 parts");
    const bar = card.locator(".slice-segs");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    await expect(bar.locator(".slice-seg")).toHaveText(["A", "B", "C", "D", "E"]);
    expect(await bar.locator(".slice-seg").evaluateAll((els) => els.map((el) => el.className.replace(/^slice-seg /, "")))).toEqual([
      "slice-seg-done",
      "slice-seg-active",
      "slice-seg-later",
      "slice-seg-later",
      "slice-seg-later",
    ]);
    const done = bar.locator(".slice-seg-done");
    expect(await css(done, "height")).toBe("16px");
    expect(await css(done, "border-top-left-radius")).toBe("4px");
    expect(await css(done, "background-color")).toBe(rgbOf(sliceColours().fg));
    expect(await css(done, "color")).toBe(rgbOf(palette().card));
    expect(await css(bar.locator(".slice-seg-active"), "background-color")).toBe(rgbOf(palette().card));
    expect(await css(bar.locator(".slice-seg-active"), "border-top-color")).toBe(rgbOf(sliceColours().fg));
    expect(await css(card.locator(".slice-now-line"), "font-weight")).toBe("600");
    expect(await css(card.locator(".slice-now"), "font-size")).toBe("12px");
  });

  test("reads a stale part with (stale), all parts done, and shows no bar for a slice with no parts", async ({ page }) => {
    await openAt(page);
    await expect(tileTitled(page, STALE_TITLE).locator(".slice-now-line")).toHaveText("Now: part B, Notification channel (stale)");
    await expect(tileTitled(page, STALE_TITLE).locator(".slice-now-count")).toHaveText("1 of 3 parts");
    await expect(tileTitled(page, DONE_TITLE).locator(".slice-now-line")).toHaveText("All parts done");
    await expect(tileTitled(page, DONE_TITLE).locator(".slice-now-count")).toHaveText("2 of 2 parts");
    await expect(tileTitled(page, NONE_TITLE).locator(".slice-segs")).toHaveCount(0);
    await expect(tileTitled(page, NONE_TITLE).locator(".slice-now")).toHaveCount(0);
  });

  test("gives a part no tile of its own", async ({ page }) => {
    await openAt(page);
    await expect(page.locator(".tile-title").getByText("Search box", { exact: true })).toHaveCount(0);
  });
});

test.describe("follow link under the tile", () => {
  test("is there only for the slice with an active part, outside the tile button, sized as drawn", async ({ page }) => {
    await openAt(page);
    await expect(page.locator("a.tile-follow")).toHaveCount(1);
    const link = cardOf(tileTitled(page, FIVE_TITLE)).locator("a.tile-follow");
    await expect(link).toHaveText("Follow part B");
    expect(await css(link, "min-height")).toBe("44px");
    expect(await css(link, "font-size")).toBe("13px");
    expect(await css(link, "margin")).toBe("0px 0px 4px 8px");
    expect(await css(link, "color")).toBe(rgbOf(palette().text));
    await expect(link.locator("svg")).toHaveAttribute("width", "14");
    await expect(tileTitled(page, FIVE_TITLE).locator("a")).toHaveCount(0);
  });

  test("leads to Active work with that part's card expanded, and the way back opens the slice", async ({ page }) => {
    await openAt(page);
    await cardOf(tileTitled(page, FIVE_TITLE)).getByRole("link", { name: "Follow part B" }).click();
    await expect(page).toHaveURL(/#\/active\/recipe-box%2Fslice-4%2Fpart-B$/);
    const card = page.locator("li.active-card", { has: page.getByRole("heading", { level: 2, name: "Part B · Search box", exact: true }) });
    await expect(card.locator(".step-row")).toHaveCount(5);
    await expect(card.locator(".active-meta")).toContainText("Slice 4 · Tag search");
    await card.getByRole("link", { name: "Back to Slice 4 · Tag search on the board" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { level: 2, name: FIVE_TITLE })).toBeVisible();
  });

  test("the tile itself still opens the drawer", async ({ page }) => {
    await openAt(page);
    await tileTitled(page, FIVE_TITLE).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("a key with no card shows the Active work page with both cards and their steps", async ({ page }) => {
    await openAt(page, "/#/active/nothing%2Fhere");
    await expect(page.locator("li.active-card")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^(Hide steps|Show all \d+ steps)$/ })).toHaveCount(0);
  });
});

test.describe("parts in the drawer", () => {
  async function openDrawer(page: Page, title: string): Promise<Locator> {
    await openAt(page);
    await tileTitled(page, title).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("lists every part with its state, after the key row", async ({ page }) => {
    const dialog = await openDrawer(page, FIVE_TITLE);
    const section = dialog.locator(".checks-section").filter({ has: page.getByRole("heading", { level: 3, name: "Parts · 1 of 5 done" }) });
    await expect(section).toHaveCount(1);
    await expect(section.locator(".check-label")).toHaveText([
      "A · Server",
      "B · Search box",
      "C · Tag chips",
      "D · Join table",
      "E · Release",
    ]);
    await expect(section.locator(".check-state")).toHaveText(["Done", "Working now", "", "", ""]);
    expect(await css(section.locator(".check-row-done .check-box"), "background-color")).toBe(rgbOf(palette().doneFg));
    await expect(section.locator(".check-row-done .check-box")).toHaveText("✓");
    expect(await css(section.locator(".check-row-active .check-state"), "color")).toBe(rgbOf(palette().sliceFg));
    await expect(dialog.locator(".parts-bar")).toHaveCount(0);
  });

  test("has the follow button for an active part, and it lands on the expanded card", async ({ page }) => {
    const dialog = await openDrawer(page, FIVE_TITLE);
    const button = dialog.getByRole("link", { name: "Follow part B on Active work" });
    expect(await css(button, "min-height")).toBe("44px");
    expect(await css(button, "background-color")).toBe(rgbOf(palette().primaryBg));
    expect(await css(button, "color")).toBe(rgbOf(palette().primaryFg));
    expect(await css(button, "border-top-left-radius")).toBe("10px");
    await button.click();
    await expect(page).toHaveURL(/#\/active\/recipe-box%2Fslice-4%2Fpart-B$/);
    await expect(page.locator("li.active-card").filter({ hasText: "Part B · Search box" }).locator(".step-row").first()).toBeVisible();
  });

  test("a stale part reads Stale with its step and offers nothing to follow", async ({ page }) => {
    const dialog = await openDrawer(page, STALE_TITLE);
    await expect(dialog.locator(".check-state")).toHaveText(["Done", "Stale", ""]);
    await expect(dialog.getByRole("link", { name: /Follow part/ })).toHaveCount(0);
  });

  test("all parts done lists them done with no button, and a slice with no parts has no section", async ({ page }) => {
    const dialog = await openDrawer(page, DONE_TITLE);
    await expect(dialog.locator(".check-state")).toHaveText(["Done", "Done"]);
    await expect(dialog.getByRole("link", { name: /Follow part/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tileTitled(page, NONE_TITLE).click();
    await expect(page.getByRole("dialog").getByRole("heading", { level: 3, name: /^Parts/ })).toHaveCount(0);
  });
});
