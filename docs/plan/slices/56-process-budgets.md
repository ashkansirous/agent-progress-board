### Slice 56 — Budgets per process, with a live breach on the card

*In progress (wave 2026-11-26), draft PR.* Needs Slice 55 (merged).

**Touches:** `config/board.example.json`, `src/config.ts`, `src/domain/budgets.ts` (new), `src/domain/stepTypes.ts`,
`src/application/board.ts`, `src/api/board.ts`, `src/api/boardDto.ts`, `web/src/model.ts`, `web/src/stepsView.tsx`,
`web/src/stepsText.ts`, `web/src/active.css`, `web/src/ActiveCard.tsx`, `web/src/Tile.tsx`, `web/src/strings.ts`,
`test/`, `e2e/`

**Migrations:** none

Source: phone scope milestone 6 and decision "Context-bloat flag" (approved 2026-11-21).

## Why

A runaway step (a test run past its time, a context past its size) should be visible while it is still running, not
only in a weekly report.

## Decisions

1. Budgets live in the board's private config, per process key: time, tokens, peak context. A default peak-context
   budget of 150k applies to every key without one. The example config uses made-up keys.
2. A breach is derived at read from the running step's start and its last cost report, never stored. The card shows
   the step in orange with "over budget: 9 min of 6"; a context breach with no compaction since says so.
3. The board only flags; gates inside the skills are the owner's config repo's work (scope decision "Enforcement").
4. (Coordinator, wave 2026-11-26, from the premise check.) Cost is recorded only for finished steps: `step_runs` rows
   and `costRefOfStep` exist only once a step is done (`src/domain/stepRuns.ts` `runOf`, `src/domain/steps.ts`
   `costRefOfStep`), and the plugin sends no cost for a running step. So:
   - A **time** breach is live: a running (active) step with a `process` key whose time budget is exceeded, measured
     from its `started_at` to the read time, shows "over budget: 9 min of 6" in orange.
   - A **tokens** or **peak context** breach is shown from the step's cost row once that row exists (a finished step):
     the same orange line, e.g. "over budget: 180k context of 150k"; when the row shows no compaction, the line adds
     "no compaction". A step with a breach that has a cost row keeps showing it after it finishes.
   - Live tokens and context on a running step need the plugin to send a running step's cost, a change to Slice 54's
     writer contract; that is a follow-up (below), not this slice's work.
   - The breach is computed per request by one pure function in `src/domain/budgets.ts` (`breachOf`), with the read
     time passed in; the Worker returns it as data (a `breach` object on the step: kind, used, budget, compacted), and
     the page builds the text from the strings table. Nothing about a breach is stored.
   - A step with no `process` key has no budget except the default peak-context budget (150k), which applies to every
     step with a cost row.
   - Colour: the config palette's `needFg` family (as blocked steps), never a literal. No mock covers this; the slice
     text is the spec.

## Follow-ups

- Live tokens and peak-context breaches on a running step: the plugin sends a running step's cost (a Slice 54
  contract change). For the index pass to plan as its own slice.

## Work

- [ ] **A.** Config shape and validation; `budgets.ts` breach rule with tests.
- [ ] **B.** Card and tile show the breach; strings in the one table.
- [ ] **C.** E2E: a faked running step past its time budget shows the breach.

## Verification

- Unit and E2E tests above; live: a step with a 1-minute test budget, left running 2 minutes, shows the breach.

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need* ("Slice 55 and later").

- 2026-11-25: do not promise "hook added time < 200 ms" in a spec; promise "append-only, no transcript read in the
  hook" and measure the sender instead.
