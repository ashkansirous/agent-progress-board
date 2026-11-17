import { expect, type Page, test } from "@playwright/test";
import { CHAT_PREFACE } from "../src/api/chatText";
import { SERVER_INSTRUCTIONS } from "../src/mcp/instructions";
import { demoBoard, SERVER_TIME } from "./fixture";

const CHAT_TEXT_ROUTE = "**/api/chat-text";
const BOARD_ROUTE = "**/api/board";
const SETUP_PAGE = "/#/setup";
const SLOW_MS = 1500;

async function openSetup(page: Page, delayMs = 0) {
  await page.route(CHAT_TEXT_ROUTE, async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ json: { text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE } });
  });
  await page.goto(SETUP_PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Set up a chat" })).toBeVisible();
}

test("the panel shows the server's instruction text and Copy puts exactly that text on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSetup(page);
  await expect(page.getByLabel("Instruction text")).toHaveValue(SERVER_INSTRUCTIONS);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  // The Windows clipboard turns each line feed into CR LF on read; the text itself is unchanged.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, "\n")).toBe(SERVER_INSTRUCTIONS);
});

test("the connector preface is its own line with its own Copy button", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSetup(page);
  await expect(page.getByText(CHAT_PREFACE, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy the line" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CHAT_PREFACE);
});

test("a refused clipboard shows the copy-failed note, which clears by itself", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await openSetup(page);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not copy");
  await expect(page.getByRole("alert")).toBeHidden({ timeout: 10000 });
});

test("a response without text counts as a failed load", async ({ page }) => {
  await page.route(CHAT_TEXT_ROUTE, (route) => route.fulfill({ json: {} }));
  await page.goto(SETUP_PAGE);
  await expect(page.getByText("Couldn’t load the instruction text")).toBeVisible();
});

test("a slow load shows the loading state naming what it waits for", async ({ page }) => {
  await openSetup(page, SLOW_MS);
  await expect(page.getByRole("status", { name: "Loading the instruction text…" })).toBeVisible();
  await expect(page.getByLabel("Instruction text")).toBeVisible();
});

test("a failed load says so and Retry loads the text", async ({ page }) => {
  let failing = true;
  await page.route(CHAT_TEXT_ROUTE, (route) =>
    failing ? route.fulfill({ status: 503, body: "x" }) : route.fulfill({ json: { text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE } }),
  );
  await page.goto(SETUP_PAGE);
  await expect(page.getByText("Couldn’t load the instruction text")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Instruction text")).toHaveValue(SERVER_INSTRUCTIONS);
});

test("the board links to the panel", async ({ page }) => {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: demoBoard() }));
  await page.route(CHAT_TEXT_ROUTE, (route) => route.fulfill({ json: { text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE } }));
  await page.goto("/#/");
  await page.getByRole("link", { name: "Set up a chat" }).click();
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(page.getByLabel("Instruction text")).toHaveValue(SERVER_INSTRUCTIONS);
});
