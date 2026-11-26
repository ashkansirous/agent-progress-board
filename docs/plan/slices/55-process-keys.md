### Slice 55 — Process keys, step counts and read tools for analysis

*Built 2026-11-25, merged as PR #209 (1faef66); the live check is under *Not yet verified*.*

*Plan cleanup 2026-11-26: close. Own work A, B and C is built on `origin/main` (`query_runs`, `process_stats`, `storeKeyOnly`) and live (Worker deployment 2026-11-25T23:53Z, plan.md line 77). The 4 "Open follow-ups" below were side findings, not this slice's work: moved to a new slice (Process-key review follow-ups, numbered by the index pass). Both live checks stay in `unverified.md`; the owner's skills sending keys is a Watch line.*

**Touches:** `src/domain/stepTypes.ts`, `src/domain/steps.ts`, `src/domain/stepRuns.ts`, `src/domain/processStats.ts` (new),
`src/application/board.ts`, `src/application/processRuns.ts` (new), `src/infrastructure/d1Repository.ts`,
`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/mcp/instructions.ts`, `plugin/skills/agent-board/SKILL.md`,
`plugin/scripts/hooks/task-steps.mjs`, `plugin/scripts/hooks/task-steps.test.mjs`, `plugin/scripts/hooks/hook-input.mjs`,
`plugin/scripts/hooks/background-agents.mjs`, `plugin/scripts/hooks/*.test.mjs`, `src/application/ports.ts`,
`test/pluginRules.test.ts`, `test/`

**Migrations:** none

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
5. (Coordinator, wave 2026-11-25, premise check.) `process` and `counts` are stored on the step itself, in the
   `items.steps` JSON that `saveStepsReport` writes, so the slice needs no migration. `query_runs` and `process_stats`
   read the steps of items in the window from `items.steps` (bounded query, `archived_at IS NULL`) and take each step's
   cost from its Slice 54 `step_runs` rows by item key and step id (the shown rule, `costRefOfStep`). The
   `step_runs.process_key` column stays unused: a second copy of the key would be a second writer.
   Why: one place holds what the step reported; the cost rows have one writer each (Slice 54).
6. (Coordinator, wave 2026-11-25, check pass: second strike on keeping a key.) One rule for when a key or counts
   change, on both sides:
   - Board: on a step report, `process` and `counts` that are left out or invalid keep the stored value; only an
     explicit `null` (or `""` for `process`) clears it. An invalid value is dropped with a reply note, never refuses the
     whole report (counts the same as process). A hook report is the whole list (`hookStepsInput`), so a task row the
     hook sends without a key has none.
   - Plugin: the task's key is defined when the task is created: TaskCreated sets it from the subject's `[key]` prefix,
     or none when the subject has no prefix (a re-created task starts clean). TaskCompleted and TaskUpdate change it only
     when their subject carries a valid prefix; without one they keep it. Matching a reported step to a task uses the
     stripped subject and the full prefixed text alike.

## Work

- [x] **A.** `process` and `counts` in the step schema, validation and storage; reporting rules text (both copies).
- [x] **B.** `query_runs` and `process_stats`, with the stats rule in `src/domain/processStats.ts`.
- [x] **C.** Task-tool steps (Slice 53) take the process key from a `[key]` prefix in the task subject when present.

## Verification

