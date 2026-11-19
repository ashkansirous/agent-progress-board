### Slice 47 — Open review follow-ups of Slices 33 to 36, 39 to 41 and 46

*Built 2026-11-19, merged as PR #179 (964de52). Checks: lint, typecheck, 769 vitest, 437 plugin node and 331 e2e green (E2E_PORT 4174). No device run (the browser e2e covers the page; there is no phone app).*

**Status:** built (PR #179). Settled 2026-11-19 by the starter session under the owner's standing rule ("build all", no review
round): build every item, correctness and privacy findings first.

*Planned 2026-11-19 by the feedback loop of night 2026-11-19-0441 ([note](../notes/2026-11-19-0441-feedback-loop.md),
finding 6). The night stopped with "no planned slices left" while these follow-ups sat only in built slices' files and
plan.md *Outstanding work* lines marked "no slice yet". The loop plans; it does not build. Parked so no night builds it
before the owner has seen it; the owner's standing rule ("build all", no review round) may settle it at once.*

**Touches:** web/src/boardStore.ts, web/src/boardState.ts, web/src/BoardPage.tsx, web/src/projectFold.ts, web/src/cards.ts, web/src/route.ts, web/src/useRoute.ts, web/src/ActivePage.tsx, web/src/stepsView.tsx, web/src/UsagePage.tsx, src/domain/item.ts, src/api/board.ts, src/api/boardDto.ts, src/domain/steps.ts, src/domain/errors.ts, src/domain/docSync.ts, src/domain/parts.ts, src/domain/boardGroups.ts, src/domain/usage.ts, src/domain/stale.ts, src/application/board.ts, src/application/usage.ts, src/infrastructure/d1Repository.ts, src/mcp/tools.ts, plugin/scripts/report-progress.mjs, plugin/scripts/sync-docs.mjs, plugin/scripts/hooks/background-agents.mjs, plugin/scripts/hooks/session-done.mjs, plugin/scripts/hooks/goal-reminder.mjs, plugin/scripts/hooks/hook-input.mjs, plugin/scripts/hooks/waiting-card.mjs, plugin/scripts/hooks/hooks.test.mjs, plugin/scripts/hooks/waiting-card.test.mjs, test/stale.test.ts, test/usageTools.test.ts, test/syncSnapshot.test.ts, e2e/active.spec.ts, e2e/loadingClock.ts, docs/clients.md, web/src/foldRules.ts, web/src/ActiveCard.tsx, web/src/PlannedSection.tsx, web/src/LooseChecksDrawer.tsx, web/src/planningText.ts, src/domain/upsert.ts, e2e/fixture.ts, e2e/board.spec.ts, e2e/projects.spec.ts, plugin/scripts/report-progress.test.mjs, plus new tests beside each and existing tests under test/ (Touches widened at build, 2026-11-19).

**Migrations:** none.

*Premise check 2026-11-19 (`reviews/s47-premise.md`): every finding of items 1-8 still open on `origin/main` 77a72f1.
Decision (coordinator, obvious choice): the Slice 13 #7 marker for `needs_you:` notes (1q) is derived at read from the
note prefix, never stored (repo rule: never store a derived value), so no migration. Findings the source slices declined
by design (e.g. 5e: `isWaitingClosable` stays, held equal to `WAITING_ROWS`; 3h write-once `details_md`; 6a first report
binds) keep the settled rule and are recorded as such, not rebuilt.*

#### Work

Each item's full text, file and reason is in its source slice file; that file wins.

- [x] 1. Slice 36 *Follow-ups* and *From review*: the stale cache on mount can close the drawer before the refresh starts
  (medium, first), the low findings on the board store and fold pruning, and the Slice 13 #7 marker field for `needs_you:`
  notes ([Slice 36](36-board-page-fixes.md)).
  - Load freshness, one design (PR 179 second check pass): every page arrival starts a load unless one runs now (no
    age heuristic), and the store counts settled loads (`settles`: success or failure, never aborted); a page records the
    count at mount, and `isFreshLoad` / `isFreshData` (settled since mount, not loading, data present) gate both the
    drawer's "missing item, close" guard and the `#/needs-you` scroll (which records its arrival only when the section was found).
  - Fixed: 1a (`isFreshLoad`: a page counts data as loaded only after a load that settled since it mounted, `settles` in
    `boardState.ts`); 1b (settle outside the try, a throwing listener never becomes a failed load); 1c (an aborted first
    load stays `loading`); 1d and 1k (the first page carries on a load a passive reader started); 1g (`eventKeys` counted
    from the oldest row); 1h (the address counts and the scrolled mark live in `ActivePage`, so a remount of the list does
    not scroll again); 1l (`isWatched` / `isLoadingNow` helpers); 1n (project ids kept as JSON, not joined); 1p
    (`isDrawerHash` reads the address as the drawer does); 1q (server marker `EventMarker` derived at read from the note
    prefix, a caller note that starts like a marker is led in with `note: `, the page reads `event.marker`; no migration).
  - Kept: 1e and 1j ("kept: a project absent from a full successful read has left the board, Slice 36 Decision"); 1o
    ("kept: both writers re-read storage at write time, no atomic read-modify-write exists across tabs").
  - Recorded, no failing sequence: 1f (unconfirmed by the reviewer); 1i and 1m (`openedFrom` is set on every hash change
    before any close can read it).
  - Follow-ups (pr-179-check-2-medium), each "converged after the second check pass; no crash, data-loss, security or privacy fault":
    - Skipped #2 (`reviews/pr-179-check-2-medium.md`): `CODE_SPAN` looks only 2000 characters ahead and its "linear time" comment is loose.
    - Skipped #3 (`reviews/pr-179-check-2-medium.md`): `eventKeys` builds with `unshift` inside `reduceRight`, O(n^2) in history rows.
    - Skipped #4 (`reviews/pr-179-check-2-medium.md`): `useProjectOpen` calls `setReleased(false)` during render, one extra pass per address change.
    - Skipped #5 (`reviews/pr-179-check-2-medium.md`): the aborted first load leaves `loading` true with no request running (store guarded by `isLoadingNow`).
    - Skipped #6 (`reviews/pr-179-check-2-medium.md`): `scrolledId` with an unstable `onScrolled` may not scroll again on an A, B, A sequence.
