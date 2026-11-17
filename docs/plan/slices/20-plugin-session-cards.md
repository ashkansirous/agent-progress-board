### Slice 20 — Session cards report themselves from the plugin's hooks

*Planned and accepted with Slice 19 (owner, 2026-11-17; decisions in
[Slice 19](19-plugin-connect.md)). Starts after Slice 19.* Moves the reporter CLI and the session hooks from the
owner's config repo (`skills/report-progress/`: `report-progress.mjs`, `hooks/hook-input.mjs`,
`hooks/session-done.mjs`, `hooks/session-waiting.mjs`, `hooks/goal-reminder.mjs`, `steps/*.json`, their tests) into
`plugin/`, made generic, with the card fixes found on 2026-11-17.

**Touches:** `plugin/scripts/**`, `plugin/hooks/hooks.json`, `plugin/skills/agent-board/SKILL.md`, `package.json`, `docs/clients.md`, `docs/plan/slices/20-plugin-session-cards.md`

**Migrations:** none

#### Work

- [ ] **Move the CLI and hooks** into `plugin/scripts/` (Node, no dependencies, as today) and wire them in
  `plugin/hooks/hooks.json` (top-level `"hooks"` key; commands use `"${CLAUDE_PLUGIN_ROOT}"`): Stop, SubagentStop
  and UserPromptSubmit (card done / resumed), Notification (waiting), PostToolUse and UserPromptSubmit (goal
  reminder). Config comes from `CLAUDE_PLUGIN_OPTION_BOARD_URL` / `CLAUDE_PLUGIN_OPTION_BOARD_TOKEN`, then the
  env `AGENT_BOARD_URL` / `AGENT_BOARD_TOKEN`; drop the hard-coded board host and secrets-file path
  (`report-progress.mjs:40-41` in the old copy). State goes in `CLAUDE_PLUGIN_DATA`, never the plugin folder.
  Project name: the git main checkout's folder name unless `AGENT_BOARD_PROJECT` is set. Steps lists that belong
  to the owner's own skills (`steps/run-wave.json` and the agent lists) stay in the owner's repo; the CLI takes
  steps from a file path or `--steps`. Every script still fails open (exit 0, short timeout). Verify: the moved
  tests run in this repo with `node --test plugin/` (added to `npm test`), with fake servers as now.
- [ ] **A session card stays open while its background agents work.** On 2026-11-17 a session's
  card was set done "Session stopped" eleven times in two hours, once per reply, while its translation and
  illustration agents ran in the background. A Stop while the session has a background agent whose transcript
  (`<session>/subagents/*.jsonl`) changed in the last 10 minutes leaves the card `in_progress` with the note
  "background agents running". Verify: a test with a fresh subagent transcript keeps the card open; with only old
  ones it closes.
- [ ] **Running background agents show as steps.** The same card stayed at step "write English text" for two
  hours. Each background agent whose transcript changed in the last 10 minutes shows as an `active` step labelled
  with its `description` from `subagents/*.meta.json`, and turns `done` on its SubagentStop; steps the session
  sent stay as sent. Verify: two meta files give two active steps; after one SubagentStop one is done.
- [ ] **A dead session's waiting card closes.** On 2026-11-17 a "Claude is waiting for your input" card stayed 8
  hours after its session died (no Stop ran). A hook `waiting_for_me` card whose session sent nothing for 30
  minutes is closed with "Session ended" at the next tick of any session on the machine. Verify: a test with an
  old card closes it; a fresh one stays.
- [ ] **Skill and guide.** The skill says what the hooks do on their own and what the session still reports
  (title, why, steps). `docs/clients.md` lists the hooks.

#### Not yet verified

- A real session with a background agent keeps its card open past a reply, then closes it.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green (plugin tests included).
