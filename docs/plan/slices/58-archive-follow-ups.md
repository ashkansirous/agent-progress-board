### Slice 58 — Archive follow-ups from Slice 50's reviews

*Planned 2026-11-26 by plan-cleanup, moved out of Slice 50.*

**Product:** agent-progress-board. Moved out of Slice 50 (docs/plan/slices/50-batch-and-archive.md), whose own work is built.

*Check 2026-11-26 (plan-cleanup-check):* verdict keep open, not started. Read on `origin/main` (7318d16): `SYNC_UPSERT` still sets `archived_at = excluded.archived_at` (item 5), `ARCHIVE_EVENTS` still writes only for named keys (item 2), `SYNC_REVIVE` and `docSyncChildren` unchanged, `SYNCED_ROWS` comment still says "live" (item 7); no commit touches this slice's files after Slice 50/51. Every item is own work, no outside waits.

**Touches:** `src/infrastructure/d1Repository.ts`, `src/domain/docSync.ts`, `src/application/board.ts`, `src/application/archive.ts`, `test/*.test.ts`

#### Why

Review passes on PR #199 left eight findings, none of them data loss.

#### Work

- [ ] 1. check-2 #5: `SYNC_REVIVE` adds a statement per write, so a 200-item batch uses about 600+ D1 statements; measure against the per-invocation limit and cut or chunk if near it.
- [ ] 2. check-2 #6 and check-3 #5: `ARCHIVE_EVENTS` writes an `archived` event only for named keys, not the parts and checks the same statement archived; a revive writes no restored event.
- [ ] 3. check-2 #7: `docSyncChildren` walks only rows `loadForSync` returned; a closed part/check or a live card in the chain can hide a doc-synced grandchild, so the early check passes and SQL refuses with the generic text. Treat the early check as advisory or walk the chain.
- [ ] 4. check-3 #1 (`src/domain/docSync.ts`): an archived child dropped by the documents revives live with its slice because `closeTargets` skips archived rows; close it on revive.
- [ ] 5. check-3 #2: `SYNC_UPSERT` ON CONFLICT sets `archived_at = excluded.archived_at`; a write with `in_doc_sync = 0` yields NULL and un-archives the row.
- [ ] 6. check-3 #3: an explicit upsert of an archived child under an archived parent plans `archived_at: null`, so `docFieldsDiffer` reports a change every call.
- [ ] 7. check-3 #4: reword the comments on `SYNCED_ROWS` and `ArchiveRepository.syncedPage` ("live" is wrong; archived rows are listed on purpose).

Each item first re-checks that the finding still holds on `origin/main`, with a test.
