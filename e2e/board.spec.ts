import { expect, type Locator, type Page, test } from "@playwright/test";
import type { BoardResponse } from "../src/api/boardDto";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { demoBoard, demoItem, SERVER_TIME } from "./fixture";

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

function project(page: Page, name: string): Locator {
  return page.locator("section.project", { has: page.getByRole("heading", { level: 2, name, exact: true }) });
}

/** The project-group tile whose title is exactly `title` (a title can also appear as another tile's parent). */
function tileTitled(page: Page, title: string): Locator {
  return page.locator("button.tile").filter({ has: page.locator(".tile-title").getByText(title, { exact: true }) });
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
    expect(await page.locator("section.project h2").allTextContents()).toEqual(["Recipe Box", "Garden Planner", "Home Lab"]);
    const flight = project(page, "Recipe Box").locator(".section", { hasText: "In flight · 3" });
    expect(await flight.locator(".tile-title").allTextContents()).toEqual([
      "CI failing on main",
      "Slice 4 · Tag search",
      "Image uploads skip resizing",
    ]);
    const done = project(page, "Recipe Box").locator(".section", { hasText: "Done in the last 12 h · 1" });
    await expect(done.locator(".tile-title")).toHaveText("Slice 3 · Share links");
  });

  test("the waiting strip lists the three questions, the most urgent first", async ({ page }) => {
    await openBoard(page);
    const strip = page.getByRole("region", { name: isPhone() ? "Waiting for you · 3" : "Waiting for you" });
    expect(await strip.locator(".card-title").allTextContents()).toEqual([
      "Sign in to the store console",
      "Approve the tags migration",
      "Pick the new app icon",
    ]);
    if (isPhone()) {
      await expect(strip.getByText("Asked")).toHaveCount(0);
    } else {
      await expect(strip.getByText("3 items across 2 projects")).toBeVisible();
      await expect(strip.getByText("Asked 25 min ago · Slice 4 · Tag search")).toBeVisible();
    }
  });

  test("project summaries and sections differ between desktop and phone as drawn", async ({ page }) => {
    await openBoard(page);
    const recipe = project(page, "Recipe Box");
    if (isPhone()) {
      await expect(recipe.locator(".project-summary")).toHaveText("1 waiting · 3 open · 1 done");
      await expect(recipe.getByRole("heading", { level: 3, name: /Waiting for you/ })).toHaveCount(0);
      await expect(page.locator("header .legend")).toHaveCount(0);
      await expect(page.getByText("Updated 13:48 · last 12 h")).toBeVisible();
    } else {
      await expect(recipe.locator(".project-summary")).toHaveText("1 waiting for you · 3 open · 1 done in 12 h");
      await expect(recipe.getByRole("heading", { level: 3, name: "Waiting for you · 1" })).toBeVisible();
      await expect(page.locator("header .legend li")).toHaveText(["Needs you", "Slice", "Problem", "Bug", "Unplanned"]);
      await expect(
        page.getByText("Open work plus everything finished in the last 12 hours · updated 13:48 · refreshes every 60 s"),
      ).toBeVisible();
    }
  });

  test("a stale tile is dashed and muted, a done tile is faded with its age", async ({ page }) => {
    await openBoard(page);
    const stale = tileTitled(page, "Slice 10 · Seed inventory");
    await expect(stale).toContainText("Stale · No heartbeat for 3 h");
    expect(await css(stale, "border-top-style")).toBe("dashed");
    const done = tileTitled(page, "Slice 3 · Share links");
    await expect(done).toContainText("Done 2 h ago");
    expect(await css(done, "opacity")).toBe("0.78");
    expect(await css(tileTitled(page, "CI failing on main"), "opacity")).toBe("1");
  });

  test("tiles carry the type label, priority, why, parent and status", async ({ page }) => {
    await openBoard(page);
    const tile = tileTitled(page, "CI failing on main");
    for (const text of ["Problem", "P0", "Lint step times out after 10 minutes", "↳ Wave 3", "Blocked"]) {
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
    expect(await css(page.getByRole("heading", { level: 1 }), "font-size")).toBe(phone ? "22px" : "26px");
    const refresh = page.getByRole("button", { name: "Refresh now" });
    const box = await refresh.boundingBox();
    expect([box?.width, box?.height]).toEqual([44, 44]);
    expect(await css(refresh, "background-color")).toBe(phone ? "rgb(23, 26, 33)" : "rgb(255, 255, 255)");
    const tile = tileTitled(page, "CI failing on main");
    expect(await css(tile, "border-radius")).toBe("12px");
    expect(await css(tile, "padding")).toBe(phone ? "12px 14px" : "14px 16px");
    expect(await css(tile, "background-color")).toBe(phone ? "rgb(44, 31, 69)" : "rgb(239, 231, 251)");
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
    await tile.click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tile).toBeFocused();
    await tile.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await tile.click();
    await page.mouse.click(isPhone() ? 200 : 100, 60);
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
});

