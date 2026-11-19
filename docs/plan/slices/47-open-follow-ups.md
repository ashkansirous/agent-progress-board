### Slice 47 — Open review follow-ups of Slices 33 to 36, 39 to 41 and 46

*In progress (wave 2026-11-19), draft PR.*

**Status:** planned. Settled 2026-11-19 by the starter session under the owner's standing rule ("build all", no review
round): build every item, correctness and privacy findings first.

*Planned 2026-11-19 by the feedback loop of night 2026-11-19-0441 ([note](../notes/2026-11-19-0441-feedback-loop.md),
finding 6). The night stopped with "no planned slices left" while these follow-ups sat only in built slices' files and
plan.md *Outstanding work* lines marked "no slice yet". The loop plans; it does not build. Parked so no night builds it
before the owner has seen it; the owner's standing rule ("build all", no review round) may settle it at once.*

**Touches:** web/src/boardStore.ts, web/src/boardState.ts, web/src/BoardPage.tsx, web/src/projectFold.ts, web/src/cards.ts, web/src/route.ts, web/src/useRoute.ts, web/src/ActivePage.tsx, web/src/stepsView.tsx, web/src/UsagePage.tsx, src/domain/item.ts, src/api/board.ts, src/api/boardDto.ts, src/domain/steps.ts, src/domain/errors.ts, src/domain/docSync.ts, src/domain/parts.ts, src/domain/boardGroups.ts, src/domain/usage.ts, src/domain/stale.ts, src/application/board.ts, src/application/usage.ts, src/infrastructure/d1Repository.ts, src/mcp/tools.ts, plugin/scripts/report-progress.mjs, plugin/scripts/sync-docs.mjs, plugin/scripts/hooks/background-agents.mjs, plugin/scripts/hooks/session-done.mjs, plugin/scripts/hooks/goal-reminder.mjs, plugin/scripts/hooks/hook-input.mjs, plugin/scripts/hooks/waiting-card.mjs, plugin/scripts/hooks/hooks.test.mjs, plugin/scripts/hooks/waiting-card.test.mjs, test/stale.test.ts, test/usageTools.test.ts, test/syncSnapshot.test.ts, e2e/active.spec.ts, e2e/loadingClock.ts, docs/clients.md, plus new tests beside each.

**Migrations:** none.

*Premise check 2026-11-19 (`reviews/s47-premise.md`): every finding of items 1-8 still open on `origin/main` 77a72f1.
Decision (coordinator, obvious choice): the Slice 13 #7 marker for `needs_you:` notes (1q) is derived at read from the
note prefix, never stored (repo rule: never store a derived value), so no migration. Findings the source slices declined
by design (e.g. 5e: `isWaitingClosable` stays, held equal to `WAITING_ROWS`; 3h write-once `details_md`; 6a first report
binds) keep the settled rule and are recorded as such, not rebuilt.*

#### Work

Each item's full text, file and reason is in its source slice file; that file wins.

- [ ] 1. Slice 36 *Follow-ups* and *From review*: the stale cache on mount can close the drawer before the refresh starts
  (medium, first), the low findings on the board store and fold pruning, and the Slice 13 #7 marker field for `needs_you:`
  notes ([Slice 36](36-board-page-fixes.md)).
- [ ] 2. Slice 39 third check pass, five lows, and its skipped lows ([Slice 39](39-step-tree.md) *From review*).
- [ ] 3. Slice 33's five second-check-pass findings and two skipped cost findings in `topLevelReasons`
  ([Slice 33](33-sync-and-checks-rules.md) *From review*).
- [ ] 4. Slice 40's seven fourth-check-pass lows and its skipped ones ([Slice 40](40-agents-in-tree.md) *From review*).
- [ ] 5. Slice 34's five second-check-pass lows and follow-ups #3 and #9 ([Slice 34](34-storage-queries.md) *From review*).
- [ ] 6. Slice 41's three second-check-pass lows and the "Needs you" scroll from Active work
  ([Slice 41](41-tasks-with-outcome.md) *From review*).
- [ ] 7. Slice 35's four low findings ([Slice 35](35-usage-page-fixes.md) *Open items*).
- [ ] 8. Slice 46's seven follow-ups and its skipped review findings, including `pr-172-check-medium` #6 (a
  `senders.log.<pid>.tmp` left when the hook is killed between write and rename) ([Slice 46](46-slice-45-follow-ups.md)
  *From review*).

#### Verification

- Each item's test fails on the old code and passes after; `npm run lint`, `npm run typecheck`, `npm test` and
  `npm run test:e2e` green.
- Before building, re-check each item against `origin/main`: an item a later slice already fixed is struck with the
  commit that fixed it.
