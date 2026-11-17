### Slice 28 — Cloud and VM sessions report their usage under their own label

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

**Touches:** `docs/setup/connect.md`, `docs/setup/cloud.md` (new), `docs/clients.md`, `plugin/scripts/**`, `plugin/skills/agent-board/SKILL.md`, `web/src/strings.ts`, `web/src/**`, `e2e/**`, `docs/plan/slices/28-cloud-usage.md`

**Migrations:** none

#### Work

- [ ] **Cloud guide for Claude.** `docs/setup/cloud.md`, written for a Claude Code with no context: what to put in a
  Claude Code cloud environment so its sessions report (allowed domain for the board host; `AGENT_BOARD_URL`,
  `AGENT_BOARD_ENV` such as `cloud`; the token in the least-exposed store the docs offer, as *Cloud sessions* in
  `docs/clients.md` says; a setup script or the repo's `.claude/settings.json` that installs the plugin or runs its
  hooks, since user-level settings do not load there). Re-read the current Claude Code cloud-environments docs first
  and write only what they say works; a step only the person can do (the environment dialog) names the page and the
  fields. Verify: the guide names every value and where it goes.
- [ ] **Usage from a cloud session.** The plugin's usage scripts find the session records where a cloud session keeps
  them (check in a real cloud session; if there are none, say so in the guide and report steps only). Verify: a
  dry-run test with a cloud-like home folder finds the records; the real check goes to *Not yet verified*.
- [ ] **This machine gets a name, not "Not set".** The connect guide asks for an environment name at setup (default:
  the machine's host name, the person may change it) and stores it in the plugin's `environment` option. Rows with no
  environment show "No label (main machine)" with a one-line hint where to set one, instead of "Not set". Verify: e2e
  on a seeded row with no environment shows the new text.

#### Not yet verified

- A real cloud session's usage shows on the usage page under its own label.
- The owner's main machine shows its new label after the plugin switch (config repo Slice 20).

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` green.
