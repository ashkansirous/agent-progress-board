### Slice 50 — Item tools one by one and in batches, archive instead of delete

**Status:** planned (2026-11-19, the owner's answers in a RefineScope pass; no review round).

**Touches:** src/mcp/tools.ts, src/mcp/schemas.ts, src/mcp/instructions.ts, src/application/board.ts,
src/application/archive.ts (new), src/domain/docSync.ts, src/domain/archive.ts (new), src/domain/scope.ts,
src/infrastructure/d1Repository.ts, src/index.ts, migrations/0010_archive.sql (new), plugin/scripts/sync-docs.mjs,
plugin/scripts/*.test.mjs, plugin/skills/agent-board/SKILL.md, docs/clients.md, test/*.test.ts, CLAUDE.md, README.md.

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

- [ ] 1. **Archive in storage.** Migration `0010_archive.sql` adds `archived_at` (UTC ISO, null) to items with an index.
  `BOARD_WHERE`, `EXPIRED_ROWS`, `WAITING_ROWS`, `OPEN_CHECK_OF` and the usage and count queries leave archived rows
  out. Tests: an archived item and its children vanish from the board read and counts; `get_item` with
  `include_archived` returns it.
- [ ] 2. **`upsert_item` and `archive_item`.** One application path each, shared with `apply_batch`; schemas in
  `src/mcp/schemas.ts`; scope per Decision 7. Tests for add, update, archive, revive and refusal by scope.
- [ ] 3. **`apply_batch`.** Up to 200 expanded items per call, one D1 batch, all or nothing; a bad operation refuses the
  whole call and names it. Events are bound by `changes() > 0` like `INSERT_EVENT` and `SYNC_EVENT`. Tests: 200
  accepted, 201 refused, a mixed batch of upsert, close and archive, one bad item refusing the call.
- [ ] 4. **`list_synced`.** Keys, status and a content hash per doc-synced item of one project, paged by key, cut only
  by `cutReply`. The hash is the same one the plugin computes, defined once in `src/domain/docSync.ts` and mirrored in
  the plugin with a test holding the two equal.
- [ ] 5. **Plugin sync by changes.** `sync-docs.mjs` reads `list_synced`, works out adds, changed items and items gone
  from the documents, and sends them with `apply_batch` (gone items as `close`) in chunks of at most 200 expanded
  items. The 200-item refusal goes; the 1000-item guard is replaced by the chunking. A failed chunk stops the run and
  is retried on the next sync; nothing is marked done unless it is really gone from the documents. Tests: 450 items
  sync in three calls; an unchanged plan sends nothing; a removed slice is closed; a failed second chunk closes nothing.
- [ ] 6. **Purge after 30 days.** The cron removes items archived more than 30 days ago, with their parts, checks,
  steps and events, in bounded chunks. The 30 days are one constant in `src/domain/archive.ts`. Test with a fixed clock.
- [ ] 7. **Words.** `SERVER_INSTRUCTIONS` and the mirrored rules in `plugin/skills/agent-board/SKILL.md` (held equal by
  `test/pluginRules.test.ts`), `docs/clients.md` and README name the new tools, that delete is archive, and the 30 days.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, plugin tests (`node --test plugin/**/*.test.mjs`).
- After release: run the plugin's sync in the owner's repo that hit the cap. It sends in several batches,
  no "exceed the 200-item cap" line, and the board's project block shows its open slices. Then archive one test item
  with `archive_item` and check it is gone from the board but readable with `get_item` and `include_archived`.

#### Not in this slice

- A page to browse archived items; the owner reads them through `get_item` for now.
- Undo of the purge; after 30 days the data is gone.
