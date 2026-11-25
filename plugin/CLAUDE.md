# plugin/ rules

Rules for the Claude Code plugin in this folder, moved from the root CLAUDE.md.

- **Plugin scripts.** Hooks and the reporter CLI live in `plugin/scripts`; every script fails open (exit 0, short
  timeout), keeps state only in `CLAUDE_PLUGIN_DATA`, and its tests run with `npm test`
  (`node --test plugin/**/*.test.mjs`) (Slice 21: docs/plan/slices/21-plugin-session-cards.md).
- Plugin usage options: `report_usage` (default true, token counts), `read_plan_cap` (default false; reads Claude
  Code's sign-in file for the plan cap, needs `report_usage` on) and `environment`. The cap reading stays opt-in.
  The usage scripts in `plugin/scripts` keep state only in `CLAUDE_PLUGIN_DATA` (Slice 22:
  docs/plan/slices/22-plugin-usage.md).
- The park-reason rule (which `parked:` reasons give a blocked slice and no waiting card) lives only in
  `waitsOnlyOnWork` in `plugin/scripts/sync-docs.mjs`; `plugin/skills/agent-board/SKILL.md` describes it in words,
  so change the function and the words together (Slice 23: docs/plan/slices/23-plugin-plan-sync.md).
- A waiting card from the plugin's Notification hook opens only when something is asked (permission, elicitation, or an
  idle prompt after a question); its text is masked by `maskSecrets` in `plugin/scripts/hooks/waiting-card.mjs` before it
  leaves the machine; never send transcript text unmasked. The mask is a deny-list: a secret name followed by a
  separator masks the line to its end (the next line too when the value is on it), plus shape maskers; input is cut to a
  4096-character window and scanned linearly. Whether a card opens and which sentence is the question are decided on the
  unmasked text; only the text that is sent is masked. The card's title reads the branch from `.git/HEAD` (`titleOf` in
  `plugin/scripts/hooks/session-waiting.mjs`), never by running git (Slice 27: docs/plan/slices/27-needs-you-cards.md;
  Slice 31: docs/plan/slices/31-sync-and-waiting-text.md).
- Cloud sessions load no plugin; `docs/setup/cloud.md` runs the plugin's usage scripts from a pinned download, so a
  change to those script paths or imports must be mirrored there (Slice 28: docs/plan/slices/28-cloud-usage.md).
- Plugin hook state needs no lock: one stop file per agent id under `<id>.stopped/`, and goal-file writes re-read and merge
  only their own fields, then rename (`plugin/scripts/hooks/hook-input.mjs`); never add a read-modify-write of a shared
  state file. No hook sends title or why on a session card (Slice 29: docs/plan/slices/29-agent-state-fixes.md).
- `planSince` in `plugin/scripts/cap-reading.mjs` is the one plan-guard rule: a status-line file is sent only when it was
  written after the plan was first seen. Never guard on the board's last accepted plan (Slice 30:
  docs/plan/slices/30-usage-script-fixes.md).
- Agent rows and the helper's row id `agent-<id>` come only from the `SubagentStart` hook
  (`plugin/scripts/hooks/session-done.mjs`); the goal file is merged per agent (`mergeParents`), never a read-modify-write
  of the whole `agentParents` map; every agent label passes `maskSecrets` before it is cut or sent (Slice 40:
  docs/plan/slices/40-agents-in-tree.md).
- The own-card binding rule lives only in `mayBindCard` (`plugin/scripts/hooks/goal-reminder.mjs`): the first own-card
  report binds, a new key moves the card only after the bound card is closed. Hooks heartbeat a slice card but never
  close it, mark it done or set its status (Slice 41: docs/plan/slices/41-tasks-with-outcome.md).
- `plain()` in `plugin/scripts/sync-docs.mjs` keeps code spans; `checkHash` keeps its old reading so stored check keys do
  not change (Slice 43: docs/plan/slices/43-owner-cards-read-right.md).
- Every plugin card report goes through `sendCardReport` in `plugin/scripts/report-progress.mjs`, which logs the sender (hook name, session id, field names only, never text) to `senders.log`; never send a card report around it (Slice 45: docs/plan/slices/45-night-1602-follow-ups.md).
- The "later close wins" rule lives only in `closeLaterThan` in `plugin/scripts/hooks/session-done.mjs`; `closing` in the goal file is set only for the duration of a close call, and the Stop report's time is taken before its hold write (Slice 46: docs/plan/slices/46-slice-45-follow-ups.md).
- The agent prune rule lives only in `liveAgentIds` (`plugin/scripts/hooks/background-agents.mjs`) used by `runningIds` in
  `session-done.mjs`; a read it cannot make prunes nothing. The agent time is one rule, `agentTime` in the same file
  (record mtime, else the meta file's, else unknown and kept unless a stop file names it); never add a second time
  reading (Slice 48: docs/plan/slices/48-slice-47-follow-ups.md; Slice 49: docs/plan/slices/49-slice-48-follow-ups.md).
