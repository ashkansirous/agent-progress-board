/// <reference lib="dom" />
// projectFold.ts reads the browser's localStorage, so the root program needs the DOM types to import it.
import { describe, expect, it } from "vitest";
import type { ProjectGroups } from "../src/domain/boardGroups";
import { readOpenMap, resolveOpen } from "../web/src/foldRules";
import { pruneIdsOf, prunedMap } from "../web/src/projectFold";

function group(needsYou: string[], working = 0): ProjectGroups {
  return { id: "p", needs_you: needsYou, summary: { needs_you: needsYou.length, working, planned: 0, built: 0, problems: 0, checks_not_tried: 0 } } as ProjectGroups;
}

describe("prunedMap (Slice 36)", () => {
  const choice = { open: true, questions: [] };

  it("drops the choices of projects that left the board and keeps the rest", () => {
    expect(prunedMap({ a: choice, gone: choice }, ["a", "b"])).toEqual({ a: choice });
  });

  it("returns the same map when nothing left, so nothing is written back", () => {
    const map = { a: choice };
    expect(prunedMap(map, ["a", "b"])).toBe(map);
  });
});

describe("pruneIdsOf (Slice 36)", () => {
  it("prunes by the ids of a loaded board that has projects", () => {
    expect(pruneIdsOf("a\nb")).toEqual(["a", "b"]);
  });

  it("prunes nothing for a failed load (no data) or an empty board", () => {
    expect(pruneIdsOf(undefined)).toBeNull();
    expect(pruneIdsOf("")).toBeNull();
  });
});

describe("readOpenMap", () => {
  it("reads nothing stored as no choices and a throwing or garbled store as failed", () => {
    expect(readOpenMap(() => null)).toEqual({});
    expect(readOpenMap(() => '{"p":{"open":false,"questions":["a"]},"q":3,"r":{"open":true}}')).toEqual({
      p: { open: false, questions: ["a"] },
    });
    expect(readOpenMap(() => "not json")).toBeNull();
    expect(readOpenMap(() => { throw new Error("denied"); })).toBeNull();
  });
});

describe("resolveOpen", () => {
  it("folds a quiet project by default and opens every project when storage failed", () => {
    expect(resolveOpen({}, group([]))).toBe(false);
    expect(resolveOpen({}, group([], 1))).toBe(true);
    expect(resolveOpen(null, group([]))).toBe(true);
  });

  it("opens a project with a question when nothing is stored", () => {
    expect(resolveOpen({}, group(["p/q"]))).toBe(true);
  });

  it("keeps the stored choice when the earlier question set returns", () => {
    const folded = { p: { open: false, questions: ["p/q1"] } };
    expect(resolveOpen(folded, group(["p/q1"]))).toBe(false);
  });

  it("opens again when a question key appears that the click did not see", () => {
    const folded = { p: { open: false, questions: ["p/q1"] } };
    expect(resolveOpen(folded, group(["p/q1", "p/q2"]))).toBe(true);
    expect(resolveOpen(folded, group(["p/q2"]))).toBe(true);
  });

  it("keeps the stored choice when the questions are all answered", () => {
    const folded = { p: { open: false, questions: ["p/q1"] } };
    expect(resolveOpen(folded, group([], 2))).toBe(false);
    expect(resolveOpen({ p: { open: true, questions: [] } }, group([]))).toBe(true);
  });

  it("ignores inherited properties of the stored map", () => {
    const g = { ...group([]), id: "constructor" } as ProjectGroups;
    expect(resolveOpen({}, g)).toBe(false);
  });
});
