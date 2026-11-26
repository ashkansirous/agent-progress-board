/* global URL, process */
// Tests for optimise.mjs and report.mjs (Slice 57). A local fake HTTP server stands in for the board.
// Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIXTURE_NOW, FIXTURE_PROJECT, NEGATIVE, POSITIVE } from '../fixtures/optimiser/fixtures.mjs';
import { callsOf, cleanUpAfterTests, envFor, runNode, startFakeBoard, trackedTemp } from '../test-helpers.mjs';
import { findingArgs, readOptions, reportArgs, rowsOf } from './optimise.mjs';
import { hasCloseMarker, withCloseMarker, findingDetails, findingKey, isoWeek, reportDetails, reportKey } from './report.mjs';
import { DETECTORS, detectAll } from './detectors.mjs';

const SCRIPT = fileURLToPath(new URL('./optimise.mjs', import.meta.url));
const CONFIG_FILE = fileURLToPath(new URL('../fixtures/optimiser/config.json', import.meta.url));
const POSITIVE_ROWS = Object.values(POSITIVE).flat();
cleanUpAfterTests();

// A fake board: query_runs gives `rows` (and `note` as the second text block), get_item reads `cards` by key (a missing
// key is "no item"), list_open gives the values of `cards`, every write answers with its key.
function replyRows(rows, { note = '', cards = {} } = {}) {
  return (record, res) => {
    const { name, arguments: args } = record.body.params;
    let result = { content: [{ type: 'text', text: JSON.stringify({ key: args.key }) }] };
    if (name === 'query_runs') {
      const asked = args.project ? rows.filter((row) => row.project === args.project) : rows;
      result = { content: [{ type: 'text', text: JSON.stringify(asked) }, ...(note ? [{ type: 'text', text: note }] : [])] };
    }
    if (name === 'list_open') result = { content: [{ type: 'text', text: JSON.stringify(Object.values(cards)) }] };
    if (name === 'get_item') result = cards[args.key] ? { content: [{ type: 'text', text: JSON.stringify(cards[args.key]) }] } : { isError: true, content: [{ type: 'text', text: `field key: no item ${args.key}` }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  };
}

async function runWith(rows, extraArgs = [], replies = {}, configFile = CONFIG_FILE) {
  const board = await startFakeBoard(replyRows(rows, replies));
  const state = join(trackedTemp('optimiser-state-'), 'state');
  const result = await runNode(SCRIPT, ['--config', configFile, '--now', FIXTURE_NOW, ...extraArgs], envFor(board.url, state));
  board.server.close();
  return { result, calls: callsOf(board) };
}

describe('keys and text', () => {
  test('isoWeek follows the ISO rule across a year end', () => {
    assert.equal(isoWeek(new Date('2026-11-23T10:00:00Z')), '2026-W48');
    assert.equal(isoWeek(new Date('2026-01-01T00:00:00Z')), '2026-W01');
    assert.equal(isoWeek(new Date('2027-01-03T00:00:00Z')), '2026-W53');
    assert.equal(isoWeek(new Date('2024-12-30T00:00:00Z')), '2025-W01');
  });

  test('the report key names the project and the week; a finding key is stable and short', () => {
    assert.equal(reportKey('demo-app', '2026-W48'), 'demo-app/optimiser-report-2026-W48');
    const [item] = detectAll(POSITIVE[DETECTORS.fanOut], JSON.parse('{"fanOut":{"minSiblings":3}}'), FIXTURE_PROJECT);
    assert.equal(findingKey('demo-app', item), findingKey('demo-app', { ...item, runs: 99 }));
    assert.match(findingKey('demo-app', item), /^demo-app\/finding-fan-out-[0-9a-f]{10}$/);
  });

  test('a finding card holds the numbers, the evidence and the proposed change; a report line per finding', () => {
    const found = detectAll(POSITIVE_ROWS, JSON.parse(`{"fanOut":{"minSiblings":3}}`), FIXTURE_PROJECT);
    const text = findingDetails(found[0]);
    assert.match(text, /Estimated saving/);
    assert.match(text, /Evidence runs/);
    assert.match(text, /Proposed change/);
    const report = reportDetails({ week: '2026-W48', findings: found, runCount: 3, dryRun: true });
    assert.match(report, /Dry run/);
    assert.match(reportDetails({ week: '2026-W48', findings: [], runCount: 0, dryRun: true }), /No finding this week/);
  });

  test('options: dry run is the default, --file-findings turns filing on, --days is clamped to a whole number', () => {
    assert.equal(readOptions(['--config', 'c.json']).fileFindings, false);
    assert.equal(readOptions(['--config', 'c.json', '--file-findings']).fileFindings, true);
    assert.equal(readOptions(['--days', '0']).days, 7);
    assert.equal(readOptions(['--days', '14.9']).days, 14);
    assert.equal(rowsOf({ ok: true, data: [1] }).length, 1);
    assert.equal(rowsOf({ ok: true, data: 'text' }), null);
    assert.equal(rowsOf({ ok: false, error: 'x' }), null);
  });

  test('card arguments: the report is an unplanned card, a finding is a finding card', () => {
    const [item] = detectAll(POSITIVE[DETECTORS.overBudget], JSON.parse(`{"budgets":{"processes":{"test/suite":{"minutes":6}}}}`), FIXTURE_PROJECT);
    assert.equal(reportArgs({ project: 'demo-app', week: '2026-W48', findings: [item], runCount: 1, dryRun: true, notice: '' }).type, 'unplanned');
    const args = findingArgs('demo-app', item);
    assert.equal(args.type, 'finding');
    assert.equal(args.status, 'open');
    assert.equal('status' in findingArgs('demo-app', item, false), false);
    assert.equal(args.priority, 'P3');
    assert.equal('priority' in findingArgs('demo-app', item, false), false);
  });
});

describe('the script against a fake board', () => {
  let ran;
  before(async () => { ran = await runWith(POSITIVE_ROWS); });
  after(() => undefined);

  test('dry run: asks for the week, writes the report card and files no finding', () => {
    assert.equal(ran.result.code, 0);
    const [first, query, ...writes] = ran.calls;
    assert.equal(first.tool, 'query_runs');
    assert.equal(first.args.project, undefined);
    assert.equal(query.tool, 'query_runs');
    assert.equal(query.args.project, FIXTURE_PROJECT);
    assert.equal(query.args.to, FIXTURE_NOW);
    assert.equal(query.args.from, '2026-11-16T10:00:00.000Z');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].tool, 'report_progress');
    assert.equal(writes[0].args.key, `${FIXTURE_PROJECT}/optimiser-report-2026-W48`);
    assert.equal(writes[0].args.type, 'unplanned');
    assert.match(writes[0].args.details_md, /Dry run/);
    assert.match(ran.result.stderr, /dry run/);
  });

  test('--file-findings files one finding card per finding after the report', async () => {
    const filed = await runWith(POSITIVE_ROWS, ['--file-findings']);
    const writes = filed.calls.filter((call) => call.tool === 'report_progress');
    const types = writes.map((call) => call.args.type);
    assert.equal(types[0], 'unplanned');
    assert.ok(types.slice(1).length >= 8 && types.slice(1).every((type) => type === 'finding'));
    assert.equal(new Set(writes.map((call) => call.args.key)).size, writes.length);
  });

  test('a reply the board cut (its note is the second text block) marks the report partial and closes no card', async () => {
    const cut = await runWith(POSITIVE_ROWS, ['--file-findings'], { note: 'showing 100 of 600 runs; narrow the call' });
    const report = cut.calls.find((call) => call.args.type === 'unplanned');
    assert.match(report.args.details_md, /Partial read.*showing 100 of 600 runs/);
    assert.equal(cut.calls.some((call) => call.tool === 'list_open' || call.args.status === 'done' && call.args.type !== 'unplanned'), false);
  });

  test('--file-findings: a done card is left alone, an open one is updated without a status, a new one is filed open', async () => {
    const found = detectAll(POSITIVE_ROWS, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')), FIXTURE_PROJECT);
    const done = findingKey(FIXTURE_PROJECT, found[0]);
    const open = findingKey(FIXTURE_PROJECT, found[1]);
    const cards = { [done]: { key: done, status: 'done' }, [open]: { key: open, status: 'open' } };
    const filed = await runWith(POSITIVE_ROWS, ['--file-findings'], { cards });
    const sent = filed.calls.filter((call) => call.tool === 'report_progress' && call.args.type === 'finding');
    assert.equal(sent.some((call) => call.args.key === done), false);
    assert.equal('status' in sent.find((call) => call.args.key === open).args, false);
    assert.ok(sent.filter((call) => call.args.key !== open).every((call) => call.args.status === 'open'));
  });

  test('--file-findings closes an open finding card the week no longer produces, only with the flag', async () => {
    const gone = `${FIXTURE_PROJECT}/finding-fan-out-0123456789`;
    const cards = { [gone]: { key: gone, status: 'open' } };
    const filed = await runWith(POSITIVE_ROWS, ['--file-findings'], { cards });
    const closed = filed.calls.filter((call) => call.args.status === 'done' && call.args.type !== 'unplanned');
    assert.deepEqual(closed.map((call) => call.args.key), [gone]);
    const dry = await runWith(POSITIVE_ROWS, [], { cards });
    assert.equal(dry.calls.some((call) => (call.args.status === 'done' && call.args.type !== 'unplanned') || call.tool === 'get_item' || call.tool === 'list_open'), false);
  });

  test('each project is read on its own: a full page of one project leaves the others whole and closable (Decision 13)', async () => {
    const busy = Array.from({ length: 1000 }, (_, index) => ({ ...POSITIVE_ROWS[0], project: 'busy-app', item_key: 'busy-app/x', step_id: `b${index}` }));
    const gone = `${FIXTURE_PROJECT}/finding-fan-out-0123456789`;
    const goneBusy = 'busy-app/finding-fan-out-0123456789';
    const cards = { [gone]: { key: gone, status: 'open' }, [goneBusy]: { key: goneBusy, status: 'open' } };
    const named = join(trackedTemp('optimiser-config-'), 'config.json');
    writeFileSync(named, JSON.stringify({ ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')), projects: ['busy-app', FIXTURE_PROJECT] }));
    const filed = await runWith([...busy, ...POSITIVE_ROWS], ['--file-findings'], { cards }, named);
    const reports =filed.calls.filter((call) => call.tool === 'report_progress' && call.args.type === 'unplanned');
    assert.match(reports.find((call) => call.args.project === 'busy-app').args.details_md, /Partial read/);
    assert.doesNotMatch(reports.find((call) => call.args.project === FIXTURE_PROJECT).args.details_md, /Partial read/);
    assert.deepEqual(filed.calls.filter((call) => call.args.status === 'done' && call.args.type !== 'unplanned').map((call) => call.args.key), [gone]);
  });

  test('discovery cut or full: no project list is trusted, no card is closed, the report says so (Decision 14)', async () => {
    const gone = `${FIXTURE_PROJECT}/finding-fan-out-0123456789`;
    const cards = { [gone]: { key: gone, status: 'open' } };
    const cut = await runWith(POSITIVE_ROWS, ['--file-findings'], { cards, note: 'showing 100 of 600 runs; narrow the call' });
    assert.equal(cut.calls.some((call) => call.args.status === 'done' && call.args.type !== 'unplanned'), false);
    assert.match(cut.result.stderr, /project list is partial/);
    const full = Array.from({ length: 1000 }, (_, index) => ({ ...POSITIVE_ROWS[0], step_id: `f${index}` }));
    const filled = await runWith([...full, ...POSITIVE_ROWS], ['--file-findings'], { cards });
    assert.equal(filled.calls.some((call) => call.args.status === 'done' && call.args.type !== 'unplanned'), false);
    assert.match(filled.calls.find((call) => call.args.type === 'unplanned').args.details_md, /Partial read/);
  });

  test('a card the script closed carries its marker; it is reopened when the finding returns, a done card without it is left (Decision 14)', async () => {
    const found = detectAll(POSITIVE_ROWS, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')), FIXTURE_PROJECT);
    const [mine, theirs, archived] = found.slice(0, 3).map((item) => findingKey(FIXTURE_PROJECT, item));
    const cards = {
      [mine]: { key: mine, status: 'done', details_md: withCloseMarker('old details') },
      [theirs]: { key: theirs, status: 'done', details_md: 'owner wrote this' },
      [archived]: { key: archived, status: 'done', archived_at: '2026-11-20T00:00:00Z', details_md: withCloseMarker('x') },
    };
    const filed = await runWith(POSITIVE_ROWS, ['--file-findings'], { cards });
    const sent = filed.calls.filter((call) => call.tool === 'report_progress' && call.args.type === 'finding');
    assert.equal(sent.find((call) => call.args.key === mine).args.status, 'open');
    assert.doesNotMatch(sent.find((call) => call.args.key === mine).args.details_md, /Closed by the weekly/);
    assert.equal(sent.some((call) => call.args.key === theirs || call.args.key === archived), false);
  });

  test('the script closes a gone card with the marker line in its details and a later run can read it back', async () => {
    const gone = `${FIXTURE_PROJECT}/finding-fan-out-0123456789`;
    const filed = await runWith(POSITIVE_ROWS, ['--file-findings'], { cards: { [gone]: { key: gone, status: 'open', details_md: 'old' } } });
    const close = filed.calls.find((call) => call.args.key === gone);
    assert.equal(close.args.status, 'done');
    assert.equal(hasCloseMarker(close.args.details_md), true);
  });

  test('a project of the config list with no runs in the window gets its open finding cards closed', async () => {
    const idle = 'idle-app/finding-fan-out-0123456789';
    const file = join(trackedTemp('optimiser-config-'), 'config.json');
    writeFileSync(file, JSON.stringify({ projects: ['idle-app'] }));
    const board = await startFakeBoard(replyRows([], { cards: { [idle]: { key: idle, status: 'open' } } }));
    const state = join(trackedTemp('optimiser-state-'), 'state');
    const result = await runNode(SCRIPT, ['--config', file, '--now', FIXTURE_NOW, '--file-findings'], envFor(board.url, state));
    board.server.close();
    assert.equal(result.code, 0);
    assert.deepEqual(callsOf(board).filter((call) => call.args.status === 'done' && call.args.key === idle).map((call) => call.args.key), [idle]);
  });

  test('a quiet week still writes a report that says so, and a --project filter reaches the query', async () => {
    const quiet = await runWith(NEGATIVE, ['--project', FIXTURE_PROJECT]);
    assert.equal(quiet.calls[0].args.project, FIXTURE_PROJECT);
    assert.match(quiet.calls[1].args.details_md, /No finding this week/);
    assert.equal(quiet.calls.length, 2);
  });
});

describe('fails open', () => {
  test('no board address: exit 0, nothing sent', async () => {
    const result = await runNode(SCRIPT, ['--config', CONFIG_FILE], { ...process.env, AGENT_BOARD_URL: '', AGENT_BOARD_TOKEN: '', CLAUDE_PLUGIN_OPTION_BOARD_URL: '', CLAUDE_PLUGIN_OPTION_BOARD_TOKEN: '' });
    assert.equal(result.code, 0);
  });

  test('an unreadable config or a board error is one line and exit 0', async () => {
    const board = await startFakeBoard((record, res) => { res.writeHead(500); res.end('no'); });
    const state = join(trackedTemp('optimiser-state-'), 'state');
    const bad = await runNode(SCRIPT, ['--config', join(state, 'missing.json')], envFor(board.url, state));
    assert.equal(bad.code, 0);
    assert.match(bad.stderr, /config unreadable/);
    const down = await runNode(SCRIPT, ['--config', CONFIG_FILE], envFor(board.url, state));
    board.server.close();
    assert.equal(down.code, 0);
    assert.match(down.stderr, /query_runs skipped \(HTTP 500\)/);
  });

  test('a runs file stands in for the board query', async () => {
    const board = await startFakeBoard();
    const state = join(trackedTemp('optimiser-state-'), 'state');
    const file = join(state, '..', 'rows.json');
    writeFileSync(file, JSON.stringify(NEGATIVE));
    const result = await runNode(SCRIPT, ['--config', CONFIG_FILE, '--runs-file', file, '--now', FIXTURE_NOW], envFor(board.url, state));
    board.server.close();
    assert.equal(result.code, 0);
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress']);
  });
});
