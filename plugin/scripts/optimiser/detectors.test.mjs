/* global URL */
// Tests for the optimiser's detectors on the fixture runs (Slice 57). Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIXTURE_PROJECT, NEGATIVE, POSITIVE } from '../fixtures/optimiser/fixtures.mjs';
import {
  DETECTORS, detectAll, detectBeforeApproval, detectBigModel, detectContextBloat, detectDuplicates, detectFanOut, detectLowYield, detectOverBudget, detectSerial,
} from './detectors.mjs';

const CONFIG = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/optimiser/config.json', import.meta.url)), 'utf8'));
const BY_DETECTOR = {
  [DETECTORS.fanOut]: detectFanOut,
  [DETECTORS.approval]: detectBeforeApproval,
  [DETECTORS.serial]: detectSerial,
  [DETECTORS.overBudget]: detectOverBudget,
  [DETECTORS.duplicate]: detectDuplicates,
  [DETECTORS.lowYield]: detectLowYield,
  [DETECTORS.contextBloat]: detectContextBloat,
  [DETECTORS.bigModel]: detectBigModel,
};

describe('every detector flags its own pattern', () => {
  for (const [name, detect] of Object.entries(BY_DETECTOR)) {
    test(`${name}: positive fixture is flagged`, () => {
      const found = detect(POSITIVE[name], CONFIG, FIXTURE_PROJECT);
      assert.ok(found.length >= 1, `${name} found nothing`);
      assert.ok(found.every((item) => item.detector === name && item.project === FIXTURE_PROJECT));
      assert.ok(found[0].evidence.length >= 1 && found[0].proposal);
    });

    test(`${name}: no negative fixture is flagged`, () => {
      assert.deepEqual(detect(NEGATIVE, CONFIG, FIXTURE_PROJECT), []);
    });

    test(`${name}: no config section, no finding`, () => {
      assert.deepEqual(detect(POSITIVE[name], {}, FIXTURE_PROJECT), []);
    });
  }

  test('detectAll over every negative fixture is empty, and over every positive one has all eight detectors', () => {
    assert.deepEqual(detectAll(NEGATIVE, CONFIG, FIXTURE_PROJECT), []);
    const kinds = new Set(detectAll(Object.values(POSITIVE).flat(), CONFIG, FIXTURE_PROJECT).map((item) => item.detector));
    assert.deepEqual([...kinds].sort(), Object.values(DETECTORS).sort());
  });
});

