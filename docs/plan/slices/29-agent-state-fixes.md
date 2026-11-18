### Slice 29 — Session cards keep background agents' state right

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping and order decided by the planning
session of 2026-11-18; every item below was re-checked against `origin/main` (d654e9b) that day.* Wave 1.

**Touches:** `plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/background-agents.mjs`,
`plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/hooks/goal-reminder.mjs`,
`plugin/scripts/hooks/hooks.test.mjs`, `docs/plan/slices/29-agent-state-fixes.md`

**Migrations:** none

#### Why

Slice 21's check pass 2 (`reviews/pr-101-check-2-medium.md`) found six medium bugs where the plugin's hooks lose or
corrupt background-agent state on the session card. None has been fixed since. A new one showed up on 2026-11-18: at
08:38:10Z a report with source `hook` replaced a session card's title and `why` with a different goal ("Research
existing tools similar to the agent progress board") while that session was planning follow-ups. The board holds it
as bug card `agent-progress-board/bug-hook-title-overwrite-2026-11-18`.

#### Decisions

- Every script still fails open (exit 0, short timeout) and keeps state only in `CLAUDE_PLUGIN_DATA` (root
  `CLAUDE.md`, *Plugin scripts*).
- The one-active-step rule (`src/domain/steps.ts:33`, Slice 21 item 11) stays. It is a product choice, not a bug.

#### Work

- [ ] **Find the title overwrite first** (new, 2026-11-18). Find which hook sends `title`/`why` on a card it did not
  create, or which hook reads another session's prompt. Likely `goal-reminder.mjs` or `session-done.mjs`. Not
  confirmed. Fix it, and add a test: two sessions' goal files, and one session's hook never writes the other's card.
- [ ] 1 (medium): `addStoppedAgent` (`hook-input.mjs:133-137`) reads and then writes without a lock. Parallel
  SubagentStop hooks lose a stopped id. Take the same lock the other state writes use.
- [ ] 2 (medium): `background-agents.mjs:53`. The `stoppedIds.has(agent.id)` clause skips the `AGENT_FRESH_MS`
  freshness filter.
- [ ] 3 (medium): `mergeSteps` (`background-agents.mjs:80-90`) demotes an active step to pending, then the
  known-labels filter drops the agent with the same label.
- [ ] 4 (medium): a resumed agent is forced to done. `session-done.mjs:143` only adds stopped ids and never removes
  one when the agent resumes.
- [ ] 5 (medium): `saveGoal` (`session-done.mjs:33-36`) writes `readGoal() || goal`, which brings back a goal file
  that was removed. `resumeCard` sends an empty `needsYou`, which wipes a question asked during its 2 s call.
- [ ] 6 (medium): `subagentCard` (`session-done.mjs:117-121`) sends a plain `in_progress` with every step done after
  Stop has left the card open, and nothing ever closes that card. Close it when the last background agent stops and
  the turn has ended.
- [ ] 7 (low): the `resumeCard` patch (about `session-done.mjs:108`) does not reset `sig`.
- [ ] 8 (low): the exit code is set in `.finally` (`goal-reminder.mjs:117-121`). The other half of the finding (a
  sync throw outside the try) no longer applies, because `closeAnsweredWaiting` is async.
- [ ] 9 (low): every SubagentStop does one extra read and write (`session-done.mjs:143`). Its growth is already
  bounded by `readFreshJson` max age (`hook-input.mjs:78-88`).
- [ ] 10 (low): add tests to `hooks.test.mjs` for: concurrent `addStoppedAgent`, old stopped ids, a resumed agent,
  a report during `saveGoal`, and the active slot after the `mergeSteps` dedupe.

#### Verification

- `npm test` (includes `node --test plugin/**/*.test.mjs`), with one new test per item 1-6 and the overwrite test.
  Each new test fails on `origin/main` and passes after the fix.
- On the owner's machine: one session with two parallel background agents. The card shows both agents' steps, closes
  after the last one stops, and keeps its own title.
