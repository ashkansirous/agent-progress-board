import { expect, type Page } from "@playwright/test";
import { SERVER_TIME } from "./fixture";

/**
 * The page's own load-delay wait (`SLOW_AFTER_MS` in `web/src/hooks.ts`), in ms: the loading card shows only after it.
 * `test/loadingDelay.test.ts` pins this equal to the page's constant.
 */
export const LOADING_DELAY_MS = 500;

const BOARD_ROUTE = "**/api/board";

/** The window property that counts the page's load-delay timers (set by the init script in `pausedClock`). */
const DELAY_TIMER_COUNT = "__loadDelayTimers";

/**
 * Installs the page clock before the page loads and stops it, so the page's 500 ms timer is created under the fake
 * clock and fires only when the test runs the clock. The clock is installed 1 s before SERVER_TIME (pauseAt needs a
 * time later than the installed one) and paused at SERVER_TIME, so the page's `Date.now()` equals the fixtures' time.
 * An init script counts the page's 500 ms timers so a test can prove the
 * timer exists before it checks that the card is still absent.
 */
export async function pausedClock(page: Page) {
  await page.clock.install({ time: new Date(Date.parse(SERVER_TIME) - 1000) });
  await page.clock.pauseAt(new Date(SERVER_TIME));
  await page.addInitScript(`(() => {
    window.${DELAY_TIMER_COUNT} = 0;
    const original = window.setTimeout.bind(window);
    window.setTimeout = (handler, timeout, ...args) => {
      if (timeout === ${LOADING_DELAY_MS}) window.${DELAY_TIMER_COUNT} += 1;
      return original(handler, timeout, ...args);
    };
  })();`);
}

type HoldOptions = {
  /** While this returns true a request fails with 503 at once instead of being held. */
  failWhile?: () => boolean;
};

/**
 * A route that holds every request until the test calls `release()`, or the page closes (so a test that throws before
 * `release()` leaves no handler hanging, and a fulfil on a request the page already dropped is swallowed).
 * `requested` resolves when the first request is held. It relies on the page's ordering: the load hook registers its
 * load-delay timer just before it sends the request (React StrictMode runs the effect twice, so a second timer may
 * follow the first request, but the first one is the one that decides the card and it exists from then on).
 */
export async function holdBoardRoute(page: Page, board: () => unknown, options: HoldOptions = {}) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed = new Promise<void>((resolve) => page.once("close", () => resolve()));
  let markRequested: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  await page.route(BOARD_ROUTE, async (route) => {
    if (options.failWhile?.()) return route.fulfill({ status: 503, body: "{}" });
    markRequested();
    await Promise.race([gate, closed]);
    await route.fulfill({ json: board() }).catch(() => {});
  });
  return { release, requested };
}

/** How many 500 ms load-delay timers the page has created so far (take it before the action under test). */
export async function delayTimerCount(page: Page): Promise<number> {
  return page.evaluate<number>(`window.${DELAY_TIMER_COUNT}`);
}

/**
 * Checks the loading card stays away until 500 ms: first that the action under test created a 500 ms timer (the count
 * grew past `timersBefore`, a snapshot from `delayTimerCount` taken before the action, so an earlier load's timer
 * cannot satisfy it), then at 499 ms `absent` must hold, one more millisecond and `present` must. Call after
 * `requested` resolved, on a page from `pausedClock`.
 */
export async function expectLoadingAfterDelay(
  page: Page,
  absent: () => Promise<void>,
  present: () => Promise<void>,
  timersBefore = 0,
) {
  // Polled, not read once: the timer is created by an effect that may run just after the request is held.
  await expect
    .poll(() => delayTimerCount(page), { message: "the action under test did not create a 500 ms loading timer" })
    .toBeGreaterThan(timersBefore);
  await page.clock.runFor(LOADING_DELAY_MS - 1);
  await absent();
  await page.clock.runFor(1);
  await present();
}

/**
 * Lets the page's effects and the work React queued run, so a rewrite that follows a state change has happened. Uses
 * message-channel round trips, not requestAnimationFrame: the page clock fakes rAF, which never fires while it is
 * paused, so this also works before the test runs the clock.
 */
export async function pageSettled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        let rounds = 0;
        channel.port1.onmessage = () => {
          rounds += 1;
          if (rounds < 3) channel.port2.postMessage(null);
          else resolve();
        };
        channel.port2.postMessage(null);
      }),
  );
}
