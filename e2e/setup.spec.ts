import { expect, type Page, test } from "@playwright/test";
import { CHAT_PREFACE } from "../src/api/chatText";
import type { GrantDto } from "../src/api/grants";
import { SERVER_INSTRUCTIONS } from "../src/mcp/instructions";
import { demoBoard, SERVER_TIME } from "./fixture";
import { delayTimerCount, expectLoadingAfterDelay, pageSettled, pausedClock } from "./loadingClock";

const CHAT_TEXT_ROUTE = "**/api/chat-text";
const GRANTS_ROUTE = "**/api/grants";
const REVOKE_ROUTE = "**/api/grants/*/revoke";
const BOARD_ROUTE = "**/api/board";
const SETUP_PAGE = "/#/setup";
const SLOW_MS = 1500;
const NO_CONTENT = 204;
/** The one block the owner pastes: the connector line, a blank line, then the rules. */
const PASTE = `${CHAT_PREFACE}\n\n${SERVER_INSTRUCTIONS}`;
const CONFIRM_TEXT = "End access for claude.ai? Its chats stop reporting until you connect it again.";

function twoGrants(): GrantDto[] {
  return [
    { id: "g1", client_name: "claude.ai", connected_at: "2026-11-17T09:12:00.000Z" },
    { id: "g2", client_name: "Claude Design", connected_at: "2026-11-16T18:40:00.000Z" },
  ];
}

async function routeChatText(page: Page, delayMs = 0) {
  await page.route(CHAT_TEXT_ROUTE, async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ json: { text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE } });
  });
}

/** Fakes the grants list and the revoke action; the returned array is what the Worker would still hold. */
async function routeGrants(page: Page, grants: GrantDto[] = twoGrants()) {
  const held = [...grants];
  const revoked: string[] = [];
  await page.route(GRANTS_ROUTE, (route) => route.fulfill({ json: { grants: held } }));
  await page.route(REVOKE_ROUTE, (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    revoked.push(id);
    held.splice(0, held.length, ...held.filter((grant) => grant.id !== id));
    return route.fulfill({ status: NO_CONTENT });
  });
  return { revoked };
}

async function openSetup(page: Page, delayMs = 0) {
  await routeChatText(page, delayMs);
  const grants = await routeGrants(page);
  await page.goto(SETUP_PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Set up a chat" })).toBeVisible();
  return grants;
}

const block = (page: Page) => page.locator("pre.setup-block");
const rowOf = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

test("one block holds the connector line, a blank line and the server's text; the one Copy copies exactly that", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openSetup(page);
  await expect(page.getByRole("heading", { level: 2, name: "Everything for the Instructions box" })).toBeVisible();
  await expect(page.getByText("This is all of it.")).toBeVisible();
  await expect(block(page)).toHaveText(PASTE.replace(/\r\n/g, "\n"));
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Now paste it into the Instructions box and save." })).toBeVisible();
  // The Windows clipboard turns each line feed into CR LF on read; the text itself is unchanged.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, "\n")).toBe(PASTE);
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
  await routeGrants(page);
  await page.route(CHAT_TEXT_ROUTE, (route) => route.fulfill({ json: {} }));
  await page.goto(SETUP_PAGE);
  await expect(page.getByText("Couldn’t load the instruction text")).toBeVisible();
  await expect(page.getByText("The API could not be reached.")).toBeVisible();
});

test("a slow load shows the loading state naming what it waits for", async ({ page }) => {
  await openSetup(page, SLOW_MS);
  await expect(page.getByRole("status", { name: "Loading the instruction text…" })).toBeVisible();
  await expect(block(page)).toBeVisible();
});

