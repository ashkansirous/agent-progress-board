### Slice 7 — Stale detection

Source: phone scope (2026-11-15), milestone 7 — see [Slice 1](01-items-api.md).

*Built 2026-11-15, merged as PR #41 (9115ca0); the cron trigger and the live recovery are not yet verified on the deployed Worker.*

**Touches:** `src/**`, `wrangler.jsonc`, `test/**`, `web/**`, `config/board.example.json`,
`README.md`, `docs/clients.md`, `e2e/**`

#### Why

A crashed session must not leave a tile saying "in progress" forever.

#### Decisions

- Live-event items carry `heartbeat_at`; the reporter refreshes it on every call. An
  `in_progress` or `blocked` live item whose heartbeat is older than the expiry (from config)
  turns `stale`; a new report on the same key brings it back.
- A Workers cron trigger marks stale items (or the list query computes it; pick whichever is
  cheaper against the free-tier limits from Slice 1). (The mock supersedes the "or": its
  history shows a "Stale · Heartbeat expired" event, so the change to `stale` writes a real
  event, which only the cron trigger can do.)
- Doc-sync items never go stale; the next sync refreshes them.
- Stale tiles look distinct on the board (label plus colour).

#### Design (Agent Progress Board mock, Main.dc.html, added 2026-11-15)

One artboard shows it (the desktop board: the Slice 10 tile and its drawer); the mock agrees with the
plan (dashed, muted, label) and fixes the look. Full values are in
[Slice 2](02-tile-board.md) *Design*.

- **Tile.** bg `#F5F6F8`, 1 px dashed border `#9AA3B2`, title `#5B6370`, opacity 1, in the "In
  flight" section. Status label (12 px, 600, muted, hollow 7 px dot): "Stale · No heartbeat for
  3 h", the hours from `heartbeat_at` to now, rounded down. In dark: bg `#171A21`, border
  `#4A5262` (not drawn; the dashed border and muted title carry over).
- **Drawer.** Status row reads "Stale" in muted. History: newest event "Stale · Heartbeat
  expired" at the time the cron marked it, then the last heartbeat ("In progress · Last
  heartbeat"). Details text: "The session stopped reporting. A new report on this key brings
  it back." (that sentence is the item's own `details_md`, sample data, not UI copy).
- New strings: "Stale", "Stale · {note}", "No heartbeat for {n} h" (in the Slice 2 table).

**Plan changed to match the mock (2026-11-15):** the cron trigger is the only option and writes
an event note "Heartbeat expired" with status `stale` (Main.dc.html, slice-10 history); the
stale label carries the hours.

#### Design of the expiry rule (coordinator, wave 3, 2026-11-15)

Grounded on `origin/main` before the claim: `heartbeat_at`, the `stale` status (SQL CHECK, domain
enum, MCP schemas), the stale strings and the dashed tile styling already exist; missing are the
expiry in config, the rule, the trigger and its event. No migration.

