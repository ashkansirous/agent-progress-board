import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WINDOW, parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("falls back to defaults when unset", () => {
    expect(parseConfig(undefined).window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig("").projects).toEqual([]);
  });

  it("reads window and projects", () => {
    const config = parseConfig(
      '{"window":{"default_hours":6,"max_hours":24},"projects":[{"id":"demo-app","label":"Demo App"}]}',
    );
    expect(config.window).toEqual({ defaultHours: 6, maxHours: 24 });
    expect(config.projects).toHaveLength(1);
    expect(parseConfig('{"types":{"bug":{"label":"Bug","color":"#a855f7"}}}').types.bug?.color).toBe("#a855f7");
  });

  it("falls back to defaults and logs on bad json, bad windows and wrong shapes", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseConfig("{").window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig("null").window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig('{"window":{"default_hours":48,"max_hours":24}}').window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig('{"window":{"default_hours":"12"}}').window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig('{"window":{"max_hours":1e12}}').window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig('{"window":{"default_hours":0.5}}').window).toEqual(DEFAULT_WINDOW);
    expect(parseConfig('{"projects":"x"}').projects).toEqual([]);
    expect(parseConfig('{"projects":[1,null]}').projects).toEqual([]);
    expect(parseConfig('{"projects":[{"id":"a"}]}').projects).toEqual([]);
    expect(parseConfig('{"types":{"slice":{"label":"Slice"}}}').types).toEqual({});
    expect(parseConfig('{"types":{"nope":{"label":"x","color":"#fff"}}}').types).toEqual({});
    expect(parseConfig('{"types":[1]}').types).toEqual({});
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
