import { expect, type Page, test } from "@playwright/test";
import type { BoardItemDto } from "../src/api/boardDto";
import { ItemType, Priority } from "../src/domain/item";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { demoBoard, demoItem, SERVER_TIME } from "./fixture";
import { openAllProjects, project } from "./projectBlock";

const BOARD_ROUTE = "**/api/board";
const FINDING_KEY = "recipe-box/finding-over-budget-1a2b3c4d5e";
const FINDING_TITLE = "test/suite: 3 of 9 runs over the 6-minute budget";

/** The demo board plus one open process-optimiser finding in Recipe Box (Slice 57). */
function boardWithFinding() {
  const base = demoItem("recipe-box/resize");
  const finding: BoardItemDto = {
    ...base,
    key: FINDING_KEY,
    type: ItemType.Finding,
    priority: Priority.P3,
    title: FINDING_TITLE,
    why: "Estimated saving: time 40 min, tokens not known",
    parent: null,
  };
  const items = [...demoBoard().items, finding];
  return demoBoard(items);
}

async function openBoard(page: Page) {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: boardWithFinding() }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await openAllProjects(page);
}

test.describe("process optimiser findings", () => {
  test("an open finding is listed in its own section, with the Finding type label, and not under Other open items", async ({ page }) => {
    await openBoard(page);
    const recipe = project(page, "Recipe Box");
    const section = recipe.locator(".section", { has: page.getByRole("heading", { level: 3, name: "Findings · 1" }) });
    await expect(section.locator(".tile-title")).toHaveText(FINDING_TITLE);
    await expect(section.getByText(exampleConfig.types.finding.label, { exact: true })).toBeVisible();
    const other = recipe.locator(".section", { hasText: "Other open items · 1" });
    expect(await other.locator(".tile-title").allTextContents()).toEqual(["Image uploads skip resizing"]);
  });
});
