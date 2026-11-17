### Slice 21 — Session cards report themselves from the plugin's hooks

*Built (wave 2026-11-17), merged as PR #101 (372ae9a), not yet verified in a live session.*

*Planned and accepted with Slice 20 (owner, 2026-11-17; decisions in
[Slice 20](20-plugin-connect.md)). Starts after Slice 20.* Moves the reporter CLI and the session hooks from the
owner's config repo (`skills/report-progress/`: `report-progress.mjs`, `hooks/hook-input.mjs`,
`hooks/session-done.mjs`, `hooks/session-waiting.mjs`, `hooks/goal-reminder.mjs`, `steps/*.json`, their tests) into
`plugin/`, made generic, with the card fixes found on 2026-11-17.

**Touches:** `plugin/scripts/**`, `plugin/hooks/hooks.json`, `plugin/skills/agent-board/SKILL.md`, `package.json`, `docs/clients.md`, `docs/plan/slices/21-plugin-session-cards.md`

**Migrations:** none

#### Work

- [x] **Move the CLI and hooks** into `plugin/scripts/` (Node, no dependencies, as today) and wire them in
  `plugin/hooks/hooks.json` (top-level `"hooks"` key; commands use `"${CLAUDE_PLUGIN_ROOT}"`): Stop, SubagentStop
  and UserPromptSubmit (card done / resumed), Notification (waiting), PostToolUse and UserPromptSubmit (goal
  reminder). Config comes from `CLAUDE_PLUGIN_OPTION_BOARD_URL` / `CLAUDE_PLUGIN_OPTION_BOARD_TOKEN`, then the
  env `AGENT_BOARD_URL` / `AGENT_BOARD_TOKEN`; drop the hard-coded board host and secrets-file path
  (`report-progress.mjs:40-41` in the old copy). State goes in `CLAUDE_PLUGIN_DATA`, never the plugin folder.
  Project name: the git main checkout's folder name unless `AGENT_BOARD_PROJECT` is set. Steps lists that belong
  to the owner's own skills (`steps/run-wave.json` and the agent lists) stay in the owner's repo; the CLI takes
  steps from a file path or `--steps`. Every script still fails open (exit 0, short timeout). Verify: the moved
  tests run in this repo with `node --test plugin/` (added to `npm test`), with fake servers as now.
- [x] **A session card stays open while its background agents work.** On 2026-11-17 a session's
  card was set done "Session stopped" eleven times in two hours, once per reply, while its translation and
  illustration agents ran in the background. A Stop while the session has a background agent whose transcript
  (`<session>/subagents/*.jsonl`) changed in the last 10 minutes leaves the card `in_progress` with the note
  "background agents running". Verify: a test with a fresh subagent transcript keeps the card open; with only old
  ones it closes.
- [x] **Running background agents show as steps.** The same card stayed at step "write English text" for two
  hours. Each background agent whose transcript changed in the last 10 minutes shows as an `active` step labelled
  with its `description` from `subagents/*.meta.json`, and turns `done` on its SubagentStop; steps the session
  sent stay as sent. Verify: two meta files give two active steps; after one SubagentStop one is done.
- [x] **A dead session's waiting card closes.** On 2026-11-17 a "Claude is waiting for your input" card stayed 8
  hours after its session died (no Stop ran). A hook `waiting_for_me` card whose session sent nothing for 30
  minutes is closed with "Session ended" at the next tick of any session on the machine. Verify: a test with an
  old card closes it; a fresh one stays.
- [x] **Skill and guide.** The skill says what the hooks do on their own and what the session still reports
  (title, why, steps). `docs/clients.md` lists the hooks.

#### Decisions (wave)

- The board allows one active step (`normalizeSteps` in `src/domain/steps.ts`), so with background agents the first
  running agent is `active` and the others `pending` with the note "running in background".
- The hooks repeat an open `needs_you` question in every card report and skip the Stop close while one is open
  (`answersQuestion` in `src/domain/upsert.ts` clears it on done and on an in_progress report that omits it).
- The goal file records who closed the card (`closedBy`: `stop` or `session`); only a Stop-closed card is reopened.
- The waiting item's key is `<project>/waiting-<session id>`, never the session card's `session-<id>`.

*From review:*

