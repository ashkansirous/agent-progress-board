import { describe, expect, it } from "vitest";
import type { BoardPartDto } from "../src/api/boardDto";
import { PartState } from "../src/domain/parts";
import { groupBoard } from "../src/domain/boardGroups";
import { parentText, partNowText, partsLabel } from "../web/src/partsText";
import { activeItemHash, activeKeyOf, Route, routeOf } from "../web/src/route";
import { translator } from "../web/src/strings";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import type { BoardItemDto } from "../src/api/boardDto";

const t = translator();

function part(letter: string, state: PartState, over: Partial<BoardPartDto> = {}): BoardPartDto {
  return { key: `p/slice-1/part-${letter}`, letter, title: `Title ${letter}`, state, step: null, steps_done: null, steps_total: null, ...over };
}

const reviewing = { step: "Reviewing", steps_done: 1, steps_total: 5 };

describe("partNowText", () => {
  it("appends (blocked) for a blocked part", () => {
    expect(partNowText([part("A", PartState.Done), part("B", PartState.Blocked, { step: "Waiting" })], t)).toBe("Part B · Waiting (blocked)");
  });

  it("names the active part and its step", () => {
    expect(partNowText([part("A", PartState.Done), part("B", PartState.Active, reviewing)], t)).toBe("Part B · Reviewing");
  });

  it("says Starting while the active part has no step yet", () => {
    expect(partNowText([part("B", PartState.Active)], t)).toBe("Part B · Starting");
  });

  it("appends (stale) for a stale part", () => {
    expect(partNowText([part("A", PartState.Done), part("B", PartState.Stale, { step: "Implementing" })], t)).toBe(
      "Part B · Implementing (stale)",
    );
  });

  it("reads Next: part C, then All parts done", () => {
    expect(partNowText([part("A", PartState.Done), part("C", PartState.Pending)], t)).toBe("Next: part C");
    expect(partNowText([part("A", PartState.Done)], t)).toBe("All parts done");
  });
});

describe("partsLabel", () => {
  it("reads the counts", () => {
    expect(partsLabel({ done: 1, total: 5, percent: 20 }, t)).toBe("1 of 5 parts · 20%");
  });
});

describe("the active address", () => {
  it("round-trips a key and opens the Active work view", () => {
    const hash = activeItemHash("demo-app/slice-7/part-B");
    expect(hash).toBe("#/active/demo-app%2Fslice-7%2Fpart-B");
    expect(activeKeyOf(hash)).toBe("demo-app/slice-7/part-B");
    expect(routeOf(hash)).toBe(Route.Active);
  });

  it("reads no key from the plain addresses or a broken one", () => {
    expect(activeKeyOf("#/active")).toBeNull();
    expect(activeKeyOf("#/")).toBeNull();
    expect(activeKeyOf("#/active/")).toBeNull();
    expect(activeKeyOf("#/active/%E0%A4%A")).toBeNull();
  });
});

describe("parentText", () => {
  const base: Pick<BoardItemDto, "parent" | "parent_slice"> = { parent: "Release 1.4", parent_slice: null };
  const view = (over: Partial<BoardItemDto>) => ({ ...base, ...over }) as BoardItemDto;
  const slice = (number: number | null, title: string) => ({ key: "p/slice-4", number, title });

  it("builds 'Slice N · title' from the data in both locales", () => {
    const item = view({ parent_slice: slice(4, "Tag search") });
    expect(parentText(item, translator())).toBe("Slice 4 · Tag search");
  });

  it("does not repeat the number when the title starts with it, and shows the bare title with no number", () => {
    expect(parentText(view({ parent_slice: slice(4, "Slice 4 · Tag search") }), translator())).toBe("Slice 4 · Tag search");
    expect(parentText(view({ parent_slice: slice(null, "Tag search") }), translator())).toBe("Tag search");
  });

  it("falls back to the stored text when there is no parent slice", () => {
    expect(parentText(view({}), translator())).toBe("Release 1.4");
  });
});

describe("parts on the board page", () => {
  function item(over: Partial<BoardItemDto>): BoardItemDto {
    return {
      key: "p/x", project: "p", parent: null, parent_slice: null, parent_key: null, slice: null, checks: null, type: ItemType.Slice, priority: Priority.P2, status: ItemStatus.Open,
      title: "T", why: null, details_md: null, links: [], heartbeat_at: "2026-11-15T10:00:00.000Z",
      created_at: "2026-11-15T09:00:00.000Z", done_at: null, environment: null, environment_label: null,
      agent: null, model: null, needs_you: null, after_answer: null, needs_you_at: null, steps: null, progress: null, working: false, parts: null, parts_progress: null,
      active_part_key: null, events: [], ...over,
    };
  }

  it("gives a part no tile of its own", () => {
    const items = [item({ key: "p/slice-1" }), item({ key: "p/slice-1/part-A", type: ItemType.Part, parent_key: "p/slice-1" })];
    const group = groupBoard(items, [], ["p"])[0]!;
    expect(group.planned.map((slice) => slice.key)).toEqual(["p/slice-1"]);
    expect([...group.working_now, ...group.other, ...group.needs_you]).toEqual([]);
  });
});
