import { expect, type Locator, type Page, test } from "@playwright/test";
import type { BoardResponse } from "../src/api/boardDto";
import { ItemStatus } from "../src/domain/item";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { demoBoard, demoItem, SERVER_TIME } from "./fixture";
import { delayTimerCount, expectLoadingAfterDelay, holdBoardRoute, LOADING_DELAY_MS, pageSettled, pausedClock } from "./loadingClock";
import { openAllProjects, project } from "./projectBlock";

const BOARD_ROUTE = "**/api/board";
const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

const isPhone = () => test.info().project.name === "phone";

/** Fakes GET /api/board with one JSON body; counts the requests it answers. */
async function serveBoard(page: Page, body: BoardResponse = demoBoard()) {
  const seen = { requests: 0 };
  await page.route(BOARD_ROUTE, (route) => {
    seen.requests += 1;
    return route.fulfill({ json: body });
  });
  return seen;
}

function foreignRequests(page: Page): string[] {
  const hosts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (!LOCAL_HOSTS.includes(url.hostname)) hosts.push(request.url());
  });
  return hosts;
}

/**
 * The button that opens the item titled `title`: a planned slice's card ("Slice 4 · Tag search" shows as
 * "Slice 4" and "Tag search", so its card is found by the words), else the project-group tile whose title
 * is exactly `title` (a title can also appear as another tile's parent).
 */
function tileTitled(page: Page, title: string): Locator {
  const slice = /^Slice \d+ · (.+)$/.exec(title);
  if (slice) return page.locator("button.slice-card").filter({ has: page.locator(".slice-title").getByText(slice[1]!, { exact: true }) });
  return page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText(title, { exact: true }) });
}

/** The card that holds a tile button (its colours, border and fade) and, for a slice with an active part, the follow link. */
function cardOf(tile: Locator): Locator {
  return tile.locator("xpath=..");
}

const STALE_HEARTBEAT = "2026-11-15T10:48:00.000Z";

/** The demo board with the unplanned "Image uploads skip resizing" item gone stale three hours ago. */
function staleResizeBoard(): BoardResponse {
  const items = demoBoard().items.map((item) =>
    item.key === "recipe-box/resize" ? { ...item, status: ItemStatus.Stale, heartbeat_at: STALE_HEARTBEAT } : item,
  );
  return demoBoard(items);
}

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

