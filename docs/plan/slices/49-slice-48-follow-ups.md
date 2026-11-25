### Slice 49 — Follow-ups left open by Slice 48

*Built (2026-11-25), PR #198.*

**Status:** planned (starter session 2026-11-19, the owner's standing "build all", no review round; the possible
data-loss item first). Planned 2026-11-19 by the feedback loop of night
2026-11-19-0734 ([note](../notes/2026-11-19-0734-feedback-loop.md), pass 1). Slice 48's last check pass returned four
nits that its *From review* calls "follow-ups", but no slice or *Outstanding work* line held them once Slice 48 was
built. The loop plans; it does not build.

**Touches:** plugin/scripts/hooks/background-agents.mjs, plugin/scripts/hooks/*.test.mjs,
src/infrastructure/d1Repository.ts, test/partsTools.test.ts, e2e/projects.spec.ts, e2e/active.spec.ts,
test/usageTools.test.ts (widened night 2026-11-25: its scheduled-handler test fails on `main` since its fixed date
went past the keep window; it blocks every slice's green `npm test`, so this follow-up slice fixes it), e2e/scrollQuiet.ts (new, widened in fix 2: the shared scroll-settle helper of both
specs).

**Source:** `reviews/pr-184-check-3-medium.md` under the repo's worktrees folder (findings 1-4) and Slice 48's
[From review](48-slice-47-follow-ups.md); the review file wins where this list differs.

#### Work

- [x] 1. **A failed `statSync` counts a live agent as quiet since 1970** (check-3 #3,
  `plugin/scripts/hooks/background-agents.mjs:188`). `liveAgentIds` reads `modifiedAt` 0 on a stat error, so a running
  agent started over 24 h ago can be pruned from `agentParents` and `agentStarts` on one transient error. This is the
  same class as check-2 #1, which Slice 48 fixed as data loss (a read it cannot make prunes nothing). Treat a stat
  failure as unknown: keep the agent. Verify with a hook test where `statSync` throws for one agent file.
- [x] 2. **`findChain` uses `UNION ALL`** (check-3 #4, `src/infrastructure/d1Repository.ts:63`): a dangling parent or a
  stored loop reads up to `limit` rows on every report with a parent (also pr-184-high #9, skipped as a cost). Use
  `UNION` or carry visited keys; verify in `test/partsTools.test.ts` that a stored loop returns each key once from SQL.
- [x] 3. **The `#/` then `#/needs-you` e2e test can flake** (check-3 #1, `e2e/projects.spec.ts:110`): wait for an
  observable `#/` state before going back.
- [x] 4. **The A, B, A scroll test reads only the last scrolled title** (check-3 #2, `e2e/active.spec.ts:275`): assert a
  per-scroll counter rose after each visit.

#### Changed while building

- Item 1 became one agent-time rule, `agentTime` in `plugin/scripts/hooks/background-agents.mjs`, used by both `liveAgentIds` and `readBackgroundAgents` (design in *From review*, "fourth design").
- Item 2: `findChain`'s recursive query carries the visited keys and stops at a repeat (`CHAIN_ROWS` in `src/infrastructure/d1Repository.ts`); the test is in `test/partsTools.test.ts`.
- Items 3 and 4: both e2e specs wait with `e2e/scrollQuiet.ts` (300 ms with no scroll).
- Extra: the scheduled-handler test in `test/usageTools.test.ts` no longer depends on today's date (it failed on `main`).
- Checks (run-checks 18:36Z): lint, typecheck, `npm test` 773, e2e 336 passed, 6 skipped.

#### From review

Five review passes ran (high 7, medium 7, check 6, check-2 5, check-3 5 findings); every finding not named in the lines below or in the follow-ups was fixed by the fixers.

- Skipped #4 (`reviews/pr-198-high.md`): "If a key can contain char(31), a key could match across the separator and the ancestor walk stops early" - keys are made by the plugin and doc sync as project/slice/part strings; no failure path for a char(31) in a key.

- Skipped #7 (`reviews/pr-198-medium.md`): "The CTE `path` (char(31)-joined) grows per level, so cost is O(depth x key length); bounded by ?2, fine now. Fix: none needed" - the reviewer's own words: bounded, no fix needed.
- Skipped #3 (`reviews/pr-198-check-medium.md`): "Unknown-time agent gets atMs = now on every call, so it never ages out of readBackgroundAgents and stays active until a stop file appears." - the slice's design keeps an agent whose time cannot be read at all; it is the rare both-unreadable case and a stop file still drops it.
- Skipped #4 (`reviews/pr-198-check-medium.md`): "For an unknown-time agent liveAgentIds skips the AGENT_LIVE_MS check, so a crashed agent with unreadable files is never pruned." - same design: the both-unreadable case keeps the agent, and a stop file still drops it.
- Skipped #5 (`reviews/pr-198-check-medium.md`): "Test relies on Date.now() and row spacing against keepDays=1; rows near the 24 h boundary can make the thinned count flaky." - the rows are 12 to 37 h old against a 24 h keep, so some are always deleted and the assertion is only "fewer than 300"; there is no boundary race.
- Skipped #6 (`reviews/pr-198-check-medium.md`): "Quiet means 300 ms without a scroll: a wall-clock wait, against the Slice 38 rule; a late re-render scroll" - CLAUDE.md's rule is for loading-delay tests (shared clock helper `e2e/loadingClock.ts`); this test waits for real scroll events to stop.
- Agent age rule, fourth design (pr-198-high #1, pr-198-check-2-medium #1): an agent's last-known time (`agentTime`) is its record's mtime whenever the record can be read, so a meta rewrite after a stop never changes it; whenever the record's stat fails for any reason (ENOENT included) the meta file's mtime (written at SubagentStart) is used, and only if that also fails is the time unknown. Why: a new agent with no record yet is fresh by its meta and not pruned, and a crashed one with no record ages out AGENT_LIVE_MS after its start instead of being kept forever. (Earlier: third design, a missing record was time 0, which pruned a new agent; second design: newest of record and meta mtime.) When unknown, `liveAgentIds` keeps the agent unless a stop file names it (a stop file marks it stopped whatever the time), and `readBackgroundAgents` lists it as written now, `done` when stopped. Both take an injectable `stat` so the tests drive the real null branches.

Follow-ups (check pass 3, `reviews/pr-198-check-3-medium.md`, nits left open):

- #2 (`e2e/scrollQuiet.ts:18`): "`waitForQuietScrolls` uses `performance.now()` and page `setTimeout`; active.spec.ts calls `page.clock.setFixedTime` in `openActive`." Unconfirmed: if the clock fakes those, the wait never resolves.
- #3 (`e2e/scrollQuiet.ts:16`): "A missing `STAMP_START` makes `stamp()` return 0 so the helper resolves at once and the flake returns silently."
- #4 (`plugin/scripts/hooks/background-agents.mjs:107`): "`modifiedAt` exported only for the test and its contract changed from 0 to null."
- #5 (`plugin/scripts/hooks/background-agents.mjs:165`): an agent with no record takes its time from the meta file; this is the fourth design above, recorded here as the decision.

Follow-ups (check pass 2, pr-198-check-2-medium.md):

- #2 (`plugin/scripts/hooks/background-agents.mjs:118`): "A non-ENOENT stat failure on the record (EBUSY, EACCES) falls back to the meta mtime (the start time), so an active agent older than 10 minutes drops out of `readBackgroundAgents` (AGENT_FRESH_MS) while the record is locked. Fix: treat unknown record time as fresh and active; use the meta time only for the 24-hour liveness check."
- #3 (`e2e/scrollQuiet.ts:12`): "`waitForQuietScrolls` measures quiet from the last scroll or page start with no settled-page check; if the board is still rendering, it can resolve after 300 ms and the "before" count is read early, so `toBeGreaterThan(before)` can pass for the wrong reason. Fix: callers await a settled-page signal first."
- #4 (`src/infrastructure/d1Repository.ts:61`): "`CHAIN_ROWS` is exported only for a test; with the SQL cut the `seen` backstop in `findChain` is unreachable and no test covers it. Fix: drop the backstop, or test it with a stubbed SQL."
- #5 (`test/usageTools.test.ts:360`): "Uses real `Date.now()`; the seed spans 12-37 h only while `SAMPLE_MINUTES * 300` >= 25 h. If the constant shrinks, nothing falls past the keep-time. Fix: assert at least one row dropped and one kept, or derive the span from the constant."

#### For CLAUDE.md

- The agent prune rule lives only in `liveAgentIds` (`plugin/scripts/hooks/background-agents.mjs`) used by `runningIds` in
  `session-done.mjs`; a read it cannot make prunes nothing. The agent time is one rule, `agentTime` in the same file
  (record mtime, else the meta file's, else unknown and kept unless a stop file names it); never add a second time
  reading (Slice 49: docs/plan/slices/49-slice-48-follow-ups.md).

#### Not yet verified

- None (hooks and queries covered by tests).
