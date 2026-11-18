### Slice 30 — The plugin's usage and cap scripts: review leftovers

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 1.

*Built (wave 2026-11-18), merged as PR #130 (c3f0448).*

**Touches:** `plugin/scripts/cap-reading.mjs`, `plugin/scripts/cap-reading.test.mjs`, `plugin/scripts/usage-tick.mjs`,
`plugin/scripts/usage-tick.test.mjs`, `plugin/hooks/hooks.json`, `docs/setup/cloud.md`,
`docs/plan/slices/30-usage-script-fixes.md`

**Migrations:** none

#### Why

These are the open review findings of Slice 22 (`docs/plan/slices/22-plugin-usage.md`, *From review*) and the
plugin-side and cloud-guide findings of Slice 28 (`docs/plan/slices/28-cloud-usage.md`, *From review*). Already fixed
or gone, so not planned: the shared option parser (`optionIsOn`, `plugin/scripts/report-progress.mjs:93-97`), and
high #4 (Stop and SubagentStop now run `usage-tick --force`). The consent text (Slice 22 check 2 #3) is in
Slice 32, which owns `plugin.json` and `SKILL.md`.

#### Decisions

- The cap reading stays opt-in (root `CLAUDE.md`, *Plugin usage options*). State lives only in `CLAUDE_PLUGIN_DATA`.
- Cloud sessions run these scripts from a pinned download. Any change to script paths or imports is mirrored in
  `docs/setup/cloud.md` (root `CLAUDE.md`, Slice 28 rule).

#### Work

- [x] Slice 22 c2 #1 / check #4: `readFromAddress` (`cap-reading.mjs:190-192`) saves `retryAfter: 0` and the plan
  before the board has accepted the reading, though the comment says otherwise. Save them only after `markSent`
  (`:224`).
- [x] Slice 22 c2 #2 / check #3: `runLocked` in `runTick` (`usage-tick.mjs:574-575`) is not inside a try, so an
  error that isn't about the lock skips `runCapReading`.
- [x] Slice 22 c2 #4: the scan is written twice, in `runHeartbeatsOnly` (`usage-tick.mjs:515-526`) and `runLocked`
  (`:532-545`). Make it one function, and check the `saveState` result at `:524`.
- [x] Slice 22 c2 #6 / med #3 / high #5: PostToolUse starts a Node process on every tool call
  (`plugin/hooks/hooks.json`), and `requestTick` (`usage-tick.mjs:106`) runs only after every import. Use lazy
  imports so a call that doesn't tick returns at once, and report the time per call before and after.
- [x] Slice 22 high #6, #7, #8 (low; the review recorded no work): look at them while in the file. Fix one only if
  it is a one-line change, otherwise note it in this file.
- [x] Slice 28 #5: `usage-tick.test.mjs:388-400` changes the process's `HOME`, `USERPROFILE` and
  `CLAUDE_CONFIG_DIR`. Pass a temp env to the child instead.
- [x] Slice 28 #2: `docs/setup/cloud.md:5-8` explains the base environment in words but never names
  `usage.baseEnvironment`. Name it.
- [x] Slice 28 #6: `docs/setup/cloud.md:69` keeps `|| true`, and the script has no check that the five downloaded
  files exist (the prose near `:74` says to check them). Add a `node --check` or exists step that prints what is
  missing and still exits 0.

#### Verification

- `npm test`, with new tests in `cap-reading.test.mjs` (plan state not saved when the board refuses) and
  `usage-tick.test.mjs` (a non-lock error still runs the cap reading; no change to the process env).
- PostToolUse time per call measured before and after, both numbers written into this file.

#### Built (2026-11-18)

- PostToolUse call that does not tick (gate closed), wall time of `node usage-tick.mjs` on this Windows machine, median
  of 30 runs, three rounds each (a bare `node -e 0` was 53 to 68 ms in the same rounds): before 74.7, 75.4, 73.1 ms;
  after 70.7, 66.1, 70.3 ms. About 5 ms less per call (the cap, hook-input and usage-report modules are no longer
  loaded; `report-progress.mjs` still is, because `stateRoot` lives there). Node's own start-up is most of the time, so
  the hook cannot go much lower than this without dropping the Node process.
