### Slice 48 — Follow-ups left open by Slice 47

**Status:** *Built (wave 2026-11-19), merged as PR #184 (0abc466), 2026-11-19T08:22Z. Lint, typecheck, 440 node, 773 vitest and 336 e2e tests (6 skipped) green at 08:19Z; live page checks not yet run.* Settled 2026-11-19 by the starter session under the owner's standing rule ("build all", no review
round): build every item, the two loading-state findings first.

*Planned 2026-11-19 by the feedback loop of night 2026-11-19-0554 ([note](../notes/2026-11-19-0554-feedback-loop.md),
pass 2). Slice 47's skipped review findings sat only in its *From review* and one plan.md *Outstanding work* line
saying "no slice is planned". Two of them are loading-state findings, which the gate sends to a fixer, and #5 is a
side effect of Slice 47's own change (an aborted first load now stays loading). The loop plans; it does not build.*

**Touches:** web/src/boardStore.ts, web/src/boardState.ts, web/src/BoardPage.tsx, web/src/projectFold.ts,
web/src/ProjectGroup.tsx, web/src/ActivePage.tsx (`scrolledId`), web/src/cards.ts (`eventKeys`, `CODE_SPAN`),
src/mcp/schemas.ts, src/mcp/tools.ts, src/application/ports.ts, src/application/board.ts,
src/infrastructure/d1Repository.ts, plugin/scripts/hooks/session-done.mjs, plugin/scripts/hooks/background-agents.mjs, plugin/scripts/hooks/*.test.mjs, e2e/, test/.
(Widened 2026-11-19 07:38Z from the premise check: the port's D1 implementation, test fakes, and tools.ts for item 8.)

**Source:** [Slice 47](47-open-follow-ups.md) *From review*; the slice file wins where this list differs. The review
files are `reviews/pr-179-high.md`, `reviews/pr-179-medium.md`, `reviews/pr-179-check-2-medium.md` and
`reviews/pr-179-check-3-medium.md` under the repo's worktrees folder.

#### Work

- [x] 1. **Loading state after an aborted first load** (pr-179-check-2-medium #5): `loading` stays true with no request
  running. It must end through `settle()` in `web/src/boardStore.ts` (CLAUDE.md rule) and show a retry, not a spinner
  forever. Verify: an e2e test aborts the first load and sees the error state with Retry, using `e2e/loadingClock.ts`.
  - Built: the aborted state still holds `loading` true on purpose (Slice 47 1c: a next page's first frame must not
    paint an empty body, and an error card there would flash Retry, and `start` keeps an error card by design, see the
    "Retry never leaves a blank page" e2e test). No stranding path exists, so no store code changed (review #1-3: a
    first-draft branch for "loading true, nothing running, a reader arrives" was dead and is removed). Why it cannot
    strand: `running` becomes null only in `abortUnwatched`, which does nothing while a page, a passive reader or the
    deferred stop is pending; so loading-true-with-nothing-running means no one is watching, and the next reader is
    either the first listener (`listeners.size === 1`, which calls `refresh()` because `isLoadingNow()` is false) or a
    passive reader (`running === null` calls `refresh()`). Both end through `settle()`. The unit test in
    `test/boardStore.test.ts` and the e2e test "a first load aborted by leaving the page never strands a spinner" are
    regression guards only (they pass on the base commit). The rule, stated once: a reader arriving while `loading` is
    true and no request runs would have to start a load, and every reader path already does (the first listener and
    the passive reader above). The remaining path named in pr-184-medium #5, a passive reader arriving while the
    deferred stop timer is pending after an aborted load, cannot be reached: `stopTimer` counts as watched in
    `isWatched`, so `abortUnwatched` cannot abort while it is pending, and the stop's own `abortUnwatched` runs after
    `stopTimer` is cleared with no reader left. The unit test "a passive reader arriving while the deferred stop is
    pending never leaves loading stranded" drives that sequence and passes on the unchanged code; it is kept as a guard.
- [x] 2. **`scrolledId` on an A, B, A address sequence** (pr-179-check-2-medium #6): returning to A scrolls again.
  Verify: an e2e test opens `#/needs-you`, another page, then `#/needs-you` and sees the scroll twice.
  - Built: the e2e test in `e2e/projects.spec.ts` (desktop; counts `scrollIntoView` calls on the Needs-you section),
    and in `e2e/active.spec.ts` "a card named by #/active/<key> scrolls again ... A, B, A" for `scrolledId` itself.
    The Active page's `scrolledId` needed no code change: its id carries the address generation (`key|n`), so an A, B, A
    sequence gives A a new id and scrolls again.
- [x] 3. **`pruneAgents` drops agents started over 24 h ago without checking they still run** (pr-179-high #4).
  Decide keep-with-rule or fix; record the choice here.
  - Built (fix): `pruneAgents(content, now, running)` keeps an agent whose id is in `running` however old, and prunes
    nothing when the write does not know the running agents (`running` undefined). The Stop, SubagentStop and
    SubagentStart hooks pass the agents that have not finished through `sendCard` (`liveAgentIds` in
    `background-agents.mjs`: an agent file not finished, not stopped and written within 24 h, since the reader lists
    only agents written in the last 10 minutes, so a long silent tool call is kept, review #2; one quiet for 24 h
    without `finished` is taken as crashed and pruned once started over 24 h ago, pr-184-check-medium #1). Narrower rule than Slice 47 4f ("at the next goal
    write"): only the write after a successful card send prunes; the hold, close and release writes do not, so while
    sends keep failing old entries wait for the next successful send (review #6, recorded not widened). Test: `hooks.test.mjs` "Slice 48 3", and 4f
    still passes.
- [x] 4. **`eventKeys` builds with `unshift` inside `reduceRight`** (pr-179-medium #7, check-2 #3): build forward.
  - Built: a loop that fills the result by index; the existing `eventKeys` tests pass unchanged.
- [x] 5. **`CODE_SPAN` look-ahead of 2000 characters and its "linear time" comment** (check-2 #2): fix the comment or the
  bound, with a test at the bound.
  - Built: the comment now says each opening run costs at most the bound and a span longer than it is not read as a span;
    test in `test/sessionWeb.test.ts` at the bound.
- [x] 6. **`useProjectOpen` calls `setReleased(false)` during render** (check-2 #4): move it to an effect or a keyed
  reset.
  - Declined, with a reason: `react-hooks/set-state-in-effect` (the repo's lint) refuses the effect, and a keyed reset
    needs a per-visit id the address hook does not give. Resetting state while rendering is React's own pattern for
    state that follows an input and re-renders at once; the comment in `web/src/projectFold.ts` says so.
- [x] 7. **Undeclared `origin` in the `test/sessionWeb.test.ts` timing test** (pr-179-check-3-medium #1): declare it.
- [x] 8. **Slice 47 item 2q, left only because `src/mcp/schemas.ts` was outside its Touches** (Slice 47 *Work*, item 2):
  build it or write the reason it is declined. Added by the 0554 loop, pass 3.
  - Built: 2q is the `stepsField` description that hardcoded "200 steps in all, 4 levels" (pr-143-check-2 #8); it now
    reads `MAX_STEPS` and `MAX_STEP_DEPTH`.
- [x] 9. **Slice 47 item 3b's sequential parent reads**, left because one read needs a new `ItemRepository` method in
  `src/application/ports.ts` (Slice 47 *Work*, item 3): build it or write why not.
  - Built: `ItemRepository.findChain(key, limit)` (one recursive query, `CHAIN_ROWS`, cut at a repeated key) replaces
    the loop of `find` calls in `loadParents`. Tests: `test/partsTools.test.ts` (order, limit, missing, loop) and the
    Slice 47 2e retry test now counts `findChain`.

#### Not yet verified

- Items 1 and 2: the live page checks (an aborted first load shows no stranded spinner; returning to `#/needs-you` or an
  Active card scrolls again) join Slice 47's live page checks in `docs/plan/unverified.md` at the index pass.

#### From review

Five findings files read in full: pr-184-high.md (9), pr-184-medium.md (5), pr-184-check-medium.md (5),
pr-184-check-2-medium.md (3), pr-184-check-3-medium.md (4). Applied: high #1-#8 (#1-#3 by removing the dead branch and
recording item 1 as not reproducible with guard tests, #4 the Active-page e2e test, #5 `liveAgentIds` counts unfinished
agents only, #6 the narrower prune rule recorded in item 3, #7 `CHAIN_ROWS` moved above the close-chunk JSDoc, #8 the
bound test at 2000 and 2001); medium #2 (24 h age cap and a real-reader test), #3 (the poll asserts greater than the
earlier count), #4 (`findChain` returns nothing for a limit under 1), #5 (proved unreachable, guard test kept);
check-medium #1 (a crashed agent quiet for 24 h is pruned); check-2 #1 (`liveAgentIds` returns undefined on a missing or
unreadable folder, so nothing is pruned). The four nits of check-3 (an e2e wait between `#/` and `#/needs-you`, a
per-scroll counter in the A, B, A test, a failed `statSync` read as unknown, `UNION` in `findChain`) are follow-ups:
converged after the third check pass; no crash, data-loss, security or privacy fault.

- Skipped #9 (`reviews/pr-184-high.md`): "`findChain` fetches a stored loop as repeated rows up to `limit` and cuts them in JS" - the extra rows are bounded by the limit of 20 and occur only for a stored parent loop; a cost, no wrong result.
- Skipped #1 (`reviews/pr-184-medium.md`): "Writes that pass no running list prune nothing (hold, close, release), and Stop/SubagentStop/SubagentStart prune only after a successful send" - already recorded as the narrower prune rule in item 3 (after pr-184-high #6); old rows wait for the next successful send, no wrong data.
- Skipped #2 (`reviews/pr-184-check-medium.md`): "saveGoal calls pruneAgents with `running` undefined for hold/close/release writes, which returns early, so pruning happens only after a successful send" - the narrower prune rule is already recorded after pr-184-high #6; old rows wait for the next successful send, no wrong data.
- Skipped #3 (`reviews/pr-184-check-medium.md`): "runningIds does readdirSync, a statSync and a meta read per agent on every Stop/SubagentStart/SubagentStop" - one extra folder scan per hook is a cost only; the folder holds the session's own agent files.
- Skipped #4 (`reviews/pr-184-check-medium.md`): "CHAIN_ROWS sits between the JSDoc for the close-chunk constants and CLOSE_CHUNK_ROWS, stealing the comment. UNION ALL also reads `limit` rows per call on a looped stored parent" - CHAIN_ROWS already sits above the close-chunk JSDoc at d1Repository.ts:60-68, and the UNION ALL over-read was skipped as pr-184-high #9.
- Skipped #2 (`reviews/pr-184-check-2-medium.md`): "`readBackgroundAgents` scans the same folder in the same hook, and the two scans can disagree" - same as pr-184-check-medium #3: one extra scan is a cost; a disagreement can only keep an entry one write longer.
- Skipped #3 (`reviews/pr-184-check-2-medium.md`): "Item 1 (a spinner stranded after an aborted first load) is marked built, but the only change in `subscribe` is a comment" - item 1's note in this slice already records it as not reproducible, with guard tests.
- Skipped #5 (`reviews/pr-184-check-medium.md`): "Slice 48 item 1 (stranded spinner after aborted first load) is marked built but the only change is a comment" - item 1's note in the slice already proves the path unreachable, with guard tests in test/boardStore.test.ts.

#### For CLAUDE.md (lifted 2026-11-19)

- The agent prune rule lives only in `liveAgentIds` (plugin/scripts/hooks/background-agents.mjs) used by `runningIds` in session-done.mjs; a read it cannot make prunes nothing (Slice 48: docs/plan/slices/48-slice-47-follow-ups.md).
