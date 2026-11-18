import { describe, expect, it } from "vitest";
import type { SnapshotItem } from "../src/domain/docSync";
import { ItemStatus, ItemType } from "../src/domain/item";
import {
  activePartOf,
  expandParts,
  MAX_PARTS,
  partKey,
  partLetterOf,
  partNow,
  PartNowKind,
  PartState,
  partsProgress,
  partStateOf,
  type PartView,
  shownStatusOf,
} from "../src/domain/parts";
import { StepState } from "../src/domain/stepTypes";
import { storedStep } from "./stepFixtures";
import { checkReport, DomainError } from "../src/domain/upsert";

const NOW = new Date("2026-11-16T13:48:00.000Z");
const MINUTES = 120;
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const STEPS = [storedStep("Review 1", StepState.Active)];

const states = (...list: PartState[]): PartState[] => list;
const D = PartState.Done;
const A = PartState.Active;
const S = PartState.Stale;
const P = PartState.Pending;

describe("partsProgress", () => {
  it("reads one of five parts done as 20%, whatever the part in progress has done", () => {
    expect(partsProgress(states(D, A, P, P, P))).toEqual({ done: 1, total: 5, percent: 20 });
  });

  it("has no bar for a slice with no parts", () => {
    expect(partsProgress([])).toBeNull();
  });

  it("reads all parts done as 100%", () => {
    expect(partsProgress(states(D, D, D))).toEqual({ done: 3, total: 3, percent: 100 });
  });

  it("counts a stale part as not done, and a part removed from the list shrinks the total", () => {
    expect(partsProgress(states(D, S, P, P, P))?.percent).toBe(20);
    expect(partsProgress(states(D, S, P, P))).toEqual({ done: 1, total: 4, percent: 25 });
  });

  it("rounds to a whole percent", () => {
    expect(partsProgress(states(D, P, P))?.percent).toBe(33);
  });
});

describe("partStateOf", () => {
  const live = { status: ItemStatus.InProgress, heartbeat_at: ago(5), doc_status_at: null, live_status_at: ago(5), steps: STEPS };

  it("is active while an agent works on it (the working-now rule)", () => {
    expect(partStateOf(live, MINUTES, NOW)).toBe(PartState.Active);
  });

  it("is stale when it is in progress and its heartbeat expired, or the cron marked it stale", () => {
    const old = { ...live, heartbeat_at: ago(200) };
    expect(partStateOf(old, MINUTES, NOW)).toBe(PartState.Stale);
    expect(partStateOf({ ...live, status: ItemStatus.Stale }, MINUTES, NOW)).toBe(PartState.Stale);
  });

  it("is blocked when stored as blocked, and partNow names it before Next", () => {
    expect(partStateOf({ ...live, status: ItemStatus.Blocked }, MINUTES, NOW)).toBe(PartState.Blocked);
    const parts = [{ key: "p/slice-1/part-A", letter: "A", title: "A", state: PartState.Blocked }, { key: "p/slice-1/part-B", letter: "B", title: "B", state: PartState.Pending }];
    expect(partNow(parts)).toMatchObject({ kind: PartNowKind.Blocked, part: { letter: "A" } });
  });

  it("is done when done and pending when open", () => {
    expect(partStateOf({ ...live, status: ItemStatus.Done }, MINUTES, NOW)).toBe(PartState.Done);
    expect(partStateOf({ ...live, status: ItemStatus.Open, steps: null }, MINUTES, NOW)).toBe(PartState.Pending);
  });
});

describe("partNow", () => {
  const part = (letter: string, state: PartState): PartView => ({ key: partKey("p/slice-1", letter), letter, title: letter, state });

  it("names the active part first", () => {
    const parts = [part("A", D), part("B", A), part("C", P)];
    expect(partNow(parts)).toMatchObject({ kind: PartNowKind.Active, part: { letter: "B" } });
    expect(activePartOf(parts)?.letter).toBe("B");
  });

  it("names a stale part when none is active, and never offers it to follow", () => {
    const parts = [part("A", D), part("B", S), part("C", P)];
    expect(partNow(parts)).toMatchObject({ kind: PartNowKind.Stale, part: { letter: "B" } });
    expect(activePartOf(parts)).toBeNull();
  });

  it("reads Next with the first pending part, and all done with none left", () => {
    const parts = [part("A", D), part("B", P), part("C", P)];
    expect(partNow(parts)).toMatchObject({ kind: PartNowKind.Next, part: { letter: "B" } });
    expect(partNow([part("A", D)])).toEqual({ kind: PartNowKind.AllDone, part: null });
  });
});