async function openBoard(page: Page) {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await serveBoard(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(project(page, "Recipe Box")).toBeVisible();
}

test.describe("board", () => {
  test("groups follow the config order and the tiles follow priority", async ({ page }) => {
    await openBoard(page);
    expect(await page.locator("section.project .project-name").allTextContents()).toEqual(["Recipe Box", "Garden Planner", "Home Lab"]);
    const recipe = project(page, "Recipe Box");
    const planned = recipe.locator(".section", { hasText: "Planned · 1" });
    expect(await planned.locator(".slice-title").allTextContents()).toEqual(["Tag search"]);
    const problems = recipe.locator(".section", { hasText: "Problems and bugs · 1" });
    expect(await problems.locator(".problem-what").allTextContents()).toEqual(["CI failing on main"]);
    const other = recipe.locator(".section", { hasText: "Other open items · 1" });
    expect(await other.locator(".tile-title").allTextContents()).toEqual(["Image uploads skip resizing"]);
    await recipe.getByRole("button", { name: "1 done in the last 12 hours" }).click();
    await expect(recipe.locator(".done-row-title")).toHaveText("Slice 3 · Share links");
  });

  test("every need sits in its own project on desktop and above the projects on the phone, in the server's order", async ({ page }) => {
    await openBoard(page);
    const garden = project(page, "Garden Planner");
    if (isPhone()) {
      const top = page.getByRole("region", { name: "Needs you · 3" });
      expect(await top.locator(".question-text").allTextContents()).toEqual([
        "Approve the tags migration",
        "Sign in to the store console",
        "Pick the new app icon",
      ]);
      await expect(top.getByText("Asked")).toHaveCount(0);
      await expect(garden.getByText("Its question is at the top of the page.")).toBeVisible();
    } else {
      await expect(page.getByRole("region", { name: "Needs you · 3" })).toHaveCount(0);
      await expect(garden.getByRole("region", { name: "Needs you · 2" }).locator(".question-text")).toHaveText([
        "Sign in to the store console",
        "Pick the new app icon",
      ]);
      await expect(project(page, "Recipe Box").getByRole("region", { name: "Needs you · 1" }).locator(".question-text")).toHaveText([
        "Approve the tags migration",
      ]);
    }
  });

  test("the title line, the project summaries and the view tabs are the same on desktop and phone", async ({ page }) => {
    await openBoard(page);
    const recipe = project(page, "Recipe Box");
    await expect(recipe.locator(".project-summary")).toHaveText("1 needs you · nothing running · 1 planned · 1 problem");
    await expect(page.locator(".board-header .subtitle")).toHaveText("3 projects · updated 13:48 · refreshes every 60 s");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Board");
    await expect(page.locator(".legend")).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: "Views" });
    await expect(tabs.getByRole("link")).toHaveText(["Board", /^Active work\d*$/, "Usage"]);
    const box = (await tabs.boundingBox())!;
    expect(box.y).toBeLessThan(80);
  });

  test("a stale tile is dashed and muted, a finished item is a row with its time in the Done list", async ({ page }) => {
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await serveBoard(page, staleResizeBoard());
    await page.goto("/");
    const stale = tileTitled(page, "Image uploads skip resizing");
    await expect(stale).toContainText("Stale · No heartbeat for 3 h");
    expect(await css(cardOf(stale), "border-top-style")).toBe("dashed");
    const recipe = project(page, "Recipe Box");
    await expect(recipe.locator(".done-row")).toHaveCount(0);
    await recipe.getByRole("button", { name: "1 done in the last 12 hours" }).click();
    const done = recipe.locator(".done-row");
    await expect(done).toContainText("Slice 3 · Share links");
    await expect(done).toContainText("11:44");
    expect(await css(done, "border-top-style")).toBe("solid");
  });

  test("tiles carry the type label, priority, why, parent and status", async ({ page }) => {
    await openBoard(page);
    const tile = tileTitled(page, "Image uploads skip resizing");
    for (const text of ["Unplanned", "P2", "Found while testing tag search", "↳ Slice 4 · Tag search", "Open"]) {
      await expect(tile).toContainText(text);
    }
  });

  test("makes no request to a third-party host", async ({ page }) => {
    const foreign = foreignRequests(page);
    await openBoard(page);
    await tileTitled(page, "Slice 4 · Tag search").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(foreign).toEqual([]);
  });
});

test.describe("design values", () => {
  test("sizes and colours follow the mock", async ({ page }) => {
    await openBoard(page);
    const phone = isPhone();
    expect(await css(page.locator(".app"), "background-color")).toBe(phone ? "rgb(14, 16, 20)" : "rgb(245, 246, 248)");
    expect(await css(page.getByRole("heading", { level: 1 }), "font-size")).toBe("26px");
    const refresh = page.getByRole("button", { name: "Refresh now" });
    const box = await refresh.boundingBox();
    expect([box?.width, box?.height]).toEqual([44, 44]);
    expect(await css(refresh, "background-color")).toBe(phone ? "rgb(23, 26, 33)" : "rgb(255, 255, 255)");
    const tile = tileTitled(page, "Image uploads skip resizing");
    expect(await css(cardOf(tile), "border-radius")).toBe("12px");
    expect(await css(tile, "padding")).toBe(phone ? "12px 14px" : "14px 16px");
    expect(await css(cardOf(tile), "background-color")).toBe(phone ? "rgb(18, 54, 49)" : "rgb(221, 243, 240)");
    expect(await css(tile.locator(".tile-title"), "font-size")).toBe("15px");
    expect(await css(tile.locator(".badge"), "font-family")).toContain("JetBrains Mono Variable");
    expect(await css(page.locator(".app"), "font-family")).toContain("Inter Variable");
  });

  test("the page follows the device colour scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: isPhone() ? "light" : "dark" });
    await openBoard(page);
    expect(await css(page.locator(".app"), "background-color")).toBe(isPhone() ? "rgb(245, 246, 248)" : "rgb(14, 16, 20)");
  });
});

