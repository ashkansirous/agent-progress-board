import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `vite --mode e2e` serves the bare page (no Worker, so no Access gate) for the Playwright tests. It
 * refuses to start or build unless playwright.config.ts set the env flag, so the ungated page can
 * never be built or served by accident.
 */
const E2E_MODE = "e2e";
const E2E_ENV_FLAG = "AGENT_BOARD_PLAYWRIGHT_SERVER";
const WEB_ROOT = path.join(import.meta.dirname, "web");

function assertE2eAllowed(mode: string) {
  if (mode === E2E_MODE && process.env[E2E_ENV_FLAG] !== "1") {
    throw new Error(`vite mode "${E2E_MODE}" serves the page without the Access gate and runs only from playwright.config.ts`);
  }
}

export default defineConfig(({ mode }) => {
  assertE2eAllowed(mode);
  return {
    root: WEB_ROOT,
    plugins: mode === E2E_MODE ? [react()] : [react(), cloudflare({ configPath: "../wrangler.jsonc" })],
  };
});
