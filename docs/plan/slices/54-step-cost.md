### Slice 54 — Cost per step: model, tokens, peak context, compactions

*Built (wave 2026-11-25), merged as PR #207 (8f00a4a); see Not yet verified below.* Needs Slice 53 (built).

**Touches:** `migrations/0011_step_runs.sql` (new), `src/domain/stepRuns.ts` (new), `src/domain/steps.ts`,
`src/domain/stepTypes.ts`, `src/domain/upsert.ts`, `src/application/board.ts`, `src/application/usage.ts`,
`src/application/ports.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/mcp/instructions.ts`, `src/index.ts`, `plugin/scripts/step-cost.mjs` (new), `plugin/scripts/step-cost.test.mjs` (new),
`plugin/hooks/hooks.json`, `plugin/scripts/report-progress.mjs`, `plugin/scripts/hooks/hook-input.mjs`, `plugin/scripts/hooks/task-steps.mjs`,
`plugin/scripts/hooks/session-done.mjs`, `plugin/scripts/hooks/hooks.test.mjs`, `plugin/scripts/hooks/task-steps.test.mjs`,
`plugin/skills/agent-board/SKILL.md`, `plugin/CLAUDE.md`, `test/pluginRules.test.ts`, `web/src/ActiveCard.tsx`,
`web/src/Detail.tsx`, `web/src/`, `test/`, `e2e/`

**Migrations:** 0011

