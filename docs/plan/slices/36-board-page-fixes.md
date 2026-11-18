### Slice 36 — Board, Active and drawer pages: review leftovers

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 3, after Slice 35 (both edit
`web/src/strings.ts` and `web/src/CapCostSection.tsx`) and after Slice 38 (the e2e files).

**Touches:** `web/src/boardStore.ts`, `test/boardStore.test.ts`, `web/src/session.css`, `web/src/view.tsx`, `web/src/BoardPage.tsx`, `web/src/boardState.ts`, `web/src/useRoute.ts`, `web/src/route.ts`,
`web/src/ActivePage.tsx`, `web/src/ActiveStates.tsx`, `web/src/UsagePage.tsx`, `web/src/UsageStates.tsx`,
`web/src/StatePanels.tsx`, `web/src/CapCostSection.tsx`, `web/src/SetupPage.tsx`, `web/src/model.ts`,
`web/src/cards.ts`, `web/src/time.ts`, `web/src/Detail.tsx`, `web/src/SessionDrawer.tsx`,
`web/src/SessionCards.tsx`, `web/src/ChecksView.tsx`, `web/src/PartsView.tsx`, `web/src/ProjectGroup.tsx`,
`web/src/projectFold.ts`, `web/src/Header.tsx`, `web/src/CapLine.tsx`, `web/src/TaskCost.tsx`,
`web/src/strings.ts`, `web/src/planning.css`, `web/src/styles.css`, `test/web.test.ts`, `test/sessionWeb.test.ts`,
`test/partsWeb.test.ts`, `test/projectFold.test.ts`, `e2e/board.spec.ts`, `e2e/active.spec.ts`,
`e2e/projects.spec.ts`, `e2e/session.spec.ts`, `e2e/planning.spec.ts`, `web/src/hooks.ts`, `web/src/planningText.ts`,
`docs/plan/slices/36-board-page-fixes.md`

**Migrations:** none

#### Why

These are the web follow-ups of Slices 2, 10, 11, 13, 14, 15, 19 and 27. The one medium: during an outage,
`dataDropped` stays true through the error state, so an open item's address is cleared and not reopened after Retry
(Slice 10 check-2 #1). The worst lows: a stale part looks like the working part (Slice 14 check-4 #1, recorded as
medium), and an item opened from Active closes to the board.

#### Decisions

- The design in `docs/design/` is the source of every visual value (root `CLAUDE.md`). Slice 2 pr-35-high #10 (a
  Cancel button on the loading card) is not built: the mock draws none, and the mock wins.
- The page never regroups (`groupBoard`, `resolveOpen`; root `CLAUDE.md`). Slice 14 pass-2 #7 removes the page's own
  regrouping of phone questions and waiting items.
- Closing an item returns to the page it was opened from. The address stays `#/open/<key>` (Slice 10 rule).

#### Work

*Built 2026-11-18 (night wave 3), PR #144 pending merge; 17 of 22 items at build plus review fixes, not yet tried on a phone. Tests green on the final code: 604 vitest, 341 node, 296 e2e.* Premise check at claim (wave 19, `origin/main` 58fdcbe), the builder reads
these before the items below:
- Slice 10 high #7 may already be done: `model.ts:59` and `cards.ts:24` use the server's `item.working`;
  `heartbeat_at` is used only for sorting and display. Confirm and tick it with a pinning test, or fix what is left.
- Line moves: `activeTasks` is `model.ts:58-60`; the tautology is `e2e/planning.spec.ts:52`; `CapLine.tsx:165`
  (`capAltDroppedOne`/`capAltDroppedMany`); `TaskCost.tsx` plural is `projectOne`/`projectMany` (find it by name);
  the state-center card in `CapCostSection.tsx` is line 507 (490 is the `<h2>`); `SetupPage.tsx:134`.
- Slice 13 #7 (`needs_you:` note): it is the `NEEDS_YOU_NOTE_PREFIX` check in `historyWords` (`cards.ts` about line
  105), a history-row rule; read what it does before changing it.
- Touches may need `web/src/hooks.ts` (`useBoard`) for the UsagePage tab count and `web/src/planningText.ts`; both are
  allowed.
- Runs beside Slice 39, which also edits `web/src/strings.ts`, `e2e/active.spec.ts` and `test/web.test.ts`: add
  separate keys and test cases, never rewrite the other's.

