import { expect, type Locator, type Page, test } from "@playwright/test";
import type { UsagePageResponse } from "../src/api/usageDto";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { demoBoard } from "./fixture";
import { demoUsage, emptyUsage, ENV_ONE, ENV_TWO, PLANS, USAGE_SERVER_TIME } from "./usageFixture";

const USAGE_ROUTE = "**/api/usage?*";
const BOARD_ROUTE = "**/api/board";
const USAGE_PAGE = "/#/usage";
const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
const PHONE_HEIGHT = 844;

const isPhone = () => test.info().project.name === "phone";

type Answer = (url: URL) => UsagePageResponse | number;

/** Fakes GET /api/usage; `answer` sees each request's URL and returns a body or an HTTP status. */
async function serveUsage(page: Page, answer: Answer = () => demoUsage()) {
  const urls: URL[] = [];
  await page.route(USAGE_ROUTE, (route) => {
    const url = new URL(route.request().url());
    urls.push(url);
    const body = answer(url);
    return typeof body === "number" ? route.fulfill({ status: body, body: "{}" }) : route.fulfill({ json: body });
  });
  return urls;
}

async function openUsage(page: Page, answer?: Answer) {
  await page.clock.setFixedTime(new Date(USAGE_SERVER_TIME));
  const urls = await serveUsage(page, answer);
  await page.goto(USAGE_PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  return urls;
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

async function css(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
}

/** The browser's spelling of a palette colour; a name the palette lacks fails the test by matching nothing. */
function rgbOf(hex: string | undefined): string {
  if (hex === undefined) return "no such palette colour";
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const palette = () => exampleConfig.palettes[isPhone() ? "dark" : "light"] as Record<string, string>;
const query = (url: URL | undefined) => Object.fromEntries(url?.searchParams ?? []);
const tile = (page: Page, label: string) => page.locator(".cap-tile", { hasText: label });
const pressed = (page: Page, name: string, group: string) => page.getByRole("group", { name: group }).getByRole("button", { name, exact: true });

test.describe("usage page", () => {
  test("shows the cap tiles, the cap line, tokens per day and cost per task", async ({ page }) => {
    const foreign = foreignRequests(page);
    await openUsage(page);
    const weekly = tile(page, "Weekly cap used");
    await expect(weekly.locator(".cap-value")).toHaveText("34.2%");
    if (!isPhone()) {
      await expect(weekly.locator(".cap-note")).toHaveText("Resets Tue 17 Nov, 08:00 · reading taken 13:46");
      await expect(tile(page, "Shorter window used").locator(".cap-value")).toHaveText("41%");
      await expect(tile(page, "Shorter window used").locator(".cap-note")).toHaveText("Resets in 2 h 10 min");
      await expect(page.getByText("Tokens your agents reported, the cap readings, and what each model costs of the cap · updated 13:48")).toBeVisible();
    } else {
      await expect(weekly.locator(".cap-note")).toHaveText("Resets Tue 08:00 · shorter window 41%");
    }
    await expect(page.getByRole("heading", { level: 2, name: "Weekly cap over this window" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: isPhone() ? "Tokens per day" : "Tokens per day, by model" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Cost per task" })).toBeVisible();
    expect(foreign).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the cap tiles use the config palette, and the shorter window tile is left out when none was reported", async ({ page }) => {
    const none = { windows: [], dropped: [], latest: null };
    await openUsage(page, () => demoUsage({ cap: { weekly: demoUsage().cap.weekly, short: none } }));
    await expect(page.locator(".cap-tile")).toHaveCount(1);
    expect(await css(page.locator(".cap-tile"), "background-color")).toBe(rgbOf(palette().card));
    expect(await css(page.locator(".cap-bar span"), "background-color")).toBe(rgbOf(palette().barFill));
  });

  test("the range switch, environment filter and plan picker change the request", async ({ page }) => {
    const urls = await openUsage(page);
    expect(query(urls[0])).toEqual({ range: "window", utc_offset: "0" });
    await expect(pressed(page, "This window", "Time range")).toHaveAttribute("aria-pressed", "true");
    await pressed(page, "24 h", "Time range").click();
    await expect.poll(() => query(urls.at(-1)).range).toBe("24h");
    await pressed(page, ENV_TWO.label, "Environment").click();
    await expect.poll(() => query(urls.at(-1)).environment).toBe(ENV_TWO.value);
    await expect(pressed(page, ENV_TWO.label, "Environment")).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Plan").selectOption(PLANS[1] ?? "");
    await expect.poll(() => query(urls.at(-1)).plan).toBe(PLANS[1]);
    expect(query(urls.at(-1))).toEqual({ range: "24h", environment: ENV_TWO.value, plan: PLANS[1], utc_offset: "0" });
  });

  test("the environment group lists All and one button per environment in the data", async ({ page }) => {
    await openUsage(page);
    const names = await page.getByRole("group", { name: "Environment" }).getByRole("button").allTextContents();
    expect(names).toEqual([isPhone() ? "All" : "All environments", ENV_ONE.label, ENV_TWO.label]);
  });

  test("the split switch changes the heading, the legend and the table equivalent", async ({ page }) => {
    await openUsage(page);
    const legend = page.locator(".series-legend li");
    expect(await legend.allTextContents()).toEqual(["model-alpha", "model-beta", "model-gamma"]);
    await pressed(page, isPhone() ? "Kind" : "Token kind", "Split tokens by").click();
    expect(await legend.allTextContents()).toEqual(["Fresh input", "Cache write", "Cache read", "Output"]);
    if (!isPhone()) await expect(page.getByRole("heading", { level: 2, name: "Tokens per day, by token kind" })).toBeVisible();
    await expect(page.locator(".sr-only tbody th")).toHaveText(["Fresh input", "Cache write", "Cache read", "Output"]);
    await pressed(page, isPhone() ? "Env" : "Environment", "Split tokens by").click();
    expect(await legend.allTextContents()).toEqual([ENV_ONE.label, ENV_TWO.label]);
    await pressed(page, isPhone() ? "Agent" : "Agent kind", "Split tokens by").click();
    expect(await legend.allTextContents()).toEqual(["reviewer", "builder"]);
  });

  test("the chart has its numbers in a table, and an alt text that names the biggest series", async ({ page }) => {
    await openUsage(page);
    const row = page.locator(".usage-table tbody tr", { hasText: "model-alpha" });
    expect(await row.locator("td").allTextContents()).toEqual(["0.11", "0.64", "9.63", "0.32", "10.7"]);
    const chart = page.getByRole("img", { name: /^Tokens per day by model/ });
    await expect(chart).toHaveAttribute("aria-label", "Tokens per day by model, Tue 10 to Mon 16. model-beta used the most; the table below has the numbers.");
    expect(await page.locator(".sr-only tbody tr").count()).toBe(3);
    expect(await page.locator(".sr-only tbody tr").first().locator("td").count()).toBe(7);
  });

  test("a dropped reading is drawn hollow and labelled, and the line is described", async ({ page }) => {
    await openUsage(page);
    const dropped = page.locator(".cap-dropped");
    await expect(dropped).toHaveCount(1);
    expect(await css(dropped, "fill")).toBe(rgbOf(palette().card));
    expect(await css(dropped, "stroke")).toBe(rgbOf(palette().muted));
    expect(await css(dropped, "stroke-dasharray")).toMatch(/2/);
    await expect(page.locator(".chart text", { hasText: isPhone() ? "dropped" : "Dropped: stale reading (19.5%)" })).toBeVisible();
    const alt = "Weekly cap used rose from 0% at the reset on Tue 08:00 to 34.2% now. 1 stale reading was dropped.";
    await expect(page.getByRole("img", { name: alt })).toBeVisible();
    await expect(page.locator(".cap-dot")).toHaveCount(7);
    if (!isPhone()) {
      await expect(dropped.locator("title")).toHaveText("19.5%, older than a stored 22% reading: dropped");
      await expect(page.locator(".now-text")).toHaveText("34.2% now");
      await expect(page.locator(".reset-text").first()).toHaveText("Reset · Tue 08:00");
    } else {
      await expect(page.locator(".chart title")).toHaveCount(0);
    }
  });

  test("cost per task lists the biggest tasks by tokens", async ({ page }) => {
    await openUsage(page);
    if (isPhone()) {
      expect(await page.locator(".task-rows .task-title").allTextContents()).toEqual(["Slice 9 · Part C", "Slice 4 · Part B", "Slice 8 · Watering log", "CI failing on main"]);
      return;
    }
    const rows = page.locator(".usage-table-tasks tbody tr");
    expect(await rows.first().locator("td").allTextContents()).toEqual(["Slice 9 · Part C · Notification channel", "demo-app", "7.1 M"]);
    expect(await rows.last().locator("td").allTextContents()).toEqual(["Everything else", "3 projects", "3.3 M"]);
    expect(await page.locator(".usage-table-tasks thead th").allTextContents()).toEqual(["Task", "Project", "Tokens"]);
  });

  test("the view tabs switch between the usage page and the board", async ({ page }) => {
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: demoBoard() }));
    await openUsage(page);
    const tabs = page.getByRole("navigation", { name: "Views" });
    await expect(tabs.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Board" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Usage" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  });

  test("the view switcher is a segmented bar on the desktop and a bottom bar on the phone", async ({ page }) => {
    await openUsage(page);
    const nav = page.getByRole("navigation", { name: "Views" });
    if (!isPhone()) {
      expect(await css(nav, "background-color")).toBe(rgbOf(palette().segmentBg));
      expect(await css(nav.getByRole("link", { name: "Usage" }), "background-color")).toBe(rgbOf(palette().segmentPressedBg));
      return;
    }
    expect(await css(nav, "position")).toBe("sticky");
    const box = await nav.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(PHONE_HEIGHT - 2);
    expect(await nav.locator("svg").count()).toBe(2);
  });

  test("a wait over 500 ms shows the loading card, in the config palette", async ({ page }) => {
    await page.route(USAGE_ROUTE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ json: demoUsage() });
    });
    await page.goto(USAGE_PAGE);
    await expect(page.getByText("Loading usage…").first()).toBeVisible({ timeout: 1500 });
    expect(await css(page.locator(".state-card"), "background-color")).toBe(rgbOf(palette().card));
    expect(await css(page.locator(".skeleton-usage-tile").first(), "background-color")).toBe(rgbOf(palette().skeletonTile));
    await expect(page.locator(".cap-value").first()).toBeVisible({ timeout: 5000 });
  });

  test("with no usage and no reading the empty card shows", async ({ page }) => {
    await openUsage(page, () => emptyUsage());
    await expect(page.getByText("No usage reported yet")).toBeVisible();
    await expect(page.getByText("Tokens and cap readings appear once a client sends its first report.")).toBeVisible();
    await expect(page.locator(".cap-tile")).toHaveCount(0);
  });

  test("a failed load shows the status and Retry reloads", async ({ page }) => {
    let failing = true;
    await openUsage(page, () => (failing ? 503 : demoUsage()));
    await expect(page.getByText("Couldn’t load usage")).toBeVisible();
    await expect(page.getByText("The usage API answered 503 (service unavailable).")).toBeVisible();
    expect(await css(page.locator(".state-card svg"), "stroke")).toBe(rgbOf(palette().danger));
    failing = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator(".cap-value").first()).toHaveText("34.2%");
  });

  test("a failed background refresh keeps the numbers on screen", async ({ page }) => {
    let failing = false;
    const urls = await openUsage(page, () => (failing ? 503 : demoUsage()));
    await expect(page.locator(".cap-value").first()).toHaveText("34.2%");
    failing = true;
    const before = urls.length;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => urls.length).toBeGreaterThan(before);
    await expect(page.locator(".cap-value").first()).toHaveText("34.2%");
    await expect(page.getByText("Couldn’t load usage")).toHaveCount(0);
  });

  test("a changed filter shows the new answer, not the old numbers", async ({ page }) => {
    const filtered = (url: URL) => (url.searchParams.get("environment") === ENV_TWO.value ? demoUsage({ top_tasks: [], other_tasks: null, totals_by_model: [] }) : demoUsage());
    await openUsage(page, filtered);
    await expect(page.locator(".usage-table tbody tr").first()).toBeVisible();
    await pressed(page, ENV_TWO.label, "Environment").click();
    await expect(page.getByRole("heading", { level: 2, name: "Cost per task" })).toHaveCount(0);
    await expect(page.locator(".usage-table tbody tr")).toHaveCount(0);
  });
});
