### Slice 65 — Task-row and step-cost review follow-ups (from Slices 53 and 54)

*Planned 2026-11-26 by the feedback loop of night 2026-11-25-1729 (note `docs/plan/notes/2026-11-25-1729-feedback-loop.md`):
the skipped review findings of Slices 53 and 54 were listed only in those built slice files, with no planned slice.*

**Product:** agent-progress-board.

**Touches:** `src/domain/steps.ts`, `src/domain/upsert.ts`, `src/domain/stepRuns.ts`, `src/application/board.ts`,
`src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `plugin/scripts/step-cost.mjs`, their tests

Needs Slices 53 and 54 (merged). Each item names its findings file under `<repo>-worktrees/reviews/`; the full text of
each skip is in the Slice 53 and 54 files (*From review*).

## Work

From Slice 53 (`docs/plan/slices/53-task-tools-steps.md`, *From review*):

- [ ] **1.** A whole-list report that drops a parent drops its mirrored task rows (`pr-205-check-2-medium.md` #3):
  re-attach unmatched task rows at top level or under the closest kept ancestor. Test: drop a parent, the task row stays.
- [ ] **2.** A non-hook report that creates a new item skips `keepMirroredRows` (`pr-205-check-3-medium.md` #1): run it for
  non-hook creation in `src/domain/upsert.ts`. Test: a new item from a non-hook report keeps no task rows it did not own.
- [ ] **3.** A report over 400 steps is refused with the "at most 200 steps" text (`pr-205-check-3-medium.md` #2): word the
  cost-bound refusal on its own.

From Slice 54 (`docs/plan/slices/54-step-cost.md`, *From review*):

- [ ] **4.** A cost with no `seq` is stored with seq 0 and can never be corrected (`pr-207-check-2-medium.md` #1,
  `pr-207-check-3-medium.md` #2): refuse a cost without `seq`, or stamp one. Test both.
- [ ] **5.** `cost_ref` can point at a row `runOf` did not store, or match another writer's row
  (`pr-207-check-2-medium.md` #3, `pr-207-check-3-medium.md` #1 and #3): set `cost_ref` only when the row was stored,
  keyed by writer. Test: a rejected cost leaves no `cost_ref`.
- [ ] **6.** Smaller ones, one test each where it changes behaviour: stored row times change only when `seq` rises
  (check-2 #4); `stealIfStale` stat-then-rename race (check-2 #5); `readSync` short read in `step-cost.mjs` (check-2 #6);
  `withStepCosts` size and order before `fitItem` (check-2 #8, check #8); the newest-1000 step read cut (check #7);
  `tasks.find` takes the first label match (check #10); schema text says a cost needs an explicit `id` (check-3 #4);
  `cost` has no size bound in the schema (check-3 #5).

From Slice 49 (`docs/plan/slices/49-slice-48-follow-ups.md`, *Follow-ups (check pass 2)* and *(check pass 3)*):

- [ ] **7.** A non-ENOENT stat failure (EBUSY, EACCES) drops an active agent older than 10 minutes from
  `readBackgroundAgents` (check pass 2 #2): keep it, with a test. The rest of that file's two follow-up lists
  (`waitForQuietScrolls` settled-page check, the unreachable `seen` backstop in `findChain`, the usageTools constant,
  the check-pass-3 nits) are done in the same pass, each checked against `origin/main` first.

- [ ] **8.** (Feedback loop pass 2.) Under load the first full run of Slice 56's fix pass 2 failed
  `plugin` `report-progress.test.mjs` (projectSlug), one vitest case and two `active.spec` e2e cases, all green on
  rerun: find the shared state or wall-clock wait in each and fix it (Slice 38's clock helper for e2e).

## Verify

`npm run lint`, `npm run typecheck`, `npm test` green, with a test per item 1-5.