test.describe("detail", () => {
  test("opens as a side panel on desktop and a bottom sheet on the phone", async ({ page }) => {
    await openBoard(page);
    await tileTitled(page, "Slice 4 · Tag search").click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    if (isPhone()) {
      expect([box.x, box.width, box.height]).toEqual([0, viewport.width, 700]);
      expect(box.y + box.height).toBe(viewport.height);
      await expect(dialog.getByRole("heading", { level: 3, name: "Details" })).toHaveCount(0);
      await expect(dialog.getByRole("heading", { level: 3, name: "Links" })).toHaveCount(0);
    } else {
      expect([box.width, box.x + box.width]).toEqual([460, viewport.width]);
      await expect(dialog.getByRole("heading", { level: 3, name: "Details" })).toBeVisible();
      await expect(dialog.getByRole("heading", { level: 3, name: "Links" })).toBeVisible();
    }
  });

  test("shows the item's fields, details, links and history newest first", async ({ page }) => {
    await openBoard(page);
    await tileTitled(page, "Slice 4 · Tag search").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Slice 4 · Tag search");
    await expect(dialog.getByText("Find recipes by ingredient or tag")).toBeVisible();
    await expect(dialog.locator(".fields")).toContainText("recipe-box/slice-4");
    await expect(dialog.locator(".fields")).toContainText("Recipe Box");
    await expect(dialog.locator(".fields")).toContainText("Plan · Search");
    await expect(dialog.getByText("Search box, tag chips and a join table for tags.")).toBeVisible();
    await expect(dialog.getByRole("link")).toHaveText(["Slice file", "Pull request #41"]);
    expect(await dialog.locator(".event-time").allTextContents()).toEqual(["13:23", "11:05", "09:12"]);
    await expect(dialog.locator(".event").first()).toContainText("Asked you to approve the migration");
  });

  test("closes with the close button, Escape and the scrim, and gives focus back to the tile", async ({ page }) => {
    await openBoard(page);
    const tile = tileTitled(page, "Slice 4 · Tag search");
    const dialog = page.getByRole("dialog");
    // Each close waits for the dialog to be open first: a key or click sent before it mounts does nothing,
    // and "no dialog" would then pass against a dialog that has not opened yet.
    await tile.click();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(tile).toBeFocused();
    await tile.click();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(tile).toBeFocused();
    await tile.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(isPhone() ? 200 : 100, 60);
    await expect(dialog).toHaveCount(0);
    await expect(tile).toBeFocused();
  });

  test("makes the board behind the dialog inert and keeps focus inside it", async ({ page }) => {
    await openBoard(page);
    const tile = tileTitled(page, "Slice 4 · Tag search");
    await tile.click();
    await expect(page.locator(".page")).toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".page")))).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".page")).not.toHaveAttribute("inert", "");
    await expect(tile).toBeFocused();
  });

  test("renders details_md safely: raw html is text, only http(s) links, no images, no requests", async ({ page }) => {
    const foreign = foreignRequests(page);
    const hostile = {
      ...demoItem("recipe-box/slice-4"),
      details_md:
        "**bold** <b>raw</b> <script>window.pwned = 1</script> [bad](javascript:window.pwned=1) [good](https://example.com/x) ![pic](https://evil.example/x.png)",
    };
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await serveBoard(page, demoBoard([hostile]));
    await page.goto("/");
    await openAllProjects(page);
    await tileTitled(page, "Slice 4 · Tag search").click();
    const box = page.getByRole("dialog").locator(".details-box");
    await expect(box.locator("strong")).toHaveText("bold");
    await expect(box).toContainText("<b>raw</b>");
    await expect(box.locator("b, script, img")).toHaveCount(0);
    await expect(box.getByRole("link", { name: "good" })).toHaveAttribute("target", "_blank");
    await expect(box.getByRole("link", { name: "good" })).toHaveAttribute("rel", /noopener/);
    await expect(box.locator("a[href^='javascript']")).toHaveCount(0);
    await expect(box.locator("a")).toHaveCount(1);
    await expect(box).toContainText("bad");
    expect(await page.evaluate(() => "pwned" in window)).toBe(false);
    await page.waitForLoadState("networkidle");
    expect(foreign).toEqual([]);
  });
});

