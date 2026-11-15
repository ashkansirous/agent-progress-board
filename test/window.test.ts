import { describe, expect, it } from "vitest";
import { resolveWindowHours, windowCutoff } from "../src/domain/window";

const config = { defaultHours: 12, maxHours: 72 };
const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("window", () => {
  it("defaults and caps the hours", () => {
    expect(resolveWindowHours(undefined, config)).toBe(12);
    expect(resolveWindowHours(24, config)).toBe(24);
    expect(resolveWindowHours(500, config)).toBe(72);
  });

  it("computes the cutoff", () => {
    expect(windowCutoff(NOW, 12)).toBe("2026-11-15T00:00:00.000Z");
  });
});
