### Slice 57 — Process optimiser: a skill that finds waste in the recorded runs

*Built (wave 2026-11-26), merged as PR #217 (6513635), not yet verified live (first weekly report, owner's 4-week read). Checks 2026-11-26 02:21-02:24Z: lint and typecheck clean; vitest 981, node 570, e2e 344 passed (6 skipped).* Needs Slices 55 and 56 (both merged).

**Touches:** `plugin/skills/process-optimiser/` (new), `plugin/scripts/optimiser/` (new), `plugin/scripts/fixtures/optimiser/` (new),
`src/domain/item.ts`, `src/mcp/schemas.ts`, `src/mcp/instructions.ts`, `plugin/skills/agent-board/SKILL.md`,
`test/pluginRules.test.ts`, `web/src/`, `docs/clients.md`, `migrations/0012_findings.sql` (new),
`test/migration0012.test.ts` (new), `config/board.example.json`, `src/config.ts`, `src/domain/boardGroups.ts`,
`src/api/board.ts`, `src/api/boardDto.ts`, `src/infrastructure/d1Repository.ts`, `test/`, `e2e/`, `scripts/seed-data.ts`,
`plugin/CLAUDE.md`, `docs/plan/unverified.md`, `plugin/scripts/report-progress.mjs` (widened in fix 1: `callTool` returns the
board's cut notice)

**Migrations:** 0012

Source: phone scope milestone 5 and decisions "Where the optimiser lives", "What findings produce", "Optimiser cadence"
(approved 2026-11-21); desk refinement 2026-11-22, question 4 and the detector answer (owner approved).

## Why

The owner's goal is fewer wasted tokens and less time across their agents. The data from Slices 53 to 56 is only
useful if something reads it and proposes concrete changes with evidence.

## Decisions

1. A skill in this repo's plugin, `process-optimiser`, with generic detectors only; thresholds, budgets and process
   names come from config or the caller, never the code (public repo).
2. Eight detectors, each a pure function over `query_runs` rows: repeated fan-out (the same step redone across N
   siblings after each change), work done before an approval step finished, independent steps run in series, a
   process over its time budget, duplicate work inside a run, low-yield reviews (findings and fixes per pass against
   tokens), context bloat with no compact, a big model on a mechanical step.
3. Proof before use: fixture runs (made-up projects) replay the owner's four example patterns (a series of books
   rebuilt for every change, a test suite over an hour, translation before the owner's read, a second review pass that
   adds little); each detector flags its pattern. Negative fixtures must not be flagged: a test suite under its 6-minute
   budget, and a translation step that starts only after an approval step is done.
4. Then a 4-week dry run on real data: the weekly report is written, no finding cards are filed. After 4 weeks the
   owner reads the reports and the slice's last item turns cards on.
5. Output: one card per finding (a new item type `finding`: evidence runs, numbers, estimated saving, the proposed
   skill change) plus one weekly report card; the owner approves each change in their own repos. The board edits no
   repo.
6. Runs weekly and on demand; the schedule is the owner's (planned in their private config repo).
7. (Coordinator, 2026-11-26, from the premise check on origin/main eab3e72.) Inputs: the detectors read only `query_runs`
   rows (`RunRow` in `src/domain/processStats.ts`: item_key, project, step_id, label, process, started_at, done_at,
   duration_seconds, counts, cost) plus one optimiser config object the caller passes (a JSON file path given to the
   script; a made-up example under `plugin/scripts/fixtures/optimiser/`). Rows carry no parent or sibling link, so
   "siblings" are the rows of one `item_key` with the same `process`; series vs parallel and fan-out use only rows whose
   `started_at` and `done_at` are both set (stamped-only rows are skipped, never guessed). "Approval" has no marker in
   the data: the config names the approval process keys and, per approval key, the process keys that must not start
   before it is done (`{ "approval": { "<approval key>": ["<gated key>", ...] } }`). Time budgets for detector 4 come from
   the config in the same shape as the board's `budgets` (Slice 56), never from the code. "Mechanical" process keys and
   the "big" model names for detector 8 are config lists. A detector with no config for it returns no findings.
8. The script calls the board itself over MCP HTTP like `report-progress.mjs` (`callTool`: `query_runs`, then
   `upsert_item`/`report_progress` for the report), and fails open (exit 0, one skip line) as every plugin client does.
   The detectors are pure functions in their own module and are tested on fixture rows with no network.
9. The weekly report card reuses an existing type: an `unplanned` task card (key `<project>/optimiser-report-<ISO week>`)
   whose details hold the findings; it needs no new type. A `finding` card is the new item type (migration 0012 rebuilds
   the items table's type CHECK the way 0007 did, `test/migration0012.test.ts` like `test/migration0007.test.ts`), with
   a palette entry in `config/board.example.json` and its own group in `groupBoard` (`src/domain/boardGroups.ts`); the
   page shows that group and never regroups.
10. Dry run is the default (D): the report card is written, no `finding` cards are filed. Filing cards needs an explicit
    flag (`--file-findings`), which E turns on; until then the flag exists and is tested on fixtures only.
11. E waits on four weeks of reports, an outside event, so it is not this wave's work: a *Watch* line, not a task that
    holds the slice open.
12. (Fix pass 1.) With `--file-findings`, a finding card filed again keeps its key: a card that is done or archived is
    left alone (never reopened), an open one is updated with no `status` sent. An open `finding` card of the project
    that the week no longer produces is closed with `mark_done`, but only when the week was read in full (no board
    notice, fewer than 1000 rows) and the open cards were listed whole. A dry run files and closes nothing. A reply
    the board cut (its note is the second text block) marks the report "Partial read" and carries the board's note.
13. (Fix pass 2.) `query_runs` is read once per project, each read with its own row cap (1000) and its own partial flag.
    The projects are `--project`, else the optimiser config's `projects` list, else the projects one unfiltered first
    read returned. `closeGone` runs per project, only when that project's own read was full (no board notice, fewer
    than 1000 rows), and also for a project with no runs in the window (its open finding cards are closed). A project
    whose read failed is skipped. The approval detector compares a gated run with the first approval run of its key in
    that item and flags it only when it started before that approval finished. Open findings count where the other
    lists count: `isQuiet` (`web/src/foldRules.ts`) is false for a project that has any, so it does not fold closed.

