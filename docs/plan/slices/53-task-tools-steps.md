### Slice 53 — Task tools become card steps with times seen by the hooks

*Built 2026-11-25 (PR #205), not yet verified in a live session.* Needs Slice 51 (time sources) built and Slice 52's note.

**Touches:** `plugin/hooks/hooks.json`, `plugin/scripts/hooks/task-steps.mjs` (new), `plugin/scripts/hooks/task-steps.test.mjs` (new),
`plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/session-done.mjs`,
`plugin/scripts/hooks/goal-reminder.mjs`, `plugin/scripts/hooks/background-agents.mjs`,
`plugin/CLAUDE.md`, `plugin/skills/agent-board/SKILL.md`, `src/mcp/instructions.ts`, `src/mcp/schemas.ts`,
`src/domain/stepTypes.ts`, `src/domain/steps.ts`, `src/domain/upsert.ts`, `test/`, `docs/clients.md`

**Migrations:** none (`items.steps` is one JSON text column, `migrations/0004_steps.sql`; a compaction count is a new key
inside a step).

Premise check (2026-11-25, wave): no step has a compaction count yet, so Decision 3 adds `compactions` (a whole number)
to a step in `src/mcp/schemas.ts`, `src/domain/stepTypes.ts` and `src/domain/steps.ts`; the page does not show it in this
slice. Item D, plugin release: the plugin has no version (`plugin/` holds none), so the release is the merge to `main`;
users get it by updating the plugin and restarting Claude Code.

Hook inputs (Claude Code hooks reference, code.claude.com/docs/en/hooks, read 2026-11-25):
- `TaskCreated` and `TaskCompleted` take no matcher. Input: `session_id`, `transcript_path`, `task_id`, `task_subject`,
  `task_description` (may be absent), `agent_id` (only inside a subagent). No status, no time. The hook never blocks
  (exit 0, no `decision` output), since exit 2 would cancel the task or keep it open.
- `PostToolUse` with matcher `TaskUpdate`: the docs do not give the `tool_input` keys. Read the task id from `taskId` or
  `task_id` and the status from `status`; `in_progress` starts the step. An input that has neither is ignored.
  The subject comes from what `TaskCreated` stored for that id in `CLAUDE_PLUGIN_DATA`.
- `PreCompact` and `PostCompact` take the matcher `manual|auto` (or none). Input: `session_id`, `trigger`. `agent_id` is
  absent, so a compaction counts on the step running on the session's own card.
- The task tools are on by default on older models and need `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` on current ones;
  `CLAUDE_CODE_ENABLE_TASKS=0` brings back `TodoWrite` instead.

Source: phone scope "Process optimiser and true per-step telemetry" (2026-11-21), milestone 1; desk refinement
2026-11-22, question 1 (owner approved: hook-seen times plus the task tools turned on).

## Why

Agents report steps late or in a batch, so the card's times are wrong. Claude Code's own task tools are used as the
agent works, and the hooks see each change when it happens. Mirroring them into card steps gives true times without
asking agents to report more.

## Decisions

Decided by this session from the approved answers:

1. A task created with `TaskCreate` becomes a step on the session's bound card (`mayBindCard`); one created inside a
   subagent becomes a child of that agent's row (`agent-<id>`, Slice 40). `TaskUpdate` to in progress sets the start,
   `TaskCompleted` the end, both with source `observed` and the hook's own clock (no hook input carries a time).
2. Steps the agent reports itself (`report_progress`) are kept; a task whose subject matches a reported step's label
   (case and spaces ignored) under the same parent fills that step's observed times instead of adding a second step.
3. `PreCompact` / `PostCompact` add one to the running step's compaction count, sent with the next step report.
4. Hooks stay fail-open, bounded (short timeout, exit 0) and keep state only in `CLAUDE_PLUGIN_DATA`. No hook reads a
   transcript here (Slice 54 does, only on a step change or an agent stop).
5. Turning the task tools on is the owner's setting, done in the owner's config repo (planned there); `docs/clients.md`
   tells other users the variable (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`) and what they gain.

## Work

- [x] **A.** `hooks.json` entries for `TaskCreated`, `TaskCompleted`, `PostToolUse` (matcher `TaskUpdate`),
  `PreCompact`, `PostCompact`; `task-steps.mjs` maps them to step reports through `sendCardReport`.
- [x] **B.** Matching rule (Decision 2) in one function in `task-steps.mjs`, with tests.
- [x] **C.** Reporting rules text (both copies) says that task tools are mirrored and agents need not repeat them.
- [x] **D.** Plugin release: by the merge to `main` (no code; the plugin has no version).

## Verification

- `node --test plugin/**/*.test.mjs`: a fake hook sequence (create, start at 10:00, complete at 10:05, a batched
  `report_progress` marking it done at 10:50) leaves the step at 10:00 to 10:05, source observed.
- Live: one real session with the task tools on shows its task list as steps on its card with times matching the
  transcript within a minute (read back with `get_item`).

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need*.

- 2026-11-25 (capture): stamp the time in the hook; use `PostToolUse(TaskUpdate in_progress)` as step start and
  `TaskCompleted` as step end, never `TaskCreated`. Keep the hook to an append-only write (no parse of the transcript).
  Task tools exist only with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` on current models, so a session without them has no
  steps: say so in the data (one "whole session" bucket) rather than inventing steps.
- 2026-11-25 (attribution, shared with Slice 54): merge assistant lines by `message.id` (a request is streamed as several
  lines; the last carries the final usage); read the subagent file from `agent_transcript_path` on `SubagentStop`; place a
  request on the step open at its timestamp, with the spike note's transition-request rule; keep an explicit "outside
  any step" bucket so totals still add up.
- 2026-11-25: the card's steps keep the server's arrival stamps until Slice 51 lands; the timeline sends the hook times
  as the step times and does not rely on the report's arrival.

#### From review

- Skipped #5 (`reviews/pr-205-high.md`): "With no main-thread task running and no active reported step, `compactionKey` returns '' and `addCompaction` writes nothing" - Decision 3 counts a compaction on the running step; time outside any step is Slice 54's "outside any step" bucket.
- Skipped #6 (`reviews/pr-205-high.md`): "a task completed with no earlier in_progress update is sent with only `done_at`, so the server stamps a start at arrival" - a task with no observed start has no true start; Slice 51's stamped source already marks the server's time as stamped.
- Skipped #6 (`reviews/pr-205-medium.md`): "the dynamic import('./session-done.mjs') in sendIfOpen is not needed for a real hazard" - the hook is fail-open by rule, so a swallowed load error only loses one report, and the import cost is one module per hook run.
- Skipped #7 (`reviews/pr-205-medium.md`): "Tasks belonging to an agent row dropped by fitAgents (over 200 steps) vanish" - it happens only past the 200-step cap, which `fitAgents` already trims. Follow-up: put a dropped agent's tasks at top level, or compute the task room after the agent rows are chosen.
- Pass 2 (`reviews/pr-205-medium.md`) built through the Ownership design: #1-#5 and #8. The id prefix is now `mirror-task:`; `src/domain/upsert.ts` (one wiring line for `keepMirroredRows`) was added to the files changed.
- Skipped #7, first half (`reviews/pr-205-high.md`): "The label match covers only top-level reported steps" - the hook cannot read a helper's own reported steps, so matching under agent rows needs Slice 54's read. Follow-up: match at every level under the same parent once Slice 54 reads them.
- Applied #3 with one limit: a task made while no card was open has no card key and shows on the next card that binds.
- Skipped #3 (`reviews/pr-205-check-medium.md`): "Rule 2 depends on the client-claimed string source" - `source: "hook"` is the Slice 51 contract `hookStepsInput` already trusts, and every writer holds the owner's own token.
- Skipped #4 (`reviews/pr-205-check-medium.md`): "mirroredTasks writes during a read" - `mirroredTasks` reads only inside a bound card's send, so the first reader is the first card that binds.
- Skipped #5 (`reviews/pr-205-check-medium.md`): "so rule 3 is not true below an agent row" - no report sends nested `agent-` rows under an agent row today; follow-up: handle nested agent rows in `hookAgentRow` if a writer ever nests them.
- Applied #1, #2, #6 of `reviews/pr-205-check-medium.md`: `keepMirroredRows` trims kept stored task rows (oldest finished first) to fit the step and depth limits; compaction files and the PreCompact note carry the card key and `readCompactions` counts one card's; a clipped task row id ends in `~` and 8 hex of a hash of the full task id (`taskRowId`).

**Ownership design (coordinator, after review 2; second strike on the task-row merge: high #1, #2 and medium #1-#5).**
Every step row has one owner, and the server keeps each owner's rows on the other owner's writes, so no write needs
a resend to repair another:
1. Mirrored task rows carry a reserved id prefix that `resolveIds` never makes from a label and that no agent is told to
   use (not `task-`, which a label "Task 1" can produce). One constant holds it, on the server in `src/domain/steps.ts`
   and in the plugin, and a test holds the two equal.
2. Only a hook report (`source: "hook"`) writes rows with that prefix. Any other report (a whole list or an
   `under_step` list) cannot add, change or drop them: rows it sends with the prefix are dropped, and the stored ones stay
   at their place under the same parent, after the rows that report sends.
3. A hook report owns the `agent-` rows (Slice 51) and the mirrored task rows. Under an agent row it replaces only the
   task rows with what it sends (an empty list clears them) and keeps the helper's own stored children, whatever their
   ids, including when the row is sent with no children.
4. With rule 2 the hook no longer resends after a helper's `under_step` report: drop the signature clear of fix 1 (#2).
5. The hook sends whenever the mirrored task set changes, also when it becomes empty (medium #1).
6. A task made while no card is open gets the key of the first card that binds after it, written into its state file
   once, and never shows on a later card (medium #5).
7. `TaskCompleted` takes the subject from its own `task_subject` when no state file has one (medium #8).
8. **Fit after the merge (coordinator, after check pass 2; second strike on the size trim: check #1, check-2 #1 and #4).**
   The limits are checked once, on the final tree, after every kept row is in it (sent rows, kept mirrored rows, stored
   children a sent step keeps), for every report, hook or not. One function makes the tree fit: while it is over the
   step or depth limit it drops mirrored task rows, finished ones first, oldest first. A report is refused only when the
   tree is still over with no mirrored rows left, which means its own rows are over. The plugin's own trim stays as a
   first cut, but the server's fit decides, so a hook report is never refused for helper rows it cannot see.
9. A non-hook report that marks a step done never changes the mirrored task rows under it (check-2 #2): rule 2 holds
   for the done cascade too.

- Built rules 8 and 9 of the Ownership design (`reviews/pr-205-check-2-medium.md` #1, #2, #4, #5): `fitMirroredRows` in `src/domain/steps.ts` runs once in `normalizeSteps` on the final tree and only when it is over a limit; the trim inside `keepMirroredRows` is gone; `asDone` skips task rows.
- Skipped #3 (`reviews/pr-205-check-2-medium.md`): "Stored task rows are kept only under a parent the report still sends" - a whole-list report that drops a parent drops its subtree by the whole-list contract. Follow-up: re-attach unmatched task rows at top level or under the closest kept ancestor if that contract changes.
- Check pass 3 (`reviews/pr-205-check-3-medium.md`): no important findings; its 4 nits are follow-ups, none built:
  - Skipped #1 (`reviews/pr-205-check-3-medium.md`): "A non-hook report that creates a new item skips keepMirroredRows" - follow-up: run `keepMirroredRows(null, input.steps)` for non-hook creation in `src/domain/upsert.ts`.
  - Skipped #2 (`reviews/pr-205-check-3-medium.md`): "A report over 400 steps is refused with the text" - follow-up: word the cost-bound refusal separately from "at most 200 steps in all".
  - Skipped #3 (`reviews/pr-205-check-3-medium.md`): "fitMirroredRows drops every task row while still over a limit" - the reviewer said no change needed.
  - Skipped #4 (`reviews/pr-205-check-3-medium.md`): "asDone leaves task rows unchanged, so a done slice can show an active task leaf" - matches rule 9; the session-done hook finishes it.
- Reviews not otherwise listed above (`reviews/pr-205-high.md`, `reviews/pr-205-medium.md`, `reviews/pr-205-check-medium.md`): findings not skipped there were applied, or superseded by the Ownership design.

#### Changed while building

- Hooks `TaskCreated`, `TaskCompleted`, `PostToolUse` (matcher `TaskUpdate`), `PreCompact`, `PostCompact` all run `task-steps.mjs`. Times come from the hook's clock, source `observed`. Tasks are kept per card (`cardKey`, bound once); compactions are counted per card.
- Server: mirrored rows carry the id prefix `mirror-task:` (one constant on each side, a test holds them equal). `keepMirroredRows` (rule 2), `hookAgentRow` (rule 3) and `fitMirroredRows` on the final tree (rule 8) are in `src/domain/steps.ts`; `asDone` skips task rows (rule 9). A step has a `compactions` field; the stored count and the sent one are merged by taking the larger.
- The id prefix is `mirror-task:`, not `task-` as first built (see the Ownership design).
- Checks run (2026-11-25, final tree): lint and typecheck clean, 883 vitest, 474 plugin tests, 338 e2e passed.

#### For CLAUDE.md

- Mirrored task rows are owned only by hook reports: the prefix is `TASK_ROW_PREFIX` in `src/domain/steps.ts` and its twin in `plugin/scripts/hooks/`, held equal by a test; a non-hook report never adds, changes or drops them. The step-limit fit for them is only `fitMirroredRows`; never add a second trim (Slice 53: docs/plan/slices/53-task-tools-steps.md).

#### Not yet verified

- [session] A real session with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` shows its tasks as steps, with times within a minute of the transcript (read back with `get_item`).
- [session] The `TaskUpdate` `tool_input` keys (`taskId`, `status`) are seen in a live payload.
- [session] A compaction adds to the running step's count.
