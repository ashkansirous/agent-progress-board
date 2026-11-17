import { expect, type Page, test } from "@playwright/test";
import type { BoardResponse } from "../src/api/boardDto";
import { demoBoard, SERVER_TIME } from "./fixture";
import { project, projectToggle } from "./projectBlock";

const BOARD_ROUTE = "**/api/board";
const STORAGE_KEY = "board.projectOpen";

async function openBoard(page: Page, board: BoardResponse = demoBoard()) {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: board }));
  await page.goto("/");
  await expect(project(page, "Recipe Box")).toBeVisible();
}

function expanded(page: Page, name: string) {
  return projectToggle(project(page, name));
}

test.describe("project blocks", () => {
  test("a project with a question opens on load and a quiet one is folded", async ({ page }) => {
    await openBoard(page);
    await expect(expanded(page, "Recipe Box")).toHaveAttribute("aria-expanded", "true");
    await expect(expanded(page, "Garden Planner")).toHaveAttribute("aria-expanded", "true");
    await expect(expanded(page, "Home Lab")).toHaveAttribute("aria-expanded", "false");
    await expect(project(page, "Home Lab").locator(".project-body")).toHaveCount(0);
    await expect(project(page, "Home Lab").locator(".project-fold")).toHaveText("Open");
    await expect(project(page, "Recipe Box").locator(".project-fold")).toHaveText("Fold");
  });

  test("a click folds and opens a block and the choice is kept across a reload", async ({ page }) => {
    await openBoard(page);
    await expanded(page, "Home Lab").click();
    await expect(expanded(page, "Home Lab")).toHaveAttribute("aria-expanded", "true");
    await expect(project(page, "Home Lab").locator(".project-body")).toBeVisible();
    await page.reload();
    await expect(expanded(page, "Home Lab")).toHaveAttribute("aria-expanded", "true");
    await expanded(page, "Home Lab").click();
    await page.reload();
    await expect(expanded(page, "Home Lab")).toHaveAttribute("aria-expanded", "false");
  });

  test("folding one project then another keeps both folded after a reload", async ({ page }) => {
    await openBoard(page);
    await expanded(page, "Recipe Box").click();
    await expanded(page, "Garden Planner").click();
    await page.reload();
    await expect(expanded(page, "Recipe Box")).toHaveAttribute("aria-expanded", "false");
    await expect(expanded(page, "Garden Planner")).toHaveAttribute("aria-expanded", "false");
  });

  test("a project with a question opens on load whatever was stored, and can be folded afterwards", async ({ page }) => {
    await page.addInitScript(
      ([key]) => {
        if (!window.localStorage.getItem(key!)) window.localStorage.setItem(key!, JSON.stringify({ "recipe-box": { open: false, questions: [] } }));
      },
      [STORAGE_KEY],
    );
    await openBoard(page);
    await expect(expanded(page, "Recipe Box")).toHaveAttribute("aria-expanded", "true");
    await expanded(page, "Recipe Box").click();
    await expect(expanded(page, "Recipe Box")).toHaveAttribute("aria-expanded", "false");
    await expect(project(page, "Recipe Box").locator(".project-body")).toHaveCount(0);
  });

  test("the page draws expanded projects when storage fails", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      });
    });
    await openBoard(page);
    await expect(expanded(page, "Recipe Box")).toHaveAttribute("aria-expanded", "true");
    await expanded(page, "Recipe Box").click();
    await expect(expanded(page, "Recipe Box")).toHaveAttribute("aria-expanded", "false");
    await expect(expanded(page, "Home Lab")).toHaveAttribute("aria-expanded", "true");
  });

  test("the count pills use the singular for one", async ({ page }) => {
    const board = demoBoard();
    for (const group of board.groups) {
      group.summary.needs_you = group.id === "recipe-box" ? 1 : 0;
      group.summary.working = group.id === "recipe-box" ? 1 : 0;
      group.summary.problems = group.id === "recipe-box" ? 1 : 0;
    }
    await openBoard(page, board);
    await expect(page.locator(".count-row .count-pill")).toHaveText(["1 needs you", "1 working", "1 problem"]);
  });

  test("the groups of a project come in the mock's order and Done is folded", async ({ page }) => {
    await openBoard(page);
    const garden = project(page, "Garden Planner");
    const headings = await garden.locator(".project-body h3").allTextContents();
    const order = ["Needs you", "Working now", "Planned", "Problems and bugs"].map((word) => headings.findIndex((h) => h.startsWith(word)));
    expect(order.filter((index) => index >= 0)).toEqual(order.filter((index) => index >= 0).sort((a, b) => a - b));
    const done = garden.getByRole("button", { name: /done in the last 12 hours/ });
    await expect(done).toHaveAttribute("aria-expanded", "false");
    await expect(garden.locator(".done-row")).toHaveCount(0);
    await done.click();
    await expect(done).toHaveAttribute("aria-expanded", "true");
    await expect(garden.locator(".done-row").first()).toBeVisible();
    await page.reload();
    await expect(garden.getByRole("button", { name: /done in the last 12 hours/ })).toHaveAttribute("aria-expanded", "false");
  });

  test("the count row shows the totals over all projects", async ({ page }) => {
    const board = demoBoard();
    const sum = (pick: (g: BoardResponse["groups"][number]["summary"]) => number) =>
      board.groups.reduce((total, g) => total + pick(g.summary), 0);
    await openBoard(page, board);
    const pills = page.locator(".count-row .count-pill");
    await expect(pills).toHaveText([`${sum((s) => s.needs_you)} need you`, `${sum((s) => s.working)} working`, `${sum((s) => s.problems)} problems`]);
    await expect(pills.first()).toHaveText("3 need you");
  });

  test("a count of zero stays in the row", async ({ page }) => {
    const board = demoBoard();
    const quiet = { ...board, groups: board.groups.map((g) => ({ ...g, summary: { ...g.summary, problems: 0, needs_you: 0 } })) };
    await openBoard(page, quiet);
    await expect(page.locator(".count-row .count-pill")).toHaveText(["0 need you", /^\d+ working$/, "0 problems"]);
  });
});

test.describe("states", () => {
  test("the loading state is a question bar, two skeleton projects and the words", async ({ page }) => {
    await page.route(BOARD_ROUTE, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ json: demoBoard() });
    });
    await page.goto("/");
    await expect(page.getByText("Loading the board…")).toBeVisible({ timeout: 1500 });
    await expect(page.locator(".skeleton-strip")).toHaveCount(1);
    await expect(page.locator(".skeleton-block")).toHaveCount(2);
    await expect(page.locator(".skeleton-block .skeleton-tile")).toHaveCount(4);
    await expect(page.locator("button.project-toggle")).toHaveCount(0);
  });

  test("the failed state names the status and has Retry", async ({ page }) => {
    await page.route(BOARD_ROUTE, (route) => route.fulfill({ status: 503, body: "{}" }));
    await page.goto("/");
    await expect(page.getByText("Couldn’t load the board")).toBeVisible();
    await expect(page.getByText("The board API answered 503 (service unavailable). Showing nothing rather than old data.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});

test.describe("german", () => {
  test.use({ locale: "de-DE" });

  test("the title, the count row and the fold control are in German", async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Übersicht");
    await expect(page.locator(".count-row .count-pill").first()).toHaveText("3 brauchen dich");
    await expect(project(page, "Recipe Box").locator(".project-fold")).toHaveText("Einklappen");
    await expect(project(page, "Home Lab").locator(".project-fold")).toHaveText("Öffnen");
    await expect(page.locator(".board-header .subtitle")).toContainText("lädt alle 60 s neu");
  });
});
