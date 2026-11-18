import { describe, expect, it } from "vitest";
import { LOADING_DELAY_MS } from "../e2e/loadingClock";
// @ts-expect-error Vite's ?raw import has no type declaration in this project's tsconfig.
import hooksSource from "../web/src/hooks.ts?raw";

describe("the e2e loading delay", () => {
  it("equals the page's own SLOW_AFTER_MS", () => {
    const match = /export const SLOW_AFTER_MS = (\d+);/.exec(hooksSource);
    expect(match).not.toBeNull();
    expect(LOADING_DELAY_MS).toBe(Number(match?.[1]));
  });
});
