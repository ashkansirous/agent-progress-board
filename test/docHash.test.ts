import { describe, expect, it } from "vitest";
import { docHash, type SnapshotItem } from "../src/domain/docSync";

const base = { key: "demo-app/slice-1", project: "demo-app", type: "slice", title: "One", status: "open" } as SnapshotItem;

/**
 * The same items and hashes are in plugin/scripts/sync-docs.test.mjs, which holds the plugin's copy of the function to
 * them: the two copies agree because both equal these values. Change them together.
 */
const VECTORS: { item: SnapshotItem; hash: string }[] = [
  { item: base, hash: "12e4cfaf3af5fa" },
  {
    item: { ...base, why: "Because", parent: "Plan · Search", parent_key: "demo-app/slice-0", links: [{ label: "PR", url: "https://example.com/pr/1" }] },
    hash: "193506bf9632d9",
  },
  {
    item: {
      ...base,
      parts: [{ letter: "B", title: "Two", done: true }, { letter: "A", title: "One", done: false }],
      checks: [{ key: "demo-app/slice-1/check-b", title: "B" }, { key: "demo-app/slice-1/check-a", title: "A" }],
    },
    hash: "0ac55f76ec7572",
  },
  { item: { ...base, type: "waiting_for_me", details_md: "1. Open the page\n2. Press **Save**" } as SnapshotItem, hash: "186ef18f34a6ef" },
  { item: { ...base, title: "Zażółć gęślą jaźń 😀" }, hash: "071f0592b4abc0" },
];

describe("docHash", () => {
  it("equals the shared vectors the plugin's copy is held to (plain, every optional field, parts and checks in any order, non-ASCII)", () => {
    for (const { item, hash } of VECTORS) expect(docHash(item)).toBe(hash);
  });

  it("ignores the order of parts and checks, a missing list against an empty one, priority and a non-owner step's details", () => {
    const parts = [{ letter: "A", title: "One", done: false }, { letter: "B", title: "Two", done: true }];
    expect(docHash({ ...base, parts })).toBe(docHash({ ...base, parts: [...parts].reverse() }));
    expect(docHash(base)).toBe(docHash({ ...base, parts: [], checks: [] }));
    expect(docHash(base)).toBe(docHash({ ...base, priority: "P0" as never }));
    expect(docHash(base)).toBe(docHash({ ...base, details_md: "a reporter's note" }));
  });

  it("changes with each field the documents own", () => {
    const seen = new Set([docHash(base)]);
    const changes = [
      { title: "Two" }, { status: "done" }, { why: "w" }, { parent: "p" }, { parent_key: "k" },
      { links: [{ label: "a", url: "https://x.example" }] }, { type: "bug" },
      { parts: [{ letter: "A", title: "t", done: false }] }, { checks: [{ key: "c", title: "t" }] },
    ];
    for (const change of changes) seen.add(docHash({ ...base, ...change } as SnapshotItem));
    expect(seen.size).toBe(10);
  });
});
