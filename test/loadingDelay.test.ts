import { describe, expect, it } from "vitest";
import { LOADING_DELAY_MS } from "../e2e/loadingClock";
import { SLOW_AFTER_MS } from "../web/src/hooks";

describe("the e2e loading delay", () => {
  it("equals the page's own SLOW_AFTER_MS", () => {
    expect(LOADING_DELAY_MS).toBe(SLOW_AFTER_MS);
  });
});