- Skipped #2 (`reviews/pr-101-high.md`): "closeDeadWaiting closes the waiting item of a session that is genuinely waiting" - the Work item asks for it ("A hook `waiting_for_me` card whose session sent nothing for 30 minutes is closed with \"Session ended\"").
- Skipped #10 (`reviews/pr-101-high.md`): "npm test relies on Node expanding the quoted glob" - low severity, not applied.
- Partly skipped #8 (`reviews/pr-101-high.md`): "PostToolUse has no matcher/if filter; spawns Node for every tool call" - `async: true` runs a command hook in the background, so its `additionalContext` (the goal reminder) would be lost, and the reminder counts every tool call, so no matcher fits.
- Skipped #6 (`reviews/pr-101-medium.md`): "Any main-thread report_progress with agent" - low severity, not applied.
- Skipped #8 (`reviews/pr-101-medium.md`): "mergeSteps slices to STEPS_MAX after appending agent steps" - low severity, not applied.
- Skipped #9 (`reviews/pr-101-medium.md`): "Test script relies on node --test expanding quoted glob" - low severity, same as pr-101-high #10, not applied.
- Skipped #10 (`reviews/pr-101-medium.md`): "PostToolUse has no matcher, so every tool call of every session/subagent spawns a Node process" - low severity, same as pr-101-high #8: `async: true` would drop the reminder's additionalContext.
- Skipped #6 (`reviews/pr-101-check-medium.md`): "any main-thread PostToolUse closes the waiting item, not only the call that was waiting for permission" - the main thread cannot run a tool while a permission prompt blocks it, so any main-thread PostToolUse means the prompt was answered.
- Skipped #7 (`reviews/pr-101-check-medium.md`): "resumeCard sends needs_you:null on every UserPromptSubmit, so any prompt (/clear, slash command, unrelated message) counts as the answer" - low severity; a typed prompt is the person's answer, the same move the server's answersQuestion treats as answered.
- Skipped #8 (`reviews/pr-101-check-medium.md`): "listMarkers treats every dot-less file in the state root as a marker, reading/parsing each on every Stop, UserPromptSubmit and SubagentStop" - low severity, not applied.

*Follow-ups:* Check passes converged after the second check pass (no crash, data-loss, security or privacy finding); the background-agent state findings 1-6 are correctness bugs to plan as a follow-up slice. From `reviews/pr-101-check-2-medium.md`:

1. `plugin/scripts/hooks/hook-input.mjs:130`: `addStoppedAgent` read-modify-write is unlocked; parallel SubagentStop hooks lose an id, so the card stays open and is never closed.
2. `plugin/scripts/hooks/background-agents.mjs:53`: the freshness filter is bypassed for every stopped id; up to all agents become done steps and `mergeSteps` cuts the newest (the running agent).
3. `plugin/scripts/hooks/background-agents.mjs:82`: `mergeSteps` demotes the active step to pending, then drops a same-labelled agent; no active step is left.
4. `plugin/scripts/hooks/session-done.mjs:143`: a stopped id is never removed; a resumed agent (same agent_id) stays forced done and Stop closes the card while it runs.
5. `plugin/scripts/hooks/session-done.mjs:33`: `saveGoal` writes patch fields over a goal changed during the 2 s call; a missing file is resurrected by `|| goal`; `resumeCard`'s `needsYou:''` erases a new question.
6. `plugin/scripts/hooks/session-done.mjs:117`: after Stop left the card open, the last SubagentStop sends plain in_progress with all steps done; nothing closes it if the user has left.
7. `plugin/scripts/hooks/session-done.mjs:100` (low): `sig` is not reset when a card is reopened, so an equal later steps list can be skipped as unchanged.
8. `plugin/scripts/hooks/goal-reminder.mjs:117` (low): `process.exitCode = 0` in `.finally` does not force exit; a lingering handle keeps the hook alive to the 5 s timeout; the sync part of `closeAnsweredWaiting` can throw outside the try.
9. `plugin/scripts/hooks/session-done.mjs:146` (low): each SubagentStop does an extra disk read/write plus `closeDeadWaiting` marker stats; the stopped-id file grows unbounded.
10. `plugin/scripts/hooks/hooks.test.mjs:93` (low): no tests for concurrent `addStoppedAgent`, old stopped ids, resumed agents, a report landing during `saveGoal`, or the active slot after the `mergeSteps` dedupe.

#### For CLAUDE.md (lifted 2026-11-17)

- Plugin hooks and the reporter CLI live in `plugin/scripts`; every script fails open (exit 0, short timeout), keeps state only in `CLAUDE_PLUGIN_DATA`, and its tests run with `npm test` (`node --test plugin/**/*.test.mjs`) (Slice 21: docs/plan/slices/21-plugin-session-cards.md).

#### Not yet verified

- A real session with a background agent keeps its card open past a reply, then closes it.
- `plugin/hooks/hooks.json` exec form and the PostToolUse tool name `mcp__plugin_agent-board_agent-board__report_progress` not seen in a live session.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green (plugin tests included).