test.describe("open item leaves the board", () => {
  const OPEN_TITLE = "Slice 4 · Tag search";

  test("a refresh that drops the item closes the detail for good and returns focus", async ({ page }) => {
    const full = demoBoard();
    const without = demoBoard(full.items.filter((item) => item.key !== "recipe-box/slice-4"));
    let current = full;
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: current }));
    await page.goto("/");
    await tileTitled(page, OPEN_TITLE).click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    await expect(dialog).toBeVisible();
    current = without;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(dialog).toHaveCount(0);
    await expect(tileTitled(page, OPEN_TITLE)).toHaveCount(0);
    await expect(page.locator(".page")).not.toHaveAttribute("inert");
    await expect(page.getByRole("button", { name: "Refresh now" })).toBeFocused();
    current = full;
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(tileTitled(page, OPEN_TITLE)).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("a failed refresh clears the board and closes the detail", async ({ page }) => {
    let failing = false;
    await page.route(BOARD_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, body: "{}" }) : route.fulfill({ json: demoBoard() }),
    );
    await page.goto("/");
    await tileTitled(page, OPEN_TITLE).click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    await expect(dialog).toBeVisible();
    failing = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(tileTitled(page, OPEN_TITLE)).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("opening the same item again after a failed refresh and Retry shows it", async ({ page }) => {
    let failing = false;
    await page.route(BOARD_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, body: "{}" }) : route.fulfill({ json: demoBoard() }),
    );
    await page.goto("/");
    await tileTitled(page, OPEN_TITLE).click();
    const dialog = page.getByRole("dialog", { name: "Item details" });
    await expect(dialog).toBeVisible();
    failing = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await pageSettled(page);
    await expect(page).not.toHaveURL(/recipe-box/);
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(dialog).toHaveCount(0);
    await tileTitled(page, OPEN_TITLE).click();
    await expect(dialog).toBeVisible();
  });
});

test.describe("states", () => {
  test("an empty board says so", async ({ page }) => {
    await serveBoard(page, demoBoard([]));
    await page.goto("/");
    await expect(page.getByText("Nothing open in any project")).toBeVisible();
    await expect(
      page.getByText("No questions, no running work, no planned slices and no problems. Projects show here once an agent or the doc sync reports."),
    ).toBeVisible();
  });

  test("a 503 shows the failed-load card, and Retry loads the board", async ({ page }) => {
    let failing = true;
    await page.route(BOARD_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" }) : route.fulfill({ json: demoBoard() }),
    );
    await page.goto("/");
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    await expect(
      page.getByText("The board API answered 503 (service unavailable). Showing nothing rather than old data."),
    ).toBeVisible();
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(project(page, "Recipe Box")).toBeVisible();
    await expect(page.getByText("Couldn’t load the board")).toHaveCount(0);
  });

  test("after a failure, Retry never leaves a blank page: the card stays until the loading card or the board", async ({ page }) => {
    await pausedClock(page);
    let failing = true;
    const { release, requested } = await holdBoardRoute(page, demoBoard, { failWhile: () => failing });
    await page.goto("/");
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    failing = false;
    const timersBefore = await delayTimerCount(page);
    await page.getByRole("button", { name: "Retry" }).click();
    await requested;
    await expectLoadingAfterDelay(
      page,
      async () => {
        await expect(page.getByText("Couldn’t load the board")).toBeVisible();
        await expect(page.getByText("Loading the board…")).toHaveCount(0);
      },
      () => expect(page.getByText("Loading the board…")).toBeVisible(),
      timersBefore,
    );
    release();
    await expect(page.getByText("Couldn’t load the board")).toHaveCount(0);
    await expect(project(page, "Recipe Box")).toBeVisible();
  });

  test("an unreachable API says so", async ({ page }) => {
    await page.route(BOARD_ROUTE, (route) => route.abort());
    await page.goto("/");
    await expect(page.getByText("The board API could not be reached. Showing nothing rather than old data.")).toBeVisible();
  });

  test("a failed refresh clears the board and shows the error", async ({ page }) => {
    let failing = false;
    await page.route(BOARD_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, body: "{}" }) : route.fulfill({ json: demoBoard() }),
    );
    await page.goto("/");
    await expect(project(page, "Recipe Box")).toBeVisible();
    failing = true;
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    await expect(page.locator("section.project")).toHaveCount(0);
  });

  test("the loading state appears only after 500 ms, then gives way to the board", async ({ page }) => {
    await pausedClock(page);
    const { release, requested } = await holdBoardRoute(page, demoBoard);
    await page.goto("/");
    await requested;
    await expectLoadingAfterDelay(
      page,
      () => expect(page.getByText("Loading the board…")).toHaveCount(0),
      () => expect(page.getByText("Loading the board…")).toBeVisible(),
    );
    release();
    await expect(project(page, "Recipe Box")).toBeVisible();
    await expect(page.getByText("Loading the board…")).toHaveCount(0);
  });
});

/** What the example config says the page's palette is, as the browser reports a colour. */
const examplePalette = () => paletteOf(isPhone() ? "dark" : "light");