- **Which items can go stale (decided here, no question to the owner).** An item whose shown
  status is a live one: `status` is `in_progress` or `blocked`, `live_status_at` is set, and
  `doc_status_at` is empty or older than `live_status_at` (the same test doc sync uses for "the
  live status wins"). So an item only the docs ever set never goes stale ("Doc-sync items never
  go stale"), and a plan slice that a session reported as in progress and then died on does,
  which is the case the *Why* names. One pure, unit-tested domain function decides it from a row,
  the expiry and now.
- **One owner of the change: the cron trigger.** A `scheduled` handler calls one application
  function, which calls one new repository method. That method runs one D1 batch: insert the
  event (status `stale`, note "Heartbeat expired", at now) for every row the rule matches, then
  set those rows to `stale` with `updated_at` now. Both statements carry the rule in their own
  `WHERE`, so a report that lands in between is never overwritten. `heartbeat_at` and
  `live_status_at` are left as they are (the tile label counts hours from `heartbeat_at`; doc
  sync keeps treating the status as live).
- **Interrupts.** The cron run fails or is skipped: nothing changed, the next run marks the same
  rows. The cron runs twice: the second finds no row (they are `stale` already), so no second
  event. A report arrives on a stale key: the normal upsert sets the reported status, refreshes
  `heartbeat_at` and writes its event (the recovery event); a test proves it. Docs change the
  status of a stale item: doc sync's existing rule applies.
- **A report with no status on a stale key** (a heartbeat-only call; added after both reviews
  raised it) brings the item back to the status it had when it went stale: the status of its
  newest event that is not `stale`, when that is `in_progress` or `blocked`; otherwise
  `in_progress` (a session that reports is working). Every status change writes an event, so
  that event is the status the cron replaced. Tests cover a blocked item with doc-sync events in
  its history, and an item a client set to `stale` itself with no live history.
- **Config.** `staleAfterMinutes` in the board config (default 120, whole minutes, at least 60 so the label never reads "0 h", at most 10080, one week);
  the cron runs every 15 minutes (`*/15 * * * *`), one trigger, well inside the free plan.
- **Clients.** `docs/clients.md` says a reporter must call at least once per expiry while it
  works, and that any report brings a stale item back.

#### Work

- [x] Expiry rule and its trigger, with tests; the trigger writes the event ("Heartbeat
      expired") and a new report on the key writes the recovery event.
- [x] Stale styling on the board, as drawn (dashed border, muted title, "Stale · No heartbeat
      for N h"), light and dark.

#### Verification

- Tests green; a killed session's item turns stale within the expiry time and recovers on the
  next report.

*Changed while building:* a report with no status revives a stale item (the design bullet above).
The dark stale tile now follows the mock: new palette key `staleBg` and dark `staleBorder`
`#4A5262` (`config/board.example.json`, `web/src/styles.css`). Expiry is bounded 60..10080
minutes, default 120; the cron runs every 15 minutes (`*/15 * * * *`), and a local build put the
`triggers` entry into `web/dist/agent_progress_board/wrangler.json`. `e2e/board.spec.ts` gained a
stale-colour check.

*From review* (`reviews/pr-41-high.md`, `reviews/pr-41-medium.md`, `reviews/pr-41-check-medium.md`):
applied high 1, 2, 3 and medium 1, 3.
- Skipped #4 (`reviews/pr-41-high.md`): "isExpired is production-dead; the real rule is the separate SQL string EXPIRED_ROWS" - the two copies are guarded by the SQL-vs-isExpired agreement test in `test/stale.test.ts`.
- Skipped #5 (`reviews/pr-41-high.md`): "NEXT_STATUS embeds the LAST_LIVE_STATUS correlated subquery" - maintainability only; the duplication is small and lazy.
- Skipped #6 (`reviews/pr-41-high.md`): "restores the status from the newest in_progress/blocked event of any source" - superseded by the design bullet on a report with no status.
- Skipped #7 (`reviews/pr-41-high.md`): "derives the cutoff and the stale event time from one new Date() read" - no failure path; the WHERE clause already skips a later report (speculative clock edge).
- Skipped #2 (`reviews/pr-41-medium.md`): "makes the sync skip that row silently" - the sync guard skips a row on any write between its read and write (comment above SYNC_UPSERT in `src/infrastructure/d1Repository.ts`); the next sync applies the docs.
- Skipped #4 (`reviews/pr-41-medium.md`): "logs console.error every 15 minutes" - no failure path, only log volume.
- Skipped #5 (`reviews/pr-41-medium.md`): "expanded 3+ times in the upsert" - guarded by the SQL-vs-isExpired agreement test; small cost.
- Skipped #1 (`reviews/pr-41-check-medium.md`): "live_status_at is not advanced" - the scenario needs a stale item whose doc_status_at is newer than live_status_at, but a sync that moves doc_status_at past live_status_at also sets the status to the docs' status (`planItem` in `src/domain/docSync.ts`), so the item is no longer stale. Follow-up kept below.
- Skipped #2 (`reviews/pr-41-check-medium.md`): "falls back to in_progress when newest non-stale event" - superseded by the design bullet on a report with no status (a session that reports is working).
- Skipped #3 (`reviews/pr-41-check-medium.md`): "Expiry rule duplicated in TS" - guarded by the SQL-vs-isExpired agreement test.
- Skipped #4 (`reviews/pr-41-check-medium.md`): "EXPIRED_ROWS has no index, full scan twice" - no failure path; the table is small.
- Skipped #5 (`reviews/pr-41-check-medium.md`): "logging errors for unrelated bad fields on every cron run" - no failure path, only log volume.
- Skipped #6 (`reviews/pr-41-check-medium.md`): "cron path untestable with fixed time" - test convenience only.

*Follow-ups (low, from the check pass):* check 1 (move `live_status_at` on revival, if it is ever
seen; `src/infrastructure/d1Repository.ts:77`), check 4 (index for `EXPIRED_ROWS`,
`src/infrastructure/d1Repository.ts:90`), check 5 (cron parses only `staleAfterMinutes`,
`src/index.ts:12`).

*Follow-up (intermittent browser test, not from this slice's diff):* in the wave's full check run
`e2e/board.spec.ts:317` ("after a failure, Retry never leaves a blank page") failed once in the
`phone` project (loading card not visible within 1000 ms), then passed 10 of 10 repeats and a
full run (56 of 56). Cause unknown; the flow is Slice 2's and this slice changes only colours in
`web/`.

#### For CLAUDE.md (lifted 2026-11-15)

- The stale rule exists twice: `isExpired` in `src/domain/stale.ts` and the `EXPIRED_ROWS` SQL in
  `src/infrastructure/d1Repository.ts`. `test/stale.test.ts` holds them equal; change both
  (Slice 7: docs/plan/slices/07-stale-detection.md).

#### For README.md

None beyond what the diff already wrote.

#### Not yet verified

- The cron trigger registers on deploy and fires (waits for the owner connecting Workers Builds).
- A killed session's item turns stale within the expiry and recovers on the next report, on the live board.
- The account's free-plan limit of 5 cron triggers is not exceeded.