test("a failed load says so and Retry loads the text", async ({ page }) => {
  let failing = true;
  await routeGrants(page);
  await page.route(CHAT_TEXT_ROUTE, (route) =>
    failing ? route.fulfill({ status: 503, body: "x" }) : route.fulfill({ json: { text: SERVER_INSTRUCTIONS, preface: CHAT_PREFACE } }),
  );
  await page.goto(SETUP_PAGE);
  await expect(page.getByText("Couldn’t load the instruction text")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(block(page)).toHaveText(PASTE);
});

test("the board links to the panel", async ({ page }) => {
  await page.clock.setFixedTime(new Date(SERVER_TIME));
  await page.route(BOARD_ROUTE, (route) => route.fulfill({ json: demoBoard() }));
  await routeChatText(page);
  await routeGrants(page);
  await page.goto("/#/");
  await page.getByRole("link", { name: "Set up a chat" }).click();
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(block(page)).toHaveText(PASTE);
});

test("Connected apps lists each app with its name and when it connected, and no scope", async ({ page }) => {
  await openSetup(page);
  await expect(page.getByRole("heading", { level: 2, name: "Connected apps" })).toBeVisible();
  await expect(rowOf(page, "claude.ai")).toContainText("Connected Tue 17 Nov, 09:12");
  await expect(rowOf(page, "Claude Design")).toContainText("Connected Mon 16 Nov, 18:40");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText(/mcp:|scope/i)).toHaveCount(0);
});

test("End access asks in the page, Keep it leaves the app, and the second End access removes it", async ({ page }) => {
  const { revoked } = await openSetup(page);
  const row = rowOf(page, "claude.ai");
  await row.getByRole("button", { name: "End access" }).click();
  await expect(row.getByRole("alert")).toContainText(CONFIRM_TEXT);
  await row.getByRole("button", { name: "Keep it" }).click();
  await expect(row.getByRole("alert")).toHaveCount(0);
  expect(revoked).toEqual([]);
  await row.getByRole("button", { name: "End access" }).click();
  await row.getByRole("button", { name: "End access" }).click();
  await expect(rowOf(page, "claude.ai")).toHaveCount(0);
  await expect(rowOf(page, "Claude Design")).toBeVisible();
  expect(revoked).toEqual(["g1"]);
});

test("a refused End access says so and keeps the app in the list", async ({ page }) => {
  await openSetup(page);
  await page.route(REVOKE_ROUTE, (route) => route.fulfill({ status: 503, body: "x" }));
  const row = rowOf(page, "claude.ai");
  await row.getByRole("button", { name: "End access" }).click();
  await row.getByRole("button", { name: "End access" }).click();
  await expect(row.getByText("Couldn’t end access. Try again.")).toBeVisible();
  await expect(rowOf(page, "claude.ai")).toHaveCount(1);
});

test("a slow End access names what it waits for only after 500 ms", async ({ page }) => {
  await pausedClock(page);
  await openSetup(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(REVOKE_ROUTE, async (route) => {
    await gate;
    await route.fulfill({ status: NO_CONTENT }).catch(() => {});
  });
  const row = rowOf(page, "claude.ai");
  await row.getByRole("button", { name: "End access" }).click();
  const before = await delayTimerCount(page);
  await row.getByRole("button", { name: "End access" }).click();
  await pageSettled(page);
  const ending = page.getByText("Ending access…");
  await expectLoadingAfterDelay(
    page,
    () => expect(ending).toHaveCount(0),
    () => expect(ending).toBeVisible(),
    before,
  );
  release();
});

test("with no grants the list says no app is connected", async ({ page }) => {
  await routeChatText(page);
  await routeGrants(page, []);
  await page.goto(SETUP_PAGE);
  await expect(page.getByText("No app is connected yet. Paste the text above into claude.ai to connect one.")).toBeVisible();
});

test("a failed grants load names the API's answer and Retry loads the list", async ({ page }) => {
  let failing = true;
  await routeChatText(page);
  await page.route(GRANTS_ROUTE, (route) =>
    failing ? route.fulfill({ status: 503, body: "x" }) : route.fulfill({ json: { grants: twoGrants() } }),
  );
  await page.goto(SETUP_PAGE);
  await expect(page.getByText("Couldn’t load connected apps. The API answered 503 (service unavailable).")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(rowOf(page, "claude.ai")).toBeVisible();
});

test("the grants loading state shows only after 500 ms", async ({ page }) => {
  await pausedClock(page);
  await routeChatText(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(GRANTS_ROUTE, async (route) => {
    await gate;
    await route.fulfill({ json: { grants: twoGrants() } }).catch(() => {});
  });
  await page.goto(SETUP_PAGE);
  await pageSettled(page);
  const loading = page.getByText("Loading connected apps…");
  await expectLoadingAfterDelay(
    page,
    () => expect(loading).toHaveCount(0),
    () => expect(loading).toBeVisible(),
  );
  release();
});
