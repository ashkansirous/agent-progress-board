### Slice 54 — Cost per step: model, tokens, peak context, compactions

*Planned.* Needs Slice 53.

**Touches:** `migrations/0010_step_runs.sql` (new), `src/domain/stepRuns.ts` (new), `src/application/board.ts`,
`src/application/ports.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/mcp/instructions.ts`, `src/index.ts`, `plugin/scripts/step-cost.mjs` (new), `plugin/scripts/step-cost.test.mjs` (new),
`plugin/scripts/hooks/task-steps.mjs`, `plugin/scripts/hooks/session-done.mjs`, `plugin/skills/agent-board/SKILL.md`,
`test/pluginRules.test.ts`, `web/src/ActiveCard.tsx`, `web/src/Detail.tsx`, `test/`, `e2e/`

Source: phone scope milestone 2; desk refinement 2026-11-22 (owner approved: one row of measured facts per step,
statistics worked out at read; cloud sessions keep per-agent totals; transcript read only on a step change or agent stop).

## Why

The owner wants rows like "Implement: 20 min · Sonnet · 300k tokens · peak context 300k", so a reviewer can ask why the
context grew and whether a compact would have helped.

## Decisions

1. When a step ends (or an agent stops), the plugin reads the transcript from its last offset (kept in
   `CLAUDE_PLUGIN_DATA`), sums the requests whose timestamps fall in the step's window by model and token kind, and
   takes the peak context (largest single request's input + cache read + cache creation). Tokens go to the innermost
   step that was active at the request's time for that agent id.
2. One stored row per finished step (`step_runs`): item key, step id, process key (Slice 55, null until then), agent
   id, model(s), start, end, time sources, tokens by kind, peak context, compactions. These are measured facts as
   reported, so the "never store a derived value" rule (Slice 8) holds; medians and totals are worked out at read.
3. Rows are kept 180 days (owner, 2026-11-21), thinned by the cron like usage rows; an archived item's purge after 30
   days (Slice 50) does not delete its step rows.
4. Cloud sessions load no plugin: they keep sending per-agent totals (Slice 28), and get no step rows.
5. Sent through `report_progress` on the step (a `cost` object), never a new write path.

## Work

- [ ] **A.** Migration, domain type and validation, repository insert bound to the steps write in the same batch.
- [ ] **B.** `step-cost.mjs` (offset-cached transcript read, window sum, peak context), called from the step-end and
  agent-stop hooks; tests on fixture transcripts with made-up content.
- [ ] **C.** Card and drawer show "duration · model · tokens · peak context" per step; no cost shown for stamped times.
- [ ] **D.** Cron thinning at 180 days; reporting rules text and plugin release.

## Verification

- A fixture transcript with two steps and a compaction gives the right tokens, peak context and compaction count per
  step (unit tests).
- Live: a real slice build's card shows the cost line on its implement step, and `get_item` returns the same numbers.