- Tests: 40 seeded runs of one key give the expected median and p90; a step without a key groups under its agent type.
- Live: `process_stats` for the last 30 days returns at least the review and implement keys once the owner's skills
  send them (planned in the owner's private config repo).

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need*.

- 2026-11-25: do not promise "hook added time < 200 ms" in a spec; promise "append-only, no transcript read in the
  hook" and measure the sender instead.

#### Changed while building

- Touches widened: `plugin/scripts/hooks/hook-input.mjs`, `background-agents.mjs`, the plugin hook tests and `src/application/ports.ts`.
- A: step `process` (key, at most 80) and `counts` (at most 10 whole numbers) live on the step in `items.steps`. The keep/clear
  rule of Decision 6 is `keptProcess`, `keptCounts` and `badFieldSteps` in `src/domain/steps.ts`; `looseField` in
  `src/mcp/schemas.ts` lets an unfit value through the schema, and `reportWithNotice` in `src/mcp/tools.ts` drops it with a
  reply note. The rules text is in `src/mcp/instructions.ts` and `plugin/skills/agent-board/SKILL.md`.
- B: `query_runs` and `process_stats` are in `src/application/processRuns.ts` and `src/domain/processStats.ts`.
  `runStepsOf` is the one rule for what a run is; stats group by key and source; a figure with no data is null, not 0.
  The reads are capped (`PROCESS_ITEM_LIMIT` 1000 items, `PROCESS_COST_ITEM_LIMIT` 200 items for cost) and the reply carries
  a notice when a cap is hit. `cutReply` stays the one cut: ids and process keys are never clipped, and its note names the
  first dropped run.
- C: `splitSubject` in `plugin/scripts/hooks/hook-input.mjs` splits a `[key]` prefix off the task subject; the key is kept on
  the task record. TaskCreated defines the key; TaskCompleted and TaskUpdate change it only with a valid prefix
  (`storeKeyOnly`); `taskMatchesLabel` matches the stripped or the prefixed label.
- Known behaviour: a TaskUpdate subject rename of a known task does not rename the step (as before).
- Checks: lint, typecheck, 956 Vitest, 512 plugin and 340 e2e tests (6 skipped) pass.

#### From review

Applied: pr-209-high 1 to 10; pr-209-medium 4, 5 and 6; pr-209-check-medium 1, 2, 4, 5 (first part) and 6;
pr-209-check-2-medium 1 and 2. The third check pass (pr-209-check-3-medium) converged with no code change. Each finding
left out is listed below.

- Skipped #1 (`reviews/pr-209-medium.md`): "STEP_LISTS_SINCE filters and sorts on items.updated_at with no covering index" - an index needs a migration and the read is capped at 1000 rows; recorded as a follow-up.
- Skipped #2 (`reviews/pr-209-medium.md`): "Costs are looked up only for the 200 newest items with a costed step" - the reply already carries a notice when the 200-item cost cap is hit, so the subset is not silent.
- Skipped #3 (`reviews/pr-209-medium.md`): "duration_seconds uses the measured cost duration when a cost is shown" - no failure path shown; the two clocks are each the step's own reported times.
- Skipped #3 (`reviews/pr-209-check-medium.md`): "splitSubject treats any leading [word]" - Decision 1 defines a key only by its form (lower-case words joined by `/`), so a bracketed `[wip]` is a key and the owner's skills choose their subjects.
- Skipped #3 (`reviews/pr-209-check-2-medium.md`): "TaskUpdate subject changes the key but not the stored subject/label" - renaming a known task on TaskUpdate was never part of the slice; a follow-up.
- Skipped #4 (`reviews/pr-209-check-2-medium.md`): "Costs are read for only the 200 newest items, yet `runs` counts all" - repeats pr-209-medium #2: the reply carries a notice when the 200-item cost cap is hit.
- Skipped #5 (`reviews/pr-209-check-2-medium.md`): "`durationOf` prefers cost.duration_seconds over step start/end" - repeats pr-209-medium #3: each clock is the step's own reported time.
- Skipped #5, second part (`reviews/pr-209-check-medium.md`): "values 81-320 chars pass the loosened schema max and are dropped with notice" - over the 80 limit, so dropping with a notice (stored key kept) is what Decision 6 asks.
- Skipped #1 (`reviews/pr-209-check-3-medium.md`): "looseField still refuses the whole report when a `process` or `counts` value is over 2000 characters" - "a report over a limit is refused" is the published rule; the 2000-character bound is a size limit like the label limit of 80.
- Skipped #3 (`reviews/pr-209-check-3-medium.md`): "recordCreated clears the stored key when a TaskCreated subject has no" prefix - Decision 6 says TaskCreated defines the key, so a re-created task starts clean.
- (Moved 2026-11-26 to a new numberless slice, Process-key review follow-ups.) Open follow-ups: pr-209-medium #1 (an index on `items.updated_at` needs a migration), pr-209-check-2-medium #3 (a TaskUpdate rename does not rename the step), pr-209-check-3-medium #2 (`storeKeyOnly` never sends a key change that arrives without a status) and #4 (`counts: {}` clears stored counts).

#### For CLAUDE.md (lifted 2026-11-25)

- Step `process`/`counts` keep/clear is one rule, `keptProcess`/`keptCounts` in `src/domain/steps.ts`; a run is only `runStepsOf` in `src/domain/processStats.ts`; never a second copy (Slice 55: docs/plan/slices/55-process-keys.md).

#### Not yet verified

- [session] `process_stats` for the last 30 days returns review and implement keys once the owner's skills send them.
- [session] A task subject `[key] ...` shows on the card step with that key after the plugin update.
