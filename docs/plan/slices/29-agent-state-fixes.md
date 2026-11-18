### Slice 29 — Session cards keep background agents' state right

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping and order decided by the planning
session of 2026-11-18; every item below was re-checked against `origin/main` (d654e9b) that day.* Wave 1.

*Built (wave 2026-11-18), PR #129.* Claim check against `origin/main` (00c1452): `subagentCard` is at
`session-done.mjs:71-79`, `saveGoal` at `:35-38`, `resumeCard` at `:85-94` (items 5-7 below cite older lines);
`stoppedIds.has` is at `background-agents.mjs:54`, `mergeSteps` at `:76`. No state lock exists in
`plugin/scripts/hooks` yet (only comments), so item 1 adds one. Touches widened with `session-waiting.mjs` (its
`titleOf` sends the goal title, a candidate for the overwrite) and `report-progress.mjs`; Slice 31 also edits
`session-waiting.mjs` (its transcript read), so 29 edits only `titleOf` there.

**Touches:** `plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/background-agents.mjs`,
`plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/hooks/goal-reminder.mjs`,
`plugin/scripts/hooks/session-waiting.mjs`, `plugin/scripts/report-progress.mjs`,
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

#### From review

- Title overwrite (likely, unconfirmed: no payload log). Board history of card `agent-progress-board/session-r7k2` shows
  done with the research goal's note at 08:37:51Z, then in_progress setting the title back to that research goal at
  08:38:10Z. The path that fits is a late report with that title right after `resumeCard` reopened the Stop-closed
  card. No hook sends `title` or `why` on a session card (`resumeCard` did not on `origin/main` either, so the new test
  "a resume after Stop reopens the card with no title or why" passes there too); it pins that no hook ever will. The
  server keeps the title and why the main thread set. The source tag `hook` proves nothing: it is a free label.
- High round (`reviews/pr-129-high.md`, 9 findings): applied #1 3 4 5 6 7 8 and #9 (the step-note part); #2 and the #9 second half are the two quoted entries below; that dead surface was removed later by medium #10. #6 (the lock races) was applied as a lock and then replaced by the lock-free design in the medium round.
- Skipped #2 (`reviews/pr-129-high.md`): "`session-waiting.mjs:26` (`titleOf`), low. Resends `goal.title` from the goal file on every waiting card" - the other open slice (31) edits `titleOf` for its git cwd fix; one owner this wave, so it goes to that slice's fix round. It is a different card key, so not the reported overwrite.
- Skipped #9, second half (`reviews/pr-129-high.md`): "`stopTimes` accepts three input shapes (id, list, `{id: at}`)" - dead surface, low; one test uses the list form. The label-overwrite part is fixed: the session's own note stays. Superseded by medium #10 below: the list and id shapes are now removed.
- Medium round (`reviews/pr-129-medium.md`): the state lock drew findings in two rounds, so it was removed, not patched. Stopped agents are one file per agent in `<id>.stopped/` (written temp-then-rename, a resumed agent deletes only its own, pruning deletes old files one by one); the goal file has no lock and is re-read right before each temp-then-rename write, merging only the hook's own fields. This settles #1 "removeLockOf renames a live lock away; a third process can mkdir in the gap, and the put-back overwrites or deletes locks", #2 "stale check reads owner, then renames later; check and delete are not atomic", #3 "owner-write failure leaves an ownerless lock dir and runs unlocked", #4 "empty owner string matches any dir with a missing owner file", #7 "updateCard decides from a goal read outside the lock, then sends, then patches under the lock" (every patch re-reads the file and writes only its own fields; a decision from a read taken before a 2 s call can still be stale, which the board corrects on the next report), #8 "sleepSync allocates a SharedArrayBuffer every 10 ms poll" (no waiting any more) and #10 "stopTimes accepts three shapes" (one object shape only).
- Medium #5 and #6 applied: a prompt clears a stale `held` whatever the card's state, and `heldAt` is the time the Stop hook's own call returned. #9 applied: `at` never moves backwards.
- Skipped #4 (`reviews/pr-129-check-medium.md`): "`recordCard/updateGoal` is a lock-free read-modify-write; a concurrent saveGoal (closed or held flag) in the few-ms window is overwritten" - the lock-free design was chosen in fix round 2: each write re-reads and merges only its own fields, then renames, so the lost-update window is the microseconds between read and rename, and the board's next report corrects a stale field.
- Skipped #8 (`reviews/pr-129-check-medium.md`): "`mainThreadWorked` uses heldAt + 3 s fixed slack; a late task-notification append counts as main-thread work, releaseHold clears held without closing; card never closes if the notice does not wake the main thread" - a card held open by a task-notification closes on the next Stop, as fix round 1 recorded; no card stays open for good.
- Skipped #9 (`reviews/pr-129-check-medium.md`): "`takeActiveSlot` matches step to agent by exact label only and overwrites the step's note; same-label pending step is overridden, only the first of two same-description agents takes the slot" - item 3 joins agents to steps by label; exact-label matching is that design.
- Check medium round (`reviews/pr-129-check-medium.md`, 9 findings): applied #1 2 3 5 6 7; #4 8 9 are the three quoted entries above. Applied: #1 `held` is written before the Stop call, `heldAt` after it returns; #2 a close that does not happen clears the hold; #3 `RESUME_SLACK_MS` is now 3000 (equal to `HELD_SLACK_MS`), so a late flush keeps the stop file; #5 `readStoppedAgents` removed; #6 the `<id>.stopped/` folder goes with `removeGoal` and with an expired goal; #7 stop-file name is a hash of the full agent id.
- Check 2 (`reviews/pr-129-check-2-medium.md`, 7 findings, converged): #3 applied (see Follow-ups); the rest are Follow-ups below.
- Check 3 (`reviews/pr-129-check-3-medium.md`): no crash, data-loss, security or privacy finding; its three lows are in Follow-ups.