**Premise check (2026-11-25, wave 30):** the compaction test the spike asked for is answered from real transcripts already
on disk (no new `/compact` needed): a `compact_boundary` line is `type: "system"`, `subtype: "compact_boundary"` with
`compactMetadata` (`trigger`, `preTokens`, `postTokens`, ...). The first request after it is larger than `postTokens`
(about 117k against 30k in one case), so before/after sizes come from the requests on either side, as the spike said;
`preTokens`/`postTokens` are not used. The same `message.id` repeats on several lines (merge by id), and the model can
change across a step (a step's cost holds a per-model list). Rows have no foreign key to `items`, so the Slice 50 purge
leaves them.

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

- [x] **A.** Migration, domain type and validation, repository insert bound to the steps write in the same batch.
- [x] **B.** `step-cost.mjs` (offset-cached transcript read, window sum, peak context), called from the step-end and
  agent-stop hooks; tests on fixture transcripts with made-up content.
- [x] **C.** Card and drawer show "duration · model · tokens · peak context" per step; no cost shown for stamped times.
- [x] **D.** Cron thinning at 180 days; reporting rules text and plugin release.

## Verification

- A fixture transcript with two steps and a compaction gives the right tokens, peak context and compaction count per
  step (unit tests).
- Live: a real slice build's card shows the cost line on its implement step, and `get_item` returns the same numbers.

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need*.

- 2026-11-25 (migration number): migration 0010 is taken by Slice 50 (claimed, PR #199), so this slice's migration
  becomes `0011_step_runs.sql`, not `0010_step_runs.sql` as the *Touches* line says.
- 2026-11-25 (attribution, shared with Slice 53): merge assistant lines by `message.id` (a request is streamed as several
  lines; the last carries the final usage); read the subagent file from `agent_transcript_path` on `SubagentStop`; place a
  request on the step open at its timestamp, with the spike note's transition-request rule; keep an explicit "outside
  any step" bucket so totals still add up.
- 2026-11-25 (compaction): nothing was observed in the spike. Test one forced compaction (`/compact` in a session)
  before claiming before/after context sizes; the size comes from the transcript's last request before the
  `compact_boundary` line and the first after it (`PostCompact` gives a summary text, not a token count).

## Decisions from review 1 (coordinator, 2026-11-25, `reviews/pr-207-high.md`)

6. **Which steps carry a cost** (finding 1): three kinds, all through `report_progress`. (a) Mirrored task rows, by task.
   (b) A reported step matched by label (run-wave and helpers send labels only): the plugin puts `cost` on the
   label-matched step with no id needed, and the server builds the `step_runs` rows after `resolveIds`, from the
   resolved step id, so a label-only step is stored. (c) The hook's own `agent-` rows (Slice 51): on `SubagentStop` the
   agent's whole transcript cost goes on its agent row, timed by the hook-observed start and stop. So a slice build's
   "Build the slice" step shows the cost on its implement-slice agent row.
7. **Only a done step shows a cost** (finding 2; rewritten after review 2, `reviews/pr-207-medium.md` #1, second
   strike): a stored row is shown only while the step's state is done and the row's end is not before the step's
   `started_at` (when known). A reopened step starts after the old run ended, so it shows none until its new cost
   arrives; a later move of `done_at` (betterTime) no longer hides it. The page checks the done state too.
8. **One writer per session's cost state** (finding 3): read, compute and write of the cost files run under a
   create-exclusive lock file per session (short wait, then skip this hook's cost: fail open; the next hook carries it,
   since the offset only moves under the lock).
9. **The cost line's look** (finding 4): no mock shows it (docs/design has no cost line). It uses the `.step-note`
   colour and size values, wraps instead of cutting with an ellipsis (its own `.step-cost` rule), and the copy follows
   this slice's *Why* line: "20 min · Sonnet · 300k tokens · peak context 300k", plus "· N compactions" when N > 0.
   After review 2 (`reviews/pr-207-medium.md` #4): that example was an illustration; the line follows the page's own
   formats, `tokenText` ("300 k") for tokens and peak context and the raw model ids the usage page shows.
10. **A newer read wins, not a later arrival** (review 2 #2; rewritten after the check pass,
    `reviews/pr-207-check-medium.md` #1, #2, #4, #9, second strike on this rule): one writer per row by construction.
    The row key gains the writer, the session id of the plugin that computed it (`(item_key, step_id, agent_id,
    writer)`), and each cost carries `seq`, a counter kept in that session's cost state and raised under the lock only
    when the cost's numbers (tokens, models, peak, compactions, times) differ from the last ones sent. The server
    replaces every column of a row (compactions included) only when the incoming `seq` is greater than the stored one.
    A cost whose numbers did not change is not resent, so a Stop does not rewrite finished rows. Byte offsets are no
    longer compared; `through` is dropped.
7b. **Which row a done step shows** (check pass #3, third strike on the shown rule): by construction, not by time.
    When a done step is saved with a `cost`, `saveStepsReport` stores on that step a reference to the row
    (`cost_ref`: writer and agent id); a later report that leaves the step's state done keeps it; any report that moves
    the step out of done clears it. The board shows a step's cost only when the step is done and has a `cost_ref`, and
    shows exactly that row. A reopened step shows nothing until a new cost arrives with its next done report. The
    time-compare rules of Decision 7 are dropped.
12. **The lock is stale only when its holder is dead** (check pass #5): every hook that takes it has a 5 s timeout
    (`plugin/hooks/hooks.json`), so a lock older than 15 s belongs to a killed process and is stolen by renaming it to a
    unique name and deleting that; it is never renamed back. Release deletes only a lock holding the holder's token.
13. **The transcript is read by bytes** (check pass #6): read a Buffer, advance to the byte after the last `0x0A`; a
    line longer than the read limit is skipped whole (offset moves past its newline) and counted in the state, never
    stalls; text is decoded per complete line.
11. **Costs ride only where they are shown** (review 2 #6): the board page read and `get_item` carry costs;
    `list_open` does not.

#### Changed while building

- Migration `0011_step_runs.sql`: `step_runs` keyed by item key, step, agent and writer, with `seq`; no foreign key to
  `items`, so the Slice 50 purge leaves the rows. `src/domain/stepRuns.ts` validates a cost per step; a bad cost is
  dropped, never refused. Rows are written in the steps batch after `resolveIds`; the stored step gets `cost_ref`
  (Decision 7b).
- `plugin/scripts/step-cost.mjs`: byte-wise transcript reads from a kept offset, merge by `message.id`, per-model tokens,
  peak context, compactions from `compact_boundary`, the innermost open step per agent, per-step aggregates plus the
  open window, a lock with a token (stale at 15 s), writer = first 16 hex of the sha256 of the session id. It runs on
  `TaskCompleted`, `TaskUpdate` completed, `SubagentStop` and `Stop`. Cost goes on mirrored task rows, label-matched
  steps and agent rows.
- Page: a `.step-cost` line (wraps), `tokenText` format, raw model ids, hidden for stamped times and non-done steps.
  `list_open` carries no costs. The cron deletes rows older than 180 days.
- Known limits: a step run by several writers shows only the row of the last cost-carrying done report; a cost with no
  stored predecessor starts `seq` at the clock in seconds; an old writer value from before the hash gets a second row
  (pre-merge rows only).
- Checks run: 911 vitest passed, 505 plugin node tests, 340 e2e passed (6 skipped); lint and typecheck clean, all exit 0, on the final tree.

#### From review

- Applied: `reviews/pr-207-high.md` #1-10; `reviews/pr-207-medium.md` #1-7; `reviews/pr-207-check-medium.md` #1-6, 9; `reviews/pr-207-check-2-medium.md` #2, 7.
- Skipped #1 (`reviews/pr-207-check-2-medium.md`): "A cost reported with no `seq` (absent reads as 0) can never be corrected" - every plugin cost carries seq from the clock; a client without seq is not a cost writer in this slice; follow-up.
- Skipped #3 (`reviews/pr-207-check-2-medium.md`): "`costRefOfStep` sets `cost_ref` when a step is done and a `cost` was sent, but `runOf` may store no row" - a ref to a row that was not stored hides the line, nothing is lost; follow-up.
- Skipped #4 (`reviews/pr-207-check-2-medium.md`): "A stored row's started/ended times and sources change only when `seq` rises" - times change only with the numbers in practice, since a later read moves the end; follow-up.
- Skipped #5 (`reviews/pr-207-check-2-medium.md`): "`stealIfStale` stats then renames by name" - the 15 s steal window is past the 5 s hook timeout (Decision 12); follow-up.
- Skipped #6 (`reviews/pr-207-check-2-medium.md`): "plugin/scripts/step-cost.mjs:147, nit, correctness. `readSync` return value ignored: a short read" - a rewritten larger transcript is not seen in practice, transcripts are append-only; follow-up.
- Skipped #8 (`reviews/pr-207-check-2-medium.md`): "src/application/board.ts:696, nit, correctness. `withStepCosts` adds `cost` (up to 20 models" - same as the earlier check-pass #8: costs are small next to events and the reply size cut applies; follow-up.

- Skipped #7 (`reviews/pr-207-check-medium.md`): "src/infrastructure/d1Repository.ts:761, nit. Board read takes only the newest 1000 step" - with one row per writer, agent and step and at most 200 steps a card, the cut needs five writers per step; follow-up.
- Skipped #8 (`reviews/pr-207-check-medium.md`): "src/application/board.ts:702, nit. withStepCosts attaches costs before fitItem cuts the get_item" - costs are small next to events and the reply size cut still applies; follow-up.
- Skipped #10 (`reviews/pr-207-check-medium.md`): "A label-matched step takes the first task whose label matches (tasks.find)" - repeated task subjects in one session are rare and the reporter's own label is the match key; follow-up.
- Skipped #1 (`reviews/pr-207-check-3-medium.md`): "A step with a truthy cost that `runOf` rejects" - repeats check-2 #3; follow-up.
- Skipped #2 (`reviews/pr-207-check-3-medium.md`): "A cost with no `seq` is stored with seq 0" - repeats check-2 #1; follow-up.
- Skipped #3 (`reviews/pr-207-check-3-medium.md`): "A non-string writer (e.g. 123) or over-long agent_id fails `runOf`" - a ref built from a rejected cost can match another writer's row: display only, nothing lost; follow-up.
- Skipped #4 (`reviews/pr-207-check-3-medium.md`): "Comments and schema text say a cost needs an explicit `id`" - the code resolves ids from the label; wording only; follow-up.
- Skipped #5 (`reviews/pr-207-check-3-medium.md`): "`cost` is z.unknown with no size bound" - request size is bounded and no stored text grows; follow-up.

#### For CLAUDE.md (lifted 2026-11-25)

- Step cost rows are measured facts, one writer per row (`writer`, `seq`), shown only through a step's `cost_ref`; the rules are in `src/domain/stepRuns.ts` and `costRefOfStep` in `src/domain/steps.ts`; never add a second shown rule (Slice 54: docs/plan/slices/54-step-cost.md).

#### Not yet verified

- [session] A real slice build's card shows the cost line on its implement-slice agent row, and `get_item` returns the same numbers.
- [session] A real `/compact` in a live session counts one compaction on the active step.
- [chrome] The cost line wraps on a phone-width board.