describe('what each finding says', () => {
  test('fan-out counts the siblings and estimates the redone steps', () => {
    const [item] = detectFanOut(POSITIVE[DETECTORS.fanOut], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.numbers.largest_group, 3);
    assert.equal(item.saving.seconds, 3 * 600);
  });

  test('serial: a re-run of one process is not a serial pair, and a chain of three counts once', () => {
    const rerun = NEGATIVE.filter((row) => row.item_key.endsWith('serial-rerun-negative'));
    assert.equal(rerun.length, 2);
    assert.deepEqual(detectSerial(rerun, CONFIG, FIXTURE_PROJECT), []);
    const config = { serial: { independent: [['a/one', 'b/two', 'c/three']], maxGapSeconds: 60 } };
    const step = (process, start, end) => ({ item_key: 'p/x', project: 'p', step_id: process, label: process, process, started_at: `2026-11-16T10:${start}:00.000Z`, done_at: `2026-11-16T10:${end}:00.000Z`, duration_seconds: 0, counts: null, cost: null });
    const [item] = detectSerial([step('a/one', '00', '10'), step('b/two', '10', '15'), step('c/three', '15', '20')], config, 'p');
    assert.equal(item.numbers.serial_chains, 1);
    assert.equal(item.saving.seconds, (10 + 5 + 5 - 10) * 60);
  });

  test('approval: two approvals gating one process are two findings with two keys', () => {
    const config = { approval: { 'text/read-a': ['translate/chapter'], 'text/read-b': ['translate/chapter'] } };
    const rows = [...POSITIVE[DETECTORS.approval], ...POSITIVE[DETECTORS.approval].map((row) => (row.process === 'text/owner-read' ? { ...row, process: 'text/read-b', step_id: 'b' } : row))]
      .map((row) => (row.process === 'text/owner-read' ? { ...row, process: 'text/read-a' } : row));
    const found = detectBeforeApproval(rows, config, FIXTURE_PROJECT);
    assert.equal(found.length, 2);
    assert.notEqual(found[0].process, found[1].process);
  });

  test('approval reports the work started before the approval and its tokens', () => {
    const [item] = detectBeforeApproval(POSITIVE[DETECTORS.approval], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.process, 'text/owner-read -> translate/chapter');
    assert.equal(item.numbers.tokens_at_risk, 200_000);
    assert.equal(item.saving.seconds, null);
  });

  test('approval: a build started after the first approval is not early when the approval is re-run later', () => {
    const step = (process, start, end) => ({ item_key: 'p/x', project: 'p', step_id: `${process}${start}`, label: process, process, started_at: `2026-11-16T${start}:00.000Z`, done_at: `2026-11-16T${end}:00.000Z`, duration_seconds: 0, counts: null, cost: null });
    const config = { approval: { 'text/read': ['build/x'] } };
    const rows = [step('text/read', '09:50', '10:00'), step('build/x', '10:05', '10:20'), step('text/read', '10:50', '11:00')];
    assert.deepEqual(detectBeforeApproval(rows, config, 'p'), []);
    assert.equal(detectBeforeApproval([step('text/read', '09:50', '10:00'), step('build/x', '09:55', '10:20')], config, 'p').length, 1);
  });

  test('serial estimates the saving as the shorter step of each pair', () => {
    const [item] = detectSerial(POSITIVE[DETECTORS.serial], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.saving.seconds, 20 * 60);
  });

  test('serial ignores steps further apart than maxGapSeconds', () => {
    const far = POSITIVE[DETECTORS.serial].map((row, index) => (index === 1 ? { ...row, started_at: '2026-11-16T11:00:00.000Z', done_at: '2026-11-16T11:20:00.000Z' } : row));
    assert.deepEqual(detectSerial(far, CONFIG, FIXTURE_PROJECT), []);
  });

  test('over budget reports the excess over the budget, from the config only', () => {
    const [item] = detectOverBudget(POSITIVE[DETECTORS.overBudget], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.numbers.budget_seconds, 360);
    assert.equal(item.saving.seconds, 65 * 60 - 360);
    const noBudget = { ...CONFIG, budgets: { processes: {} } };
    assert.deepEqual(detectOverBudget(POSITIVE[DETECTORS.overBudget], noBudget, FIXTURE_PROJECT), []);
  });

  test('a run with no measured duration is never over a budget', () => {
    const rows = POSITIVE[DETECTORS.overBudget].map((row) => ({ ...row, duration_seconds: null }));
    assert.deepEqual(detectOverBudget(rows, CONFIG, FIXTURE_PROJECT), []);
  });

  test('duplicates count only the repeats, matching the label ignoring case', () => {
    const [item] = detectDuplicates(POSITIVE[DETECTORS.duplicate], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.numbers.extra_runs, 1);
    assert.equal(item.saving.seconds, 240);
  });

  test('low yield judges only the later pass and reads the yield per 100,000 tokens', () => {
    const [item] = detectLowYield(POSITIVE[DETECTORS.lowYield], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.runs, 1);
    assert.equal(item.evidence[0].label, 'Review pass 2');
    assert.equal(item.numbers.worst_yield_per_100k_tokens, 0.25);
    assert.equal(item.saving.tokens, 400_000);
  });

  test('context bloat takes a per-process limit from budgets over the general one', () => {
    const tight = { ...CONFIG, budgets: { processes: { 'research/read-docs': { peakContext: 250_000 } } } };
    assert.deepEqual(detectContextBloat(POSITIVE[DETECTORS.contextBloat], tight, FIXTURE_PROJECT), []);
  });

  test('big model counts the tokens on the big model only', () => {
    const [item] = detectBigModel(POSITIVE[DETECTORS.bigModel], CONFIG, FIXTURE_PROJECT);
    assert.equal(item.numbers.tokens_on_big_model, 80_000);
    assert.deepEqual(item.numbers.models, ['model-opus-x']);
  });
});

describe('detectAll', () => {
  test('orders the findings by their saving and survives a bad config', () => {
    const found = detectAll(Object.values(POSITIVE).flat(), CONFIG, FIXTURE_PROJECT);
    assert.ok(found.length >= 8);
    assert.deepEqual(detectAll(Object.values(POSITIVE).flat(), null, FIXTURE_PROJECT), []);
    assert.deepEqual(detectAll([], CONFIG, FIXTURE_PROJECT), []);
  });
});
