### Slice 4 — Doc sync: `sync_snapshot` tool

Source: phone scope (2026-11-15), milestone 4 and *The hard part* — see [Slice 1](01-items-api.md).

*Built 2026-11-15 (wave 2026-11-15), merged as PR #34 (815023b). Not yet verified against a deployed board (see the end of this file).*

**Touches:** `src/domain/**`, `src/application/**`, `src/infrastructure/**`, `src/mcp/**`,
`migrations/**`, `test/**`, `README.md`, `docs/clients.md`

**Migrations:** 0002

Touches narrowed at the claim (2026-11-15): Slice 2 builds beside this slice and owns
`src/api/**`, `src/config.ts` and `src/index.ts`; the tool needs none of them.

#### Design (written at the claim, 2026-11-15)

The premise check found that `source` is one column holding the last writer, so it cannot say
whether an item belongs to the doc-sync set once a live report has touched it, and nothing
records when the live status or the doc status last changed. The design below keeps both.

- **Four new columns on the item (migration 0002):** `in_doc_sync` (0/1: the item was in the
  project's last snapshot), `doc_status` (the status the docs last gave), `doc_status_at` (the
  time a sync first saw that doc status), `live_status_at` (the time a report from any source
  other than `doc-sync` last set the status; `report_progress`, `mark_done` and `ask_human` set
  it). Existing rows: `in_doc_sync` 0, `live_status_at` = `updated_at`.
- **One pure function in `src/domain`** (unit-tested, no I/O) takes the stored item (or none),
  the snapshot item and the clock, and returns the row to store plus the event to write, or
  "no change". Its rules:
  - Title, why, parent and links: the snapshot's values always win.
  - `doc_status_at` moves to now only when the snapshot's status differs from the stored
    `doc_status`. The same status again leaves it alone.
  - First sight (changed 2026-11-15 after the high review, finding 3: the first wording let
    the first sync of a live item wipe a newer live status, against the Decision above): an
    item that has never been in a snapshot (`doc_status` empty) gets `doc_status` recorded;
    if it already has a `live_status_at`, `doc_status_at` stays empty and an empty
    `doc_status_at` counts as older than any live status, so the live status stays until the
    docs change. With no live status, `doc_status_at` is now and the doc status shows.
    One exception (medium review, finding 5: a reporter that said "in progress" once and
    died would otherwise show in progress for good while the docs say done): a first-sight
    doc status of `done` always wins (`doc_status_at` is now), because docs record a finish
    only after it happened, so a doc "done" is never older news than a live open status.
  - The shown status is the live one when `live_status_at` is newer than `doc_status_at`,
    otherwise the doc one. So a live "in progress" survives every sync until the docs
    themselves change, and a doc change made after the last live report wins.
  - An event (source `doc-sync`) is written only when the shown status changes.
  - Nothing changed at all: no write, no event, `updated_at` untouched (idempotent).
- **Close-missing:** every item of that project with `in_doc_sync` 1 whose key is not in the
  snapshot gets `in_doc_sync` 0 and, if it is not done already, status `done` with an event
  noted "Left the plan" (source `doc-sync`). Items with `in_doc_sync` 0 (live-only) are never
  touched by a snapshot. Leaving the plan is a doc change: the close also sets `doc_status`
  `done` and `doc_status_at` now, so a key that comes back in a later snapshot carries a new
  doc status and reopens. The close is set-based (a fixed number of statements however many
  items close), so an empty snapshot of a large project stays inside the statement limits.
- **A write never acts on a stale read** (added 2026-11-15, high review finding 1): each
  status write and its event apply only if the row's `updated_at` still equals the value the
  sync read; a row a live report changed in between keeps its status and the next sync
  settles it. The same guard covers the close.
- **Source:** a sync sets `source` to `doc-sync` only on a row it creates or whose shown
  status it changes; a title or link change leaves the live reporter's source alone.
- **Type and priority** are used only when the snapshot creates the key (the Decision names
  title, why, parent and links as the doc-owned fields); the tool's schema text says so.
- The four sync columns are internal: they are not part of the item the tools return.
- **One owner, one transaction:** the application-layer use case `syncSnapshot` reads the
  project's items once, runs the pure function per item, and hands the repository one batch
  that is applied atomically (a D1 batch): a failure leaves nothing half applied, and a retry
  of the same snapshot then does the whole thing. Every snapshot item's `project` must equal
  the call's `project`, keys must be unique in the call, and the item count is capped (an error
  names the limit) so one call stays inside the free-tier statement limits.
- An empty `items` list is valid and closes every doc-sync item of the project (the plan has
  no open rows). A write token is required.

#### Why

The board must be true even when no agent remembered to report. Repo plan docs are the state;
live events only add motion. The parser that reads a repo's plan docs is a client (built in
the repo that wants it); this slice is the MCP tool it calls.

#### Decisions

- MCP tool `sync_snapshot(project, items[])` takes the full set of doc-sync items for one
  project (source `doc-sync`). Doc-sync items of that project missing from the snapshot become
  `done` (the slice left the open table). Items from other sources are never closed by a
  snapshot.
- Merge on one key: when a doc-sync item and a live item share a key, doc sync wins on title,
  why, parent and links; the live status wins when its `updated_at` is newer.