Part A, open-item address (Slice 10):
- [x] check-2 #1 (medium): `dataDropped` (`web/src/boardState.ts:57`) is cleared only by a success. In
  `web/src/BoardPage.tsx:113-116`, `gone = dataDropped || …` calls `close()`. Keep the address through an error and
  reopen it after Retry.
- [x] med #6 + check-med #7 + check-2 #5: `close()` replaces the hash with the board route (`web/src/useRoute.ts:30-32`).
  Return to the page the item was opened from. `e2e/active.spec.ts:180` pins the old behaviour; change it.
- [x] Slice 14 check-3 #3: the key `loose-checks:x` can't be opened (`web/src/route.ts:36-47`).
- [x] Slice 11 #5: a hash change remounts the Active card and drops its expand state (`web/src/ActivePage.tsx:29`,
  where the key includes `item.key === openKey`).

Part B, counts and model (Slices 10, 13, 14, 15):
- [x] Slice 10 high #7: the client recomputes `working` from `heartbeat_at` (`web/src/model.ts:59`,
  `web/src/cards.ts:24`). Use the server's `item.working`.
- [x] Slice 10 high #8 + check-med #8: `activeTasks` runs twice per render and ignores `working_count`
  (`ActivePage.tsx:24,48`).
- [x] Slice 10 med #2: the Usage page runs its own `useBoard()` only for the tab count (`web/src/UsagePage.tsx:115`).
- [x] Slice 14 pass-2 #7: the page regroups phone questions and waiting items (`web/src/model.ts:~40-60`). Read the
  server's order.
- [x] Slice 15: remove the dead leftovers of the Waiting strip: `waitingItems`, `questionItems`, `distinctProjects`
  (`model.ts:39,44,70`), `waitingForYouN` (`strings.ts:18,388`), the imports in `test/sessionWeb.test.ts:18` and
  `test/web.test.ts:7`, and any CSS only they used.
- [x] Slice 13 #8: an unparseable timestamp shows "waiting NaN min" (`web/src/time.ts:9-11`). #9a: `LAST_TIME` sorts
  with U+FFFF (`model.ts:32,36`).
- [ ] Slice 13 #7: a note that starts with `needs_you:` renders as a question (`cards.ts:~99-104`).
- [x] Slice 15: plurals are hand-rolled (`Header.tsx:22,33-35`, `ActivePage.tsx:20`, `CapLine.tsx:164`,
  `TaskCost.tsx:62`). Use `Intl.PluralRules`.

Part C, drawers, parts and layout (Slices 2, 13, 14, 15, 19, 27, 10):
- [x] Slice 14 check-4 #1 (medium): a stale part has the same class as the active part (`web/src/ChecksView.tsx:26-27`).
  Give it the stale style the design shows. Also check-4 #2 (no `aria-current="step"`), #5 (the part label is
  built in code, and the `ul` aria-label repeats the h3; `:12,53`), #6 (`PartsSection` is a thin wrapper,
  `web/src/PartsView.tsx:59`), #7 (`.check-state` defaults to the done green, `web/src/planning.css:358-366`), and
  #3 (dead strings, `strings.ts:267-273` en, `638-644` de).
- [x] Slice 13 #4: a non-session question shows `why` as the purpose and all of `details_md` as "Done so far"
  (`web/src/SessionDrawer.tsx:61-75,148-149`).
- [x] Slice 27 chk #8: `QuestionCard` is a div. Only the inner `button.question-body` opens it (tapping the padding
  does nothing), and it has no group role (`web/src/SessionCards.tsx`).
- [x] Slice 2 #3: history rows are keyed by index, the client doesn't sort them, and no test pins the order
  (`web/src/Detail.tsx:111`). #4: `focusAfterClose` falls back to the first `.page` button (`Detail.tsx:175-178`).
- [ ] Slice 15: the fold button has no `aria-controls` (`web/src/ProjectGroup.tsx:89`). The per-block copies of the
  stored fold map are never pruned (`web/src/projectFold.ts:25-35`). The phone tab bar is on top only on the Board
  page (`BoardPage.tsx:122` vs `ActivePage.tsx:64`, `UsagePage.tsx:136`); match the mock.
