import { expect, type Locator, type Page, test } from "@playwright/test";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { SERVER_TIME } from "./fixture";
import { partsBoard } from "./partsFixture";

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
}

/** The tile button of the slice with this title (a title also shows as another tile's parent). */
function tileTitled(page: Page, title: string): Locator {
  return page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText(title, { exact: true }) });
}

const cardOf = (tile: Locator): Locator => tile.locator("xpath=..");

const FIVE_TITLE = "Slice 4 · Tag search";
const STALE_TITLE = "Slice 9 · Frost alerts";
const DONE_TITLE = "Slice 2 · Backup rotation";
const NONE_TITLE = "Slice 3 · Share links";

test.describe("parts bar on the tile", () => {
  test("shows the part now, the counts and a bar 20% full in the slice's colour", async ({ page }) => {
    await openAt(page);
    const tile = tileTitled(page, FIVE_TITLE);
    await expect(tile.locator(".tile-parts-now")).toHaveText("Part B · Reviewing");
    await expect(tile.locator(".tile-parts-count")).toHaveText("1 of 5 parts · 20%");
    const bar = tile.locator(".parts-bar");
    await expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(await css(bar, "height")).toBe("6px");
    expect(await css(bar, "border-top-left-radius")).toBe("3px");
    expect(await css(bar, "background-color")).toBe(rgbOf(palette().partTrack));
    expect(await css(bar.locator(".parts-bar-fill"), "background-color")).toBe(rgbOf(sliceColours().fg));
    const widths = await bar.evaluate((el) => [el.getBoundingClientRect().width, el.firstElementChild!.getBoundingClientRect().width]);
    expect(widths[1]! / widths[0]!).toBeCloseTo(0.2, 2);
    expect(await css(tile.locator(".tile-parts-now"), "font-weight")).toBe("600");
    expect(await css(tile.locator(".tile-parts-line"), "font-size")).toBe("12px");
  });

  test("reads a stale part with (stale), all parts done, and shows no bar for a slice with no parts", async ({ page }) => {
    await openAt(page);
    await expect(tileTitled(page, STALE_TITLE).locator(".tile-parts-now")).toHaveText("Part B · Implementing (stale)");
    await expect(tileTitled(page, STALE_TITLE).locator(".tile-parts-count")).toHaveText("1 of 3 parts · 33%");
    await expect(tileTitled(page, DONE_TITLE).locator(".tile-parts-now")).toHaveText("All parts done");
    await expect(tileTitled(page, DONE_TITLE).locator(".tile-parts-count")).toHaveText("2 of 2 parts · 100%");
    await expect(tileTitled(page, NONE_TITLE).locator(".tile-parts")).toHaveCount(0);
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
    expect(await css(link, "margin")).toBe("-8px 0px 4px 8px");
    expect(await css(link, "color")).toBe(rgbOf(palette().text));
    await expect(link.locator("svg")).toHaveAttribute("width", "14");
    await expect(tileTitled(page, FIVE_TITLE).locator("a")).toHaveCount(0);
  });

  test("leads to Active work with that part's card expanded, and the way back opens the slice", async ({ page }) => {
    await openAt(page);
    await cardOf(tileTitled(page, FIVE_TITLE)).getByRole("link", { name: "Follow part B" }).click();
    await expect(page).toHaveURL(/#\/active\/recipe-box%2Fslice-4%2Fpart-B$/);
    const card = page.locator("li.active-card", { has: page.getByRole("heading", { level: 2, name: "Part B · Search box", exact: true }) });
    await expect(card.getByRole("button", { name: "Hide steps" })).toHaveAttribute("aria-expanded", "true");
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

  test("a key with no card shows the Active work page with nothing expanded", async ({ page }) => {
    await openAt(page, "/#/active/nothing%2Fhere");
    await expect(page.locator("li.active-card")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Hide steps" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Show all \d+ steps$/ })).toHaveCount(2);
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
    const section = dialog.locator(".parts-section");
    await expect(section.getByRole("heading", { level: 3, name: "Parts" })).toBeVisible();
    await expect(section.locator(".parts-count")).toHaveText("1 of 5 parts · 20%");
    await expect(section.locator(".part-mark")).toHaveText(["A", "B", "C", "D", "E"]);
    await expect(section.locator(".part-title")).toHaveText(["Server", "Search box", "Tag chips", "Join table", "Release"]);
    const active = isPhone() ? "Reviewing · 1 of 5 steps" : "Active · Reviewing · 1 of 5 steps";
    await expect(section.locator(".part-state")).toHaveText(["Done", active, "Next", "Later", "Later"]);
    await expect(section.locator(".part-row-active")).toHaveAttribute("aria-current", "step");
    expect(await css(section.locator(".part-row-active"), "background-color")).toBe(rgbOf(palette().stepActiveRow));
    expect(await css(section.locator(".part-row-done .part-mark"), "background-color")).toBe(rgbOf(palette().stepDone));
    expect(await css(section.locator(".part-row-active .part-state"), "color")).toBe(rgbOf(palette().link));
    const bar = section.locator(".parts-bar");
    expect(await css(bar, "height")).toBe(isPhone() ? "6px" : "8px");
    expect(await css(bar, "background-color")).toBe(rgbOf(palette().track));
    expect(await css(section.locator(".part-row").first(), "grid-template-columns")).toMatch(isPhone() ? /^26px / : /^28px /);
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
    await expect(page.getByRole("button", { name: "Hide steps" })).toHaveAttribute("aria-expanded", "true");
  });

  test("a stale part reads Stale with its step and offers nothing to follow", async ({ page }) => {
    const dialog = await openDrawer(page, STALE_TITLE);
    await expect(dialog.locator(".part-state")).toHaveText(["Done", "Stale · Implementing", "Next"]);
    await expect(dialog.getByRole("link", { name: /Follow part/ })).toHaveCount(0);
  });

  test("all parts done lists them done with no button, and a slice with no parts has no section", async ({ page }) => {
    const dialog = await openDrawer(page, DONE_TITLE);
    await expect(dialog.locator(".part-state")).toHaveText(["Done", "Done"]);
    await expect(dialog.getByRole("link", { name: /Follow part/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tileTitled(page, NONE_TITLE).click();
    await expect(page.getByRole("dialog").locator(".parts-section")).toHaveCount(0);
  });
});
