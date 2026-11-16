### Slice 11 — Slice parts: progress bar on the slice, click through to the active part

Source: the owner at the desk, 2026-11-16 ("Each slice has multiple parts, say A to E. An agent
finished sub A. An agent picks slice X sub B. Then the status of slice X is in flight, and 20% of
it is done that should be shown in a progress bar under it ... From the main page, where we have
the slices, we should be able to click and follow to the sub task that is currently active").

*Planned.* Needs [Slice 10](10-task-steps.md). Part B (the page) waits for the owner's design
mock.

**Touches:** `migrations/0005_parts.sql`, `src/domain/parts.ts`, `src/domain/item.ts`,
`src/domain/docSync.ts`, `src/domain/upsert.ts`, `src/application/board.ts`,
`src/application/ports.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`,
`src/mcp/tools.ts`, `src/api/boardDto.ts`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`

#### Why

A slice is often several parts built one after another, sometimes by different agents. Today the
board knows a slice as one tile with one status. The owner wants to see how much of it is done
and to get from the slice to the part someone is working on.

#### Decisions (owner, 2026-11-16)

- **Parts are the lettered groups in the slice's work list** (A, B, C and so on). A part is done
  when all its checkboxes are ticked.
- **The slice's bar is parts done over parts in the slice.** One of five done is 20%. The part
  in progress adds nothing until it is done.
- **A slice with a part in progress shows as in flight.**
- **From the slice, one click leads to the part that is active now**, on the active work page
  from Slice 10, with its steps.

#### Decided at the desk (not the owner's choices)

- **A real link between items.** Today `parent` is only a text shown on the tile. Items get a
  `parent_key` that names another item's key. The text field stays as it is.
- A part is an item with the key `<project>/slice-<N>/part-<letter>` and the new type `part`
  (types come from config; `part` is added to the example config). Parts get no tile of their
  own on the board page: they show under their slice and, when someone works on one, on the
  active work page.
- **The plan documents say which parts exist and which are done; live reports say which is
  active.** `sync_snapshot` items may carry a `parts` list (letter, title, done). A live
  `report_progress` on a part's key carries the steps from Slice 10. The two merge on the key,
  the same way slices do today ([Slice 4](04-doc-sync.md)).
- A slice whose documents show no lettered groups has no bar; nothing is guessed.
- A part that left the documents is closed by the next snapshot, like a slice that left the
  table.
- Migration 0005, or the next free number from `parallel-check` when it is built.

#### Work

**A. Server (no design needed)**

- [ ] **A1.** Migration and domain: `parent_key`, the `part` type, slice progress as parts done
      over parts. Pure, with tests for 1 of 5, no parts, all done, a part removed.
- [ ] **A2.** `sync_snapshot` accepts `parts` per slice and upserts them as items with
      `parent_key`; the document owns a part's title and done state.
- [ ] **A3.** `report_progress` accepts `parent_key`; a part in progress makes its slice read as
      in flight on the board without changing the slice's stored status.
- [ ] **A4.** `/api/board` returns, for each slice, its parts (letter, title, done, active) and
      the worked-out progress, and the key of the active part when there is one.
- [ ] **A5.** `docs/clients.md`: parts in the snapshot, part keys, `parent_key`. README line.

**B. Page (after the mock)**

- [ ] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it.
- [ ] **B2.** The bar under a slice's tile, with the parts listed in the detail drawer.
- [ ] **B3.** The click from a slice (tile or drawer) to its active part on the active work
      page, and the way back.
- [ ] **B4.** Browser tests against a faked `/api/board`, phone and desktop sizes.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1.
- A snapshot with a five-part slice, part A done, then a live report on part B: the slice reads
  as in flight at 20% with B as its active part.
- On the deployed board, after a real document sync and a real agent run: a slice shows its bar,
  and the click lands on the part the agent holds.
- `npm run test:e2e` green for part B.
