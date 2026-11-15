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

  it("reads public_origin only as a bare https origin", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseConfig(undefined).publicOrigin).toBeNull();
    expect(parseConfig('{"public_origin":"https://board.example.org"}').publicOrigin).toBe("https://board.example.org");
    expect(parseConfig('{"public_origin":"https://board.example.org/"}').publicOrigin).toBe("https://board.example.org");
    for (const bad of ["http://board.example.org", "https://board.example.org/x", "https://u@board.example.org", "nope", 5]) {
      expect(parseConfig(JSON.stringify({ public_origin: bad })).publicOrigin, String(bad)).toBeNull();
    }
    log.mockRestore();
  });

  it("reads type colour sets, status and priority colours and palettes", () => {
    const config = parseConfig(
      JSON.stringify({
        types: { bug: { label: "Bug", color: "#a855f7", dark: { bg: "#3B1A1A", fg: "#FF9B94", border: "rgba(1,2,3,0.5)" } } },
        statuses: { blocked: { light: { fg: "#B42318", dot: "#B42318" } } },
        priorities: { P0: { dark: { bg: "transparent", fg: "#fff", border: "#fff" } } },
        palettes: { dark: { page: "#0E1014" } },
      }),
    );
    expect(config.types.bug?.dark?.fg).toBe("#FF9B94");
    expect(config.statuses.blocked?.light?.dot).toBe("#B42318");
    expect(config.priorities.P0?.dark?.bg).toBe("transparent");
    expect(config.palettes.dark?.page).toBe("#0E1014");
  });

  it("drops colour maps with an unknown name, a bad colour or a missing field, and logs", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseConfig('{"statuses":{"nope":{}}}').statuses).toEqual({});
    expect(parseConfig('{"statuses":{"open":{"light":{"fg":"red","dot":"#000"}}}}').statuses).toEqual({});
    expect(parseConfig('{"priorities":{"P9":{}}}').priorities).toEqual({});
    expect(parseConfig('{"priorities":{"P0":{"light":{"bg":"#000"}}}}').priorities).toEqual({});
    expect(parseConfig('{"statuses":{"open":5}}').statuses).toEqual({});
    expect(parseConfig('{"priorities":{"P0":null}}').priorities).toEqual({});
    expect(parseConfig('{"palettes":{"sepia":{}}}').palettes).toEqual({});
    expect(parseConfig('{"palettes":{"light":{"page":"url(x)"}}}').palettes).toEqual({});
    expect(parseConfig('{"palettes":{"light":{"nope":"#000"}}}').palettes).toEqual({});
    expect(parseConfig('{"types":{"bug":{"label":"B","color":"#000","light":{"bg":"#000"}}}}').types).toEqual({});
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("reads staleAfterMinutes: default 120, whole minutes from 60 to 10080, else the default and a log", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(parseConfig(undefined).staleAfterMinutes).toBe(120);
    expect(parseConfig('{"staleAfterMinutes":90}').staleAfterMinutes).toBe(90);
    expect(parseConfig('{"staleAfterMinutes":60}').staleAfterMinutes).toBe(60);
    expect(parseConfig('{"staleAfterMinutes":10080}').staleAfterMinutes).toBe(10080);
    expect(log).not.toHaveBeenCalled();
    for (const bad of ["59", "10081", "1000000000000", "90.5", '"60"', "null", "-5"]) {
      expect(parseConfig(`{"staleAfterMinutes":${bad}}`).staleAfterMinutes).toBe(120);
    }
    expect(log).toHaveBeenCalledTimes(7);
    log.mockRestore();
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
