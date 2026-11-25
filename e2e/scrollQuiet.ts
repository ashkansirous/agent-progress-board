import type { Page } from "@playwright/test";

/** A page counts as settled when no scroll was recorded for this long, measured with the page's own `performance.now()`. */
export const SCROLL_QUIET_MS = 300;

/** The window property a test's scroll hook stamps with `performance.now()` at every scroll it records. */
export const LAST_SCROLL_AT = "__lastScrollAt";

/** The init-script source that stamps the page's start, so a page that never scrolls is quiet after the window too. */
export const STAMP_START = `window.${LAST_SCROLL_AT} = performance.now();`;

/** Resolves once the page recorded no scroll for SCROLL_QUIET_MS; a late duplicate scroll restarts the wait. */
export async function waitForQuietScrolls(page: Page) {
  await page.evaluate(
    ([property, quiet]) =>
      new Promise<void>((resolve) => {
        const stamp = () => (window as unknown as Record<string, number>)[property] ?? 0;
        const check = () => {
          const left = quiet - (performance.now() - stamp());
          if (left <= 0) resolve();
          else setTimeout(check, left);
        };
        check();
      }),
    [LAST_SCROLL_AT, SCROLL_QUIET_MS] as const,
  );
}