#### Follow-ups

- Follow-up #1 (`reviews/pr-129-check-2-medium.md`): "`<id>.stopped/` folder removed only in readGoal's goalAt-expiry branch and removeGoal; sessions with no goal file (SubagentStop still writes) or whose goal file expired by mtime leak the folder forever." - not crash, data-loss, security or privacy; check passes converged.
- Follow-up #2 (`reviews/pr-129-check-2-medium.md`): "Stop's in-flight in_progress report (up to 2 s) can land after the last SubagentStop's mark_done; card ends open and Stop's patch overwrites `closed`." - same; the board's stale rules close the card.
- Follow-up #4 (`reviews/pr-129-check-2-medium.md`): "stoppedAfterLastWrite treats a write within 3 s after stop as still stopped; an agent resumed in that window is shown done and the card can close under running work." - same.
- Follow-up #5 (`reviews/pr-129-check-2-medium.md`): "takeActiveSlot promotes any pending session step whose label equals the agent label; unrelated planned step shown active and never reverted." - same.
- Follow-up #6 (`reviews/pr-129-check-2-medium.md`): "currentAgents deletes stop files (side effect in a read helper) and `agent.id in stopped` on a plain object matches Object.prototype names; use Map or Object.hasOwn." - same.
- Follow-up #7 (`reviews/pr-129-check-2-medium.md`): "import list `{ existsSync,mkdirSync, ...}` missing a space (style only)." - same.
- Applied #3 (`reviews/pr-129-check-2-medium.md`): `writeJson` retries the rename on EPERM/EBUSY/EACCES (about 100 ms in all), then gives up and removes its temp file.
- Follow-up check 3 #1 (`reviews/pr-129-check-3-medium.md`): "`.stopped` folder is not removed when readFreshJson deletes a stale goal file first, so the folder stays on disk." - low.
- Follow-up check 3 #2 (`reviews/pr-129-check-3-medium.md`): "writeJson's temp file is left behind if the process is killed during the rename retry window." - low.
- Follow-up check 3 #3 (`reviews/pr-129-check-3-medium.md`): "held goal stays in_progress if the last background agent ends with no SubagentStop. The board's 30-minute stale rule closes the card." - low.

#### Not yet verified

- On the owner's machine: one session with two parallel background agents. Both agents' steps show, the card closes after the last stops, and the title stays.

#### For CLAUDE.md

- Plugin hook state needs no lock: one stop file per agent id under `<id>.stopped/`, and goal-file writes re-read and merge only their own fields, then rename (`plugin/scripts/hooks/hook-input.mjs`); never add a read-modify-write of a shared state file. No hook sends title or why on a session card (Slice 29: docs/plan/slices/29-agent-state-fixes.md).
