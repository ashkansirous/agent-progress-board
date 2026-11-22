### Slice 57 — Process optimiser: a skill that finds waste in the recorded runs

*Planned.* Needs Slices 55 and 56.

**Touches:** `plugin/skills/process-optimiser/` (new), `plugin/scripts/optimiser/` (new), `plugin/scripts/fixtures/optimiser/` (new),
`src/domain/item.ts`, `src/mcp/schemas.ts`, `src/mcp/instructions.ts`, `plugin/skills/agent-board/SKILL.md`,
`test/pluginRules.test.ts`, `web/src/`, `docs/clients.md`

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

## Work

- [ ] **A.** Detectors and fixtures with tests (`node --test`).
- [ ] **B.** The skill: pulls a week through `query_runs` / `process_stats`, runs the detectors, writes the report.
- [ ] **C.** Item type `finding` (domain, schema, rules text both copies, page section).
- [ ] **D.** Dry-run mode (report only) as the default.
- [ ] **E.** After 4 weeks of reports: cards on (owner reads the reports first).

## Verification

- Every positive fixture is flagged by its detector and no negative fixture is flagged.
- Live: the first weekly dry-run report exists on the board with at least one real run per detector input.
