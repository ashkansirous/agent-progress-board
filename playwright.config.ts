import { defineConfig, devices } from "@playwright/test";

const DEFAULT_PORT = 4173;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** E2E_PORT unset keeps the default; any set value must be a whole port number, else config load fails. */
function resolvePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`E2E_PORT must be a whole number from ${MIN_PORT} to ${MAX_PORT}, got "${raw}"`);
  }
  return port;
}

const PORT = resolvePort(process.env.E2E_PORT);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const PHONE_VIEWPORT = { width: 390, height: 844 };

/**
 * The page is served by `vite --mode e2e`: the bare page with no Worker, so no Access gate. Every test
 * fakes /api/board with page.route. The desktop run uses the light scheme and the phone run the dark
 * one, as the mock draws them.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: { baseURL: ORIGIN, timezoneId: "UTC", locale: "en-US", trace: "retain-on-failure" },
  webServer: {
    command: `npx vite --mode e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: ORIGIN,
    env: { AGENT_BOARD_PLAYWRIGHT_SERVER: "1" },
    // Never attach to a server this run did not start: a parallel worktree's server may serve other code.
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT, colorScheme: "light" } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: PHONE_VIEWPORT, colorScheme: "dark" } },
  ],
});
