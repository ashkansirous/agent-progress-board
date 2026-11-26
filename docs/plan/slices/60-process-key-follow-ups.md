### Slice 60 — Process-key review follow-ups (from Slice 55)

*Planned 2026-11-26 by plan-cleanup, moved out of Slice 55.*

**Product:** agent-progress-board.

**Touches:** `src/infrastructure/d1Repository.ts`, `migrations/`, `src/domain/steps.ts`, `plugin/scripts/hooks/task-steps.mjs`, `test/`, `plugin/scripts/hooks/*.test.mjs`

**Migrations:** one (index)

## Why

Four review findings of PR #209 were left out of Slice 55 as not its own work.

## Work

- [ ] An index on `items.updated_at` for `STEP_LISTS_SINCE` (pr-209-medium #1); the read is capped at 1000 rows.
- [ ] A TaskUpdate subject rename of a known task renames the step (pr-209-check-2-medium #3).
- [ ] `storeKeyOnly` in `plugin/scripts/hooks/task-steps.mjs` stores a key change that arrives without a status but sends nothing to the board; decide and make the key reach the card (pr-209-check-3-medium #2).
- [ ] `counts: {}` clears stored counts in `keptCounts` (`src/domain/steps.ts`); decide whether only `null` may clear (Slice 55 Decision 6) and test it (pr-209-check-3-medium #4).
