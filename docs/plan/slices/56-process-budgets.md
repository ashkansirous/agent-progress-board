### Slice 56 — Budgets per process, with a live breach on the card

*Merged as PR #214 (8fd7b2e). Lint, typecheck, npm test and e2e green.* Needs Slice 55 (merged).

*Plan cleanup check 2026-11-26: verdict close. Work items A to C are done and merged. The Follow-ups bullet (live running-step cost) and the four check-medium follow-ups (#1 to #4) are not this slice's own work; they are moved out (a numberless new slice for each, proposed in the cleanup index). Read on origin/main: all four follow-ups are still true (`budgets.processes[step.process]` at `src/domain/budgets.ts:9` has no own-property guard; `breachText` falls through to the context text for any other kind; `readBudgets` in `src/config.ts` has no unknown-key log; the stamped-source rule is at `budgets.ts:25`). The release after PR #214 is a Watch line (deployments read 2026-11-26T02:39:19Z and 02:44:51Z, `wrangler d1 migrations list --remote` "No migrations to apply"; `batch-release.mjs worker-deployed` not yet run), and the live check stays in `unverified.md`.*

*Release check 2026-11-26 21:41Z: `batch-release.json` holds no `workerNotDeployed` or `workerHook` key (last release 2026-11-26T03:29:33Z), so `worker-deployed` has nothing to clear and is no Watch line; origin/main plan.md has no "with the next batched release" line. Deployments list shows 02:39Z, 02:44Z, 05:58Z and 10:04Z; `git log origin/main --since=2026-11-26T02:45Z -- src web migrations config` is empty. The live budget check stays in `unverified.md`.*

**Touches:** `config/board.example.json`, `src/config.ts`, `src/domain/budgets.ts` (new), `src/domain/stepTypes.ts`,
`src/application/board.ts`, `src/api/board.ts`, `src/api/boardDto.ts`, `web/src/model.ts`, `web/src/stepsView.tsx`,
`web/src/stepsText.ts`, `web/src/active.css`, `web/src/ActiveCard.tsx`, `web/src/SessionCards.tsx`, `web/src/Tile.tsx`, `web/src/strings.ts`,
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
   - A finished step keeps its **time** breach too: time used is the cost row's duration when present, else `done_at`
     minus `started_at` (`breachOf` in `src/domain/budgets.ts`). A running step shows a time breach only on a live card
     (`isLiveCard`), never on a stale, expired or crashed one.
   - Rules in `breachOf` / `firstBreach` (pass 2 review): one line per step, for a finished step in the order peak
     context, then tokens, then time (a running step has only time), so the context-bloat flag is never hidden. A cost
     row drives a breach only when `isShownCost` says so. The `done_at - started_at` fallback is used only when neither
     `started_source` nor `done_source` is `stamped`; otherwise, with no shown cost duration, there is no time breach.
     A running step keeps measuring from `started_at`. `firstBreach` prefers a running step's breach over a finished
     one's, then tree order.
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

- [x] **A.** Config shape and validation (`src/config.ts`, example config); `breachOf` / `withBreaches` in `src/domain/budgets.ts` with tests.
- [x] **B.** Breach on steps in the board DTO (`src/api/board.ts`); `breachText` / `firstBreach` in `web/src/stepsText.ts`; orange row via `var(--needFg)` in `stepsView`, Tile, ActiveCard, SessionCards; strings in the one table.
- [x] **C.** E2E (`e2e/active.spec.ts`): a faked running step past its time budget shows the breach.

## Verification

- Unit and E2E tests above; live: a step with a 1-minute test budget, left running 2 minutes, shows the breach.

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need* ("Slice 55 and later").

- 2026-11-25: do not promise "hook added time < 200 ms" in a spec; promise "append-only, no transcript read in the
  hook" and measure the sender instead.

#### From review

- Skipped #4 (`reviews/pr-214-high.md`): "When both peak-context and tokens are over budget only context is returned." - one line per step is the design (Decision 2 shows one "over budget" line).
- Skipped #5 (`reviews/pr-214-high.md`): "`used` is `Math.ceil` of the minutes." - rounding up keeps an over-budget step from reading "6 min of 6", which would look like no breach.
- Skipped #6 (`reviews/pr-214-high.md`): "via `tokenText`" - sizes follow the page's existing `tokenText` format used everywhere else.
- Skipped #4 (`reviews/pr-214-medium.md`): "A process entry `{}` or with all limits skipped is dropped with no log." - an empty process entry has no effect on any breach; nothing is lost.
- Skipped #5 (`reviews/pr-214-medium.md`): "Non-object entry and invalid key share one generic message" - log wording only; the value is still named.
- Skipped #7 (`reviews/pr-214-medium.md`): "colours label and state orange for every breach" - Decision 4 says a finished step keeps showing its breach on the same orange line.
- Applied: `reviews/pr-214-high.md` 1, 2, 3, 7 and #8 (Work items ticked here); `reviews/pr-214-medium.md` 1, 2, 3, 6.
- Follow-up (`reviews/pr-214-check-medium.md` #1): `budgets.processes[step.process]` in `src/domain/budgets.ts` reads inherited properties (e.g. process `constructor`); use `Object.hasOwn` or a null-prototype object.
- Follow-up (`reviews/pr-214-check-medium.md` #2): a running step is timed from a board-stamped `started_at` while finished steps skip stamped sources, so a late report can show "over budget" that vanishes once the step is done.
- Follow-up (`reviews/pr-214-check-medium.md` #3): unknown keys under `budgets` in `src/config.ts` are ignored without a log line (a misspelled `defaultPeak` leaves 150000 in force silently).
- Follow-up (`reviews/pr-214-check-medium.md` #4): `breachText` in `web/src/stepsText.ts` sends every kind other than time/tokens to the context message; return null for an unknown kind.

#### For CLAUDE.md (lifted 2026-11-26)

- A step's budget breach is derived at read only by `breachOf` in `src/domain/budgets.ts` (priority for a finished step: peak context, tokens, time; a running step only time, only on a live card); the page picks the shown one only by `firstBreach` in `web/src/stepsText.ts`; never stored, never a second copy (Slice 56: docs/plan/slices/56-process-budgets.md).

#### Not yet verified

- `[chrome]` Live: a step with a 1-minute test budget, left running 2 minutes, shows the over-budget line on the board (needs the release and a budgets entry in the private config).
- `[owner]` Add real per-process budgets to the board's private config (`BOARD_CONFIG`) when wanted; the default 150k peak-context budget already applies.
