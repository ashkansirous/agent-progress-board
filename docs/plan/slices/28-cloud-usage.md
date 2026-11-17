### Slice 28 — Cloud and VM sessions report their usage under their own label

*Built 2026-11-17 (PR #114, not merged). Web page and docs only, no device run; covered by e2e. Not yet verified in a real cloud session.*

*Planned (owner, 2026-11-17: "I added environment last night and set up my build tools so that it uses the claude vm
when possible. but looking at the token usage it says that env not set. whats going on? not implemented yet or missing
from the plan").* Starts after Slice 22 (the plugin's usage part).

**Which "VM" (read from the owner's config repo, 2026-11-17; the owner: "look at the fucking claudeskill project and
see what it is"):** Claude Code cloud sessions. The owner's wave tooling writes a slice's code in a cloud routine
(a fixed worker routine, model Sonnet, the cloud environment named "Default", started through the routines API), then
reviews and merges locally. Two slices used it on 2026-11-17 (one in each repo), and neither cloud run sent a usage
row. The guide below therefore covers routines as well as interactive cloud sessions: what the routine's environment
needs (allowed domain, variables, how the plugin or its hooks load there) and a label such as `cloud`.

**Found, read live at 21:00Z** (`usage_samples` on the live D1, read-only): 4,229 usage rows since 2026-11-16 16:58Z,
every one with no `environment`. They all come from the owner's main machine, which sets no label (no
`AGENT_BOARD_ENV`, no `BOARD_ENV` in its secrets file), and the page shows that as "Not set" (`web/src/strings.ts:108`,
`noValue`). Not one row came from a cloud session or VM. Causes: the reporting hooks live only in the owner's
user-level profile, which cloud sessions do not load (`docs/clients.md`, *Cloud sessions*, *Hooks*); nothing installs
the board's plugin inside a cloud session; the board host must be in that environment's *Allowed domains*; and the
only plan line about it was an untried check in the owner's config repo ("one real cloud session ... `AGENT_BOARD_ENV`
set").

**Touches:** `docs/setup/connect.md`, `docs/setup/cloud.md` (new), `docs/clients.md`, `plugin/scripts/**`, `plugin/skills/agent-board/SKILL.md`, `plugin/.claude-plugin/plugin.json`, `web/src/strings.ts`, `web/src/**`, `e2e/**`, `docs/plan/slices/28-cloud-usage.md`

**Migrations:** none

#### Work

- [x] **Cloud guide for Claude.** `docs/setup/cloud.md`, written for a Claude Code with no context: what to put in a
  Claude Code cloud environment so its sessions report (allowed domain for the board host; `AGENT_BOARD_URL`,
  `AGENT_BOARD_ENV` such as `cloud`; the token in the least-exposed store the docs offer, as *Cloud sessions* in
  `docs/clients.md` says; a setup script or the repo's `.claude/settings.json` that installs the plugin or runs its
  hooks, since user-level settings do not load there). Re-read the current Claude Code cloud-environments docs first
  and write only what they say works; a step only the person can do (the environment dialog) names the page and the
  fields. Verify: the guide names every value and where it goes.
- [x] **Usage from a cloud session.** The plugin's usage scripts find the session records where a cloud session keeps
  them (check in a real cloud session; if there are none, say so in the guide and report steps only). Verify: a
  dry-run test with a cloud-like home folder finds the records; the real check goes to *Not yet verified*.
- [x] **This machine gets a name, not "Not set".** The connect guide asks for an environment name at setup (default:
  the machine's host name, the person may change it) and stores it in the plugin's `environment` option. Rows with no
  environment show "No label (main machine)" with a one-line hint where to set one, instead of "Not set". Verify: e2e
  on a seeded row with no environment shows the new text.

*Changed while building:*

- A cloud session cannot install plugins from settings (Claude Code docs), so `docs/setup/cloud.md` runs the plugin's
  scripts directly: a setup script downloads them at a pinned `<ref>`, and the repo's `.claude/settings.json` sets
  usage hooks guarded on `CLAUDE_CODE_REMOTE`. Usage only, no cards (no session-done, session-waiting or
  goal-reminder hooks are installed).
- The server's merge of unlabelled rows into the busiest named environment (`withBaseEnvironment`, `src/application/usage.ts`,
  existing behaviour) is kept and documented: the guide says to name the main machine first. So "No label (main
  machine)" (`noEnvironment`, with `noEnvironmentHint`, en and de) shows only while no environment on the board is named;
  `noValue` is unchanged for the other splits.
- `connect.md` has a "Name this machine" step (default: host name, cut to 40, stored and shown on the usage page).
  Review fix pass 1 changed the default to "desktop" (high #9); that was reverted to the slice's host-name default.
- Also built: `clients.md` *Cloud sessions* points to `cloud.md`; `plugin.json` `environment` description; a
  `usage-tick` cloud-home dry-run test; an e2e test for the no-label series.
- Checks: lint, typecheck, `npm test` 478, plugin tests 278, e2e 259 passed 3 skipped.

*From review:*

- Findings 1-9 of `reviews/pr-114-high.md` applied; findings 2, 3 and 6 of `reviews/pr-114-medium.md` applied.
- Skipped #10 (`reviews/pr-114-high.md`): "German rendering is untested" - low; the e2e harness has no German locale, and the server merge it would test is main's existing behaviour outside Touches.
- Skipped #1 (`reviews/pr-114-medium.md`): "failed download silently cached" - low; the guide already states the silent failure and how to force a rebuild.
- Skipped #4 (`reviews/pr-114-medium.md`): "hint note sits between chart and table" - low, no failure path.
- Skipped #5 (`reviews/pr-114-medium.md`): "test mutates process.env HOME/USERPROFILE/CLAUDE_CONFIG_DIR globally" - low; node --test runs each test file in its own process and the test restores the values.
- Check pass (`reviews/pr-114-check-medium.md`, 6 findings read, converged, no blockers); its 6 findings are follow-ups, not fixed here:
  - #1 `web/src/TokenChart.tsx:278`: the hint shows only while no environment is named.
  - #2 `docs/setup/cloud.md:5`: guide does not mention `usage.baseEnvironment` (`src/config.ts:226`).
  - #3 `web/src/usageView.tsx:43`: `??` to `||` changes empty-label handling for agent/model splits.
  - #4 `plugin/.claude-plugin/plugin.json:33`: long `environment` description may be truncated in a menu.
  - #5 `plugin/scripts/usage-tick.test.mjs:388`: test mutates process-wide HOME/USERPROFILE.
  - #6 `docs/setup/cloud.md:56`: `|| true` may leave a partial script cached; no `node --check` step.

#### For CLAUDE.md

- Unlabelled usage rows are folded into the busiest named environment at read (`withBaseEnvironment` in
  `src/application/usage.ts`, pinned by `usage.baseEnvironment`); a machine must be named before any other environment
  is, and the "No label (main machine)" string shows only while none is named (Slice 28: docs/plan/slices/28-cloud-usage.md).
- Cloud sessions load no plugin; `docs/setup/cloud.md` runs the plugin's usage scripts from a pinned download, so a
  change to those script paths or imports must be mirrored there (Slice 28: docs/plan/slices/28-cloud-usage.md).

#### Not yet verified

- A real cloud session's usage shows on the usage page under its own label.
- The owner's main machine shows its new label after the plugin switch (config repo Slice 20; plan-not-needed: 20).
- The cloud records path `/root/.claude` is untried in a real cloud session.
- The setup-time variables (unset during the setup script) are untried.
- The Stop hook's detached send (`usage-tick` spawns a background run) is untried in a cloud VM.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` green.