function paletteOf(scheme: "light" | "dark"): Record<string, string> {
  const raw = exampleConfig.palettes[scheme] as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([name, hex]) => [name, rgbOf(hex)]));
}

function rgbOf(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test.describe("state cards use the palette without a response", () => {
  test("the failed-load card (503) is drawn in the config palette", async ({ page }) => {
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto("/");
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    const palette = examplePalette();
    expect(await css(retry, "background-color")).toBe(palette.primaryBg);
    expect(await css(retry, "color")).toBe(palette.primaryFg);
    expect(await css(page.locator(".state-card svg"), "stroke")).toBe(palette.danger);
    expect(await css(page.locator(".state-card"), "background-color")).toBe(palette.card);
  });

  test("the loading card (slow response) is drawn in the config palette", async ({ page }) => {
    await pausedClock(page);
    const { release, requested } = await holdBoardRoute(page, demoBoard);
    try {
      await page.goto("/");
      await requested;
      await page.clock.runFor(LOADING_DELAY_MS);
      await expect(page.getByText("Loading the board…")).toBeVisible();
      const palette = examplePalette();
      expect(await css(page.locator(".state-card"), "background-color")).toBe(palette.card);
      expect(await css(page.locator(".skeleton-title").first(), "background-color")).toBe(palette.skeletonBar);
      expect(await css(page.locator(".skeleton-strip"), "background-color")).toBe(palette.skeletonStrip);
      expect(await css(page.locator(".skeleton-tile").first(), "background-color")).toBe(palette.skeletonTile);
    } finally {
      release();
    }
  });

  test("a failed refresh keeps the palette the board arrived with", async ({ page }) => {
    let failing = false;
    await page.route(BOARD_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, body: "{}" }) : route.fulfill({ json: demoBoard() }),
    );
    await page.goto("/");
    await expect(project(page, "Recipe Box")).toBeVisible();
    failing = true;
    await page.getByRole("button", { name: "Refresh now" }).click();
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    expect(await css(retry, "background-color")).toBe(examplePalette().primaryBg);
  });
});

test.describe("tile why colour", () => {
  test("a tile's why text uses the palette's tileWhy colour", async ({ page }) => {
    await openBoard(page);
    const why = tileTitled(page, "Image uploads skip resizing").locator(".tile-why");
    // The phone mock draws the tile why text #B3BBC8 (Phone.dc.html), which the dark palette's tileWhy holds.
    expect(await css(why, "color")).toBe(examplePalette().tileWhy);
    if (isPhone()) expect(await css(why, "color")).toBe("rgb(179, 187, 200)");
  });
});

test.describe("stale tile colours", () => {
  test("a stale tile draws the palette's staleBg and staleBorder and a muted title", async ({ page }) => {
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    await serveBoard(page, staleResizeBoard());
    await page.goto("/");
    const stale = tileTitled(page, "Image uploads skip resizing");
    const palette = examplePalette();
    expect(await css(cardOf(stale), "background-color")).toBe(palette.staleBg);
    expect(await css(cardOf(stale), "border-top-color")).toBe(palette.staleBorder);
    expect(await css(stale.locator(".tile-title"), "color")).toBe(palette.muted);
    // The mock: light bg #F5F6F8 and border #9AA3B2; dark bg #171A21 and border #4A5262.
    const dark = isPhone();
    expect(await css(cardOf(stale), "background-color")).toBe(dark ? "rgb(23, 26, 33)" : "rgb(245, 246, 248)");
    expect(await css(cardOf(stale), "border-top-color")).toBe(dark ? "rgb(74, 82, 98)" : "rgb(154, 163, 178)");
  });
});

test.describe("refresh", () => {
  test("the refresh button loads again", async ({ page }) => {
    await page.clock.setFixedTime(new Date(SERVER_TIME));
    const seen = await serveBoard(page);
    await page.goto("/");
    await expect(project(page, "Recipe Box")).toBeVisible();
    const first = seen.requests;
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect.poll(() => seen.requests).toBe(first + 1);
  });

  test("the board reloads by itself every 60 s while the tab is visible", async ({ page }) => {
    await page.clock.install({ time: new Date(SERVER_TIME) });
    const seen = await serveBoard(page);
    await page.goto("/");
    await expect(project(page, "Recipe Box")).toBeVisible();
    const first = seen.requests;
    await page.clock.runFor(61_000);
    await expect.poll(() => seen.requests).toBe(first + 1);
  });
});
