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
- `plain()` in `plugin/scripts/sync-docs.mjs` keeps code spans; `checkHash` keeps its old reading of code spans so stored check keys do
  not change, but ignores a leading `[tag] ` (one whitespace character then text; chrome, session, phone, cloud, chat, owner, copied from
  ClaudeSkills `live-checks.mjs` TAGS: update both together) and one trailing
  `(live check YYYY-MM-DD: ...)` marker, so tagging a check or a live-check run never re-keys it; the one re-key when
  this landed was accepted (Slice 43: docs/plan/slices/43-owner-cards-read-right.md; Slice 31 item 7, ClaudeSkills).
- Every plugin card report goes through `sendCardReport` in `plugin/scripts/report-progress.mjs`, which logs the sender (hook name, session id, field names only, never text) to `senders.log`; never send a card report around it (Slice 45: docs/plan/slices/45-night-1602-follow-ups.md).
- The "later close wins" rule lives only in `closeLaterThan` in `plugin/scripts/hooks/session-done.mjs`; `closing` in the goal file is set only for the duration of a close call, and the Stop report's time is taken before its hold write (Slice 46: docs/plan/slices/46-slice-45-follow-ups.md).
- The agent prune rule lives only in `liveAgentIds` (`plugin/scripts/hooks/background-agents.mjs`) used by `runningIds` in
  `session-done.mjs`; a read it cannot make prunes nothing. The agent time is one rule, `agentTime` in the same file
  (record mtime, else the meta file's, else unknown and kept unless a stop file names it); never add a second time
  reading (Slice 48: docs/plan/slices/48-slice-47-follow-ups.md; Slice 49: docs/plan/slices/49-slice-48-follow-ups.md).
- Task steps (Slice 53): the task tools are mirrored only by `plugin/scripts/hooks/task-steps.mjs` into one file per task under `<id>.tasks/` (no shared file), and every hook report builds its list through `mergeSteps` (`background-agents.mjs`) with `mirroredTasks` (`session-done.mjs`); the label-match rule is `sameLabel`. Mirrored task rows have the reserved id prefix `mirror-task:` (`TASK_ROW_PREFIX` in `src/domain/steps.ts`, `TASK_ID_PREFIX` in `background-agents.mjs`, held equal by `test/taskSteps.test.ts`; `generatedId` never makes it): only a hook report writes them, any other report keeps them (`keepMirroredRows`), and a hook report keeps a helper's own children under an agent row and replaces only the task rows (none sent clears them), so the hook never resends after a helper's report. The compaction count only grows (`keptCompactions`) (Slice 53: docs/plan/slices/53-task-tools-steps.md).
- Process optimiser (Slice 57): the detectors are pure functions in `plugin/scripts/optimiser/detectors.mjs` over `query_runs` rows and one caller-given config (every threshold, budget, process key and model name comes from it; a detector with no config section finds nothing; a row's times count only when both are set); the report and finding text and keys are `report.mjs`, the script `optimise.mjs` sends every card through `sendCardReport` and is a dry run unless `--file-findings` is given; never file a finding card by default, and never put a process name, model name or threshold in the code (docs/plan/slices/57-process-optimiser.md).
- Step cost (Slice 54): the transcript is read only by `refreshCosts` in `plugin/scripts/step-cost.mjs`, from the offset kept per transcript (`<id>.cost-<hash>.json`), and only on a step's end (`TaskCompleted` or the `TaskUpdate` completing it, `isStepEnd` in `task-steps.mjs`), `SubagentStop` and `Stop`; no other hook reads it. Costs are recomputed whole from that state into `<id>.costs.json` (a lost write is repaired by the next), and every hook list gets them through `cardSteps` (`session-done.mjs`) -> `withCosts`; never put a cost on a row elsewhere. A request goes to the innermost step open at its time for its agent (`taskAt`), the request that opens a task (TaskUpdate in_progress) to that task, a subagent with no open step of its own to the main thread's; the rest is the outside bucket, sent nowhere. Read, compute and write run under the session's create-exclusive `<id>.cost.lock` (a hook that cannot get it skips its cost); a transcript state keeps per-step aggregates and only the newest requests (`settle`), and the cost files go with the session's other state files (`removeStoppedFolder`). A cost goes on a mirrored task row, on a reported step the task matches by label (with the task's observed times), and on a finished agent's row (its whole transcript, observed start and stop). The board stores the cost as a `step_runs` row, never in the steps text (docs/plan/slices/54-step-cost.md).
