### Slice 49 — Follow-ups left open by Slice 48

*In progress (wave 2026-11-25), draft PR.*

**Status:** planned (starter session 2026-11-19, the owner's standing "build all", no review round; the possible
data-loss item first). Planned 2026-11-19 by the feedback loop of night
2026-11-19-0734 ([note](../notes/2026-11-19-0734-feedback-loop.md), pass 1). Slice 48's last check pass returned four
nits that its *From review* calls "follow-ups", but no slice or *Outstanding work* line held them once Slice 48 was
built. The loop plans; it does not build.

**Touches:** plugin/scripts/hooks/background-agents.mjs, plugin/scripts/hooks/*.test.mjs,
src/infrastructure/d1Repository.ts, test/partsTools.test.ts, e2e/projects.spec.ts, e2e/active.spec.ts.

**Source:** `reviews/pr-184-check-3-medium.md` under the repo's worktrees folder (findings 1-4) and Slice 48's
[From review](48-slice-47-follow-ups.md); the review file wins where this list differs.

#### Work

- [ ] 1. **A failed `statSync` counts a live agent as quiet since 1970** (check-3 #3,
  `plugin/scripts/hooks/background-agents.mjs:188`). `liveAgentIds` reads `modifiedAt` 0 on a stat error, so a running
  agent started over 24 h ago can be pruned from `agentParents` and `agentStarts` on one transient error. This is the
  same class as check-2 #1, which Slice 48 fixed as data loss (a read it cannot make prunes nothing). Treat a stat
  failure as unknown: keep the agent. Verify with a hook test where `statSync` throws for one agent file.
- [ ] 2. **`findChain` uses `UNION ALL`** (check-3 #4, `src/infrastructure/d1Repository.ts:63`): a dangling parent or a
  stored loop reads up to `limit` rows on every report with a parent (also pr-184-high #9, skipped as a cost). Use
  `UNION` or carry visited keys; verify in `test/partsTools.test.ts` that a stored loop returns each key once from SQL.
- [ ] 3. **The `#/` then `#/needs-you` e2e test can flake** (check-3 #1, `e2e/projects.spec.ts:110`): wait for an
  observable `#/` state before going back.
- [ ] 4. **The A, B, A scroll test reads only the last scrolled title** (check-3 #2, `e2e/active.spec.ts:275`): assert a
  per-scroll counter rose after each visit.

#### Not yet verified

- None yet (not built).
