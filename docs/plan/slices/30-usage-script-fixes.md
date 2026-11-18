### Slice 30 — The plugin's usage and cap scripts: review leftovers

*Planned 2026-11-18 (owner: "double check and plan the follow up work"). Grouping decided by the planning session of
2026-11-18; items re-checked against `origin/main` (d654e9b).* Wave 1.

*In progress (wave 2026-11-18), draft PR.*

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

- [ ] Slice 22 c2 #1 / check #4: `readFromAddress` (`cap-reading.mjs:190-192`) saves `retryAfter: 0` and the plan
  before the board has accepted the reading, though the comment says otherwise. Save them only after `markSent`
  (`:224`).
- [ ] Slice 22 c2 #2 / check #3: `runLocked` in `runTick` (`usage-tick.mjs:574-575`) is not inside a try, so an
  error that isn't about the lock skips `runCapReading`.
- [ ] Slice 22 c2 #4: the scan is written twice, in `runHeartbeatsOnly` (`usage-tick.mjs:515-526`) and `runLocked`
  (`:532-545`). Make it one function, and check the `saveState` result at `:524`.
- [ ] Slice 22 c2 #6 / med #3 / high #5: PostToolUse starts a Node process on every tool call
  (`plugin/hooks/hooks.json`), and `requestTick` (`usage-tick.mjs:106`) runs only after every import. Use lazy
  imports so a call that doesn't tick returns at once, and report the time per call before and after.
- [ ] Slice 22 high #6, #7, #8 (low; the review recorded no work): look at them while in the file. Fix one only if
  it is a one-line change, otherwise note it in this file.
- [ ] Slice 28 #5: `usage-tick.test.mjs:388-400` changes the process's `HOME`, `USERPROFILE` and
  `CLAUDE_CONFIG_DIR`. Pass a temp env to the child instead.
- [ ] Slice 28 #2: `docs/setup/cloud.md:5-8` explains the base environment in words but never names
  `usage.baseEnvironment`. Name it.
- [ ] Slice 28 #6: `docs/setup/cloud.md:69` keeps `|| true`, and the script has no check that the five downloaded
  files exist (the prose near `:74` says to check them). Add a `node --check` or exists step that prints what is
  missing and still exits 0.

#### Verification

- `npm test`, with new tests in `cap-reading.test.mjs` (plan state not saved when the board refuses) and
  `usage-tick.test.mjs` (a non-lock error still runs the cap reading; no change to the process env).
- PostToolUse time per call measured before and after, both numbers written into this file.
