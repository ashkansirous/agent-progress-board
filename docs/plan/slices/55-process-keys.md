### Slice 55 — Process keys, step counts and read tools for analysis

*Planned.* Needs Slice 54.

**Touches:** `src/domain/stepTypes.ts`, `src/domain/processStats.ts` (new), `src/application/board.ts`,
`src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/mcp/instructions.ts`,
`plugin/skills/agent-board/SKILL.md`, `plugin/scripts/hooks/task-steps.mjs`, `test/pluginRules.test.ts`, `test/`

Source: phone scope milestones 3 and 4 (decision "Process keys", approved 2026-11-21); desk refinement 2026-11-22.

## Why

Labels drift; a fixed key per kind of step (`slice/implement`, `review/pass-2`, `tests/full`, `book/translate`) makes
runs comparable across items and days. An analysis agent needs the runs without paging through `get_item`.

## Decisions

1. A step may carry `process` (a key of lower-case words joined by `/`, at most 80 characters). A step without one is
   grouped by its agent type, then its label, so older skills still group roughly.
2. A step may carry `counts`: up to 10 named whole numbers (for example `findings`, `fixed`, `skipped`), stored on its
   step row. Review passes and fixers use it for review yield.
3. Two read tools on `/mcp`: `query_runs` (filter by project, process key, date range; returns step rows with cost and
   counts) and `process_stats` (per process key: runs, median and p90 time, tokens and peak context over a window,
   default 30 days). Both are computed at read and cut by `cutReply`.
4. The keys themselves are named by the skills that run the steps, in the owner's other repos (scope decision
   "Enforcement"); this repo's docs use made-up examples only.

## Work

- [ ] **A.** `process` and `counts` in the step schema, validation and storage; reporting rules text (both copies).
- [ ] **B.** `query_runs` and `process_stats`, with the stats rule in `src/domain/processStats.ts`.
- [ ] **C.** Task-tool steps (Slice 53) take the process key from a `[key]` prefix in the task subject when present.

## Verification

- Tests: 40 seeded runs of one key give the expected median and p90; a step without a key groups under its agent type.
- Live: `process_stats` for the last 30 days returns at least the review and implement keys once the owner's skills
  send them (planned in the owner's private config repo).
