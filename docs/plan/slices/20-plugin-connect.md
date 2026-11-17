### Slice 20 — A Claude Code plugin and a setup guide: any Claude Code connects itself to a board

*Built (wave 2026-11-17), PR #99, not merged.*

*Planned and accepted (owner, 2026-11-17, "/RefineScope this is a board. it is generic and is supposed to be plug and
play and usabel by the ai agents ... a client tells its claude code to install it and on board it self ... If they
need a skill or sub agent to use, write a skill and ask them to install it ... if we improve our innstructions,
clients can be updating themselves easyly"; answered "agree with all the suggestions" to the four recommendations
below).*

**Touches:** `.claude-plugin/marketplace.json`, `plugin/**`, `docs/setup/connect.md` (new), `README.md`, `docs/clients.md`, `src/mcp/instructions.ts`, `test/pluginRules.test.ts`, `package.json`, `docs/plan/slices/20-plugin-connect.md`

**Migrations:** none

#### Decisions (owner, 2026-11-17)

1. **For whom:** anyone, in two guides: setting up your own board on your own Cloudflare account (Slice 24), and
   connecting a Claude Code to a board that exists (this slice). The owner's board is one install with no special
   case in code or docs.
2. **How it installs and updates:** this repo is a Claude Code plugin marketplace with one plugin. A person tells
   their Claude Code one sentence from the README; Claude follows `docs/setup/connect.md`. New versions reach
   clients through Claude Code's plugin update.
3. **What moves here:** every piece that talks to the board, now in the owner's config repo
   (`skills/report-progress/`): reporter CLI, session hooks, usage and cap reporting, the "waiting for you" rules,
   plan documents sync (optional). Slices 21 to 23 move them; the owner's repo then installs the plugin like any
   client and deletes its copy (its own slice, in that repo).
4. **AIs other than Claude Code:** the rules the server sends on connect (Slice 18, `src/mcp/instructions.ts`)
   are all they need; the pasted chat instruction stays only as a fallback.

