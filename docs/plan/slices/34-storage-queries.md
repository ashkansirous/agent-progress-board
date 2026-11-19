### Slice 34 — Storage: queries, events and indexes

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 4, after Slices 33 and 35: Slice 4 #1 edits
`src/application/board.ts`, and the Slice 16 items edit `src/application/usage.ts`.

This is a horizontal cut (one layer, many readers), named as the exception to vertical slices. Almost every item edits
`src/infrastructure/d1Repository.ts`, and splitting them across slices would make every wave conflict on that file.

*Built 2026-11-18 (wave night 2026-11-18-1602), merged as PR #150 (891c371). Lint, typecheck, 707 vitest and 367 plugin tests green; no device surface. Migration 0008 not yet applied remotely.*

*Changed while building:*
- Migration 0008 holds two indexes: `(status, heartbeat_at)` for `EXPIRED_ROWS` and a partial index for the waiting-card query.
- Status applies only when the report time is at or after `live_status_at` (`NEXT_STATUS`); `heartbeat_at` and `updated_at` keep the later time.
- The event row is decided from the request, and Heartbeat rows are coalesced only after this save's own heartbeat insert. `INSERT_EVENT` and `SYNC_EVENT` are bound by `changes() > 0`.
- The sync summary has a `raced` count (writes the stale-read guard skipped).
- Close rows go in chunks of 200 rows or 64,000 UTF-8 bytes.
- Session windows are capped at 500 per environment. The environment identity is ASCII-only, shared by SQL and JS.
- `list_open` no longer returns parts and checks.
- Waiting cards with no slice or part parent and not doc-synced close after 24 h (`isWaitingClosable` and the cron query, held equal in `test/stale.test.ts`); the cron log line counts closed waiting cards.

