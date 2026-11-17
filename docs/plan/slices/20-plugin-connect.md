### Slice 20 — A Claude Code plugin and a setup guide: any Claude Code connects itself to a board

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

- [ ] **Marketplace and plugin.** `.claude-plugin/marketplace.json` (marketplace name unlikely to clash, e.g.
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
  fails when one side changes alone.
- [ ] **Connect guide for Claude.** `docs/setup/connect.md`, written for a Claude Code with no context: check
  Claude Code's version; `claude plugin marketplace add <owner>/<repo>`; `claude plugin install
  agent-board@<marketplace>`; ask the person for the board address and token and where they come from (their
  board's secrets store, or whoever runs the board), never guessing; the person enters them in `/plugin`,
  Installed, agent-board, Configure options (or the install prompt; check which works non-interactively and write
  only that); turn on auto-update for this marketplace (`/plugin`, Marketplaces) or say how to update by hand
  (`claude plugin marketplace update`, `claude plugin update agent-board@<marketplace>`); `/reload-plugins`; then a
  test: open a session card, read it back with `get_item`, `mark_done` it, and tell the person it worked. Also how
  to add the board to claude.ai (OAuth connector, `docs/clients.md`). Verify: a fresh Claude Code given only the
  README sentence, on a machine with no board setup (a clean profile), ends with a working test card.
- [ ] **README.** Top section "Use it": one sentence to give your Claude Code ("Install and set up the agent board
  plugin from https://github.com/<owner>/<repo>, following docs/setup/connect.md"), and a link to Slice 24's
  own-board guide. The *Develop* section stays below. Fix the stale "Status: building (Slice 1...)" line.
- [ ] **Client guide.** `docs/clients.md` *Setup for an AI agent* points to the plugin and `docs/setup/connect.md`
  first; the raw MCP and HTTPS sections stay for other clients.
- [ ] **Rule text** for the index pass (`CLAUDE.md`): replace "Clients live in the repos that use them, not here"
  with: clients for Claude Code live in `plugin/`; the rules text exists once, in `src/mcp/instructions.ts`, mirrored
  by the skill and held equal by `test/pluginRules.test.ts`; `plugin/` holds no owner data (public repo).

#### Not yet verified

- A fresh Claude Code on another machine, given only the README sentence, connects and shows a card.
- Auto-update delivers a change to an installed client after a merge.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green; `claude plugin validate .` passes.
