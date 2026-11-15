import { describe, expect, it } from "vitest";
import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { boardReducer, INITIAL_STATE } from "../web/src/boardState";
import { groupByProject, projectLabel, waitingItems } from "../web/src/model";
import { LOCALES, pickLocale, translator } from "../web/src/strings";
import { looksFor, paletteVars } from "../web/src/theme";
import { ageText, clockTime, hoursSince } from "../web/src/time";

const NOW = Date.parse("2026-11-15T13:48:00.000Z");

function item(over: Partial<BoardItemDto>): BoardItemDto {
  return {
    key: "p/x", project: "p", parent: null, type: ItemType.Slice, priority: Priority.P2, status: ItemStatus.Open,
    title: "T", why: null, details_md: null, links: [], heartbeat_at: "2026-11-15T10:00:00.000Z",
    created_at: "2026-11-15T09:00:00.000Z", done_at: null, events: [], ...over,
  };
}

describe("grouping and order", () => {
  const items = [
    item({ key: "a/1", project: "a", priority: Priority.P2 }),
    item({ key: "a/2", project: "a", priority: Priority.P0 }),
    item({ key: "a/w1", project: "a", type: ItemType.WaitingForMe, priority: Priority.P1, created_at: "2026-11-15T12:00:00.000Z" }),
    item({ key: "a/w0", project: "a", type: ItemType.WaitingForMe, priority: Priority.P1, created_at: "2026-11-15T11:00:00.000Z" }),
    item({ key: "a/d1", project: "a", status: ItemStatus.Done, done_at: "2026-11-15T10:00:00.000Z" }),
    item({ key: "a/d2", project: "a", status: ItemStatus.Done, done_at: "2026-11-15T12:00:00.000Z" }),
    item({ key: "z/1", project: "z" }),
    item({ key: "b/1", project: "b" }),
  ];
  const projects = [{ id: "z", label: "Zed" }, { id: "empty", label: "Nothing" }, { id: "a", label: "Alpha" }];

  it("lists configured projects first, in config order, then others by id, and skips empty ones", () => {
    expect(groupByProject(items, projects).map((g) => g.label)).toEqual(["Zed", "Alpha", "b"]);
  });

  it("sorts waiting by priority then oldest ask, in flight by priority, done newest first", () => {
    const alpha = groupByProject(items, projects).find((g) => g.id === "a")!;
    expect(alpha.waiting.map((i) => i.key)).toEqual(["a/w0", "a/w1"]);
    expect(alpha.inFlight.map((i) => i.key)).toEqual(["a/2", "a/1"]);
    expect(alpha.done.map((i) => i.key)).toEqual(["a/d2", "a/d1"]);
    expect(waitingItems(items).map((i) => i.key)).toEqual(["a/w0", "a/w1"]);
  });

  it("does not list a done waiting item as waiting, and labels unknown projects by id", () => {
    const done = item({ type: ItemType.WaitingForMe, status: ItemStatus.Done, done_at: "2026-11-15T12:00:00.000Z" });
    expect(waitingItems([done])).toEqual([]);
    expect(projectLabel("q", projects)).toBe("q");
    expect(projectLabel("a", projects)).toBe("Alpha");
  });
});

describe("time text", () => {
  const t = translator("en");

  it("gives minutes, hours and days, never less than 1 min", () => {
    expect(ageText("2026-11-15T13:23:00.000Z", NOW, t)).toBe("25 min ago");
    expect(ageText("2026-11-15T13:47:59.000Z", NOW, t)).toBe("1 min ago");
    expect(ageText("2026-11-15T11:40:00.000Z", NOW, t)).toBe("2 h ago");
    expect(ageText("2026-11-12T13:00:00.000Z", NOW, t)).toBe("3 d ago");
    expect(hoursSince("2026-11-15T10:40:00.000Z", NOW)).toBe(3);
  });

  it("formats HH:mm with a leading zero in local time", () => {
    expect(clockTime(new Date(2026, 10, 15, 7, 5))).toBe("07:05");
    expect(clockTime(new Date(2026, 10, 15, 13, 48).toISOString())).toBe("13:48");
  });
});

describe("strings", () => {
  it("gives every locale every key", () => {
    const english = Object.keys(LOCALES.en!).sort();
    for (const [name, table] of Object.entries(LOCALES)) {
      expect(Object.keys(table).sort(), name).toEqual(english);
      for (const [key, value] of Object.entries(table)) {
        const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(placeholders(value), `${name}.${key}`).toEqual(placeholders(LOCALES.en![key as keyof typeof LOCALES.en]!));
      }
    }
  });

  it("fills placeholders, picks the locale from the language tag and falls back to English", () => {
    expect(translator("en")("askedAge", { age: "5 min ago", parent: "Plan" })).toBe("Asked 5 min ago · Plan");
    expect(translator("de")("retry")).toBe("Erneut versuchen");
    expect(translator("xx")("retry")).toBe("Retry");
    expect(pickLocale("de-AT")).toBe("de");
    expect(pickLocale("fr-FR")).toBe("en");
    expect(pickLocale(undefined)).toBe("en");
  });
});

describe("board state", () => {
  const response = { config: { projects: [] }, window_hours: 12, items: [], server_time: "x" } as unknown as BoardResponse;

  it("keeps the config but clears the board on a failure, and shows the loading state only when slow", () => {
    const ok = boardReducer(INITIAL_STATE, { type: "success", data: response, at: new Date(0) });
    expect(ok.data).toBe(response);
    const failed = boardReducer(ok, { type: "failure", status: 503 });
    expect(failed).toMatchObject({ data: null, error: { status: 503 }, loading: false });
    expect(failed.config).toBe(ok.config);
    expect(boardReducer(failed, { type: "start" })).toMatchObject({ loading: true, slow: false });
    expect(boardReducer({ ...failed, loading: false }, { type: "slow" }).slow).toBe(false);
    expect(boardReducer({ ...INITIAL_STATE }, { type: "slow" }).slow).toBe(true);
  });
});

describe("theme", () => {
  const config = {
    projects: [],
    types: { slice: { label: "Slice", color: "#000", dark: { bg: "#1", fg: "#2", border: "#3" } } },
    statuses: {},
    priorities: {},
    palettes: { light: { page: "#fff" }, dark: { page: "#000" } },
  } as unknown as Parameters<typeof looksFor>[0];

  it("reads a type's colours for the scheme and falls back to the page's own colours", () => {
    expect(looksFor(config, "dark").type(ItemType.Slice)).toEqual({ bg: "#1", fg: "#2", border: "#3", label: "Slice" });
    expect(looksFor(config, "light").type(ItemType.Slice).bg).toBe("var(--card)");
    expect(looksFor(null, "light").type(ItemType.Bug).label).toBe("bug");
    expect(looksFor(null, "dark").status(ItemStatus.Open).dot).toBe("transparent");
  });

  it("turns the palette into custom properties", () => {
    expect(paletteVars(config, "dark")).toMatchObject({ "--page": "#000", "--text": "#E8EAEE" });
    expect(paletteVars(null, "light")).toMatchObject({ "--page": "#F5F6F8", "--primaryBg": "#14171C" });
  });
});