14. (Fix pass 3.) The script marks its own close: when it closes a finding card it sends a report (status done) whose
    details end with the line `CLOSE_MARKER` (`plugin/scripts/optimiser/report.mjs`; `mark_done` takes no details). A done
    card carrying that line is reopened (status open, fresh details) when the finding comes back; a done card without it,
    or any archived card, is the owner's decision and is left alone. An update of an open card sends no status and no
    priority (a priority is sent only for a new card). When the first, unfiltered discovery read of the projects is cut
    or full, the project list may be missing projects: the log says so, every discovered project's report is marked
    "Partial read" and no card is closed.

## Work

- [x] **A.** Detectors and fixtures with tests (`node --test`).
- [x] **B.** The skill: pulls a week through `query_runs` / `process_stats`, runs the detectors, writes the report.
- [x] **C.** Item type `finding` (domain, schema, rules text both copies, page section).
- [x] **D.** Dry-run mode (report only) as the default.
*Watch:* after 4 weeks of dry-run reports (from the first live report), the owner reads them; then a new slice turns
finding cards on (`--file-findings` as the default). Former item E; Decision 11.

## Verification

- Every positive fixture is flagged by its detector and no negative fixture is flagged.
- Live: the first weekly dry-run report exists on the board with at least one real run per detector input.

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need* ("Slice 55 and later").

- 2026-11-25: do not promise "hook added time < 200 ms" in a spec; promise "append-only, no transcript read in the
  hook" and measure the sender instead.

*Changed while building:* the plan's Touches widened to `plugin/scripts/report-progress.mjs` (review fix 1). Migration
`0012_findings.sql` rebuilds the `items` type CHECK to admit `finding`.

#### From review

Findings read: `reviews/pr-217-high.md` 8/8, `reviews/pr-217-medium.md` 6/6, `reviews/pr-217-check-medium.md` 6/6,
`reviews/pr-217-check-2-medium.md` 5/5. Applied: high 1 2 3 4 5 7; medium 1 2 3 4 6; check-medium 1 2 3 6. Skipped:

- Skipped #6 (`reviews/pr-217-high.md`): "Formatting slip: `&&<Section` has no space after `&&`" - whitespace style only; lint passes.
- Skipped #5 (`reviews/pr-217-medium.md`): "Formatting slip: `&&<Section` has no space after `&&`" - whitespace style only; lint passes (same as high #6).
- Skipped #8 (`reviews/pr-217-high.md`): "`detectAll` ranks findings by adding seconds to tokens divided by 100,000, two unrelated units" - changes only the order inside the report; every finding is still listed with its own numbers.
- Skipped #4 (`reviews/pr-217-check-medium.md`): "The serial detector has `maxGap` default Infinity, and a repeated process joins the chain" - detector tuning on a dry-run report; no card is filed by default. Follow-up.
- Skipped #5 (`reviews/pr-217-check-medium.md`): "The duplicate detector flags any repeat of the same process and label, even after a fix ran between" - heuristic edge in a report-only detector. Follow-up.
- Skipped #1 (`reviews/pr-217-check-2-medium.md`): "Findings never close for a project found only by discovery" - converged after the second check pass: no crash, data loss, security or privacy issue; the card paths run only with `--file-findings`, off by default. Follow-up.
- Skipped #2 (`reviews/pr-217-check-2-medium.md`): "In discovery mode the discovery notice marks every project partial" - same reason as #1. Follow-up.
- Skipped #3 (`reviews/pr-217-check-2-medium.md`): "treat missing as unknown (and say so) or use `!row.cost.compactions`" - same reason as #1. Follow-up.
- Skipped #4 (`reviews/pr-217-check-2-medium.md`): "An invalid `--now` gives an Invalid Date" - same reason as #1. Follow-up.
- Skipped #5 (`reviews/pr-217-check-2-medium.md`): "Ranking sums seconds and tokens/100000, mixed units" - same reason as #1 (repeat of high #8). Follow-up.

#### For CLAUDE.md (lifted 2026-11-26)

- Detectors are pure functions in `plugin/scripts/optimiser/detectors.mjs`; every threshold comes from the caller's config, never from code. The finding-card keep/close rule (Decision 14 close marker) lives only in `plugin/scripts/optimiser/optimise.mjs`; never a second copy. A run is a dry run by default; only `--file-findings` files cards (Slice 57: docs/plan/slices/57-process-optimiser.md).

#### For README.md (lifted 2026-11-26)

- `process-optimiser` skill: reads a week of finished steps and writes a dry-run report of waste (serial steps, repeats, over-budget, approval order); finding cards only with `--file-findings`.

#### Not yet verified

- [session] The first weekly dry-run report exists on the board with at least one real run per detector input.
- [owner] Four weeks of dry-run reports read, then a slice that turns `--file-findings` on by default (link: `<board address>/`).
