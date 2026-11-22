### Slice 53 — Task tools become card steps with times seen by the hooks

*Planned.* Needs Slice 51 (time sources) built and Slice 52's note.

**Touches:** `plugin/hooks/hooks.json`, `plugin/scripts/hooks/task-steps.mjs` (new), `plugin/scripts/hooks/task-steps.test.mjs` (new),
`plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/report-progress.mjs`,
`plugin/skills/agent-board/SKILL.md`, `src/mcp/instructions.ts`, `test/pluginRules.test.ts`, `docs/clients.md`

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

- [ ] **A.** `hooks.json` entries for `TaskCreated`, `TaskCompleted`, `PostToolUse` (matcher `TaskUpdate`),
  `PreCompact`, `PostCompact`; `task-steps.mjs` maps them to step reports through `sendCardReport`.
- [ ] **B.** Matching rule (Decision 2) in one function in `task-steps.mjs`, with tests.
- [ ] **C.** Reporting rules text (both copies) says that task tools are mirrored and agents need not repeat them.
- [ ] **D.** Plugin release.

## Verification

- `node --test plugin/**/*.test.mjs`: a fake hook sequence (create, start at 10:00, complete at 10:05, a batched
  `report_progress` marking it done at 10:50) leaves the step at 10:00 to 10:05, source observed.
- Live: one real session with the task tools on shows its task list as steps on its card with times matching the
  transcript within a minute (read back with `get_item`).
