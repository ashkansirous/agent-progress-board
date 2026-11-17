import { expect, type Locator, type Page, test } from "@playwright/test";
import type { UsagePageResponse } from "../src/api/usageDto";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { MixSource, MultiplierState } from "../src/domain/capCost";
import { TokenKind } from "../src/domain/usage";
import { demoBoard } from "./fixture";
import { demoUsage, emptyUsage, ENV_ONE, ENV_TWO, PLANS, readyCapCost, readyUsage, USAGE_SERVER_TIME } from "./usageFixture";

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
    expect(await rows.first().locator("td").allTextContents()).toEqual(["Slice 9 · Part C · Notification channel", "demo-app", "7.1 M", "–"]);
    expect(await rows.last().locator("td").allTextContents()).toEqual(["Everything else", "3 projects", "3.3 M", "–"]);
    expect(await page.locator(".usage-table-tasks thead th").allTextContents()).toEqual(["Task", "Project", "Tokens", "Of the cap"]);
  });

  test("the view tabs switch between the usage page and the board", async ({ page }) => {
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: demoBoard() }));
    await openUsage(page);
    const tabs = page.getByRole("navigation", { name: "Views" });
    await expect(tabs.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Board" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Usage" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  });

  test("the view switcher is a segmented bar on the desktop and a bottom bar on the phone", async ({ page }) => {
    await openUsage(page);
    const nav = page.getByRole("navigation", { name: "Views" });
    if (!isPhone()) {
      expect(await css(nav, "background-color")).toBe(rgbOf(palette().tabBg));
      expect(await css(nav.getByRole("link", { name: "Usage" }), "background-color")).toBe(rgbOf(palette().tabOn));
      return;
    }
    expect(await css(nav, "position")).toBe("sticky");
    const box = await nav.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(PHONE_HEIGHT - 2);
    expect(await nav.locator("svg").count()).toBe(3);
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

test.describe("what 1% of the cap costs", () => {
  const openReady = (page: Page, over: Partial<UsagePageResponse> = {}) => openUsage(page, () => readyUsage(over));
  const modelRow = (page: Page, model: string) => page.locator(".cap-cost-card .usage-table tbody tr", { hasText: model }).first();

  test("shows the unexplained tile, and its share on the phone's cap card", async ({ page }) => {
    await openReady(page);
    if (isPhone()) {
      await expect(page.locator(".cap-note").first()).toContainText("8% of growth not explained");
      return;
    }
    const unexplained = tile(page, "Cap growth the board can’t explain");
    await expect(unexplained.locator(".cap-value")).toHaveText("8%");
    await expect(unexplained.locator(".cap-bar")).toHaveCount(0);
    await expect(unexplained.locator(".cap-note")).toHaveText("2.8 of the 34.2 points. Use no client reports: Claude chat on desktop or phone, Claude Design, or a machine without the client.");
  });

  test("shows no mix note while every figure uses the current window's mix (Slice 26)", async ({ page }) => {
    await openReady(page);
    await expect(page.locator(".cap-cost-card, .phone-models").first()).toBeVisible();
    await expect(page.locator(".mix-note")).toHaveCount(0);
  });

  test("marks only the model whose all-kinds figure uses last week's mix (Slice 26)", async ({ page }) => {
    const base = readyCapCost();
    const models = base.models.map((m, i) => (i === 0 ? { ...m, mix_source: MixSource.LastFull } : m));
    await openReady(page, { cap_cost: { ...base, models } });
    const notes = page.locator(".mix-note");
    // One note per place the figure is shown (the cost table and the compare table on desktop, the row on the phone): only the first model's.
    await expect(notes).toHaveCount(isPhone() ? 1 : 2);
    await expect(notes.first()).toHaveText("last week’s mix until this week has a day of use");
  });

  test("writes tokens per 1% in full below a million and as millions from there, with both pills", async ({ page }) => {
    await openReady(page);
    if (isPhone()) {
      const phoneModel = (name: string) => page.locator(".phone-model").filter({ has: page.locator(".model-name", { hasText: new RegExp(`^${name}$`) }) });
      const alpha = phoneModel("model-alpha");
      await expect(alpha.locator(".phone-model-line")).toHaveText("1% ≈ 700,000 tokens · 1 token = 27.1× model-gamma");
      await expect(alpha.locator(".pill")).toHaveText("Fairly sure");
      await expect(alpha.locator(".kind-cell-value")).toHaveText(["174,000", "140,000", "1.74 M", "35,000"]);
      const gamma = phoneModel("model-gamma");
      await expect(gamma.locator(".phone-model-line")).toHaveText("1% ≈ 19 million tokens · the comparison base (1×)");
      await expect(gamma.locator(".phone-model-note")).toHaveText("One weight for every kind until 12 stretches (7 so far)");
      await expect(gamma.locator(".pill")).toHaveText("Rough guess");
      return;
    }
    await expect(page.getByRole("heading", { level: 2, name: "What 1% of the week costs on Plan One" })).toBeVisible();
    const alpha = modelRow(page, "model-alpha");
    const cells = await alpha.locator("td").allTextContents();
    expect(cells.slice(0, 5)).toEqual(["174,000", "140,000", "1.74 million", "35,000", "700,000"]);
    expect(cells[5]).toBe("Fairly sure14 stretches");
    const gamma = modelRow(page, "model-gamma");
    await expect(gamma.locator(".merged-cell")).toHaveText("One weight for every kind until 12 stretches (19 million each)");
    await expect(gamma.locator(".strong-col")).toHaveText("19 million");
    await expect(gamma.locator(".pill")).toHaveText("Rough guess");
    expect(await css(alpha.locator(".pill"), "background-color")).toBe(rgbOf(palette().pillSureBg));
    expect(await css(gamma.locator(".pill"), "background-color")).toBe(rgbOf(palette().pillRoughBg));
  });

  test("the comparison base select changes the numbers and the sentence", async ({ page }) => {
    if (isPhone()) test.skip(true, "the phone carries the default base only");
    await openReady(page);
    const select = page.getByLabel("Measured in");
    await expect(select).toHaveValue("model-gamma");
    const sentence = page.locator(".block-note", { hasText: "Log scale." });
    await expect(sentence).toHaveText("One model-alpha token uses as much of the week as 27.1 model-gamma tokens; one model-beta token as much as 13.6. Log scale.");
    await select.selectOption("model-alpha");
    await expect(sentence).toHaveText("One model-beta token uses as much of the week as 0.5 model-alpha tokens; one model-gamma token as much as 0.04. Log scale.");
    const betaRow = page.locator(".cost-block", { hasText: "What one token is worth, compared" }).locator("table tbody tr", { hasText: "model-beta" });
    await expect(betaRow.locator("td").last()).toHaveText("0.5×");
    await expect(betaRow.locator("td").first()).toHaveText("2×");
  });

  test("lists the kinds against fresh input, and says which model is not split", async ({ page }) => {
    await openReady(page);
    if (isPhone()) {
      await expect(page.locator(".kind-ratio-cell b")).toHaveText(["1×", "1.24×", "0.1×", "5×"]);
      await expect(page.getByText("Same for model-alpha and model-beta; model-gamma is not split by kind yet.")).toBeVisible();
      return;
    }
    const rows = page.locator(".cost-block", { hasText: "Token kinds within each model" }).locator("tbody tr");
    expect(await rows.first().locator("td").allTextContents()).toEqual(["1.0×", "1.2×", "0.10×", "5.0×"]);
    await expect(rows.last().locator("td")).toHaveText("Not split by kind yet");
    await expect(page.getByText("A cache read costs a tenth of a fresh input token; output costs five times as much.")).toBeVisible();
  });

  test("phone kinds card never says same for models whose ratios differ", async ({ page }) => {
    test.skip(!isPhone(), "the kinds card is the phone layout");
    const ready = readyUsage();
    const models = ready.cap_cost.models.map((m) =>
      m.model === "model-beta" && m.kind_ratios ? { ...m, kind_ratios: { ...m.kind_ratios, cache_read: 0.3 } } : m,
    );
    await openUsage(page, () => ({ ...ready, cap_cost: { ...ready.cap_cost, models } }));
    const card = page.locator(".usage-card", { hasText: "Kinds compared with fresh input" });
    await expect(card.locator(".kind-ratio-group")).toHaveCount(2);
    await expect(card.getByText("Same for model-alpha.")).toBeVisible();
    await expect(card.getByText("Same for model-beta; model-gamma is not split by kind yet.")).toBeVisible();
  });

  test("phone kinds card keeps models with equal cells but a different reference apart", async ({ page }) => {
    test.skip(!isPhone(), "the kinds card is the phone layout");
    const ready = readyUsage();
    const models = ready.cap_cost.models.map((m) =>
      m.model === "model-beta" && m.kind_ratios ? { ...m, kind_ratio_reference: TokenKind.CacheRead } : m,
    );
    await openUsage(page, () => ({ ...ready, cap_cost: { ...ready.cap_cost, models } }));
    const card = page.locator(".usage-card", { hasText: "Kinds compared with fresh input" });
    await expect(card.locator(".kind-ratio-group")).toHaveCount(2);
  });

  test("shows the estimate-not-ready card in place of the section, with dashes for the cap figures", async ({ page }) => {
    await openUsage(page);
    await expect(page.getByText("Not enough data for an estimate yet")).toBeVisible();
    await expect(page.getByText("Only 2 stretches so far inside one window on Plan One. Tokens and cap readings still show above.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /What 1% of the week costs/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Where the usage comes from" })).toHaveCount(0);
    if (!isPhone()) await expect(page.locator(".cap-cell-value").first()).toHaveText("–");
    expect(await css(page.locator(".state-card svg").first(), "stroke")).toBe(rgbOf(palette().pillRoughFg));
  });

  test("the sources table has a base row, a measured row, the fixed rows and the not-explained row", async ({ page }) => {
    await openReady(page);
    if (isPhone()) {
      const rows = page.locator(".source-row");
      await expect(rows.nth(0).locator(".source-main")).toHaveText("Claude Code · Box One");
      await expect(rows.nth(0).locator(".source-sub").first()).toHaveText("Reported · the base, 1×");
      await expect(rows.nth(1).locator(".source-sub").first()).toHaveText("Reported · 0.98× Box One · fairly sure");
      await expect(rows.last().locator(".source-value")).toHaveText("2.8%");
      await expect(rows.last()).toContainText("Biggest stretch: Sat 14, 10:05–12:40, +1.6 points.");
      await expect(page.locator(".stretch-row")).toHaveCount(0);
      return;
    }
    const rows = page.locator(".sources-table tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(page.locator(".sources-table thead th").last()).toHaveText("Cost per token vs Box One");
    expect(await rows.nth(0).locator("td").allTextContents()).toEqual(["Box One", "Reported", "24.1 M", "19.6%", "The base: 1×"]);
    expect(await rows.nth(1).locator("td").last().textContent()).toBe("0.98× Box One · fairly sure, 18 stretches");
    await expect(rows.nth(2)).toContainText("Not reported");
    await expect(rows.nth(2)).toContainText("in “not explained”");
    expect(await rows.last().locator("td").allTextContents()).toEqual(["Cap growth that no report accounts for", "2.8%", "8% of this window’s growth"]);
  });

  test("a placed environment row shows its own name and no reports pill", async ({ page }) => {
    const cost = readyCapCost();
    const chat = { value: "Claude chat", label: "Claude chat", tokens: null, reports: 0, cap_points: 3, multiplier: null, state: MultiplierState.NotEnough, how_sure: null, stretches: 0 };
    await openReady(page, { cap_cost: { ...cost, environments: [...cost.environments, chat] } });
    if (isPhone()) {
      const row = page.locator(".source-row").nth(2);
      await expect(row.locator(".source-main")).toHaveText("Claude chat");
      await expect(row).not.toContainText("Reported");
      return;
    }
    const row = page.locator(".sources-table tbody tr").nth(2);
    await expect(row.locator("th")).toHaveText("Claude chat");
    await expect(row.locator(".pill")).toHaveCount(0);
  });

  test("lists the stretches with the most unexplained growth, largest first", async ({ page }) => {
    await openReady(page);
    if (isPhone()) return;
    const rows = page.locator(".stretch-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("span")).toHaveText(["Sat 14, 10:05–12:40", "+1.6 points", "No agent reported in this stretch"]);
    await expect(rows.nth(1).locator("span").last()).toHaveText("Agents reported 1.4 points of it");
  });

  test("the task table and the agent kind card show the share of the cap", async ({ page }) => {
    await openReady(page);
    if (isPhone()) {
      await expect(page.locator(".task-row-top .task-value").first()).toHaveText("8.6%");
      await expect(page.getByRole("heading", { level: 2, name: "Cost per agent kind" })).toHaveCount(0);
      return;
    }
    const rows = page.locator(".usage-table-tasks tbody tr");
    expect(await rows.first().locator("td").last().textContent()).toBe("8.6%");
    expect(await rows.last().locator("td").last().textContent()).toBe("4.0%");
    const kinds = page.locator(".kind-cost-row");
    await expect(kinds).toHaveCount(3);
    await expect(kinds.last().locator(".kind-cost-tokens")).toHaveText("not reported");
    await expect(kinds.last().locator(".kind-cost-percent")).toHaveText("2.8%");
    await expect(page.getByText("Work a helper agent does counts under the agent that started it.")).toBeVisible();
  });
});
