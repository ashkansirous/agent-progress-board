### Slice 48 — Follow-ups left open by Slice 47

**Status:** parked: feedback loop, waits for the user.

*Planned 2026-11-19 by the feedback loop of night 2026-11-19-0554 ([note](../notes/2026-11-19-0554-feedback-loop.md),
pass 2). Slice 47's skipped review findings sat only in its *From review* and one plan.md *Outstanding work* line
saying "no slice is planned". Two of them are loading-state findings, which the gate sends to a fixer, and #5 is a
side effect of Slice 47's own change (an aborted first load now stays loading). The loop plans; it does not build.*

**Touches:** web/src/boardStore.ts, web/src/boardState.ts, web/src/BoardPage.tsx, web/src/projectFold.ts,
web/src/ProjectGroup.tsx, web/src/ActivePage.tsx (`scrolledId`), web/src/cards.ts (`eventKeys`, `CODE_SPAN`),
src/mcp/schemas.ts, src/application/ports.ts, plugin/scripts/hooks/session-done.mjs, e2e/, test/sessionWeb.test.ts.

**Source:** [Slice 47](47-open-follow-ups.md) *From review*; the slice file wins where this list differs. The review
files are `reviews/pr-179-high.md`, `reviews/pr-179-medium.md`, `reviews/pr-179-check-2-medium.md` and
`reviews/pr-179-check-3-medium.md` under the repo's worktrees folder.

#### Work

- [ ] 1. **Loading state after an aborted first load** (pr-179-check-2-medium #5): `loading` stays true with no request
  running. It must end through `settle()` in `web/src/boardStore.ts` (CLAUDE.md rule) and show a retry, not a spinner
  forever. Verify: an e2e test aborts the first load and sees the error state with Retry, using `e2e/loadingClock.ts`.
- [ ] 2. **`scrolledId` on an A, B, A address sequence** (pr-179-check-2-medium #6): returning to A scrolls again.
  Verify: an e2e test opens `#/needs-you`, another page, then `#/needs-you` and sees the scroll twice.
- [ ] 3. **`pruneAgents` drops agents started over 24 h ago without checking they still run** (pr-179-high #4).
  Decide keep-with-rule or fix; record the choice here.
- [ ] 4. **`eventKeys` builds with `unshift` inside `reduceRight`** (pr-179-medium #7, check-2 #3): build forward.
- [ ] 5. **`CODE_SPAN` look-ahead of 2000 characters and its "linear time" comment** (check-2 #2): fix the comment or the
  bound, with a test at the bound.
- [ ] 6. **`useProjectOpen` calls `setReleased(false)` during render** (check-2 #4): move it to an effect or a keyed
  reset.
- [ ] 7. **Undeclared `origin` in the `test/sessionWeb.test.ts` timing test** (pr-179-check-3-medium #1): declare it.
- [ ] 8. **Slice 47 item 2q, left only because `src/mcp/schemas.ts` was outside its Touches** (Slice 47 *Work*, item 2):
  build it or write the reason it is declined. Added by the 0554 loop, pass 3.
- [ ] 9. **Slice 47 item 3b's sequential parent reads**, left because one read needs a new `ItemRepository` method in
  `src/application/ports.ts` (Slice 47 *Work*, item 3): build it or write why not.

#### Not yet verified

- None planned beyond the e2e tests above; items 1 and 2 also join Slice 47's live page checks in
  `docs/plan/unverified.md` once built.
