### Slice 34 — Storage: queries, events and indexes

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 4, after Slices 33 and 35: Slice 4 #1 edits
`src/application/board.ts`, and the Slice 16 items edit `src/application/usage.ts`.

This is a horizontal cut (one layer, many readers), named as the exception to vertical slices. Almost every item edits
`src/infrastructure/d1Repository.ts`, and splitting them across slices would make every wave conflict on that file.

**Touches:** `src/infrastructure/d1Repository.ts`, `src/application/ports.ts`, `src/application/board.ts`,
`src/application/usage.ts`, `src/domain/stale.ts`, `migrations/0008_heartbeat_index.sql` (new),
`test/board.test.ts`, `test/syncSnapshot.test.ts`, `test/stale.test.ts`, `test/usageTools.test.ts`,
`test/capCost.test.ts`, `test/mcp.test.ts`, `docs/plan/slices/34-storage-queries.md`

**Migrations:** 0008

#### Why

These are the open SQL and storage follow-ups of Slices 1, 4, 7, 8, 11, 13, 14 and 16. Each one is low on its own.
The ones that give a wrong result:
- a delayed request moves `heartbeat_at` backwards;
- the sync summary counts writes that the stale-read guard skipped;
- a very large close fails the whole batch;
- the SQL and JS environment identities differ;
- `LIMIT 500` per card crowds out older windows.

#### Decisions

- The stale rule exists twice (`isExpired` and `EXPIRED_ROWS`), held equal by `test/stale.test.ts`. Change both
  together (root `CLAUDE.md`). Stored times stay UTC ISO, and the plan assertions in `test/usageTools.test.ts` stay.
- Whether a `waiting_for_me` tile ages out is the owner's choice (Slice 7, feedback loop 2026-11-16). It is **not**
  in this slice until the owner answers. It is listed in plan.md's *Outstanding work*.

#### Work

Events and items (Slice 1):
- [ ] A delayed request moves `heartbeat_at` and `updated_at` backwards (`d1Repository.ts:144,146`). Keep the later
  time.
- [ ] The heartbeat note is inferred from `updated_at = ?1` (`:197-199`, `INSERT_EVENT`). The event takes its status
  and source from the stored item. Heartbeat events are neither coalesced nor capped. Write each event from the
  request, and coalesce heartbeats.
- [ ] Slice 7 check 1: `live_status_at` on revival (`:~146`).

Sync writes (Slice 4):
- [ ] #1: the summary counts include writes the stale-read guard skipped. `applySync` (`:393`) returns void; make it
  return what it wrote (`src/application/ports.ts`) and count from that in `src/application/board.ts:~140-160`.
- [ ] #2: the close rows are sent as one uncapped JSON parameter (`:402-406`). Send them in chunks.
- [ ] med #7: the close rule is written twice, in SQL (`:179`) and in the domain. Med #8: the delete loop in `toItem`
  (`:504`).

Board listing (Slices 11, 14):
- [ ] Slice 11 high #7 + med #7: `BOARD_WHERE` (`:53-56`) pulls every part into `list_open`, a type or project
  filter hides parts, and its correlated subquery has no query-plan test.
- [ ] Slice 11 high #9: usage and task titles use the bare `items.title` (`taskInfo`, `:346-350`).
- [ ] Slice 14 check #7 + c3 #1: a done bug outside the window loses its slice chip, and done checks of listed slices
  are loaded and then dropped (`:56-59`).

Indexes (Slices 7, 13):
- [ ] Slice 7 check 4 / Slice 13 #6: `EXPIRED_ROWS` has no index on `heartbeat_at`, and its `CASE` blocks one. Add
  `migrations/0008_heartbeat_index.sql` and a query-plan test in `test/stale.test.ts`.

Usage queries (Slices 8, 16):
- [ ] Slice 8 #2, #3: the final `ORDER BY` over `UNION ALL` makes a temp sort and then a JS re-sort (`:246`), and
  `SERIES_WINDOW` orders by `record_at, id` while the JS sorts by `record_at` only (`:252`). Sort in one place.
- [ ] Slice 16: SQL `lower(trim())` (`:~207-212`) and `environmentIdentity` (`src/application/usage.ts:409-412`)
  disagree. Use one identity.
- [ ] Slice 16: the window `LIMIT` counts cards (`:217`), so 500 per card crowds out older windows. Limit per window
  range.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, with query-plan assertions for `EXPIRED_ROWS` and `BOARD_WHERE`.
  New tests: a delayed heartbeat doesn't move back; the sync summary leaves out guarded writes; 5,000 closes succeed;
  environment identities agree.
- After the release: `wrangler d1 migrations list --remote` shows 0008 applied (read only).