- Each snapshot item carries `parent` as display text (for example "Plan · Search"), as the
  board mock shows it (the mock supersedes a parent key; see Slice 1).
- Idempotent: the same snapshot twice changes nothing (callers retry).
- Shares the upsert in the application layer with `report_progress` (`CLAUDE.md`, *One contract*).

#### Work

- [x] `sync_snapshot` with tests for close-missing, the live-vs-doc merge and idempotency.
- [x] `docs/clients.md`: the snapshot tool and the merge rule.

#### Verification

- Tests green. (Done 2026-11-15: lint, typecheck and `npm test` pass, 65 tests in 6 files.)
- With a client: a repo with no live events shows its open slices and unverified checks after
  one sync; a second sync changes nothing; a slice removed from the repo's table turns done.
  (Not yet done: waits for the first deploy and a client; see *Not yet verified*.)

*Changed while building (2026-11-15):*

- Built: the `sync_snapshot` MCP tool (write token), migration 0002 (the four internal sync
  columns), the pure merge rules in `src/domain/docSync.ts`, the `syncSnapshot` use case, and
  one atomic D1 batch with stale-read guards and a set-based close. `docs/clients.md` has a
  `sync_snapshot` section; the README tool table has a row.
- Cap of 200 items per call; a larger call is refused and the error names the limit.
- Each snapshot item's `project` must equal the call's `project`.
- A key that exists under another project is refused and nothing is written.
- `type` and `priority` are used only when the snapshot creates the key.
- The output is a summary `{project, created, updated, closed, unchanged}`.
- A `db.batch()` call counts as one query against the D1 per-invocation limit (D1 limits
  page, read 2026-11-15).

*From review* (`reviews/pr-34-high.md`, `reviews/pr-34-medium.md`, `reviews/pr-34-check-medium.md`, all read in full):

- High: applied 1, 3, 4, 5, 6, 7, 8. Finding 2 applied as schema text only: the Decision names
  the doc-owned fields (title, why, parent, links), so the tool text says `type` and
  `priority` are used only for a new key.
- Applied #9 (`reviews/pr-34-high.md`), after the fix round: the branch took `origin/main` and `docs/clients.md` got its `sync_snapshot` section in this PR; both Work items are ticked above.
- Skipped #10 (`reviews/pr-34-high.md`): "Formatting slips: missing space" - low severity, formatting only; lint passes.
- Medium: applied 2, 4, 5, 10.
- Skipped #1 (`reviews/pr-34-medium.md`): "about 402 statements at the 200-item cap in one db.batch" - a `db.batch()` call counts as one query per the D1 limits page (read 2026-11-15); a 200-item snapshot against deployed D1 is under *Not yet verified*.
- Skipped #3 (`reviews/pr-34-medium.md`): "SYNC_EVENT checks updated_at = now AND status AND source on the row" - the event insert also requires source `doc-sync` on the row, which the finding itself states, so a live write cannot leave a matching row.
- Skipped #6 (`reviews/pr-34-medium.md`): "docFieldsDiffer does not compare done_at" - low, no failure path shown; follow-up below.
- Skipped #7 (`reviews/pr-34-medium.md`): "duplicated as raw SQL in the repository and separately in the domain" - low, a refactor with no failure shown; follow-up below.
- Skipped #8 (`reviews/pr-34-medium.md`): "toItem strips the sync columns with a runtime delete loop" - low, a refactor with no failure shown; follow-up below.
- Skipped #9 (`reviews/pr-34-medium.md`): "re-declares its fields instead of deriving them from the report schema" - low, a refactor with no failure shown; follow-up below.
- Check pass (`reviews/pr-34-check-medium.md`): 4 findings, no code change; all four are follow-ups below.

#### Follow-ups (open, not built)

- Summary counts include writes the guard skipped: a live report between the read and the batch
  leaves `updated` or `closed` too high (check pass finding 1, `reviews/pr-34-check-medium.md`).
- The close list goes to `CLOSE_ROWS` as one uncapped JSON parameter; thousands of rows could
  exceed D1's per-statement size (check pass finding 2).
- A closed key that returns as `done` is not a docs change, so a live status set after the close
  keeps winning (check pass finding 3).
- The first sync replaces `why`, `parent` and `links` a live reporter set, when the snapshot
  omits them. The Decision says doc sync wins on those fields; note it in the tool text if
  wanted (check pass finding 4).
- Medium review findings 6, 7, 8 and 9 (`reviews/pr-34-medium.md`), as listed above.

#### For CLAUDE.md

Nothing to lift.

#### For README.md

Nothing to lift (the tool row is already in the PR).

#### Not yet verified

- Migration 0002 applied to the remote D1 by the pipeline. Seen 2026-11-15: `sync_snapshot` works against the remote D1. Not seen: the migration record itself.

*Verified 2026-11-15* (Worker at c1cc5de, by curl, no real client used): a repo with no live events shows its items after one sync (`{created:3}`), a second sync changes nothing (`{unchanged:3}`), and a key removed from the list turns done (`{closed:1,unchanged:2}`; `get_item` showed status done, source doc-sync); an empty-list sync closed the rest with 200. A 200-item snapshot against deployed D1 gave `{created:200}` with HTTP 200; 201 items were refused with "expected array to have <=200 items".
