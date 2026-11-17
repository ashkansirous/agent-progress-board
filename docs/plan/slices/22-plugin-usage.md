### Slice 22 — Token usage and cap readings from the plugin

*Built (wave 2026-11-17), PR #104, not yet verified in a real Claude Code session (see *Not yet verified*).*

*Planned and accepted with Slice 20 (owner, 2026-11-17; decisions in
[Slice 20](20-plugin-connect.md)). Starts after Slice 21.* Moves usage reporting from the owner's config repo
(`skills/report-progress/`: `usage-tick.mjs`, `usage-report.mjs`, `cap-reading.mjs`, `self-report.mjs`, their tests)
into `plugin/scripts/`.

**Touches:** `plugin/scripts/**`, `plugin/hooks/hooks.json`, `plugin/.claude-plugin/plugin.json`, `plugin/skills/agent-board/SKILL.md`, `docs/clients.md`, `docs/setup/connect.md`, `test/pluginRules.test.ts` (its option-list expectation), `docs/plan/slices/22-plugin-usage.md`

**Migrations:** none

#### Work

- [x] **Move the usage scripts** and wire `usage-tick` to PostToolUse in `plugin/hooks/hooks.json`, with the
  heartbeat it sends today. A `userConfig` option `report_usage` (boolean, default true, "send token counts and
  plan cap readings to the board") turns it off; `AGENT_BOARD_USAGE=off` still works. The environment label comes
  from an option `environment` (string, optional, e.g. "desktop"). Verify: the moved tests pass in this repo; with
  the option off, no usage call is made (test).
- [x] **Cap reading is opt-in by what it reads.** It reads Claude Code's own sign-in file to ask the plan's cap
  percentage. The skill and `docs/setup/connect.md` say so in one line, so the person knows before turning it on.
  Verify: the guide text says it.

#### Decisions (builder, accepted by the coordinator 2026-11-17)

1. `self-report.mjs` is not moved: Slice 21's session cards come from the session's own MCP reports, and a second
   card path would duplicate them.
2. The usage tick's session-item code (a card for a session with no task) is not moved, for the same reason. Token
   reports, the task heartbeat and the cap reading are moved.
3. Token reports use the session card key stored in the goal file (`goal.key`) as `task_key`, so usage joins the
   plugin's card; with none stored they fall back to `<project>/session-<session id>`. A task file still wins.
4. `report_usage` = false (or `AGENT_BOARD_USAGE=off`) stops only token reports and the cap reading. The task
   heartbeat still goes, because the option text covers only token counts and cap readings; the hook still starts
   the run and the run sends heartbeats only (review #3, `reviews/pr-104-high.md`).
5. The Claude folder is `AGENT_BOARD_CLAUDE_DIR`, else Claude Code's `CLAUDE_CONFIG_DIR`, else `~/.claude`; record
   files are read in 1 MB chunks with the lock refreshed between them (review #1, #2).

6. The cap reading has its own option, `read_plan_cap` (boolean, default false), separate from `report_usage`. The
   slice says "Cap reading is opt-in by what it reads" and that the person reads the line "before turning it on", so
   it is off until the person turns it on; it runs only when both options are on. Token counts stay under
   `report_usage` (review #4, `reviews/pr-104-medium.md`).
7. A forced run (Stop, SubagentStop) that finds the lock held asks for it up to 4 times, 1 s apart, then gives up
   quietly; a stale lock is deleted and a fresh one created in the same call (review #1, #2,
   `reviews/pr-104-medium.md`).

*Changed while building:* the plugin hooks run `usage-tick` on PostToolUse (5-minute gate), Stop and SubagentStop
(forced); state lives in `CLAUDE_PLUGIN_DATA/state`. Options are `report_usage` (default true), `read_plan_cap`
(default false, needs `report_usage` on) and `environment` (optional label); `AGENT_BOARD_USAGE=off` still works.
With usage off the run still sends the task heartbeat and advances the scan state, so re-enabling sends no backlog
(review check-medium #1). `test/pluginRules.test.ts` was widened (in *Touches*) to the options list and env names.

*From review:* applied `reviews/pr-104-high.md` 1, 2, 3; `reviews/pr-104-medium.md` 1, 2, 4, 5, 6, 7, 8;
`reviews/pr-104-check-medium.md` 1, 2, 5. `reviews/pr-104-check-2-medium.md` converged: all six findings go to
follow-ups, none applied:

- Skipped #1 (`reviews/pr-104-check-2-medium.md`): "saves plan and retryAfter 0 before the board accepts the reading" - follow-up (repeat of check-medium #4).
- Skipped #2 (`reviews/pr-104-check-2-medium.md`): "A non-lock error from runLocked" skips the cap reading - follow-up (repeat of check-medium #3).
- Skipped #3 (`reviews/pr-104-check-2-medium.md`): "name plan name and reset times in the consent text" - follow-up.
- Skipped #4 (`reviews/pr-104-check-2-medium.md`): "shared scan helper, check saveState" - follow-up.
- Skipped #5 (`reviews/pr-104-check-2-medium.md`): "one shared parser accepting false words" - follow-up (repeat of check-medium #5).
- Skipped #6 (`reviews/pr-104-check-2-medium.md`): "spawns a Node process on every PostToolUse" - follow-up.

- Skipped #3 (`reviews/pr-104-medium.md`): "A node process spawns on every PostToolUse and loads all heavy modules to read a gate that is usually closed" - low, not applied this round (coordinator's triage).

- Skipped #3 (`reviews/pr-104-check-medium.md`): "A non-lock error thrown by runLocked skips runCapReading" - low, not applied this round (coordinator's triage).
- Skipped #4 (`reviews/pr-104-check-medium.md`): "Cap state saves plan and retryAfter 0 before the board accepts the reading" - low, not applied this round (coordinator's triage).
- Skipped #4 (`reviews/pr-104-high.md`): "the last turn's tokens wait up to 5 minutes" - low, not applied this round (coordinator's triage).
- Skipped #5 (`reviews/pr-104-high.md`): "Consider checking the off switch and gate before the heavy imports" - low, not applied this round (coordinator's triage).
- Skipped #6 (`reviews/pr-104-high.md`): "Cache per session id" - low, not applied this round (coordinator's triage).
- Skipped #7 (`reviews/pr-104-high.md`): "Re-read just before saving" - low, the run holds the lock; not applied (coordinator's triage).
- Skipped #8 (`reviews/pr-104-high.md`): "use separate option fields so it is enforced" - safe today; not applied (coordinator's triage).

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.

#### For CLAUDE.md

- Plugin usage options: `report_usage` (default true, token counts), `read_plan_cap` (default false; reads Claude
  Code's sign-in file for the plan cap, needs `report_usage` on) and `environment`. The cap reading stays opt-in.
  The usage scripts in `plugin/scripts` keep state only in `CLAUDE_PLUGIN_DATA` (Slice 22:
  docs/plan/slices/22-plugin-usage.md).

#### Not yet verified

- In a real Claude Code session with the plugin installed, tokens reach the board and join the session card.
- With `report_usage` off no usage call goes out and the card stays live.
- With `read_plan_cap` on a cap reading arrives.
