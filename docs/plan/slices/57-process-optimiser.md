### Slice 57 — Process optimiser: a skill that finds waste in the recorded runs

*In progress (wave 2026-11-26), draft PR.* Needs Slices 55 and 56 (both merged).

**Touches:** `plugin/skills/process-optimiser/` (new), `plugin/scripts/optimiser/` (new), `plugin/scripts/fixtures/optimiser/` (new),
`src/domain/item.ts`, `src/mcp/schemas.ts`, `src/mcp/instructions.ts`, `plugin/skills/agent-board/SKILL.md`,
`test/pluginRules.test.ts`, `web/src/`, `docs/clients.md`, `migrations/0012_findings.sql` (new),
`test/migration0012.test.ts` (new), `config/board.example.json`, `src/config.ts`, `src/domain/boardGroups.ts`,
`src/api/board.ts`, `src/api/boardDto.ts`, `src/infrastructure/d1Repository.ts`, `test/`, `e2e/`, `scripts/seed-data.ts`,
`plugin/CLAUDE.md`, `docs/plan/unverified.md`

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

## Work

- [ ] **A.** Detectors and fixtures with tests (`node --test`).
- [ ] **B.** The skill: pulls a week through `query_runs` / `process_stats`, runs the detectors, writes the report.
- [ ] **C.** Item type `finding` (domain, schema, rules text both copies, page section).
- [ ] **D.** Dry-run mode (report only) as the default.
*Watch:* after 4 weeks of dry-run reports (from the first live report), the owner reads them; then a new slice turns
finding cards on (`--file-findings` as the default). Former item E; Decision 11.

## Verification

- Every positive fixture is flagged by its detector and no negative fixture is flagged.
- Live: the first weekly dry-run report exists on the board with at least one real run per detector input.

## Changes from the Slice 52 spike (2026-11-25)

Source: [note](../notes/2026-11-22-timeline-spike.md), *Changes Slices 53 to 57 need* ("Slice 55 and later").

- 2026-11-25: do not promise "hook added time < 200 ms" in a spec; promise "append-only, no transcript read in the
  hook" and measure the sender instead.