- [ ] Slice 19 high #5 / med #5: the header link's touch target and the phone layout of the setup page, to the mock.
- [x] Slice 10 check-3 #1: `.state-gap-14` is only on the empty card (`ActiveStates.tsx:32,45`,
  `styles.css:744-751`). Apply it to every state-center card: `StatePanels.tsx:44,57`, `CapCostSection.tsx:490`,
  `UsageStates.tsx:35,48`, `SetupPage.tsx:130`.
- [x] Slice 14 check-4 #4: the tautology `expect(3 + 5 + LOOSE_COUNT).toBe(30)` (`e2e/planning.spec.ts:51`).

*Built notes (builder, 2026-11-18), items left open above:*
- Slice 13 #7 stays open: a caller note and the server's marker are the same text, so the page cannot tell them apart; it needs a marker field on the event in `src/domain/item.ts` and `src/api/board.ts` (outside Touches).
- Slice 15 tab bar stays open: Board and Active work now draw the segmented bar at the top on the phone (PhoneV2, ActiveV3Phone), but `PhoneUsage.dc.html` still draws a bottom bar and `e2e/usage.spec.ts:200` (outside Touches) pins it, so the Usage page keeps it. The mock for Usage needs the same update before the bar sits in one place on every page.
- Slice 19 #5/med #5: the header link is now a 44 px target; the Setup page's phone layout already equals `SetupPhone.dc.html` (`setup.css`, outside Touches), so nothing changed there.
- Slice 10 check-3 #1: the mock draws every centred state card with a 12 px gap (`States*.dc.html`), so `.state-gap-14` and its e2e pin were removed instead of spread to the other cards.
- Slice 14 check-3 #3: the loose-checks drawer now has its own address `#/loose/<project>`; `#/open/<key>` is only for items.
- Slice 10 med #2: `useBoard` (`web/src/hooks.ts`) is one shared read; a page that mounts shows the last answer and starts one reload.

*Changed while building / from review fixes:*
- The shared board store is `web/src/boardStore.ts` (`hooks.ts` wraps it). `settle(success|failure|aborted)` is the only writer of `loading` and `slow`. The read stops one tick after the last listener leaves (deferred stop). `useBoardSnapshot` gives the Usage tab its count from the cached board without starting a read.
- Loose checks open at `#/loose/<project>`; closing returns to the page the item was opened from; plurals go through `Intl.PluralRules` via `t.plural`; the time helpers show "–" for an unreadable time; the drawer's gone-check runs only on a settled load.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`. New e2e tests: open an item, fail the load,
  Retry, and the item is open again; open from Active, close, and you're back on Active; a stale part is styled
  stale.
- On the owner's phone after the release: the tab bar sits at the top on Board and Active work; on Usage it stays at
  the bottom until the owner picks the mock (see *Waiting on the user*).

#### Follow-ups