test.describe("states", () => {
  test("an empty board says so", async ({ page }) => {
    await serveBoard(page, demoBoard([]));
    await page.goto("/");
    await expect(page.getByText("Nothing open")).toBeVisible();
    await expect(
      page.getByText("No open items and nothing finished in the last 12 hours. Agents add items here as they report."),
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
    let failing = true;
    await page.route(BOARD_ROUTE, async (route) => {
      if (failing) return route.fulfill({ status: 503, body: "{}" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ json: demoBoard() });
    });
    await page.goto("/");
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    await expect(page.getByText("Loading the board…")).toHaveCount(0);
    await expect(page.getByText("Loading the board…")).toBeVisible({ timeout: 1000 });
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
    await page.route(BOARD_ROUTE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ json: demoBoard() });
    });
    await page.goto("/");
    await page.waitForTimeout(250);
    await expect(page.getByText("Loading the board…")).toHaveCount(0);
    await expect(page.getByText("Loading the board…")).toBeVisible({ timeout: 1000 });
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
    await page.route(BOARD_ROUTE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ json: demoBoard() });
    });
    await page.goto("/");
    await expect(page.getByText("Loading the board…")).toBeVisible({ timeout: 1500 });
    const palette = examplePalette();
    expect(await css(page.locator(".state-card"), "background-color")).toBe(palette.card);
    expect(await css(page.locator(".skeleton-heading"), "background-color")).toBe(palette.skeletonBar);
    expect(await css(page.locator(".skeleton-label"), "background-color")).toBe(palette.skeletonBar);
    expect(await css(page.locator(".skeleton-strip"), "background-color")).toBe(palette.skeletonStrip);
    expect(await css(page.locator(".skeleton-tile").first(), "background-color")).toBe(palette.skeletonTile);
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
    const why = tileTitled(page, "CI failing on main").locator(".tile-why");
    // The phone mock draws the tile why text #B3BBC8 (Phone.dc.html), which the dark palette's tileWhy holds.
    expect(await css(why, "color")).toBe(examplePalette().tileWhy);
    if (isPhone()) expect(await css(why, "color")).toBe("rgb(179, 187, 200)");
  });
});

test.describe("stale tile colours", () => {
  test("a stale tile draws the palette's staleBg and staleBorder and a muted title", async ({ page }) => {
    await openBoard(page);
    const stale = tileTitled(page, "Slice 10 · Seed inventory");
    const palette = examplePalette();
    expect(await css(stale, "background-color")).toBe(palette.staleBg);
    expect(await css(stale, "border-top-color")).toBe(palette.staleBorder);
    expect(await css(stale.locator(".tile-title"), "color")).toBe(palette.muted);
    // The mock: light bg #F5F6F8 and border #9AA3B2; dark bg #171A21 and border #4A5262.
    const dark = isPhone();
    expect(await css(stale, "background-color")).toBe(dark ? "rgb(23, 26, 33)" : "rgb(245, 246, 248)");
    expect(await css(stale, "border-top-color")).toBe(dark ? "rgb(74, 82, 98)" : "rgb(154, 163, 178)");
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