- [x] 2. Slice 39 third check pass, five lows, and its skipped lows ([Slice 39](39-step-tree.md) *From review*).
  - Fixed: 2b (`parseStoredSteps` reads no list over `STORED_STEPS_READ_MAX`); 2e (a CAS retry does not repeat the
    parent reads); 2a (the page-side generation counts are now kept in `ActivePage`, see 1h).
  - Covered already: 2d (`test/stepsTools.test.ts` pins that a lost compare-and-swap adds no event).
  - Kept: 2c (a done parent finishes its children: the reporter said it), 2s (a first insert has no steps to lose).
  - Recorded, display detail or bounded by 200 steps, no data loss: 2f, 2g, 2h, 2i, 2j, 2k, 2l, 2m, 2n, 2o, 2p, 2r; 2q
    needs `src/mcp/schemas.ts`, outside Touches.
- [x] 3. Slice 33's five second-check-pass findings and two skipped cost findings in `topLevelReasons`
  ([Slice 33](33-sync-and-checks-rules.md) *From review*).
  - Fixed: 3c (the loose-checks card and drawer say the checks not tried, else all loose checks, never "0 checks");
    3f and 3g (one kept map for every pass, later passes screen only items that name a parent); 3j (renamed to
    `SLICE_NAMING_TYPES`); 3k (doc comment on `assertItemFits`).
  - Kept: 3d ("kept: a doc-synced bug the document dropped closes, the `isKeptChild` rule"); 3e ("kept: a blocked part
    shows ahead of the next pending one, Slice 11 pr-66-check-medium #1, pinned by `test/parts.test.ts`"); 3h and 3i
    (settled Decisions); 3b legacy loop part ("kept: a report that leaves the relation as it is skips re-validation, so a
    legacy row is never refused").
  - Recorded: 3a (the plugin omits `why` by design of the sync, no failing sequence); 3b's sequential parent reads (a
    single read needs a new method on `ItemRepository` in `src/application/ports.ts`, outside Touches); 3l (rare, a later
    report that carries the parts list catches it).
- [x] 4. Slice 40's seven fourth-check-pass lows and its skipped ones ([Slice 40](40-agents-in-tree.md) *From review*).
  - Fixed: 4a (no placeholder row for a stopped agent); 4e (row id quoted in the command text); 4f (`pruneAgents` drops
    places and starts older than a day inside the goal write); 4j (foreground agents are not listed); 4l (no helper
    context once the card is closed); 4n (comment names addresses).
  - Not reproducible: 4c (`clip` already flattens whitespace; a test pins it); 4d (no line with two statements is left in
    `goal-reminder.mjs`).
  - Kept: 4o and 4p (settled).
  - Recorded: 4b (the deny-list residual of `maskSecrets`); 4g, 4h, 4i, 4k, 4m (low, no failing sequence shown; each
    would change what the board shows for a running agent).
- [x] 5. Slice 34's five second-check-pass lows and follow-ups #3 and #9 ([Slice 34](34-storage-queries.md) *From review*).
  - Fixed: 5a (`compareText` orders by code point); 5d (doc comment above `closeChunks`); #9 (a dropped older status is
    named in its history row, "Older status report ignored"); #3 (test holds the event note and `updated_at` on one
    change rule).
  - Kept: 5e ("kept: `isWaitingClosable` stays, held equal to `WAITING_ROWS` by `test/stale.test.ts`").
  - Recorded: 5b (bounded by the environments a plan reports); 5c (every report time is the Worker's own clock, no client
    can stamp ahead).