describe("part keys", () => {
  it("builds and reads <slice key>/part-<letter>", () => {
    expect(partKey("demo-app/slice-58", "B")).toBe("demo-app/slice-58/part-B");
    expect(partLetterOf("demo-app/slice-58/part-B")).toBe("B");
    expect(partLetterOf("demo-app/slice-58")).toBeNull();
    expect(partLetterOf("demo-app/slice-58/part-b")).toBeNull();
  });
});

describe("expandParts", () => {
  const slice = (parts?: { letter: string; title: string; done: boolean }[]): SnapshotItem => ({
    key: "demo-app/slice-5",
    project: "demo-app",
    type: ItemType.Slice,
    title: "Slice 5",
    status: ItemStatus.Open,
    parts,
  });

  it("adds each part as an item of type part under its slice, done by the document", () => {
    const items = expandParts([slice([{ letter: "A", title: "Server", done: true }, { letter: "B", title: "Page", done: false }])]);
    expect(items.map((i) => i.key)).toEqual(["demo-app/slice-5", "demo-app/slice-5/part-A", "demo-app/slice-5/part-B"]);
    expect(items[0]).not.toHaveProperty("parts");
    expect(items[1]).toMatchObject({ type: "part", title: "Server", status: "done", parent_key: "demo-app/slice-5", project: "demo-app" });
    expect(items[2]).toMatchObject({ status: "open" });
  });

  it("leaves a slice with no parts alone", () => {
    expect(expandParts([slice()])).toHaveLength(1);
    expect(expandParts([slice([])])).toHaveLength(1);
  });

  it("rejects a letter that is not one capital letter and more parts than letters", () => {
    expect(() => expandParts([slice([{ letter: "a", title: "x", done: false }])])).toThrow(DomainError);
    expect(() => expandParts([slice([{ letter: "AB", title: "x", done: false }])])).toThrow(DomainError);
    const many = Array.from({ length: MAX_PARTS + 1 }, (_, i) => ({ letter: "A", title: String(i), done: false }));
    expect(() => expandParts([slice(many)])).toThrow(DomainError);
  });
});

describe("shownStatusOf", () => {
  it("reads an open or stale slice with an active part as in flight, and leaves every other status alone", () => {
    expect(shownStatusOf(ItemStatus.Open, true)).toBe(ItemStatus.InProgress);
    expect(shownStatusOf(ItemStatus.Stale, true)).toBe(ItemStatus.InProgress);
    expect(shownStatusOf(ItemStatus.Blocked, true)).toBe(ItemStatus.Blocked);
    expect(shownStatusOf(ItemStatus.Done, true)).toBe(ItemStatus.Done);
  });

  it("keeps the stored status when no part is active", () => {
    expect(shownStatusOf(ItemStatus.Open, false)).toBe(ItemStatus.Open);
    expect(shownStatusOf(ItemStatus.Stale, false)).toBe(ItemStatus.Stale);
  });
});

describe("expandParts on a non-slice", () => {
  const bug = (parts: { letter: string; title: string; done: boolean }[]): SnapshotItem => ({
    key: "demo-app/bug-1",
    project: "demo-app",
    type: ItemType.Bug,
    title: "A bug",
    status: ItemStatus.Open,
    parts,
  });

  it("rejects parts on an item that is not a slice, and allows an empty list", () => {
    expect(() => expandParts([bug([{ letter: "A", title: "x", done: false }])])).toThrow(DomainError);
    expect(expandParts([bug([])])).toHaveLength(1);
  });
});

describe("checkReport parent_key", () => {
  it("rejects an item that names itself as its parent", () => {
    expect(() => checkReport({ key: "p/x", parent_key: "p/x" })).toThrow(DomainError);
    expect(checkReport({ key: "p/x/part-A", parent_key: "p/x" }).parent_key).toBe("p/x");
  });
});
