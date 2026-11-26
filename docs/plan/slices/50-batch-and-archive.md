### Slice 50 — Item tools one by one and in batches, archive instead of delete

*Built (2026-11-25), merged as PR #199 (2b4c864).*

*Plan cleanup 2026-11-26 (verdict: close):* all seven work items are built (PR #199). `wrangler deployments list` shows a Worker version created 2026-11-26T02:44:51Z, after the batched release's deploy hook at 02:37:56Z, so the code is live. The eight review follow-ups under *From review* are not this slice's work: moved to a new slice (archive follow-ups, number given by the index pass). The live plugin-sync run stays a `[session]` line in `unverified.md` (installed plugin is still the 2026-11-18 copy); it never holds the slice open. Check-3 #4 (the `SYNCED_ROWS` comment says "live" but the query lists archived rows) still reads wrong at `src/infrastructure/d1Repository.ts:329`.

Planned 2026-11-19 from the owner's answers in a RefineScope pass (no review round).

**Touches:** src/mcp/tools.ts, src/mcp/schemas.ts, src/mcp/instructions.ts, src/application/board.ts,
src/application/archive.ts (new), src/domain/docSync.ts, src/domain/archive.ts (new), src/domain/scope.ts,
src/infrastructure/d1Repository.ts, src/index.ts, migrations/0010_archive.sql (new), plugin/scripts/sync-docs.mjs,
plugin/scripts/*.test.mjs, plugin/skills/agent-board/SKILL.md, docs/clients.md, test/*.test.ts,
test/pluginRules.test.ts, CLAUDE.md, README.md, docs/setup/plan-sync.md (widened while building: its "At most 200
items" line is wrong once the cap goes).

Night 2026-11-25 claim note: the live run of the plugin's sync in the owner's repo that hit the cap (Verification) is a
`[session]` line in `docs/plan/unverified.md`, run by the live-checks session after the release.

**Migrations:** 0010

#### Why

A repo whose plan documents hold more than 200 items cannot reach the board at all. The plugin's plan sync sends the
whole project in one `sync_snapshot` call. That call is capped at 200 items (`MAX_SNAPSHOT_ITEMS`,
`src/domain/docSync.ts:4`; Slice 4 set the cap on purpose and verified 200 accepted, 201 refused). Over the cap the
plugin sends nothing ("N items exceed the 200-item cap, nothing sent", `plugin/scripts/sync-docs.mjs:849`). The call
cannot be split either: the board marks done every synced item a snapshot leaves out (`closeTargets`,
`src/domain/docSync.ts:256-270`), so each part would close the others. There is no way to remove an item at all.

The owner's words (2026-11-19): "we should have post, and delete, so it can be done 1 by 1, as well as having batch
apis, that accept adding/updating/deleting in batches. mcp should support that as well". On delete: "delete should not
delete anything. it should basically archive it and the archive should be automatically deleted after 30 days. I still
need these data to dig in and do performance investigation as the work goes on".

#### Decisions (owner's answers, 2026-11-19)

1. **MCP tools only.** No REST write path (root `CLAUDE.md`, *One contract: MCP*). One item at a time and in batches
   are both MCP tools.
2. **Plan sync sends only the changes.** The plugin reads what the board holds for the project, compares it with the
   documents, and sends adds, updates and closes in batches of at most 200, as many batches as it needs. No batch
   relies on absence, so a partial run never closes anything wrongly.
3. **An item that leaves the documents is marked done**, as now. It is not archived: archived plans leave `plan.md`
   and their finished record stays on the board.
4. **Delete means archive.** An archived item, with its parts, checks, steps and events, is kept unchanged but hidden
   from the board page, `list_open` and every count. Thirty days after it was archived the daily cron removes it and
   everything under it for good. Until then the owner can still read it for investigation.

Decided by the starter session (2026-11-19), inside those answers:

5. `sync_snapshot` stays as it is for older plugin copies; the plugin stops calling it.
6. Tools: `upsert_item` (add or update one item), `archive_item` (archive one item), `apply_batch` (a list of
   operations, each `upsert`, `close` or `archive` with its item; at most 200 items per call counted after parts and
   checks are expanded; applied in one D1 batch, all or nothing, with one result line per operation), and
   `list_synced` (the project's doc-synced keys with a content hash and status, paged so no reply passes the 50,000
   character cut). Field rules and validation are the existing ones (`itemProblem`, `validateSnapshot`), never a copy.
7. Scope: writing doc-synced items (`in_doc_sync`) needs the same scope as `sync_snapshot` (the static repo token);
   archiving or upserting an item that is not doc-synced needs the owner's write scope, as `report_progress` does.
   The one mapping stays `allows` in `src/domain/scope.ts`.
8. Archiving an item archives its parts and checks with it. Upserting an archived key brings it back (clears
   `archived_at`); the 30 days start again on the next archive.
9. `get_item` takes `include_archived: true` to read an archived item; nothing else shows them.
10. The purge runs in the existing `scheduled` handler (`src/index.ts`), in chunks like `closeChunks`
    (`src/infrastructure/d1Repository.ts:626`) so one run never passes D1's statement limits.

#### Work

- [x] 1. **Archive in storage.** Migration `0010_archive.sql` adds `archived_at` (UTC ISO, null) to items with an index.
  `BOARD_WHERE`, `EXPIRED_ROWS`, `WAITING_ROWS`, `OPEN_CHECK_OF` and the usage and count queries leave archived rows
  out. Tests: an archived item and its children vanish from the board read and counts; `get_item` with
  `include_archived` returns it.
- [x] 2. **`upsert_item` and `archive_item`.** One application path each, shared with `apply_batch`; schemas in
  `src/mcp/schemas.ts`; scope per Decision 7. Tests for add, update, archive, revive and refusal by scope.
- [x] 3. **`apply_batch`.** Up to 200 expanded items per call, one D1 batch, all or nothing; a bad operation refuses the
  whole call and names it. Events are bound by `changes() > 0` like `INSERT_EVENT` and `SYNC_EVENT`. Tests: 200
  accepted, 201 refused, a mixed batch of upsert, close and archive, one bad item refusing the call.
- [x] 4. **`list_synced`.** Keys, status and a content hash per doc-synced item of one project, paged by key, cut only
  by `cutReply`. The hash is the same one the plugin computes, defined once in `src/domain/docSync.ts` and mirrored in
  the plugin with a test holding the two equal.
- [x] 5. **Plugin sync by changes.** `sync-docs.mjs` reads `list_synced`, works out adds, changed items and items gone
  from the documents, and sends them with `apply_batch` (gone items as `close`) in chunks of at most 200 expanded
  items. The 200-item refusal goes; the 1000-item guard is replaced by the chunking. A failed chunk stops the run and
  is retried on the next sync; nothing is marked done unless it is really gone from the documents. Tests: 450 items
  sync in three calls; an unchanged plan sends nothing; a removed slice is closed; a failed second chunk closes nothing.
- [x] 6. **Purge after 30 days.** The cron removes items archived more than 30 days ago, with their parts, checks,
  steps and events, in bounded chunks. The 30 days are one constant in `src/domain/archive.ts`. Test with a fixed clock.
- [x] 7. **Words.** `SERVER_INSTRUCTIONS` and the mirrored rules in `plugin/skills/agent-board/SKILL.md` (held equal by
  `test/pluginRules.test.ts`), `docs/clients.md` and README name the new tools, that delete is archive, and the 30 days.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, plugin tests (`node --test plugin/**/*.test.mjs`).
- After release: run the plugin's sync in the owner's repo that hit the cap. It sends in several batches,
  no "exceed the 200-item cap" line, and the board's project block shows its open slices. Then archive one test item
  with `archive_item` and check it is gone from the board but readable with `get_item` and `include_archived`.

#### Not in this slice

- A page to browse archived items; the owner reads them through `get_item` for now.
- Undo of the purge; after 30 days the data is gone.

#### From review

- Skipped #4 (`reviews/pr-199-high.md`): "One refused item now refuses the whole apply_batch chunk of up to 200 items, and the plugin stops at the first failed chunk, so closes never go out." - Work 3 decides it: "one D1 batch, all or nothing; a bad operation refuses the call".
- Archive and revive, one design after two failed passes (`reviews/pr-199-medium.md` #1-#6, `reviews/pr-199-high.md` #1, #2): archiving key K sets the same `archived_at` on K and every descendant (recursive on `parent_key`, any type, one `ARCHIVE_ROWS` statement). Any write that revives K (upsert, sync, `report_progress`, `mark_done`, `ask_human`) clears `archived_at` on K and every descendant whose time equals K's, in the same batch (`reviveSubtree` in `d1Repository.ts`, run before the write and guarded by the write's own compare-and-swap); a child archived on its own earlier keeps its time and stays archived. `reviveChildren` and the live-parent purge guard are gone: the purge deletes rows whose `archived_at` is past 30 days, nothing else (`PURGE_UNLINK` stays). `list_synced` returns archived doc-synced rows too, flagged `archived: true`, with their hash; the plugin sends nothing for one whose hash is unchanged and an upsert when it changed, and never closes one. `ARCHIVE_EVENTS` is bound by `changes() > 0` and adjacent to its update (one event per archived root). A part the documents dropped while its slice was archived comes back live with the slice and is closed by the next sync.
- Archive and revive, third design (coordinator, 2026-11-25, after `reviews/pr-199-check-medium.md` #1-#8; it replaces
  the second design above). Each rule lives in one place and holds inside the SQL statement, never on an earlier read:
  1. *What an archive takes:* K plus its plan-owned descendants (recursive on `parent_key`, only rows with
     `in_doc_sync = 1` or type part or check), all with the same `archived_at` (Decision 8). Live cards under K (bug,
     problem, waiting, agent rows that are not doc-synced) are never archived. A caller without the sync scope
     archives only when K and every row the statement takes have `in_doc_sync = 0`: the condition is in the archive
     statement itself, and `changes() = 0` refuses the call (#6, #7).
  2. *What revives:* only an explicit write of the item's content: `upsert_item`, an `apply_batch` upsert, and a sync
     write whose document fields really changed (`archived_at` is not a document field, so an unchanged doc item stays
     archived under `sync_snapshot` too) (#2). The revive clears `archived_at` on K and on descendants reached only
     through rows whose `archived_at` equals K's, in the same batch, with K's time read by a subquery inside the
     statement (#4). `report_progress`, `mark_done`, `ask_human` and heartbeats on an archived key are refused by the
     write's own SQL condition (`archived_at IS NULL`) with a reply saying it is archived and how to bring it back;
     reporters fail open, so a refusal never blocks a client (#3, pr-199-high #1).
  3. *Purge:* deletes archived rows past 30 days and their steps and events. `PURGE_UNLINK` clears `parent_key` only on
     rows that are not doc-synced (#5), and the cron logs both counts (#8).
  4. *A purged item the documents still list comes back new on the next sync* (#1): the documents are the source of
     record (Decision 3), so this is the intended behaviour, written here, not a fix.
  5. *Added after `reviews/pr-199-check-2-medium.md` #1-#4 (coordinator, 2026-11-25):* no live doc-synced row ever sits
     under an archived parent. Every write of a doc-synced row (insert or update, sync or upsert) whose parent is archived
     takes the parent's `archived_at` in the same SQL statement; the dead "archived-parent guard" goes. An explicit
     upsert of the parent revives the row with it (rule 2, same time). A row that is not doc-synced (a bug, problem,
     waiting or agent card) written under an archived parent stays live; the purge clears its `parent_key` (rule 3).
     Closes (`CLOSE_ROWS`, `CLOSE_ITEMS`) skip archived rows (`archived_at IS NULL`).
- Follow-ups (`reviews/pr-199-check-2-medium.md`, not built in this slice; MOVED 2026-11-26 to the new archive follow-ups slice):
  - #5: "SYNC_REVIVE adds a statement per write, so a 200-item batch uses about 600+ statements in one D1 batch, near or over the per-invocation limit; if rejected nothing applies and the plugin retries the same call."
  - #6: "ARCHIVE_EVENTS writes an archived event only for named keys, not for the parts and checks the same statement archived; a revive writes no restored event."
  - #7: "docSyncChildren walks only rows loadForSync returned; a closed part/check (in_doc_sync = 0) or a live card in the chain can hide a doc-synced grandchild, so the early check passes and the SQL guard refuses with the generic text. Treat the early check as advisory."
- Follow-ups (`reviews/pr-199-check-3-medium.md`, converged, not built in this slice):
  - #1 (`src/domain/docSync.ts:288`, a visibility fault, no data lost): "Archived child dropped by the documents revives live." `closeTargets` skips archived rows, so when the revive restores a slice, a part or check the documents dropped while it was archived comes back open and counts on the board; the plugin sends the slice only when its hash changes, so nothing closes it later.
  - #2: "SYNC_UPSERT ON CONFLICT sets `archived_at = excluded.archived_at`; a write with `in_doc_sync = 0` yields NULL and un-archives the row."
  - #3: "Explicit upsert of an archived child under an archived parent plans `archived_at: null`, so `docFieldsDiffer` reports a change every call."
  - #4: the comment on `SYNCED_ROWS` and `ArchiveRepository.syncedPage` says "live" rows but the query lists archived ones on purpose; reword both.
  - #5: the `archived` event covers only named keys (same as check-2 #6).
Five review passes ran (high 8, medium 6, check 8, check-2 7, check-3 5 findings). The high, medium and first check
findings are fixed by the second and third designs above, except high #4 (the one line naming it above); check-2 #1-#4
by rule 5; check-2 #5-#7 and all five check-3 findings are the follow-ups above.

#### Changed while building

- A report, `mark_done`, `ask_human` or heartbeat on an archived key is refused with an "archived" reply, and says how to bring it back; reporters fail open, so the caller is never blocked.
- A purged item the documents still list comes back new on the next sync (rule 4 above): the documents are the source of record.

#### For CLAUDE.md (lifted 2026-11-25)

- The archive rules (what an archive takes, what revives, the purge, an archived parent's time passed to its doc-synced rows) live in the write statements of `src/infrastructure/d1Repository.ts` (`ARCHIVE_ROWS`, `SYNC_UPSERT`, `SYNC_REVIVE`, `UPSERT_ITEM`, `PURGE_*`), never on an earlier read (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- The archive filters live in `BOARD_WHERE`, `EXPIRED_ROWS`, `WAITING_ROWS`, `OPEN_CHECK_OF` and `SESSION_WINDOWS`, and in their twins in `src/domain/stale.ts`; a new read of items adds `archived_at IS NULL` (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- The 30 days are `ARCHIVE_KEEP_DAYS` in `src/domain/archive.ts`; never write the number elsewhere (Slice 50: docs/plan/slices/50-batch-and-archive.md).
- `docHash` has one board copy (`src/domain/docSync.ts`) and one plugin copy (`plugin/scripts/sync-docs.mjs`), held equal by `test/docHash.test.ts` and the plugin's vectors test; change both (Slice 50: docs/plan/slices/50-batch-and-archive.md).

#### For README.md (lifted 2026-11-25)

- `upsert_item`: add or update one item, with its parts and checks (static write token).
- `archive_item`: archive an item and its plan-owned parts and checks; it is purged after 30 days.
- `apply_batch`: up to 200 upserts, closes and archives in one all-or-nothing call.
- `list_synced`: keys, status and content hash of a project's doc-synced items, paged by key.
- `get_item` takes `include_archived` to read an archived item.

#### Not yet verified

- `[session]` After release, run the plugin's sync in the owner's repo that hit the 200-item cap: it sends in several batches, no "exceed the 200-item cap" line appears, and the board's project block shows its open slices.
- `[session]` After release, archive one test item with `archive_item`: it is gone from the board and readable with `get_item` and `include_archived`.
