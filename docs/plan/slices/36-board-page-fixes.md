### Slice 36 — Board, Active and drawer pages: review leftovers

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 3, after Slice 35 (both edit
`web/src/strings.ts` and `web/src/CapCostSection.tsx`) and after Slice 38 (the e2e files).

**Touches:** `web/src/BoardPage.tsx`, `web/src/boardState.ts`, `web/src/useRoute.ts`, `web/src/route.ts`,
`web/src/ActivePage.tsx`, `web/src/ActiveStates.tsx`, `web/src/UsagePage.tsx`, `web/src/UsageStates.tsx`,
`web/src/StatePanels.tsx`, `web/src/CapCostSection.tsx`, `web/src/SetupPage.tsx`, `web/src/model.ts`,
`web/src/cards.ts`, `web/src/time.ts`, `web/src/Detail.tsx`, `web/src/SessionDrawer.tsx`,
`web/src/SessionCards.tsx`, `web/src/ChecksView.tsx`, `web/src/PartsView.tsx`, `web/src/ProjectGroup.tsx`,
`web/src/projectFold.ts`, `web/src/Header.tsx`, `web/src/CapLine.tsx`, `web/src/TaskCost.tsx`,
`web/src/strings.ts`, `web/src/planning.css`, `web/src/styles.css`, `test/web.test.ts`, `test/sessionWeb.test.ts`,
`test/partsWeb.test.ts`, `test/projectFold.test.ts`, `e2e/board.spec.ts`, `e2e/active.spec.ts`,
`e2e/projects.spec.ts`, `e2e/session.spec.ts`, `e2e/planning.spec.ts`, `docs/plan/slices/36-board-page-fixes.md`

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

Part A, open-item address (Slice 10):
- [ ] check-2 #1 (medium): `dataDropped` (`web/src/boardState.ts:57`) is cleared only by a success. In
  `web/src/BoardPage.tsx:113-116`, `gone = dataDropped || …` calls `close()`. Keep the address through an error and
  reopen it after Retry.
- [ ] med #6 + check-med #7 + check-2 #5: `close()` replaces the hash with the board route (`web/src/useRoute.ts:30-32`).
  Return to the page the item was opened from. `e2e/active.spec.ts:180` pins the old behaviour; change it.
- [ ] Slice 14 check-3 #3: the key `loose-checks:x` can't be opened (`web/src/route.ts:36-47`).
- [ ] Slice 11 #5: a hash change remounts the Active card and drops its expand state (`web/src/ActivePage.tsx:29`,
  where the key includes `item.key === openKey`).

Part B, counts and model (Slices 10, 13, 14, 15):
- [ ] Slice 10 high #7: the client recomputes `working` from `heartbeat_at` (`web/src/model.ts:59`,
  `web/src/cards.ts:24`). Use the server's `item.working`.
- [ ] Slice 10 high #8 + check-med #8: `activeTasks` runs twice per render and ignores `working_count`
  (`ActivePage.tsx:24,48`).
- [ ] Slice 10 med #2: the Usage page runs its own `useBoard()` only for the tab count (`web/src/UsagePage.tsx:115`).
- [ ] Slice 14 pass-2 #7: the page regroups phone questions and waiting items (`web/src/model.ts:~40-60`). Read the
  server's order.
- [ ] Slice 15: remove the dead leftovers of the Waiting strip: `waitingItems`, `questionItems`, `distinctProjects`
  (`model.ts:39,44,70`), `waitingForYouN` (`strings.ts:18,388`), the imports in `test/sessionWeb.test.ts:18` and
  `test/web.test.ts:7`, and any CSS only they used.
- [ ] Slice 13 #8: an unparseable timestamp shows "waiting NaN min" (`web/src/time.ts:9-11`). #9a: `LAST_TIME` sorts
  with U+FFFF (`model.ts:32,36`).
- [ ] Slice 13 #7: a note that starts with `needs_you:` renders as a question (`cards.ts:~99-104`).
- [ ] Slice 15: plurals are hand-rolled (`Header.tsx:22,33-35`, `ActivePage.tsx:20`, `CapLine.tsx:164`,
  `TaskCost.tsx:62`). Use `Intl.PluralRules`.

Part C, drawers, parts and layout (Slices 2, 13, 14, 15, 19, 27, 10):
- [ ] Slice 14 check-4 #1 (medium): a stale part has the same class as the active part (`web/src/ChecksView.tsx:26-27`).
  Give it the stale style the design shows. Also check-4 #2 (no `aria-current="step"`), #5 (the part label is
  built in code, and the `ul` aria-label repeats the h3; `:12,53`), #6 (`PartsSection` is a thin wrapper,
  `web/src/PartsView.tsx:59`), #7 (`.check-state` defaults to the done green, `web/src/planning.css:358-366`), and
  #3 (dead strings, `strings.ts:267-273` en, `638-644` de).
- [ ] Slice 13 #4: a non-session question shows `why` as the purpose and all of `details_md` as "Done so far"
  (`web/src/SessionDrawer.tsx:61-75,148-149`).
- [ ] Slice 27 chk #8: `QuestionCard` is a div. Only the inner `button.question-body` opens it (tapping the padding
  does nothing), and it has no group role (`web/src/SessionCards.tsx`).
- [ ] Slice 2 #3: history rows are keyed by index, the client doesn't sort them, and no test pins the order
  (`web/src/Detail.tsx:111`). #4: `focusAfterClose` falls back to the first `.page` button (`Detail.tsx:175-178`).
- [ ] Slice 15: the fold button has no `aria-controls` (`web/src/ProjectGroup.tsx:89`). The per-block copies of the
  stored fold map are never pruned (`web/src/projectFold.ts:25-35`). The phone tab bar is on top only on the Board
  page (`BoardPage.tsx:122` vs `ActivePage.tsx:64`, `UsagePage.tsx:136`); match the mock.
- [ ] Slice 19 high #5 / med #5: the header link's touch target and the phone layout of the setup page, to the mock.
- [ ] Slice 10 check-3 #1: `.state-gap-14` is only on the empty card (`ActiveStates.tsx:32,45`,
  `styles.css:744-751`). Apply it to every state-center card: `StatePanels.tsx:44,57`, `CapCostSection.tsx:490`,
  `UsageStates.tsx:35,48`, `SetupPage.tsx:130`.
- [ ] Slice 14 check-4 #4: the tautology `expect(3 + 5 + LOOSE_COUNT).toBe(30)` (`e2e/planning.spec.ts:51`).

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`. New e2e tests: open an item, fail the load,
  Retry, and the item is open again; open from Active, close, and you're back on Active; a stale part is styled
  stale.
- On the owner's phone after the release: the tab bar sits in the same place on every page.