Facts read 2026-11-17 from code.claude.com/docs/en/ (plugin-marketplaces, plugins-reference, discover-plugins,
plugins/loading, plugins/host-marketplace, mcp): marketplace file `.claude-plugin/marketplace.json` at the repo root,
plugin source a relative `./plugin` path; plugin manifest `plugin/.claude-plugin/plugin.json`; `userConfig` options
with `sensitive: true` go to the system's secure store, others to `pluginConfigs` in settings; `.mcp.json` takes
`${user_config.KEY}` in `url` and `headers`; hooks get `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and
`CLAUDE_PLUGIN_OPTION_<KEY>`; with no `version` in the manifest or the marketplace entry, every commit is a new
version; auto-update is off for third-party marketplaces until the person turns it on. Re-check these through
context7 or the docs before building (the version rule and `userConfig` above all).

#### Work

**Every install test runs in a throwaway Claude config folder** (`CLAUDE_CONFIG_DIR` set to a temp folder inside the
worktree), never the owner's own profile: the owner's machine already reports through the config repo's hooks, and a
second install there would report every session twice until that repo's Slice 20 removes its copy (start-of-run
decision, 2026-11-17). If the CLI cannot be pointed at a temp folder, the install checks go to *Not yet verified*.

- [x] **Marketplace and plugin.** `.claude-plugin/marketplace.json` (marketplace name unlikely to clash, e.g.
  `agent-progress-board`) lists one plugin `agent-board` from `./plugin`. `plugin/.claude-plugin/plugin.json`: name,
  description, no `version` (every commit ships), `userConfig` `board_url` (string, required, "https address of
  your board, ending before /mcp") and `board_token` (string, sensitive, required, "the board's write token").
  `plugin/.mcp.json` adds the board as an HTTP MCP server at `${user_config.board_url}/mcp` with
  `Authorization: Bearer ${user_config.board_token}`. Verify: `claude plugin validate .` passes; installing from a
  local path with test values lists the board's tools in `claude mcp list` (local dev Worker, `npm run dev`).
- [ ] **The skill.** `plugin/skills/agent-board/SKILL.md`: when to report and how (the session card at the start,
  steps kept current, heartbeat, background agents, `needs_you`, `mark_done` only when all work is done, keys,
  projects, what never to send: private data, guessed numbers). Its rules section is the same text as
  `src/mcp/instructions.ts`, held equal by `test/pluginRules.test.ts`, so the two never drift. Verify: the test
  fails when one side changes alone. Not met: the test asserts equality only, no mutation case (see *Not yet
  verified*).
- [ ] **Connect guide for Claude** (written; its Verify, a fresh Claude Code run, is in *Not yet verified*). `docs/setup/connect.md`, written for a Claude Code with no context: check
  Claude Code's version; `claude plugin marketplace add <owner>/<repo>`; `claude plugin install
  agent-board@<marketplace>`; ask the person for the board address and token and where they come from (their
  board's secrets store, or whoever runs the board), never guessing; the person enters them in `/plugin`,
  Installed, agent-board, Configure options (or the install prompt; check which works non-interactively and write
  only that); turn on auto-update for this marketplace (`/plugin`, Marketplaces) or say how to update by hand
  (`claude plugin marketplace update`, `claude plugin update agent-board@<marketplace>`); `/reload-plugins`; then a
  test: open a session card, read it back with `get_item`, `mark_done` it, and tell the person it worked. Also how
  to add the board to claude.ai (OAuth connector, `docs/clients.md`). Verify: a fresh Claude Code given only the
  README sentence, on a machine with no board setup (a clean profile), ends with a working test card.
- [x] **README.** Top section "Use it": one sentence to give your Claude Code ("Install and set up the agent board
  plugin from https://github.com/<owner>/<repo>, following docs/setup/connect.md"), and a link to Slice 24's
  own-board guide. The *Develop* section stays below. Fix the stale "Status: building (Slice 1...)" line.
- [x] **Client guide.** `docs/clients.md` *Setup for an AI agent* points to the plugin and `docs/setup/connect.md`
  first; the raw MCP and HTTPS sections stay for other clients.
- [ ] **Rule text** for the index pass (`CLAUDE.md`): replace "Clients live in the repos that use them, not here"
  with: clients for Claude Code live in `plugin/`; the rules text exists once, in `src/mcp/instructions.ts`, mirrored
  by the skill and held equal by `test/pluginRules.test.ts`; `plugin/` holds no owner data (public repo).

#### Not yet verified

- A fresh Claude Code on another machine, given only the README sentence, connects and shows a card.
- Auto-update delivers a change to an installed client after a merge.
- Install from the GitHub marketplace source (`claude plugin marketplace add <owner>/<repo>`) with the plugin
  merged on `main`: tested here only from a local path in a throwaway `CLAUDE_CONFIG_DIR` (install, `--config`,
  `configure --values-stdin`, `claude mcp list` showed Connected against the local dev Worker).
- The test card steps of `docs/setup/connect.md` (`report_progress`, `get_item`, `mark_done`) run by a Claude
  Code session, and the skill loading in a session (only the MCP connection was checked here).
- The skill's "test fails when one side changes alone" check: `test/pluginRules.test.ts` asserts equality only; a
  mutation case (change one side, see the test fail) was not run.
- The stdin-from-a-file form of `claude plugin configure --values-stdin` in `docs/setup/connect.md` step 4 was not
  run (only the pipe form was, in a throwaway config folder).
- Rule text for `CLAUDE.md` is left to the index pass (not edited in this slice).

#### From review:

- Skipped #4 (`reviews/pr-99-high.md`): "No check that marketplace.json, plugin.json and connect.md agree on marketplace name, plugin name and source path." Low; a rename is an edit of all three files at once, not worth a cross-file test now.
- Skipped #8 (`reviews/pr-99-high.md`): "Without a version, the install cache keys on commit, so every commit to main re-installs the plugin" That is the decision: the Work item says "no `version` (every commit ships)", so clients get every change.
- Skipped #2 (`reviews/pr-99-medium.md`): "board_url not validated; http:// sends bearer token in cleartext, trailing slash gives //mcp." Same as pr-99-high #3; already stated in the option description and connect.md, and `.mcp.json` has no validation hook.
- Skipped #3 (`reviews/pr-99-medium.md`): "Hand copy of SERVER_INSTRUCTIONS contradicts root CLAUDE.md" CLAUDE.md is changed by the index pass (the *Rule text* item above).
- Skipped #4 (`reviews/pr-99-medium.md`): "Equality test never shown to fail when one side changes" The builder showed the test fail on a one-character change.
- Skipped #5 (`reviews/pr-99-medium.md`): "slice Verify (fresh run reaching a working card) unmet, listed under Not yet verified." Already listed under *Not yet verified*.
- Skipped #7 (`reviews/pr-99-medium.md`): "Hard-coded GitHub main URL to guide; forks misdirect" Low; the owner's repo is the only source of the plugin.

#### For CLAUDE.md

- Replace the rule "Clients live in the repos that use them, not here" with: clients for Claude Code live in
  `plugin/` (marketplace in `.claude-plugin/marketplace.json`); the reporting rules text exists once, in
  `src/mcp/instructions.ts`, mirrored between the BEGIN/END RULES markers of `plugin/skills/agent-board/SKILL.md` and
  held equal by `test/pluginRules.test.ts`; change both together; `plugin/` holds no owner data and no version
  (public repo) (Slice 20: docs/plan/slices/20-plugin-connect.md).

#### For README.md

- None: the README "Use it" section and `docs/clients.md` were already updated in this slice.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green; `claude plugin validate .` passes.
