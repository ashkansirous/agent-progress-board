### Slice 63 — Budget hardening: four review follow-ups from Slice 56

*Planned 2026-11-26 by plan-cleanup, moved out of Slice 56.*

**Product:** agent-progress-board.

**Touches:** `src/domain/budgets.ts`, `src/config.ts`, `web/src/stepsText.ts`, their tests

Moved from Slice 56 (`reviews/pr-214-check-medium.md` #1 to #4). Needs Slice 56 (merged).

## Why

Four small defects found in review of PR #214, all still present on `origin/main` (read 2026-11-26).

## Work

- [ ] **1.** `budgets.processes[step.process]` (`src/domain/budgets.ts:9`) reads inherited properties (a process named `constructor`); use `Object.hasOwn` or a null-prototype object. Test with `constructor` and `__proto__`.
- [ ] **2.** A running step is timed from a board-stamped `started_at` while a finished step skips stamped sources, so a late report can show "over budget" that vanishes when the step is done. Make the two agree (one rule in `breachOf`), with a test.
- [ ] **3.** Unknown keys under `budgets` in `src/config.ts` (`readBudgets`) are ignored silently (a misspelled `defaultPeak` leaves 150000 in force); log each unknown key by name.
- [ ] **4.** `breachText` in `web/src/stepsText.ts` sends every kind other than time or tokens to the context message; return null for an unknown kind.