- The lazy load is a top-level `await import` that is skipped only for a direct call without `--run`
  (the hook call); the five downloaded cloud files are unchanged, so `docs/setup/cloud.md` needed no path change.
- Slice 22 high #6 (cache per session id), #7 (re-read before saving) and #8 (separate option fields): none is a
  one-line change and none is a fault today (the run holds the lock; the options are checked by the same parser),
  so they stay as the review recorded them, unchanged.
- A non-lock error in `runLocked` now returns `{ skipped: 'error' }` and one stderr line, and the cap reading still runs.
- `cloud.md`: the setup script now runs `node --check` on each of the five files and prints which is missing, then
  still exits 0.

#### From review

- Skipped #5 (`reviews/pr-130-high.md`): "plugin/scripts/usage-tick.mjs:47, low: the lazy import (seven `let` bindings and a" - the saving (about 5 ms per call) is measured and written above; a module-load test would pin an implementation detail with no fault behind it.
- Skipped #1 (`reviews/pr-130-medium.md`): "markRefused runs on any failed board call (network error, 5xx), not only refusals" - the 60 s gap after any failed send, network or 5xx included, only limits calls to the usage address; calling it on every tick while the board is down is the fault high #3 removed.
- Skipped #3 (`reviews/pr-130-medium.md`): "isInvokedDirectly() runs twice (line 47 and 629), two realpathSync each, on the hook hot path" - low; the lazy-load cost is measured above, and a second argv check costs microseconds.
- Skipped #7 (`reviews/pr-130-medium.md`): "docs/plan/slices/30-usage-script-fixes.md:6, low: header still says" - the status line is set when the slice is recorded, and the 5 ms figure is the measured median, written as such, not a claim of a fault.
- Skipped #4 (`reviews/pr-130-check-medium.md`): "docs/setup/cloud.md:73, low, syntax check silently skipped when `node` is absent" - a cloud box without node cannot run any of the five scripts the loop downloads, so a missing node is already the visible failure.
- Plan guard (changed while fixing review): one pure function `planSince` in `plugin/scripts/cap-reading.mjs` with state `planSeen {plan, since}`; a status-line file is sent only when written at or after `since`; `markSent` no longer writes the plan. Applied from `reviews/pr-130-high.md` (#1 2 3 4 6 7), `reviews/pr-130-medium.md` (#2 4 5 6) and `reviews/pr-130-check-medium.md` (#1 2 3 5, as one design).
- Checks on the final tree: lint, typecheck, `npm test` (488 unit, 284 plugin) green. No device run: plugin background scripts only, no UI.

#### Follow-ups (from `reviews/pr-130-check-2-medium.md`, converged; none is a crash, data-loss, security or privacy fault in practice, so none was fixed in this slice)

- #1 (`cap-reading.mjs:224`): "guard uses first-seen time as plan start; fresh install/upgrade/wiped state rejects a valid status-line file written earlier under the same plan".
- #2 (`cap-reading.mjs:189`): "planSince keeps a saved future `since` (clock skew); fix Math.min(saved.since, now)".
- #3 (`cap-reading.mjs:224`): "takenAt >= since proves only write time, not plan; long session rewriting cached old-plan percentages after switch passes the guard".
- #4 (`usage-tick.mjs:56`): "failed import rethrows from top-level await outside direct entry; an importer (partial download) dies with unhandled rejection". Its "crash" label does not hold today: no production importer of `usage-tick.mjs` (grep of `plugin/` and `docs/setup/cloud.md` finds none).
- #5 (`usage-tick.mjs:47`): "--run background path logs only error.name to stdio ignore; failed import leaves no findable record".
- #6 (`cap-reading.mjs:205`): "readCapState parsed up to five times per firing; read once and pass down".
- #7 (`cap-reading.mjs:245`): "dead state.plan field stays in old state files next to planSeen; drop on write".

#### For CLAUDE.md (lifted 2026-11-18)

- `planSince` in `plugin/scripts/cap-reading.mjs` is the one plan-guard rule: a status-line file is sent only when it was written after the plan was first seen. Never guard on the board's last accepted plan (Slice 30: docs/plan/slices/30-usage-script-fixes.md).

#### Not yet verified

- A real session on the owner's machine sends cap readings after a plan switch with the address unusable.
- The `docs/setup/cloud.md` setup loop on a real cloud box.
