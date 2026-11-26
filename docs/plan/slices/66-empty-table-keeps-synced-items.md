### Slice 66 — An empty status table must not close doc-synced items

*Planned 2026-11-26 by plan cleanup (moved from Slice 64 item 3).*

**Product:** agent-progress-board.

**Touches:** `plugin/scripts/sync-docs.mjs` (`scanPlan`, `hasEmptyStatusTable`, the snapshot builder near the
"status table empty" notice), `plugin/scripts/sync-docs.test.mjs`

## Why

When plan.md's status table has no open rows (the last row moved to `docs/plan/notes/slices-done.md`), `sync-docs.mjs`
sends an empty snapshot and the board closes the project's doc-synced items (night 2026-11-25-1729: closed 73, created
72, then closed 84 / created 71 earlier). Moved here from Slice 64 item 3 by plan cleanup 2026-11-26; the code still
does this on `origin/main`.

## Work

- [ ] **1.** An empty table with slice files present must not close the doc-synced items. Read what was closed with
  `list_synced` first, so the real rule (when an empty snapshot is right) is known.
- [ ] **2.** Test: an empty table closes nothing.

## Verify

- A sync-docs test with a header-only table sends no closing snapshot.
