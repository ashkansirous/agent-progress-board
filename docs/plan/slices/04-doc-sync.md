### Slice 4 — Doc sync: `sync_snapshot` tool

Source: phone scope (2026-11-15), milestone 4 and *The hard part* — see [Slice 1](01-items-api.md).

*In progress (wave 2026-11-15), draft PR.*

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

- [ ] `sync_snapshot` with tests for close-missing, the live-vs-doc merge and idempotency.
- [ ] `docs/clients.md`: the snapshot tool and the merge rule.

#### Verification

- Tests green.
- With a client: a repo with no live events shows its open slices and unverified checks after
  one sync; a second sync changes nothing; a slice removed from the repo's table turns done.