Undelivered Work items (`reviews/pr-144-high.md` #5):
- Slice 13 #7 (a note that starts with `needs_you:` renders as a question): needs a marker field on the event in
  `src/domain/item.ts` and `src/api/board.ts`, outside this slice's Touches.
- Slice 19 #5 / med #5 (phone layout of the setup page): already matches `SetupPhone.dc.html`, so nothing to change.

Open from review (`reviews/pr-144-check-3-medium.md` #1-#4, listed under *From review*): not yet planned as a slice; the medium one (stale cache closes the drawer before the refresh starts) needs one first.

#### Waiting on the user

- The phone tab bar is at the top in `PhoneV2` and `ActiveV3Phone` but at the bottom in `PhoneUsage.dc.html`, so which
  mock wins for Usage is the owner's call. Today's Usage bar (bottom) is kept; `e2e/usage.spec.ts:200` pins it
  (`reviews/pr-144-high.md` #5).

#### From review

Read in full: `reviews/pr-144-high.md` (10 findings), `pr-144-medium.md` (4), `pr-144-check-medium.md` (5), `pr-144-check-2-medium.md` (9), `pr-144-check-3-medium.md` (4). The check passes converged after the second one. Findings not listed below with a reason were fixed in review rounds (per the builder's brief); the undelivered Work lines of the first review are under *Follow-ups* and *Waiting on the user*. The review files live in `D:/agent-progress-board-worktrees/reviews`, so the skip check needs `--root D:/agent-progress-board-worktrees`.

Check-3 left four findings as follow-ups (one medium, three low); the medium is the first.

- Skipped #1 (`reviews/pr-144-check-3-medium.md`): "`loaded` is true from cached data on mount, so drawer closes before refresh." - medium follow-up: stale cache on mount can close the drawer before the refresh starts.
- Skipped #2 (`reviews/pr-144-check-3-medium.md`): "settle() runs inside the try that wraps fetchBoard, so a throwing listener during the success publish is caught and turned into a failure" - needs a listener that throws during the publish, none does today; left for a follow-up.
- Skipped #3 (`reviews/pr-144-check-3-medium.md`): "an aborted first load (data=null, error=null) leaves loading=false, so the next board page's first frame" - one frame of blank body before the subscribe effect restarts the load, no data loss; left for a follow-up.
- Skipped #4 (`reviews/pr-144-check-3-medium.md`): "first subscriber always calls refresh(), aborting a first load a passive reader (Usage count) already started" - the cost is one duplicate request and a restarted 500 ms slow timer, no wrong data; left for a follow-up.
- Skipped #9 (`reviews/pr-144-high.md`): "pruneStoredFolds drops the stored fold choice of any project missing from a single successful response, not only projects gone for good." - a project absent from a full refresh has left the board, which is when its stored choice should go; no partial refreshes exist that drop projects.
- Skipped #2 (`reviews/pr-144-check-medium.md`): "abortUnwatched sets state via a bare" (a bare start action with no notify, so loading may stay true after an abort) - the reviewer marked it unconfirmed and gave no failing sequence.
- Skipped #4 (`reviews/pr-144-check-medium.md`): "eventKeys numbers identical rows from the top (newest first), so a new identical top row shifts every older duplicate's key and remounts them." - a remount of older history rows is a render cost only; their content and order stay right.
- Skipped #5 (`reviews/pr-144-check-medium.md`): "useAddressGenerations state lives in Cards; when a failed refresh clears data and Cards remounts, the addressed card counts as newly named and re-expands, losing the user's collapsed state." - a cosmetic state loss with no data loss.
- Skipped #3 (`reviews/pr-144-medium.md`): "`openedFrom` is module-level mutable state set by an import-time hashchange listener, shared across callers and tests." - the reviewer found no failing sequence; `openedFrom` is set on every hash change before any close can read it (checked in `useRoute.ts`).
- Skipped #1 (`reviews/pr-144-check-2-medium.md`): "pruneIdsOf and the BoardPage effect treat one loaded board's project ids as the full set and delete saved fold choices for absent projects." - a stored fold choice is a view preference; pruning projects that left is this slice's own item; follow-up.
- Skipped #3 (`reviews/pr-144-check-2-medium.md`): "subscribePassive starts a load nobody polls; a following subscribe aborts and reissues it." - low, no failing sequence shown; follow-up.
- Skipped #4 (`reviews/pr-144-check-2-medium.md`): "Deferred stop (stopTimer, early return in abortUnwatched) plus two sets must be kept consistent by hand." - low, no failing sequence shown; follow-up.
- Skipped #5 (`reviews/pr-144-check-2-medium.md`): "Module-level openedFrom and an always-on hashchange listener are never removed; openedFrom is stale after non-hashchange routes." - low, no failing sequence shown; follow-up.
- Skipped #7 (`reviews/pr-144-check-2-medium.md`): "low. Project ids joined with" - low, no failing sequence shown; follow-up.
- Skipped #8 (`reviews/pr-144-check-2-medium.md`): "pruneStoredFolds reads/writes localStorage without coordination with in-memory fold state or other tabs." - low, no failing sequence shown; follow-up.
- Skipped #9 (`reviews/pr-144-check-2-medium.md`): "isDrawerHash/hashOfUrl use startsWith while openKeyOf/looseProjectOf decode; `#/open/` or `#/loose/` counts as a drawer address with nothing open." - low, no failing sequence shown; follow-up.

#### For CLAUDE.md

- The board's loading state ends only through `settle()` in `web/src/boardStore.ts`; never write `loading` or `slow` anywhere else (Slice 36: docs/plan/slices/36-board-page-fixes.md).

#### Not yet verified

- On a phone, the board read stops one tick after leaving a page, and the Usage tab count reads the cached board.
- On a phone, the open drawer stays open through a reload.
