// Fixture runs for the process optimiser (Slice 57), in the shape of the board's `query_runs` rows. Made-up projects only.
// POSITIVE has, per detector, runs that detector must flag (the owner's four example patterns are fanOut, overBudget,
// approval and lowYield); NEGATIVE holds runs that look alike and must not be flagged by any detector.
import { DETECTORS } from '../../optimiser/detectors.mjs';

const BASE = Date.parse('2026-11-16T09:00:00.000Z');
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;
export const FIXTURE_PROJECT = 'book-shop';
export const FIXTURE_NOW = '2026-11-23T10:00:00.000Z';

const at = (minutes) => new Date(BASE + minutes * MS_PER_MINUTE).toISOString();

function cost(totalTokens, { peak = 20_000, compactions = 0, model = 'model-small' } = {}) {
  return {
    models: [{ model, input_tokens: totalTokens, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 }],
    input_tokens: totalTokens, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, total_tokens: totalTokens,
    peak_context: peak, compactions, duration_seconds: 0, started_source: 'observed', ended_source: 'observed',
  };
}

let counter = 0;
// One finished step: starts `from` minutes after BASE and takes `minutes`.
function run(item, process, label, from, minutes, extra = {}) {
  counter += 1;
  return {
    item_key: `${FIXTURE_PROJECT}/${item}`, project: FIXTURE_PROJECT, step_id: `s${counter}`, label, process, process_source: 'reported',
    started_at: at(from), done_at: at(from + minutes), duration_seconds: minutes * SECONDS_PER_MINUTE, counts: null, cost: null, ...extra,
  };
}

const books = (item, count) => Array.from({ length: count }, (_, index) => run(item, 'build/book', `Rebuild book ${index + 1}`, index * 10, 10));

// Every book rebuilt again after a change: the same labels in two rounds.
const rebuiltTwice = (item, count) => [...books(item, count), ...books(item, count).map((row, index) => run(item, row.process, row.label, 60 + index * 10, 10))];

export const POSITIVE = {
  // A series of books rebuilt, one after the other, after each change.
  [DETECTORS.fanOut]: rebuiltTwice('fan-out-positive', 3),
  // Translation started before the owner's read was done.
  [DETECTORS.approval]: [
    run('approval-positive', 'text/owner-read', 'Owner reads the text', 0, 60),
    run('approval-positive', 'translate/chapter', 'Translate chapter 3', 30, 60, { cost: cost(200_000) }),
  ],
  // Two independent reviews, one after the other.
  [DETECTORS.serial]: [
    run('serial-positive', 'review/security', 'Security review', 0, 20),
    run('serial-positive', 'review/style', 'Style review', 20, 20),
  ],
  // A test suite over an hour against a 6-minute budget.
  [DETECTORS.overBudget]: [run('budget-positive', 'test/suite', 'Run the test suite', 0, 65)],
  // The same step done twice in one run.
  [DETECTORS.duplicate]: [
    run('duplicate-positive', 'lint/run', 'Lint the project', 0, 4),
    run('duplicate-positive', 'lint/run', 'lint the project', 30, 4),
  ],
  // A second review pass that adds little.
  [DETECTORS.lowYield]: [
    run('yield-positive', 'review/code', 'Review pass 1', 0, 30, { counts: { findings: 8, fixed: 7 }, cost: cost(300_000) }),
    run('yield-positive', 'review/code', 'Review pass 2', 60, 30, { counts: { findings: 1, fixed: 0 }, cost: cost(400_000) }),
  ],
  // A long context that never compacted.
  [DETECTORS.contextBloat]: [run('context-positive', 'research/read-docs', 'Read the docs', 0, 40, { cost: cost(500_000, { peak: 190_000, compactions: 0 }) })],
  // A mechanical step on a big model.
  [DETECTORS.bigModel]: [run('model-positive', 'format/files', 'Format the files', 0, 5, { cost: cost(80_000, { model: 'model-opus-x' }) })],
};

export const NEGATIVE = [
  // Under the 6-minute budget.
  run('budget-negative', 'test/suite', 'Run the test suite', 0, 5),
  // Starts only after the approval step is done.
  run('approval-negative', 'text/owner-read', 'Owner reads the text', 0, 60),
  run('approval-negative', 'translate/chapter', 'Translate chapter 3', 65, 60, { cost: cost(200_000) }),
  // Two siblings only (the config wants 3), and a stamped-only row that has no times.
  ...books('fan-out-negative', 2),
  run('fan-out-negative', 'build/book', 'Rebuild book 3', 0, 10, { started_at: null, duration_seconds: null }),
  // Three unrelated one-off parts of one process, each run once: ordinary work, not redone (Review 5).
  run('fan-out-oneoff-negative', 'slice/implement', 'Part A', 0, 10),
  run('fan-out-oneoff-negative', 'slice/implement', 'Part B', 15, 10),
  run('fan-out-oneoff-negative', 'slice/implement', 'Part C', 30, 10),
  // The same review run twice in a row (a re-run after a fix) is not two independent steps (Review 2).
  run('serial-rerun-negative', 'review/security', 'Security review', 0, 20),
  run('serial-rerun-negative', 'review/security', 'Security review again', 21, 20),
  // The two independent reviews overlap.
  run('serial-negative', 'review/security', 'Security review', 0, 20),
  run('serial-negative', 'review/style', 'Style review', 5, 20),
  // A second review pass that found and fixed plenty.
  run('yield-negative', 'review/code', 'Review pass 1', 0, 30, { counts: { findings: 8, fixed: 7 }, cost: cost(300_000) }),
  run('yield-negative', 'review/code', 'Review pass 2', 60, 30, { counts: { findings: 6, fixed: 5 }, cost: cost(200_000) }),
  // A review pass with no counts: unknown, never zero.
  run('yield-unknown', 'review/code', 'Review pass 1', 0, 30, { cost: cost(300_000) }),
  run('yield-unknown', 'review/code', 'Review pass 2', 60, 30, { cost: cost(400_000) }),
  // Different steps of one process are not duplicates.
  run('duplicate-negative', 'lint/run', 'Lint the project', 0, 4),
  run('duplicate-negative', 'lint/run', 'Lint the tests', 10, 4),
  // A long context that was compacted, and a small one.
  run('context-negative', 'research/read-docs', 'Read the docs', 0, 40, { cost: cost(500_000, { peak: 190_000, compactions: 2 }) }),
  run('context-negative', 'research/read-docs', 'Read more docs', 50, 10, { cost: cost(50_000, { peak: 60_000 }) }),
  // A mechanical step on a small model.
  run('model-negative', 'format/files', 'Format the files', 0, 5, { cost: cost(80_000, { model: 'model-small' }) }),
];
