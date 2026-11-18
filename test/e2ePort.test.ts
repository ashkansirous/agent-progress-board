import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, resolvePort } from "../e2e/port";

describe("resolvePort", () => {
  it("keeps the default port when E2E_PORT is unset", () => {
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
  });

  it("accepts a whole port number from 1 to 65535", () => {
    expect(resolvePort("4174")).toBe(4174);
    expect(resolvePort("1")).toBe(1);
    expect(resolvePort("65535")).toBe(65535);
  });

  it.each(["", "  ", "abc", "4174x", "41.5", "0", "-1", "65536", "NaN", "Infinity"])("rejects the bad value %j", (raw) => {
    expect(() => resolvePort(raw)).toThrow(/E2E_PORT must be a whole number from 1 to 65535/);
  });
});
