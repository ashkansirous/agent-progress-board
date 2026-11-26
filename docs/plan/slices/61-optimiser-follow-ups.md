### Slice 61 — Optimiser detector and discovery follow-ups

*Planned 2026-11-26 by plan-cleanup, moved out of Slice 57.*

**Product:** agent-progress-board.

*Checked 2026-11-26 by plan-cleanup-check against origin/main (8e7c155 is the last optimiser commit): keep open. All 7 items are still unbuilt (maxGap Infinity at detectors.mjs:168, `compactions === 0` at :291, `new Date(parsed.now)` unchecked at optimise.mjs:38). No waits, no outside events.*

**Touches:** `plugin/scripts/optimiser/detectors.mjs`, `plugin/scripts/optimiser/optimise.mjs`, their tests

## Why

Slice 57's review passes left 7 follow-ups, skipped because the optimiser is report-only by default. They matter before
`--file-findings` becomes the default.

## Work

- [ ] Serial detector: `maxGap` defaults to Infinity and a repeated process joins a chain (pr-217-check-medium #4).
- [ ] Duplicate detector flags any repeat of the same process and label, even after a fix ran between (check-medium #5).
- [ ] Findings never close for a project found only by discovery (check-2-medium #1).
- [ ] In discovery mode the discovery notice marks every project partial (check-2 #2).
- [ ] Context-bloat detector: treat missing `compactions` as unknown and say so, or use `!row.cost.compactions` (check-2 #3).
- [ ] An invalid `--now` gives an Invalid Date; refuse it (check-2 #4).
- [ ] Ranking sums seconds and tokens/100000, two units; rank by a stated rule (check-2 #5, high #8).

Source: `docs/plan/slices/57-process-optimiser.md`, *From review*. The review files are `reviews/pr-217-*.md`.
