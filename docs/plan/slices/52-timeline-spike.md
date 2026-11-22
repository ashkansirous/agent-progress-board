### Slice 52 — Spike: rebuild one session's true step timeline from hooks and the transcript

*Planned.* First step of the process-optimiser scope (Slices 52 to 57). No board change.

**Touches:** `tmp/` (scratch script, git-ignored), `docs/plan/notes/2026-11-22-timeline-spike.md` (new)

Source: the owner's phone scope "Process optimiser and true per-step telemetry" (2026-11-21), refined at the desk
2026-11-22 (all recommendations approved by the owner that day).

## Why

The scope's hard part is attribution: tokens arrive per API request, steps are what agents say they do. Before any
storage or tool is built, prove on one real session that the plugin can rebuild "step, start, end, model, tokens, peak
context" and that it differs from what the card showed.

## What the desk check found (2026-11-22)

- Claude Code's hook inputs carry no timestamp and no token counts; a hook script stamps its own clock when it fires
  (https://code.claude.com/docs/en/hooks). `TaskCreated` / `TaskCompleted` fire only for the `TaskCreate` /
  `TaskUpdate` tools, which are off by default on current models unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`
  (https://code.claude.com/docs/en/tools-reference, "Task tool availability"). Five recent local transcripts had no
  task-tool call.
- Transcript assistant lines carry `timestamp`, `message.model` and `message.usage` (input, cache read, cache creation,
  output); a compaction is a `type: system, subtype: compact_boundary` line. `PostCompact` gives no token size, so the
  size before and after comes from the transcript.
- `src/domain/steps.ts` stamps step times with the server's clock on arrival, which is the "active 1 h, really done
  45 min ago" fault (Slice 51 fixes the storage side).

## Decisions

1. A scratch script under `tmp/` (never shipped) reads one session transcript and its subagent transcripts, plus a
   hook log from a session run with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` and a logging hook on `TaskCreated`,
   `TaskCompleted`, `PostToolUse` (matcher `TaskUpdate`), `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`
   and `Stop`.
2. Peak context of a window is the largest single request's input + cache read + cache creation tokens in it.
3. Kill rule: if tokens cannot be placed on steps for a session that used the task tools, stop at per-agent cost
   (scope's first risk) and rewrite Slices 53 and 54 before building them.

## Work

- [ ] **A.** Logging hook and scratch script; one real session (a slice build with a review pass) run with the task
  tools on.
- [ ] **B.** Timeline table per step: start, end, source, model(s), tokens by kind, peak context, compactions; next to
  it what the card showed (`get_item` history).
- [ ] **C.** Note `docs/plan/notes/2026-11-22-timeline-spike.md` with the result, the measured cost of reading the
  transcript per hook (time and bytes, with offset caching), and any change Slices 53 to 57 need. No owner data in it.

## Verification

- The note shows at least one step whose observed end is earlier than the card's stamped end, with both times.
- The hook script's added time per call is measured and under 200 ms.