**Touches:** `src/infrastructure/d1Repository.ts`, `src/application/ports.ts`, `src/application/board.ts`, `src/domain/capCost.ts`,
`src/application/usage.ts`, `src/domain/stale.ts`, `src/index.ts` (the cron's log line only), `src/api/board.ts` (`parentSliceOf` only), `migrations/0008_heartbeat_index.sql` (new),
`test/board.test.ts`, `test/syncSnapshot.test.ts`, `test/stale.test.ts`, `test/usageTools.test.ts`,
`test/capCost.test.ts`, `test/mcp.test.ts`, `docs/clients.md` (the sync summary's `raced` count only), `docs/plan/slices/34-storage-queries.md`

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
- **Waiting cards** (owner, 2026-11-18, answering the question open since the Slice 7 feedback loop of 2026-11-16):
  "if they are as a part of a slice, they should stay because the slice/plan will be picked up later and that should
  clode it. if it is random thing, like I open a chat to refine something and then close it without comiting to any
  plan or future work, it should be removed automatically in 24h". A `waiting_for_me` card whose `parent_key` names a
  slice or a part, or that doc sync made, never expires: the slice's own work closes it. Any other waiting card is
  closed (status `done`, note "no answer needed after 24 h") once its `heartbeat_at` is 24 hours old. It is closed,
  not marked stale, so it leaves "Needs you" for good. A report on it before then restarts the 24 hours. Decided by
  the planning session: "removed" means closed, so its history stays readable.

#### Work

Events and items (Slice 1):
- [x] A delayed request moves `heartbeat_at` and `updated_at` backwards (`d1Repository.ts:144,146`). Keep the later
  time.
- [x] The heartbeat note is inferred from `updated_at = ?1` (`:197-199`, `INSERT_EVENT`). The event takes its status
  and source from the stored item. Heartbeat events are neither coalesced nor capped. Write each event from the
  request, and coalesce heartbeats.
- [x] Slice 7 check 1: `live_status_at` on revival (`:~146`).

Sync writes (Slice 4):
- [x] #1: the summary counts include writes the stale-read guard skipped. `applySync` (`:393`) returns void; make it
  return what it wrote (`src/application/ports.ts`) and count from that in `src/application/board.ts:~140-160`.
- [x] #2: the close rows are sent as one uncapped JSON parameter (`:402-406`). Send them in chunks.
- [x] med #7: the close rule is written twice, in SQL (`:179`) and in the domain. Med #8: the delete loop in `toItem`
  (`:504`).

Board listing (Slices 11, 14):
- [x] Slice 11 high #7 + med #7: `BOARD_WHERE` (`:53-56`) pulls every part into `list_open`, a type or project
  filter hides parts, and its correlated subquery has no query-plan test.
- [x] Slice 11 high #9: usage and task titles use the bare `items.title` (`taskInfo`, `:346-350`).
- [x] Slice 14 check #7 + c3 #1: a done bug outside the window loses its slice chip, and done checks of listed slices
  are loaded and then dropped (`:56-59`).

Waiting cards (Slice 7 follow-up, owner's answer above):
- [x] Close a `waiting_for_me` card that has no slice behind it once `heartbeat_at` is 24 hours old. Keep one with a
  slice or part `parent_key`, or a doc-synced one. Add the rule and its 24-hour constant to `src/domain/stale.ts`
  (next to `EXPIRING_STATUSES`, `:35`) and to the cron's close query in `d1Repository.ts`, and hold them equal in
  `test/stale.test.ts`, as the two copies of the stale rule are (root `CLAUDE.md`). Test: a slice's waiting card
  older than 24 hours stays; a chat's waiting card closes at 24 hours and stays open at 23.

Indexes (Slices 7, 13):
- [x] Slice 7 check 4 / Slice 13 #6: `EXPIRED_ROWS` has no index on `heartbeat_at`, and its `CASE` blocks one. Add
  `migrations/0008_heartbeat_index.sql` and a query-plan test in `test/stale.test.ts`.

Usage queries (Slices 8, 16):
- [x] Slice 8 #2, #3: the final `ORDER BY` over `UNION ALL` makes a temp sort and then a JS re-sort (`:246`), and
  `SERIES_WINDOW` orders by `record_at, id` while the JS sorts by `record_at` only (`:252`). Sort in one place.
- [x] Slice 16: SQL `lower(trim())` (`:~207-212`) and `environmentIdentity` (`src/application/usage.ts:409-412`)
  disagree. Use one identity.
- [x] Slice 16: the window `LIMIT` counts cards (`:217`), so 500 per card crowds out older windows. Limit per window
  range.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, with query-plan assertions for `EXPIRED_ROWS` and `BOARD_WHERE`.
  New tests: a delayed heartbeat doesn't move back; the sync summary leaves out guarded writes; 5,000 closes succeed;
  environment identities agree.
- After the release: `wrangler d1 migrations list --remote` shows 0008 applied (read only).

#### From review

review read: `reviews/pr-150-high.md` 7/7, `reviews/pr-150-medium.md` 9/9, `reviews/pr-150-check-medium.md` 9/9, `reviews/pr-150-check-2-medium.md` 5/5.

- Applied from `reviews/pr-150-high.md`: #1, #2, #3, #4, #6, #7.
- Applied from `reviews/pr-150-medium.md`: #1-#6, #8, #9.
- Skipped #5 (`reviews/pr-150-high.md`): "`WAITING_ROWS` has no index to seek on and runs twice per cron" - the scan runs only in the cron; later fixed by #4 of `reviews/pr-150-medium.md` (partial index).
- Follow-ups, all low, left as they are because the second check pass converged (`reviews/pr-150-check-2-medium.md`): #1 "bySeriesThenTime compares strings by UTF-16 code unit", #2 "the number of environments is unbounded", #3 "One report stamped ahead of real time makes later status reports ... be dropped", #4 "doc comment for closeChunks sits above const ENCODER", #5 "isWaitingClosable duplicates the SQL rule; nothing in production calls it".
- Done in the second review round (`reviews/pr-150-medium.md`), superseding two earlier lines: the partial index for the waiting-card query is in migration 0008 with a query-plan test (left open at first, #5 of `reviews/pr-150-high.md`), and the event note is decided from the request, so a delayed title, steps or question change gets its own row (was left from #6 of `reviews/pr-150-high.md`). The status of a report is compared with `live_status_at`, not `heartbeat_at`; `sync_snapshot` reports lost-race writes as `raced` (`docs/clients.md` updated).
- Skipped #7 (`reviews/pr-150-medium.md`): "`environmentIdentity` trims only ASCII whitespace and lowercases ASCII only. Names differing in non-ASCII case or NBSP used to merge and now split" - SQLite's `lower()` and `trim()` are ASCII-only, so the one identity that SQL and JS share has to be ASCII.
- Done from `reviews/pr-150-check-medium.md`: #5 (a status-less report moves `live_status_at` only when it revives, `?12 >= heartbeat_at`, same condition as `NEXT_STATUS`) and #7 (`SYNC_EVENT` bound by `changes() > 0`, adjacent to its upsert).
- Skipped #1 (`reviews/pr-150-check-medium.md`): "The Heartbeat note is decided from a SELECT outside the batch" - the read only picks the history note label; status and times are decided in the batch.
- Skipped #2 (`reviews/pr-150-check-medium.md`): "Every save() now does an extra SELECT *" - one primary-key read per report on a small table.
- Follow-up #3 (`reviews/pr-150-check-medium.md`): fold the change rule into one function (today `changesOnlyHeartbeat` and `ANY_CHANGED` hold it twice).
- Skipped #4 (`reviews/pr-150-check-medium.md`): "It acts on the two newest events by at" - the heartbeat coalesce runs only after this save's own Heartbeat insert under `changes() > 0`.
- Skipped #6 (`reviews/pr-150-check-medium.md`): "Sets status=done and done_at but does not clear needs_you / after_answer, and overrides blocked after 24 h" - the cron close behaviour predates this slice.
- Skipped #8 (`reviews/pr-150-check-medium.md`): "A close guarded out because the row moved is not counted in raced" - a guarded close means a newer report already moved the item; nothing to resend.
- Follow-up #9 (`reviews/pr-150-check-medium.md`): note a dropped older status in the event.

#### For CLAUDE.md (lifted 2026-11-19)

- A status report applies only when its time is at or after `live_status_at` (`NEXT_STATUS` in `src/infrastructure/d1Repository.ts`); `heartbeat_at` and `updated_at` keep the later time. A status-less report moves `live_status_at` only when it revives, with the same condition. Never compare a status with `heartbeat_at` (Slice 34: docs/plan/slices/34-storage-queries.md).
- The waiting-card close rule (no slice or part parent, not doc-synced, 24 h) exists twice: `isWaitingClosable` in `src/domain/stale.ts` and the cron query `WAITING_ROWS` in `src/infrastructure/d1Repository.ts`. `test/stale.test.ts` holds them equal; change both (Slice 34: docs/plan/slices/34-storage-queries.md).
- `SYNC_EVENT` is bound by `changes() > 0` and kept adjacent to its upsert, like `INSERT_EVENT`; never insert an event outside that binding (Slice 34: docs/plan/slices/34-storage-queries.md).

#### Not yet verified

- After the release, `wrangler d1 migrations list --remote` shows 0008 applied (read only).
