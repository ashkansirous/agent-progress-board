### Slice 56 — Budgets per process, with a live breach on the card

*Planned.* Needs Slice 55.

**Touches:** `config/board.example.json`, `src/config.ts`, `src/domain/budgets.ts` (new), `src/application/board.ts`,
`web/src/ActiveCard.tsx`, `web/src/Tile.tsx`, `web/src/strings.ts`, `test/`, `e2e/`

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
