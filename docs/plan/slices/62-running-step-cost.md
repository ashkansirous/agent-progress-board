### Slice 62 — A running step reports its cost, so tokens and context breaches show live

*Planned 2026-11-26 by plan-cleanup, moved out of Slice 56 (*Follow-ups*).*

**Product:** agent-progress-board.

**Touches:** `src/domain/stepRuns.ts`, `src/domain/steps.ts`, `src/domain/budgets.ts`, `plugin/`, their tests

Needs Slices 54 and 56 (merged).

## Why

Slice 56 shows a live breach for time only. Cost exists only for finished steps (`runOf` in `src/domain/stepRuns.ts`, `costRefOfStep` in `src/domain/steps.ts`), and the plugin sends no cost for a running step, so a context bloat shows only after the step ends.

## Work

- [ ] The plugin sends a running step's measured cost (tokens, peak context, compaction) with the heartbeat report; a change to Slice 54's writer contract (`src/domain/stepRuns.ts`, `plugin/`).
- [ ] The Worker accepts it for an active step and `breachOf` (`src/domain/budgets.ts`) uses it, still derived at read and never stored.
- [ ] Tests, and an e2e of a running step over its context budget.

## Decisions

1. Reporters stay fail-open and append-only (no transcript read in the hook beyond what Slice 54 already allows).
2. The one-line-per-step rule of Slice 56 stays.
