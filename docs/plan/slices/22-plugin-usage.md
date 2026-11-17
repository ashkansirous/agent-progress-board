### Slice 22 — Token usage and cap readings from the plugin

*In progress (wave 2026-11-17), draft PR.*

*Planned and accepted with Slice 20 (owner, 2026-11-17; decisions in
[Slice 20](20-plugin-connect.md)). Starts after Slice 21.* Moves usage reporting from the owner's config repo
(`skills/report-progress/`: `usage-tick.mjs`, `usage-report.mjs`, `cap-reading.mjs`, `self-report.mjs`, their tests)
into `plugin/scripts/`.

**Touches:** `plugin/scripts/**`, `plugin/hooks/hooks.json`, `plugin/.claude-plugin/plugin.json`, `plugin/skills/agent-board/SKILL.md`, `docs/clients.md`, `docs/setup/connect.md`, `docs/plan/slices/22-plugin-usage.md`

**Migrations:** none

#### Work

- [ ] **Move the usage scripts** and wire `usage-tick` to PostToolUse in `plugin/hooks/hooks.json`, with the
  heartbeat it sends today. A `userConfig` option `report_usage` (boolean, default true, "send token counts and
  plan cap readings to the board") turns it off; `AGENT_BOARD_USAGE=off` still works. The environment label comes
  from an option `environment` (string, optional, e.g. "desktop"). Verify: the moved tests pass in this repo; with
  the option off, no usage call is made (test).
- [ ] **Cap reading is opt-in by what it reads.** It reads Claude Code's own sign-in file to ask the plan's cap
  percentage. The skill and `docs/setup/connect.md` say so in one line, so the person knows before turning it on.
  Verify: the guide text says it.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green.