- [x] 6. Slice 41's three second-check-pass lows and the "Needs you" scroll from Active work
  ([Slice 41](41-tasks-with-outcome.md) *From review*).
  - Fixed: 6b (`--clear-outcome` sends `outcome: null`); 6d (the scroll follows the address as well as the load, and the
    project with a question is drawn open while the address asks for it; folding it ends the address).
  - Kept: 6a ("kept: the first own-card report binds, `mayBindCard` Decision").
  - Recorded: 6c (unconfirmed by the reviewer).
- [x] 7. Slice 35's four low findings ([Slice 35](35-usage-page-fixes.md) *Open items*).
  - Fixed: 7d (`clampedStart` compares moments); 7b was already fixed (the key regex decides, not its length; a test now
    pins `2026-10-25#2`).
  - Kept: 7a ("kept: hours are consecutive real hours with distinct keys, pinned by `test/usage.test.ts`"); 7c (a miss
    costs one formatter, bounded by the zones the runtime knows, authenticated callers only).
- [x] 8. Slice 46's seven follow-ups and its skipped review findings, including `pr-172-check-medium` #6 (a
  `senders.log.<pid>.tmp` left when the hook is killed between write and rename) ([Slice 46](46-slice-45-follow-ups.md)
  *From review*).
  - Fixed: 8h (the trim sweeps stale `senders.log.*.tmp`); 8d (code spans match runs of equal length).
  - Already covered: 8f (`closing` counts only inside `CLOSING_WINDOW_MS`).
  - Kept: 8e (bounded at twice the line limit), 8g (once per file per process is the settled rule).
  - Recorded: 8a, 8b, 8c (mask details of `waiting-card.mjs`, no failing sequence).

#### Verification

- Each item's test fails on the old code and passes after; `npm run lint`, `npm run typecheck`, `npm test` and
  `npm run test:e2e` green.
- Before building, re-check each item against `origin/main`: an item a later slice already fixed is struck with the
  commit that fixed it.

#### From review

*Changed while building:*

- Load freshness is one design, reached after the third review round: every page arrival starts a load unless one is
  running; `settles` counts success and failure, not abort; `isFreshLoad` / `isFreshData` compare with the count at mount;
  the drawer close guard needs fresh data; the needs-you scroll needs fresh data and a found section.
- Behaviour changes: every page switch reloads the board; an aborted first load stays loading; `#/needs-you` opens folded
  projects that hold questions, and a fold click keeps the address but releases only that block; a dropped older status
  gets its own history note (a page string), only when nothing else changed.
- Reading of `pr-179-medium.md` #4: a caller note placed after the server's own marker is left as written; a caller note
  that would be stored first and reads like a marker is led in with `note: `.

*From review:*

- Findings 5/5 of pr-179-high (applied 1, 2, 3, 5; 4 left out, below).
- Findings 7/7 of pr-179-medium (applied 1-6; 7 left out, below).
- Findings 6/6 of pr-179-check-medium (applied 1-6; 1-4 as one design, after the third round, in load freshness).
- Findings 6/6 of pr-179-check-2-medium (applied 1; 2-6 left out, below).
- Finding 1/1 of pr-179-check-3-medium (left out, below).
- Skipped #4 (`reviews/pr-179-high.md`): "`pruneAgents` drops the place and start of any agent recorded as started over 24 h ago without checking whether it still runs" - an agent running past 24 h is far beyond the session stale window, so its card is stale long before the prune drops its place.
- Skipped #7 (`reviews/pr-179-medium.md`): "`eventKeys` uses `unshift` in `reduceRight`, O(n squared)" - bounded by the per-item history the Worker returns.
- Skipped #2 (`reviews/pr-179-check-2-medium.md`): "CODE_SPAN looks only 2000 characters ahead for the closing run" - converged after the second check pass; no crash, data-loss, security or privacy fault.
- Skipped #3 (`reviews/pr-179-check-2-medium.md`): "eventKeys builds its result with unshift inside reduceRight" - converged after the second check pass; no crash, data-loss, security or privacy fault.
- Skipped #4 (`reviews/pr-179-check-2-medium.md`): "useProjectOpen calls setReleased(false) during render" - converged after the second check pass; no crash, data-loss, security or privacy fault.
- Skipped #5 (`reviews/pr-179-check-2-medium.md`): "The aborted case sets loading true when there is no data and no error" - converged after the second check pass; no crash, data-loss, security or privacy fault.
- Skipped #6 (`reviews/pr-179-check-2-medium.md`): "scrolledId is a single string" - converged after the second check pass; no crash, data-loss, security or privacy fault.
- Skipped #1 (`reviews/pr-179-check-3-medium.md`): "the test uses `origin` without declaring it" - converged after the second check pass; no crash, data-loss, security or privacy fault.

#### For CLAUDE.md (lifted 2026-11-19)

- Board freshness after a page arrival is `isFreshLoad` / `isFreshData` in `web/src/boardState.ts`, from the `settles`
  count; never a time-based reuse window (Slice 47: docs/plan/slices/47-open-follow-ups.md).

#### Not yet verified

- None on a device: the browser e2e covers the page and there is no phone app here.
