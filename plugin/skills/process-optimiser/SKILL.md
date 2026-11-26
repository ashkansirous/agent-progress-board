---
name: process-optimiser
description: Find wasted tokens and time in the agent board's recorded runs and write a weekly report. Use when the person asks to "optimise the process", "find waste in our runs", "run the process optimiser", or for the weekly optimiser run. Reads finished steps through the board's query_runs, runs eight detectors, writes one report card (a dry run by default); finding cards are filed only with --file-findings.
---

# Process optimiser

Reads a week of finished steps (`query_runs`) from the board, runs the detectors on each project's rows and writes the
weekly report card. The board edits no repo: each proposed change is for the owner to approve in their own repo.

## Run it

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/optimiser/optimise.mjs" --config <optimiser config json> [--project <slug>] [--days 7]
```

- **Dry run is the default.** It writes one card, `<project>/optimiser-report-<ISO week>` (an `unplanned` card, done),
  whose details list every finding. No `finding` card is filed.
- `--file-findings` also files one card of type `finding` per finding (key `<project>/finding-<detector>-<hash>`, the
  same card every week for the same detector and process): evidence runs, numbers, estimated saving and the proposed
  change are in its details. Do not pass it until the owner has read four weeks of dry-run reports and asked for it.
- Board address and token: the plugin's options (or `AGENT_BOARD_URL` / `AGENT_BOARD_TOKEN`), as for the reporter.
  The script fails open: any problem is one line on stderr and exit 0.
- Run it weekly and on demand; the schedule is the owner's, set in their own config.

## The config

One JSON file the caller names. A made-up example is `scripts/fixtures/optimiser/config.json` in this plugin. Nothing in the
code names a process, a model or a threshold. A detector whose section is missing finds nothing.

- `approval`: `{ "<approval process key>": ["<gated process key>", ...] }`: the gated steps must not start before the
  approval step is done.
- `budgets`: the board's own shape, `{ "processes": { "<key>": { "minutes": 6, "peakContext": 150000 } } }`.
- `fanOut`: `{ "minSiblings": 3 }`; `serial`: `{ "independent": [["<key>", "<key>"]], "maxGapSeconds": 600 }`;
  `duplicate`: `{ "minRepeats": 2 }`; `reviews`: `{ "processes": ["<key>"], "minPass": 2, "maxYieldPer100kTokens": 2,
  "findingsCount": "findings", "fixesCount": "fixed" }`; `contextBloat`: `{ "peakContext": 150000 }`;
  `bigModel`: `{ "mechanical": ["<key>"], "models": ["<part of a model name>"] }`.

## The detectors

Each is a pure function in `scripts/optimiser/detectors.mjs` over the rows; a row's start and end count only when both are
set (a stamped-only row is skipped, never guessed), and a figure with no data is "not known", never 0.

1. **fan-out**: the same process redone across N siblings (rows of one item with different labels, counting only the labels that ran at least twice, so `minSiblings` counts redone siblings, not one-off steps), after each change.
2. **approval**: a gated step started before its approval step was done.
3. **serial**: steps the config calls independent that ran one after the other.
4. **over-budget**: runs longer than the process's `minutes` budget.
5. **duplicate**: the same process and label done more than once in one item.
6. **low-yield**: a later review pass whose findings plus fixes per 100,000 tokens fall under the threshold.
7. **context-bloat**: a step whose largest request passed the limit with no compaction.
8. **big-model**: a mechanical process that used a big model.

## After it runs

Tell the person the report card's key and how many findings it holds, and name anything that was skipped (the stderr
lines). Do not file or change anything in their repos.
