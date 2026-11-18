/* global process, URL */
// Tests for sync-docs.mjs against made-up fixture files of the real shapes (fixtures/repo-a) and a
// local fake board. The real board and the real token are never touched.
// Run: node --test skills/report-progress/sync-docs.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sliceKey } from './report-progress.mjs';
import { MAX_CHECKS, MAX_EXPANDED_ITEMS, MAX_ITEMS, SourceError, WAIT_TARGETS, buildItems, buildSnapshot, checkHash, collect, filesForSlice, gitSource, hasEmptyStatusTable, mapStatus, openForOwner, parkNote, parseParts, parsePlanTable, parseParked, parseUnverified, readUnverified, safeLinkPath, syncLine, waitsOnlyOnWork } from './sync-docs.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = join(here, 'sync-docs.mjs');
const FIXTURE = join(here, 'fixtures', 'repo-a');
const NO_STORE = join(tmpdir(), 'no-such-board-secrets.env');
const PROJECT = 'demo-app';

function snapshotOf(extra = {}) {
  return collect({ root: FIXTURE, project: PROJECT, parked: join(FIXTURE, 'parked.md'), ...extra }).items;
}

function byKey(items) {
  return Object.fromEntries(items.map((item) => [item.key, item]));
}

function startFakeBoard() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed.params);
      const text = JSON.stringify({ project: parsed.params.arguments.project, created: 1, updated: 0, closed: 0, unchanged: 0 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

function runSync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, AGENT_BOARD_SECRETS_FILE: NO_STORE, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('parsing', () => {
  test('plan table: open slices under Status only, with product headings', () => {
    const rows = parsePlanTable(readFileSync(join(FIXTURE, 'plan.md'), 'utf8'));
    assert.deepEqual(rows.map((row) => row.number), ['3', '4', '5', '6', '7']);
    assert.deepEqual(rows.map((row) => row.product), ['Export', 'Export', 'Export', 'Search', 'Search']);
    assert.equal(rows[1].title, 'CSV encoding options');
    assert.equal(rows[2].title, 'Import from a spreadsheet');
    assert.equal(rows[0].file, 'docs/plan/slices/03-export-button.md');
  });

  test('also reads the older header with Slice and Title columns', () => {
    const text = '## Status\n\n| Slice | Title | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 12 | Thing | planned | | | |\n';
    assert.deepEqual(parsePlanTable(text).map((row) => [row.number, row.title]), [['12', 'Thing']]);
  });

  test('status mapping', () => {
    assert.equal(mapStatus('planned').status, 'open');
    assert.equal(mapStatus('in progress (wave 2026-11-15), draft PR').status, 'in_progress');
    assert.equal(mapStatus('built').status, 'done');
    assert.equal(mapStatus('built (PR #1 merged)').status, 'done');
    const parked = mapStatus('parked: waits for Slice 06 (user, 2026-11-15)');
    assert.deepEqual(parked, { status: 'blocked', reason: 'waits for Slice 06 (user, 2026-11-15)' });
    assert.equal(mapStatus('waiting on the user: pick a store').status, 'blocked');
    assert.equal(mapStatus('Planned (unparked 2026-11-15)').status, 'open');
    assert.equal(mapStatus('Merged, parked follow-up').status, 'done');
    assert.equal(mapStatus('**Parked** - needs a store').status, 'blocked');
  });

  test('unverified blocks and parked lines', () => {
    const blocks = parseUnverified(readFileSync(join(FIXTURE, 'docs/plan/unverified.md'), 'utf8'));
    assert.deepEqual(blocks.map((block) => [block.number, block.lines.length]), [['5', 3], ['3', 1]]);
    const parked = parseParked(readFileSync(join(FIXTURE, 'parked.md'), 'utf8'));
    assert.deepEqual(parked.map((entry) => entry.number), ['4', '6']);
  });

  test('a park note must start the line; history lines do not count', () => {
    assert.match(parkNote('*Parked: waits for the user.*\n'), /^Parked: waits for the user\./);
    assert.equal(parkNote('*Planned.* Earlier park (user): history\n*Earlier park (user): x*\n'), '');
    assert.equal(parkNote(undefined), '');
  });

  test('check hash ignores markup, bullets, case and spacing', () => {
    assert.equal(checkHash('- The `.xlsx` import  keeps the first sheet only.'), checkHash('* the .xlsx import keeps the FIRST sheet only'));
    assert.notEqual(checkHash('- one thing'), checkHash('- another thing'));
    assert.match(checkHash('- x'), /^[0-9a-f]{8}$/);
  });
});

describe('snapshot items', () => {
  const items = snapshotOf();
  const keyed = byKey(items);

  test('slice keys have no leading zero and match the live reporter', () => {
    assert.ok(keyed[sliceKey(PROJECT, '03')]);
    assert.equal(keyed['demo-app/slice-3'].title, 'Add the export button');
    assert.equal(keyed['demo-app/slice-3'].status, 'open');
    assert.equal(keyed['demo-app/slice-3'].parent, 'Plan · Export');
    assert.equal(keyed['demo-app/slice-3/waiting'], undefined);
  });

  test('statuses map from the table', () => {
    assert.equal(keyed['demo-app/slice-4'].status, 'in_progress');
    assert.equal(keyed['demo-app/slice-5'].status, 'done');
    assert.equal(keyed['demo-app/slice-6'].status, 'blocked');
    assert.match(keyed['demo-app/slice-6'].why, /ranking/);
    assert.equal(keyed['demo-app/slice-7'].status, 'open');
  });

  test('only a parked row gets a waiting_for_me child; parked.md and slice-file notes never add one', () => {
    const waiting = items.filter((item) => item.key.endsWith('/waiting'));
    assert.deepEqual(waiting.map((item) => item.key), ['demo-app/slice-6/waiting']);
    assert.ok(waiting.every((item) => item.type === 'waiting_for_me' && item.status === 'open'));
    assert.match(keyed['demo-app/slice-6/waiting'].title, /ranking/);
    assert.equal(keyed['demo-app/slice-7'].status, 'open');
  });

  test('waitsOnlyOnWork drops the card only when the reason is nothing but a wait on work', () => {
    for (const reason of ['waits for Slice 06 (user, 2026-11-15)', 'waits for Slice 06 (owner, 2026-11-15)', 'waits on slice 7', 'waiting for Slice 12a', 'behind Slice 06', 'WAITS FOR SLICE 3', 'waits for Slice 06.', 'waits for Slice 06 (user, 2026-11-15).',
      'waits for the deploy to finish', 'waits for CI','waits for the merge of slice 4',
      'waits for Slice 06 which is not built yet', 'waits for Slice 06 and then Slice 07']) {
      assert.equal(waitsOnlyOnWork(reason), true, reason);
    }
    for (const reason of ['waits for Slice 06 and the user\'s answer', 'waiting on the user', 'pick the store', '',
      'waits for Slice 06 and your answer', 'waits for Slice 06; user must pick', 'waits for Slice 06 (owner must pick)',
      'waits for the deploy to finish, then you press go', 'waits for CI and the owner', 'needs the deploy key', 'needs an interactive session', 'needs a merge decision']) {
      assert.equal(waitsOnlyOnWork(reason), false, reason);
    }
  });

  test('a reason that waits for an interactive session, a deploy, another repo\'s slice or a merge gives no waiting_for_me item', () => {
    const reasons = ['waits for an interactive session', 'waiting on the deploy', 'waits for a production deploy (owner, 2026-11-15)',
      'waits for slice 4 in the other repo', 'waits for another repo\'s slice', 'waits for the merge', 'waits for PR #12 to merge',
      'parked: waits for an interactive session.'];
    for (const reason of reasons) {
      const planText = `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 9 | Nine | parked: ${reason.replace(/^parked: /, '')} | | | |\n`;
      const built = byKey(buildItems({ project: PROJECT, planText }));
      assert.equal(built['demo-app/slice-9'].status, 'blocked', reason);
      assert.equal(built['demo-app/slice-9/waiting'], undefined, reason);
    }
  });

  test('"waits for the user" and "the owner\'s go" still give a waiting_for_me item', () => {
    for (const reason of ['waits for the user', 'the owner\'s go', 'waits for an interactive session and the user\'s answer', 'waits for the deploy, then your go']) {
      const planText = `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 9 | Nine | parked: ${reason} | | | |\n`;
      const built = byKey(buildItems({ project: PROJECT, planText }));
      assert.equal(built['demo-app/slice-9/waiting'].type, 'waiting_for_me', reason);
    }
  });

  test('a row parked behind a slice is blocked with its why and no waiting child; a user park keeps it', () => {
    const rows = '| 8 | Eight | parked: waits for Slice 06 (user, 2026-11-15) | | | |\n| 9 | Nine | parked: pick the store | | | |\n';
    const planText = `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}`;
    const built = byKey(buildItems({ project: PROJECT, planText }));
    assert.equal(built['demo-app/slice-8/waiting'], undefined);
    assert.equal(built['demo-app/slice-8'].status, 'blocked');
    assert.match(built['demo-app/slice-8'].why, /waits for Slice 06/);
    assert.equal(built['demo-app/slice-9/waiting'].type, 'waiting_for_me');
  });

  test('the snapshot is the same with and without --parked', () => {
    assert.deepEqual(snapshotOf({ parked: undefined }), items);
  });

  test('a park note that waits only on a slice gives no waiting child; one that names the user does', () => {
    const table = (status) => `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 9 | Nine | ${status} | | | |\n`;
    const only = buildItems({ project: PROJECT, planText: table('parked'), sliceTexts: { 9: '*Parked: waits for Slice 06 (user, 2026-11-15).*\n' } });
    assert.equal(byKey(only)['demo-app/slice-9/waiting'], undefined);
    const named = buildItems({ project: PROJECT, planText: table('parked'), sliceTexts: { 9: '*Parked: waits for Slice 06 and your answer.*\n' } });
    assert.equal(byKey(named)['demo-app/slice-9/waiting'].type, 'waiting_for_me');
  });

  test('a park note supplies the why only while the row is parked; "waits on the user" in a row is not a park', () => {
    const table = (status) => `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 9 | Nine | ${status} | | | |\n`;
    const sliceTexts = { 9: '*Parked: pick the store.*\n' };
    const parked = buildItems({ project: PROJECT, planText: table('parked'), sliceTexts });
    assert.match(parked.find((item) => item.key.endsWith('/waiting')).title, /pick the store/);
    const building = buildItems({ project: PROJECT, planText: table('in progress (part C waits on the user)'), sliceTexts });
    assert.deepEqual(building.map((item) => [item.key, item.status]), [['demo-app/slice-9', 'in_progress']]);
  });

  test('unverified lines are `checks` inside their slice, never items of their own (Slice 16 part D)', () => {
    const owner = items.filter((item) => item.key.includes('/check-'));
    assert.ok(owner.length > 0 && owner.every((item) => item.type === 'waiting_for_me' && item.parent.includes('Not yet verified')), 'only `**You` lines stay items (the owner\'s step)');
    const five = keyed['demo-app/slice-5'].checks;
    assert.equal(five.length, 3 - owner.length);
    assert.ok(five.every((check) => check.key.startsWith('demo-app/slice-5/check-') && Object.keys(check).sort().join() === 'key,title'));
    assert.equal(keyed['demo-app/slice-3'].checks.length, 1);
    assert.deepEqual(keyed['demo-app/slice-7'].checks, [], 'an open-row slice with no block sends [] so verified checks close');
  });

  const OPEN_TABLE = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 5 | Five | planned | | | |\n';
  const DONE_TABLE = '# Slices done\n\n| Slice | Title | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n'
    + '| 07 | Seven | built, live checks open | #1 | | [slice](../slices/07-seven.md) |\n| 08 | Eight | built | #2 | | [slice](../slices/08-eight.md) |\n';

  test('FINDING 1: a built slice (slices-done.md row) with an unverified block is sent as a slice item carrying its checks', () => {
    const unverifiedText = '### Slice 7: s\n\n- Try it on the phone\n\n### Slice 8: gone\n';
    const built = buildItems({ project: PROJECT, planText: OPEN_TABLE, unverifiedText: `${unverifiedText}\n### Slice 99: none\n\n- x\n`, doneText: DONE_TABLE });
    const seven = built.find((item) => item.key === 'demo-app/slice-7');
    assert.equal(seven.status, 'done', 'built: merged code, open device checks, never in progress');
    assert.equal(seven.checks.length, 1);
    assert.equal(seven.title, 'Seven');
    assert.ok(!built.some((item) => item.key === 'demo-app/slice-99'), 'a slice with no row anywhere stays out');
    assert.deepEqual(built.find((item) => item.key === 'demo-app/slice-8').checks, [], 'an empty block closes old checks');
  });

  test('FINDING 6: a built row with an unfinished part stays in_progress; with all parts ticked it is done', () => {
    const planText = (status) => `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 5 | Five | ${status} | | | |\n`;
    const open = { 5: '## Work\n\n**A. First**\n- [x] one\n\n**B. Second**\n- [ ] two\n' };
    const finished = { 5: '## Work\n\n**A. First**\n- [x] one\n\n**B. Second**\n- [x] two\n' };
    assert.equal(buildItems({ project: PROJECT, planText: planText('built'), sliceTexts: open })[0].status, 'in_progress');
    assert.equal(buildItems({ project: PROJECT, planText: planText('built'), sliceTexts: finished })[0].status, 'done');
    assert.equal(buildItems({ project: PROJECT, planText: planText('done'), sliceTexts: open })[0].status, 'done', 'only built rows are held back');
    const doneFile = buildItems({ project: PROJECT, planText: OPEN_TABLE, unverifiedText: '### Slice 7: s\n\n- Try\n', doneText: DONE_TABLE, sliceTexts: { 7: open[5] } });
    assert.equal(doneFile.find((item) => item.key === 'demo-app/slice-7').status, 'in_progress');
  });

  test('FINDING 1: a done-file row with no block, or one that is also an open row, is not sent', () => {
    const built = buildItems({ project: PROJECT, planText: OPEN_TABLE, unverifiedText: '### Slice 5: s\n\n- a\n', doneText: DONE_TABLE.replace('| 07 |', '| 05 |') });
    assert.deepEqual(built.map((item) => item.key), ['demo-app/slice-5']);
  });

  test('FINDING 2 and unread file: no unverified.md text sends no checks field at all', () => {
    const built = buildItems({ project: PROJECT, planText: OPEN_TABLE });
    assert.equal('checks' in built[0], false);
  });

  test('a slice with a block of no lines sends checks: [] so the board closes its old checks', () => {
    const planText = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 5 | Five | planned | | | |\n';
    const built = buildItems({ project: PROJECT, planText, unverifiedText: '### Slice 5: x\n\nno bullets\n' });
    assert.deepEqual(built[0].checks, []);
  });

  test('over 100 checks under one slice: the first 100 are sent, one notice names it', () => {
    const planText = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 5 | Five | planned | | | |\n';
    const lines = Array.from({ length: 101 }, (_, index) => `- check number ${index}`).join('\n');
    const snapshot = buildSnapshot({ project: PROJECT, planText, unverifiedText: `### Slice 5: x\n\n${lines}\n` });
    assert.equal(snapshot.items[0].checks.length, MAX_CHECKS);
    assert.match(snapshot.notices.join(''), /101 checks, only the first 100 sent/);
  });

  test('every item has a unique key, the call project and valid enums', () => {
    assert.equal(new Set(items.map((item) => item.key)).size, items.length);
    for (const item of items) {
      assert.equal(item.project, PROJECT);
      assert.ok(['slice', 'waiting_for_me'].includes(item.type));
      assert.ok(['open', 'in_progress', 'blocked', 'done'].includes(item.status));
      assert.ok(item.title.length > 0 && item.title.length <= 300);
    }
  });

  test('a second parse gives the identical snapshot', () => {
    assert.deepEqual(snapshotOf(), items);
  });

  test('a slice removed from the table is absent from the next snapshot', () => {
    const plan = readFileSync(join(FIXTURE, 'plan.md'), 'utf8').split('\n').filter((line) => !line.startsWith('| 07 ')).join('\n');
    const next = buildItems({ project: PROJECT, planText: plan });
    assert.ok(!next.some((item) => item.key.startsWith('demo-app/slice-7')));
  });

  test('links use the repo URL when one is known', () => {
    const linked = snapshotOf({ 'repo-url': 'https://github.com/o/demo-app' });
    const five = byKey(linked)['demo-app/slice-5'];
    assert.deepEqual(five.links.map((link) => link.url), ['https://github.com/o/demo-app/blob/main/docs/plan/slices/05-import.md', 'https://github.com/o/demo-app/pull/33']);
    assert.equal(byKey(items)['demo-app/slice-5'].links, undefined);
  });

  test('201 items in all: nothing is sent, no HTTP call, one stderr line with the count and the cap, exit 0', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => `| ${index + 1} | S${index + 1} | planned | | | |`).join('\n');
    const lines = Array.from({ length: 3 }, (_, index) => `- check number ${index}`).join('\n');
    const planText = `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;
    const unverifiedText = `### Slice 1: x\n\n${lines}\n`;
    const snapshot = buildSnapshot({ project: PROJECT, planText, unverifiedText });
    assert.equal(snapshot.overflow, true);
    assert.equal(snapshot.count, MAX_ITEMS + 1);
    assert.deepEqual(snapshot.items, []);
    const board = await startFakeBoard();
    const root = mkdtempSync(join(tmpdir(), 'sync-over-'));
    writeFileSync(join(root, 'plan.md'), planText);
    mkdirSync(join(root, 'docs', 'plan'), { recursive: true });
    writeFileSync(join(root, 'docs', 'plan', 'unverified.md'), unverifiedText);
    const result = await runSync(['--root', root, '--project', PROJECT], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
    board.server.close();
    assert.equal(result.code, 0);
    assert.equal(board.requests.length, 0);
    assert.equal(result.stderr.trim(), 'sync-docs: 201 items exceed the 200-item cap, nothing sent');
  });

  test('nested bullets fold into their parent check; the hash stays on the first line', () => {
    const text = '### Slice 5: x\n\n- Import works on the phone\n  - on the S21\n  - on the emulator\n- Second check\n';
    const [block] = parseUnverified(text);
    assert.equal(block.lines.length, 2);
    assert.deepEqual(block.lines[0].nested, ['on the S21', 'on the emulator']);
    const planText = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 5 | Five | planned | | | |\n';
    const checks = buildItems({ project: PROJECT, planText, unverifiedText: text })[0].checks;
    assert.equal(checks.length, 2);
    assert.equal(checks[0].title, 'Import works on the phone on the S21 on the emulator');
    assert.equal(checks[0].key, `demo-app/slice-5/check-${checkHash('- Import works on the phone')}`);
  });

  test('checks do not count toward the 1000 items-plus-parts cap; they keep their own per-slice cap', () => {
    const rows = Array.from({ length: 20 }, (_, index) => `| ${index + 1} | S${index + 1} | planned | | | |`).join('\n');
    const lines = Array.from({ length: 100 }, (_, index) => `- check number ${index}`).join('\n');
    const unverifiedText = Array.from({ length: 20 }, (_, index) => `### Slice ${index + 1}: x\n\n${lines}\n`).join('\n');
    const snapshot = buildSnapshot({
      project: PROJECT, unverifiedText,
      planText: `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`,
    });
    assert.equal(snapshot.overflow, false, '2000 checks, 20 items');
    assert.equal(snapshot.items.length, 20);
    assert.equal(snapshot.items[0].checks.length, MAX_CHECKS);
  });

  test('a `**You` line stays an owner step item (waiting_for_me) and is not a check', () => {
    const planText = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 5 | Five | planned | | | |\n';
    const built = buildItems({ project: PROJECT, planText, unverifiedText: '### Slice 5: x\n\n- **You:** check the picker\n- Plain check\n' });
    const slice = built.find((item) => item.type === 'slice');
    assert.equal(slice.checks.length, 1);
    const owner = built.find((item) => item.type === 'waiting_for_me');
    assert.equal(owner.key, `demo-app/slice-5/check-${checkHash('- **You:** check the picker')}`);
    assert.equal(owner.parent, 'Slice 5 · Not yet verified');
    assert.equal(owner.status, 'open');
  });

  test('the plugin skill tells agents to write every person-only step as a `**You:**` line with its link', () => {
    const skill = readFileSync(join(here, '..', 'skills', 'agent-board', 'SKILL.md'), 'utf8');
    assert.match(skill, /- \*\*You:\*\*/);
    assert.match(skill, /direct link/);
  });

  test('exactly 200 items are all sent', () => {
    const rows = Array.from({ length: 200 }, (_, index) => `| ${index + 1} | S${index + 1} | planned | | | |`).join('\n');
    const lines = Array.from({ length: 5 }, (_, index) => `- check number ${index}`).join('\n');
    const many = buildItems({
      project: PROJECT, planText: `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`,
      unverifiedText: `### Slice 1: x\n\n${lines}\n`,
    });
    assert.equal(many.length, MAX_ITEMS);
    assert.equal(many[0].checks.length, 5);
  });
});

describe('review fixes', () => {
  const tableOf = (rows) => `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;

  test('a failed unverified.md read aborts the sync with a SourceError', () => {
    const failing = { read: () => { throw new Error('boom'); }, list: () => [] };
    assert.throws(() => readUnverified(failing), { path: 'docs/plan/unverified.md' });
    assert.equal(readUnverified({ read: () => null }), '');
  });

  test('a park lead with a colon, dash, em dash, comma or parenthesis is stripped and the wait on work gives no card', () => {
    for (const lead of ['parked: ', 'parked - ', 'parked \u2014 ', 'parked, ', 'parked (']) {
      const closing = lead.endsWith('(') ? ')' : '';
      const planText = tableOf(`| 9 | Nine | ${lead}waits for the deploy${closing} | | | |`);
      const built = byKey(buildItems({ project: PROJECT, planText }));
      assert.equal(built['demo-app/slice-9'].status, 'blocked', lead);
      assert.equal(built['demo-app/slice-9'].why, 'waits for the deploy', lead);
      assert.equal(built['demo-app/slice-9/waiting'], undefined, lead);
    }
    assert.equal(waitsOnlyOnWork('parked - waits for the deploy'), true);
    assert.equal(waitsOnlyOnWork('parked (waits for a merge)'), true);
  });

  test('with --root and no project the slug is the root folder name, never an enclosing repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-slug-'));
    writeFileSync(join(root, 'plan.md'), `# Plan\n\n${tableOf('| 9 | Nine | planned | | | |')}`);
    assert.equal(collect({ root }, {}).project, basename(root).toLowerCase());
    assert.equal(collect({ root }, { AGENT_BOARD_PROJECT: 'Forced' }).project, 'forced');
  });

  test('a slice-file note loses its parked lead too', () => {
    const planText = tableOf('| 9 | Nine | parked | | | |');
    const waits = buildItems({ project: PROJECT, planText, sliceTexts: { 9: '**Parked** - waits for the deploy\n' } });
    assert.equal(byKey(waits)['demo-app/slice-9/waiting'], undefined);
    const user = buildItems({ project: PROJECT, planText, sliceTexts: { 9: '**Parked** - pick the store\n' } });
    assert.equal(byKey(user)['demo-app/slice-9/waiting'].title, 'pick the store');
  });

  test('only "**You:**" marks an owner step', () => {
    const unverifiedText = '### Slice 9: x\n\n- **You** should see the picker\n- **You can** export twice\n- **You:** press the button\n';
    const built = byKey(buildItems({ project: PROJECT, planText: tableOf('| 9 | Nine | planned | | | |'), unverifiedText }));
    assert.equal(built['demo-app/slice-9'].checks.length, 2);
    const owner = Object.values(built).filter((item) => item.type === 'waiting_for_me');
    assert.equal(owner.length, 1);
    assert.match(owner[0].title, /press the button/);
  });

  test('a row, check or owner step with an empty title is skipped with a notice', () => {
    const planText = tableOf('| 8 | | planned | | | |\n| 10 | ** ** | planned | | | |\n| 9 | Nine | planned | | | |');
    const unverifiedText = '### Slice 9: x\n\n- **  **\n- real check\n';
    const snapshot = buildSnapshot({ project: PROJECT, planText, unverifiedText });
    assert.ok(snapshot.items.every((item) => item.title !== ''));
    assert.deepEqual(snapshot.items.filter((item) => item.type === 'slice').map((item) => item.key), ['demo-app/slice-9']);
    assert.equal(snapshot.items[0].checks.length, 1);
    assert.ok(snapshot.notices.some((notice) => /slice 8 has an empty title/.test(notice)));
    assert.ok(snapshot.notices.some((notice) => /empty entry/.test(notice)));
  });

  test('a File-cell link outside the root or with an anchor is made safe', () => {
    assert.equal(safeLinkPath('../../../secrets/x.md'), '');
    assert.equal(safeLinkPath('/etc/passwd'), '');
    assert.equal(safeLinkPath('C:/x.md'), '');
    assert.equal(safeLinkPath('docs/plan/slices/09-x.md#work'), 'docs/plan/slices/09-x.md');
    assert.equal(safeLinkPath('docs/plan/slices/09%20x.md'), 'docs/plan/slices/09 x.md');
  });
});

describe('sync-docs CLI', () => {
  const baseArgs = ['--root', FIXTURE, '--project', PROJECT, '--parked', join(FIXTURE, 'parked.md')];

  test('sends one sync_snapshot with the project and all items; a second run sends the same', async () => {
    const board = await startFakeBoard();
    const env = { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 'test-token-not-real' };
    const first = await runSync(baseArgs, env);
    const second = await runSync(baseArgs, env);
    board.server.close();
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    assert.match(first.stdout, /^sync-docs: demo-app items=\d+ created=1/);
    assert.equal(board.requests.length, 2);
    assert.equal(board.requests[0].name, 'sync_snapshot');
    assert.equal(board.requests[0].arguments.project, PROJECT);
    assert.deepEqual(board.requests[1], board.requests[0]);
    assert.equal(board.requests[0].arguments.items.length, snapshotOf().length);
    assert.ok(!JSON.stringify(first).includes('test-token-not-real'));
  });

  test('--parked prints one stderr line per slice whose row is not parked yet and adds no item', async () => {
    const withParked = await runSync([...baseArgs, '--dry-run'], { AGENT_BOARD_TOKEN: '' });
    const without = await runSync(['--root', FIXTURE, '--project', PROJECT, '--dry-run'], { AGENT_BOARD_TOKEN: '' });
    assert.equal(withParked.stdout, without.stdout);
    assert.deepEqual(withParked.stderr.trim().split('\n'), ['sync-docs: slice 4 is parked in parked.md but its row on main is not parked yet, not sent']);
    assert.equal(without.stderr, '');
  });

  test('--dry-run prints the items and sends nothing', async () => {
    const board = await startFakeBoard();
    const result = await runSync([...baseArgs, '--dry-run'], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
    board.server.close();
    assert.equal(result.code, 0);
    assert.equal(board.requests.length, 0);
    assert.equal(JSON.parse(result.stdout).length, snapshotOf().length);
  });

  test('no token, no plan.md, or a dead board: exit 0 and nothing breaks', async () => {
    const board = await startFakeBoard();
    const noToken = await runSync(baseArgs, { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: '' });
    const empty = mkdtempSync(join(tmpdir(), 'sync-empty-'));
    const noPlan = await runSync(['--root', empty, '--project', PROJECT], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
    const url = board.url;
    board.server.close();
    const dead = await runSync(baseArgs, { AGENT_BOARD_URL: url, AGENT_BOARD_TOKEN: 't' });
    assert.deepEqual([noToken.code, noPlan.code, dead.code], [0, 0, 0]);
    assert.equal(board.requests.length, 0);
    assert.match(noPlan.stderr, /no plan\.md/);
    assert.match(dead.stderr, /skipped/);
  });

  test('a plan.md with no recognised status table sends nothing', async () => {
    const board = await startFakeBoard();
    const root = mkdtempSync(join(tmpdir(), 'sync-notable-'));
    writeFileSync(join(root, 'plan.md'), '# Plan\n\n## Renamed heading\n\nno table here\n');
    const result = await runSync(['--root', root, '--project', PROJECT], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
    board.server.close();
    assert.equal(result.code, 0);
    assert.equal(board.requests.length, 0);
    assert.match(result.stderr, /recognised status table, nothing sent/);
  });

  const HEADER = '| # | Title | Status | PR | File |\n| --- | --- | --- | --- | --- |\n';
  const UNVERIFIED = '### Slice 3: Demo\n\n- Check the thing on a device\n';

  function planRoot(table, unverified) {
    const root = mkdtempSync(join(tmpdir(), 'sync-empty-'));
    writeFileSync(join(root, 'plan.md'), `# Plan\n\n## Status\n\n${table}\n`);
    if (unverified) {
      mkdirSync(join(root, 'docs', 'plan'), { recursive: true });
      writeFileSync(join(root, 'docs', 'plan', 'unverified.md'), unverified);
    }
    return root;
  }

  test('FL-1402: a header row with no data rows still sends the snapshot', () => {
    assert.equal(parsePlanTable(`## Status\n\n${HEADER}`).length, 0);
    assert.equal(hasEmptyStatusTable(`## Status\n\n${HEADER}`), true);
    const withChecks = collect({ root: planRoot(HEADER, UNVERIFIED), project: PROJECT });
    assert.equal(withChecks.items.length, 0, 'a check has no card of its own, only its slice holds it');
    assert.match(withChecks.notices.join(''), /slice 3 has checks in unverified\.md but no open row/);
    const none = collect({ root: planRoot(HEADER), project: PROJECT });
    assert.deepEqual(none.items, []);
  });

  test('FL-1402: a table of unparseable rows, or no header, sends nothing', () => {
    const unparseable = `${HEADER}| - | not a slice | Done | | |\n`;
    assert.equal(hasEmptyStatusTable(`## Status\n\n${unparseable}`), false);
    assert.equal(collect({ root: planRoot(unparseable), project: PROJECT }), null);
    assert.equal(hasEmptyStatusTable('## Status\n\nno table\n'), false);
    assert.equal(collect({ root: planRoot('no table'), project: PROJECT }), null);
  });

  test('FL-1402: blank placeholder rows are rows, alignment-colon separators are not', () => {
    const blank = `${HEADER}| | | | | |\n`;
    assert.equal(hasEmptyStatusTable(`## Status\n\n${blank}`), false);
    assert.equal(collect({ root: planRoot(blank), project: PROJECT }), null);
    const dashRow = `${HEADER}| - | - | - | - | - |\n`;
    assert.equal(hasEmptyStatusTable(`## Status\n\n${dashRow}`), false);
    const aligned = '| # | Title | Status | PR | File |\n|:---|:---:|---:|---|---|\n';
    assert.equal(hasEmptyStatusTable(`## Status\n\n${aligned}`), true);
  });

  test('FL-1402: CRLF, a header-only table under ### and the empty notice', () => {
    const crlf = `## Status\r\n\r\n### Product\r\n\r\n${HEADER.replace(/\n/g, '\r\n')}`;
    assert.equal(hasEmptyStatusTable(crlf), true);
    assert.equal(parsePlanTable(crlf).length, 0);
    const snapshot = collect({ root: planRoot(`### Product\n\n${HEADER}`), project: PROJECT });
    assert.deepEqual(snapshot.items, []);
    assert.equal(snapshot.notices.length, 1);
    assert.match(snapshot.notices[0], /status table empty/);
  });

  test('FL-1402: a conflict-marked plan.md sends no empty snapshot', () => {
    const marked = `<<<<<<< HEAD\n${HEADER}=======\n${HEADER}>>>>>>> branch`;
    assert.equal(collect({ root: planRoot(marked), project: PROJECT }), null);
  });

  test('FL-1402: conflict markers send nothing even when rows parse, and say why on stderr', () => {
    const row = '| 1 | Title | planned | | docs/plan/slices/01-x.md |\n';
    const marked = `<<<<<<< HEAD\n${HEADER}${row}=======\n${HEADER}${row}>>>>>>> branch\n`;
    const written = [];
    const orig = process.stderr.write;
    process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
    try {
      assert.equal(collect({ root: planRoot(marked), project: PROJECT }), null);
    } finally {
      process.stderr.write = orig;
    }
    assert.match(written.join(''), /conflict markers/);
  });

  test('reads a git ref when no --root is given', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sync-git-'));
    cpSync(FIXTURE, repo, { recursive: true });
    const git = (args) => new Promise((resolve) => spawn('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' }).on('close', resolve));
    await git(['init', '-q', '-b', 'main']);
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'fixture']);
    writeFileSync(join(repo, 'plan.md'), '## Status\n\n(uncommitted edit that must not be read)\n');
    const result = await runSync(['--repo', repo, '--ref', 'main', '--project', PROJECT, '--dry-run'], {});
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).length, collect({ root: FIXTURE, project: PROJECT }).items.length);
  });

  async function gitFixture(prefix) {
    const repo = mkdtempSync(join(tmpdir(), prefix));
    cpSync(FIXTURE, repo, { recursive: true });
    const git = (args) => new Promise((resolve) => {
      let out = '';
      const child = spawn('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => resolve(out.trim()));
    });
    await git(['init', '-q', '-b', 'main']);
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'fixture']);
    return { repo, git };
  }

  async function breakBlob({ repo, git }, path) {
    const hash = await git(['rev-parse', `main:${path}`]);
    rmSync(join(repo, '.git', 'objects', hash.slice(0, 2), hash.slice(2)), { force: true });
  }

  test('an unreadable unverified.md (not absent) sends nothing, like any other unreadable source', async () => {
    const board = await startFakeBoard();
    const fixture = await gitFixture('sync-unreadable-');
    await breakBlob(fixture, 'docs/plan/unverified.md');
    const result = await runSync(['--repo', fixture.repo, '--ref', 'main', '--project', PROJECT], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
    board.server.close();
    assert.equal(result.code, 0);
    assert.equal(board.requests.length, 0);
    assert.match(result.stderr, /could not read docs\/plan\/unverified\.md/);
  });

  test('a failing git read of a slice file sends nothing', async () => {
    for (const path of ['docs/plan/slices/03-export-button.md']) {
      const board = await startFakeBoard();
      const fixture = await gitFixture('sync-broken-');
      await breakBlob(fixture, path);
      const result = await runSync(['--repo', fixture.repo, '--ref', 'main', '--project', PROJECT], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
      board.server.close();
      assert.equal(result.code, 0);
      assert.equal(board.requests.length, 0, path);
      assert.match(result.stderr, new RegExp(`could not read ${path.replace(/\./g, '\\.')}`));
    }
  });

  test('an absent unverified.md in a git ref still sends the slices', async () => {
    const board = await startFakeBoard();
    const fixture = await gitFixture('sync-absent-');
    await fixture.git(['rm', '-q', 'docs/plan/unverified.md']);
    await fixture.git(['commit', '-q', '-m', 'drop unverified']);
    const result = await runSync(['--repo', fixture.repo, '--ref', 'main', '--project', PROJECT], { AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: 't' });
    board.server.close();
    assert.equal(result.code, 0);
    assert.equal(board.requests.length, 1);
    assert.ok(board.requests[0].arguments.items.length > 0);
    const sliceItems = board.requests[0].arguments.items.filter((item) => item.type === 'slice');
    assert.ok(sliceItems.every((item) => Array.isArray(item.checks) && item.checks.length === 0), 'absent file: checks [] so the board closes them');
  });
});

describe('slice parts (Slice 11 part D)', () => {
  const SLICE_TEXT = [
    '### Slice 3 - Export', '', '#### Work', '', '**A. Server**', '',
    '- [x] **A1.** one', '- [x] **A2.** two', '', '**B. Client**', '',
    '- [x] **B1.** one', '- [ ] **B2.** two', '', '- **C. Bullet form**', '  - [x] done a', '  - [X] done b', '',
    '#### Verification', '', '**D. Not in work**', '- [ ] **D1.** x', '',
  ].join('\n');
  const planText = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 3 | Export | planned | | | docs/plan/slices/03-export.md |\n| 4 | Other | planned | | | |\n';

  test('parts from lettered groups: all ticked is done, mixed ticks is not, bullet form counts', () => {
    assert.deepEqual(parseParts(SLICE_TEXT), [
      { letter: 'A', title: 'Server', done: true }, { letter: 'B', title: 'Client', done: false }, { letter: 'C', title: 'Bullet form', done: true },
    ]);
  });

  test('no letters in a Work section sends parts [], no work section or no file text sends no parts field', () => {
    assert.deepEqual(parseParts('#### Work\n\n- [x] one\n- [ ] two\n'), []);
    assert.deepEqual(parseParts('**A. Outside**\n- [x] x\n'), []);
    const items = buildSnapshot({ project: PROJECT, planText, sliceTexts: { 3: '#### Work\n- [x] a\n', 4: '### Notes\n**A. Outside**\n' } }).items;
    assert.deepEqual(items[0].parts, []);
    assert.equal('parts' in items[1], false);
    const unread = buildSnapshot({ project: PROJECT, planText, sliceTexts: {} }).items;
    assert.equal('parts' in unread[0], false);
  });

  // Slice 17 part G: a slice's parts looked open on the board until the sync after the index PR, because doc sync
  // ran after the index PR, not at the merge. The client's part is that a slice whose row moved to slices-done.md sends no item and no parts, so
  // the board closes both ("A part that is not in the next snapshot of its slice is closed", docs/clients.md).
  // The claim PR's title is not part of the key (`<project>/slice-<N>`), so it cannot keep a card from matching.
  test('a slice whose row moved to slices-done.md sends neither the slice nor its parts, so the board closes them', () => {
    const before = buildSnapshot({ project: PROJECT, planText, sliceTexts: { 3: '#### Work\n**A. One**\n- [ ] a\n' } }).items;
    assert.deepEqual(before.map((item) => item.key), [`${PROJECT}/slice-3`, `${PROJECT}/slice-4`]);
    assert.deepEqual(before[0].parts, [{ letter: 'A', title: 'One', done: false }]);
    const movedPlan = planText.split(/\r?\n/).filter((line) => !/^\|\s*3\s*\|/.test(line)).join('\n');
    const after = buildSnapshot({ project: PROJECT, planText: movedPlan, sliceTexts: { 3: '#### Work\n**A. One**\n- [ ] a\n' } }).items;
    assert.deepEqual(after.map((item) => item.key), [`${PROJECT}/slice-4`]);
    assert.ok(after.every((item) => !item.parts || item.key !== `${PROJECT}/slice-3`));
  });

  test('the Work heading is ## to ####, "Work" or "Work items" only, and the first match wins', () => {
    for (const heading of ['## Work', '### Work items', '#### WORK', '#### Work   ']) {
      assert.equal(parseParts(`${heading}\n**A. One**\n- [x] a\n`).length, 1, heading);
    }
    for (const heading of ['#### Work log', '##### Work', '# Work', '#### Tasks', '#### Working notes']) {
      assert.deepEqual(parseParts(`${heading}\n**A. One**\n- [x] a\n`), [], heading);
    }
    const two = parseParts('### Work\n**A. First**\n- [x] a\n\n### Work items\n**B. Second**\n');
    assert.deepEqual(two, [{ letter: 'A', title: 'First', done: true }]);
    assert.equal(parseParts('### Work log\n\n#### Work\n**A. Real**\n- [x] a\n').length, 1);
  });

  test('fences close only on the same character, at least as long, with nothing after', () => {
    const four = ['#### Work', '**A. One**', '- [x] a', '````', '```', '**B. Fake**', '- [ ] x', '```', '````', '**C. Real**', '- [x] c'].join('\n');
    assert.deepEqual(parseParts(four).map((p) => p.letter), ['A', 'C']);
    const tilde = ['#### Work', '**A. One**', '- [x] a', '~~~', '```', '**B. Fake**', '- [ ] x', '```', '~~~', '**C. Real**', '- [x] c'].join('\n');
    assert.deepEqual(parseParts(tilde).map((p) => p.letter), ['A', 'C']);
    const infoLine = ['#### Work', '**A. One**', '- [x] a', '```', '```js', '**B. Fake**', '```', '**C. Real**'].join('\n');
    assert.deepEqual(parseParts(infoLine).map((p) => p.letter), ['A', 'C']);
  });

  test('an unclosed fence keeps the parts found before it, or sends no parts field when none were', () => {
    const planText2 = '## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n| 3 | Export | planned | | | docs/plan/slices/03-export.md |\n';
    const afterA = '#### Work\n**A. One**\n- [x] a\n```\n**B. Hidden**\n- [ ] b\n';
    const items = buildSnapshot({ project: PROJECT, planText: planText2, sliceTexts: { 3: afterA } }).items;
    assert.deepEqual(items[0].parts, [{ letter: 'A', title: 'One', done: true }]);
    const beforeAny = '#### Work\n```\n**A. Hidden**\n- [x] a\n';
    const none = buildSnapshot({ project: PROJECT, planText: planText2, sliceTexts: { 3: beforeAny } }).items;
    assert.equal('parts' in none[0], false);
  });

  test('a # line in a code fence is not a heading, and a deeper sub-heading does not end the section', () => {
    const fenced = ['#### Work', '**A. One**', '- [x] a', '```bash', '# comment', '- [ ] fenced box', '```', '- [ ] a2', '**B. Two**', '- [x] b', '#### Verification', '**C. Out**'].join('\n');
    assert.deepEqual(parseParts(fenced), [{ letter: 'A', title: 'One', done: false }, { letter: 'B', title: 'Two', done: true }]);
    const deeper = ['### Work', '**A. One**', '- [x] a', '#### Sub heading', '**B. Two**', '- [x] b', '### Next', '**C. Out**'].join('\n');
    assert.deepEqual(parseParts(deeper).map((part) => part.letter), ['A', 'B']);
    assert.deepEqual(parseParts('## Work\n**A. One**\n- [x] a\n# Higher\n**B. Out**\n').map((part) => part.letter), ['A']);
  });

  test('a repeated letter keeps its own checkboxes only; later ones are ignored', () => {
    const text = '#### Work\n**A. One**\n- [x] a\n**B. Two**\n- [x] b\n**A. Again**\n- [ ] z\n';
    assert.deepEqual(parseParts(text), [{ letter: 'A', title: 'One', done: true }, { letter: 'B', title: 'Two', done: true }]);
  });

  test('checkboxes in -, *, + and numbered items all count', () => {
    for (const marker of ['-', '*', '+', '1.', '12.']) {
      assert.deepEqual(parseParts(`#### Work\n**A. One**\n${marker} [x] a\n${marker} [X] b\n`), [{ letter: 'A', title: 'One', done: true }], marker);
      assert.equal(parseParts(`#### Work\n**A. One**\n${marker} [x] a\n${marker} [ ] b\n`)[0].done, false, marker);
    }
  });

  test('bold lines that are not parts (Touches, item labels, Done) start nothing', () => {
    const text = '#### Work\n**Touches:** a b\n**B1.** item\n**Done when** x\n- **A1.** item\n**A. Real**\n- [x] a\n';
    assert.deepEqual(parseParts(text), [{ letter: 'A', title: 'Real', done: true }]);
    assert.deepEqual(parseParts('#### Work\n**Touches:** a\n**B1.** item\n- [x] a\n'), []);
  });

  test('the snapshot puts parts on the slice item only, and the same documents give the same snapshot', () => {
    const make = () => buildSnapshot({ project: PROJECT, planText, sliceTexts: { 3: SLICE_TEXT } });
    const items = make().items;
    assert.equal(items[0].key, 'demo-app/slice-3');
    assert.equal(items[0].parts.length, 3);
    assert.equal('parts' in items[1], false);
    assert.deepEqual(make(), make());
  });

  test('a group with no checkbox is not done; a repeated letter counts once; at most 26 groups', () => {
    assert.deepEqual(parseParts('#### Work\n**A. Full**\n- [x] x\n**A. Again**\n**B. Empty**\n'),
      [{ letter: 'A', title: 'Full', done: true }, { letter: 'B', title: 'Empty', done: false }]);
    const many = Array.from({ length: 30 }, (_, i) => `**${String.fromCharCode(65 + (i % 26))}. G${i}**\n- [x] x`).join('\n');
    assert.equal(parseParts(`#### Work\n${many}\n`).length, 26);
  });

  function manySlices(count, groupCount) {
    const groups = Array.from({ length: groupCount }, (_, i) => `**${String.fromCharCode(65 + i)}. G**\n- [x] x`).join('\n');
    const rows = Array.from({ length: count }, (_, i) => `| ${i + 1} | S${i + 1} | planned | | | |`).join('\n');
    const plan = `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;
    const sliceTexts = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), `#### Work\n${groups}\n`]));
    return buildSnapshot({ project: PROJECT, planText: plan, sliceTexts });
  }

  test('parts do not count toward the 200 item limit: 190 items and 60 parts still sync', () => {
    const snapshot = manySlices(190, 0);
    assert.equal(snapshot.overflow, false);
    const withParts = manySlices(10, 6);
    assert.equal(withParts.overflow, false);
    const rows = Array.from({ length: 190 }, (_, i) => `| ${i + 1} | S${i + 1} | planned | | | |`).join('\n');
    const plan = `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;
    const letters = (n) => `#### Work\n${Array.from({ length: n }, (_, i) => `**${String.fromCharCode(65 + i)}. G**`).join('\n')}\n`;
    const mixed = buildSnapshot({ project: PROJECT, planText: plan, sliceTexts: { 1: letters(26), 2: letters(26), 3: letters(8) } });
    assert.equal(mixed.overflow, false);
    assert.equal(mixed.items.length, 190);
    assert.equal(mixed.expanded, 190 + 60);
  });

  test('more than 200 items is withheld whole; so are items plus parts over 1000', () => {
    const items = manySlices(201, 0);
    assert.equal(items.overflow, true);
    assert.equal(items.limit, MAX_ITEMS);
    assert.deepEqual(items.items, []);
    const parts = manySlices(40, 26); // 40 + 40 * 26 = 1080
    assert.equal(parts.overflow, true);
    assert.equal(parts.limit, MAX_EXPANDED_ITEMS);
    assert.equal(parts.count, 1080);
    assert.deepEqual(parts.items, []);
  });
});

describe('Slice 27: cards that say what, for which slice and why', () => {
  const REPO = 'https://github.com/example/demo-app';
  const table = (row) => `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${row}\n`;

  test('a `**You:**` line is the step; why names the slice and what it unblocks; the slice file is linked', () => {
    const planText = table('| 5 | Picker | planned | | | [file](docs/plan/slices/05-picker.md) |');
    const unverifiedText = '### Slice 5: x\n\n- **You:** check the picker on a phone so that the release can go out.\n- **You:** open the board once\n';
    const owner = buildItems({ project: PROJECT, planText, unverifiedText, repoUrl: REPO }).filter((item) => item.type === 'waiting_for_me');
    assert.equal(owner[0].title, 'check the picker on a phone so that the release can go out.');
    assert.equal(owner[0].why, 'Slice 5: Picker — so that the release can go out.');
    assert.equal(owner[1].why, 'Not yet verified for Slice 5: Picker');
    assert.deepEqual(owner[1].links, [{ label: 'Slice file', url: `${REPO}/blob/main/docs/plan/slices/05-picker.md` }]);
  });

  test('a parked row\'s card is the slice file\'s "Open for the owner" lines, why is the slice, with the link', () => {
    const planText = table('| 9 | Nine | parked: waits for the user | | | [file](docs/plan/slices/09-nine.md) |');
    const sliceTexts = { 9: '### Slice 9\n\n## Open for the owner\n\n- Build this or drop it.\n- Pick the store.\n\n## Notes\n\n- other\n' };
    const card = byKey(buildItems({ project: PROJECT, planText, sliceTexts, repoUrl: REPO }))['demo-app/slice-9/waiting'];
    assert.equal(card.title, 'Build this or drop it. Pick the store.');
    assert.equal(card.why, 'Slice 9: Nine');
    assert.equal(card.links[0].url, `${REPO}/blob/main/docs/plan/slices/09-nine.md`);
  });

  test('placeholders and later paragraphs under "Open for the owner" are not the card title', () => {
    const planText = table('| 9 | Nine | parked: waits for the user | | | |');
    const none = { 9: '## Open for the owner\n\n- none\n\n## Notes\n' };
    assert.equal(byKey(buildItems({ project: PROJECT, planText, sliceTexts: none, repoUrl: REPO }))['demo-app/slice-9/waiting'].title, 'waits for the user');
    const sentence = { 9: '## Open for the owner\n\nNone, the owner has nothing to do.\n\n## Notes\n' };
    assert.equal(byKey(buildItems({ project: PROJECT, planText, sliceTexts: sentence, repoUrl: REPO }))['demo-app/slice-9/waiting'].title, 'waits for the user');
    const starts = { 9: '## Open for the owner\n\nNothing is wired until you approve the DNS change.\n\n## Notes\n' };
    assert.equal(byKey(buildItems({ project: PROJECT, planText, sliceTexts: starts, repoUrl: REPO }))['demo-app/slice-9/waiting'].title, 'Nothing is wired until you approve the DNS change.');
    const later = { 9: '## Open for the owner\n\n- Pick the store.\n\nAn unrelated paragraph.\n' };
    assert.equal(byKey(buildItems({ project: PROJECT, planText, sliceTexts: later, repoUrl: REPO }))['demo-app/slice-9/waiting'].title, 'Pick the store.');
  });

  test('a parked row with no owner section uses its reason as the title', () => {
    const planText = table('| 9 | Nine | parked: pick the store | | | |');
    const card = byKey(buildItems({ project: PROJECT, planText }))['demo-app/slice-9/waiting'];
    assert.equal(card.title, 'pick the store');
    assert.equal(card.why, 'Slice 9: Nine');
  });
});

describe('Slice 31: plan sync reads the documents right', () => {
  const table = (rows) => `## Status\n\n| # | Slice | Status | PR | Issue | File |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;
  const SKILL = readFileSync(join(here, '..', 'skills', 'agent-board', 'SKILL.md'), 'utf8');
  const PLAN_SYNC = readFileSync(join(here, '..', '..', 'docs', 'setup', 'plan-sync.md'), 'utf8');
  // One example reason and the word the documents use for each entry of WAIT_TARGETS, in order.
  const TARGET_EXAMPLES = [
    ['waits for Slice 3', 'another slice'], ['waits for another repo\'s slice', 'another slice'], ['waits for an interactive session', 'interactive session'],
    ['waits for a deploy', 'deploy'], ['waits for a merge', 'merge'], ['waits for CI', 'CI'], ['waits for PR #4', 'PR'],
  ];

  test('waitsOnlyOnWork is an allow-list: a person named in other words keeps the card', () => {
    for (const reason of ['waits for Slice 6 and the store pick', 'waits for the deploy, then Ash decides', 'waits for CI and the founder', 'waits for Slice 6 and a decision',
      'waits for Slice 6 hmm', 'waiting on slice 7 plus the DNS change', 'behind Slice 6, owner go-ahead']) {
      assert.equal(waitsOnlyOnWork(reason), false, reason);
    }
    for (const reason of ['waits for Slice 6 and Slice 7', 'waits for the deploy, then CI', 'waiting on PR #12 to merge', 'parked: behind Slice 6 (owner, 2026-11-18)']) {
      assert.equal(waitsOnlyOnWork(reason), true, reason);
    }
  });

  test('a comma may come before the words that follow a work target', () => {
    for (const reason of ['Parked: waiting on Slice 29, which is not built yet', 'waits for a merge to main', 'waits for a merge to main, which is not done yet',
      'waits for the deploy of slice 4', 'waits for Slice 29, then the deploy']) {
      assert.equal(waitsOnlyOnWork(reason), true, reason);
    }
    for (const reason of ['waits for Slice 29, which your answer unblocks', 'waits for a merge to main, owner picks']) {
      assert.equal(waitsOnlyOnWork(reason), false, reason);
    }
  });

  test('a number listed twice is read once and its ambiguity notice appears once', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-dup-'));
    mkdirSync(join(root, 'docs', 'plan', 'slices'), { recursive: true });
    writeFileSync(join(root, 'plan.md'), table('| 4 | Four | parked: pick the store | | | |\n| 4 | Four again | planned | | | |'));
    writeFileSync(join(root, 'docs', 'plan', 'slices', '04-a.md'), 'x\n');
    writeFileSync(join(root, 'docs', 'plan', 'slices', '04-b.md'), 'y\n');
    const notices = collect({ root, project: PROJECT }).notices.filter((notice) => /slice 4 matches/.test(notice));
    assert.equal(notices.length, 1);
  });

  test('SKILL.md and plan-sync.md describe the same park words as waitsOnlyOnWork', () => {
    assert.equal(TARGET_EXAMPLES.length, WAIT_TARGETS.length, 'a new target needs an example here and a word in both documents');
    for (const [reason, word] of TARGET_EXAMPLES) {
      assert.equal(waitsOnlyOnWork(reason), true, reason);
      assert.ok(SKILL.includes(word), `SKILL.md names "${word}"`);
      assert.ok(PLAN_SYNC.includes(word), `plan-sync.md names "${word}"`);
    }
    for (const lead of ['waits for', 'waiting on', 'behind']) {
      assert.equal(waitsOnlyOnWork(`${lead} Slice 3`), true, lead);
      assert.ok(SKILL.includes(`"${lead}"`), `SKILL.md names "${lead}"`);
      assert.ok(PLAN_SYNC.includes(`"${lead}"`), `plan-sync.md names "${lead}"`);
    }
  });

  test('a slice file is matched by its whole number; two files for one number are read as neither', () => {
    assert.deepEqual(filesForSlice(['31-a.md', '3-b.md', '310-c.md', '31a-d.md', 'README.md', '31-notes.txt'], '31'), ['31-a.md']);
    assert.deepEqual(filesForSlice(['12a-x.md', '12-y.md'], '12a'), ['12a-x.md']);
    const root = mkdtempSync(join(tmpdir(), 'sync-ambig-'));
    mkdirSync(join(root, 'docs', 'plan', 'slices'), { recursive: true });
    writeFileSync(join(root, 'plan.md'), table('| 4 | Four | parked: pick the store | | | |'));
    writeFileSync(join(root, 'docs', 'plan', 'slices', '04-a.md'), '## Open for the owner\n\n- from a\n');
    writeFileSync(join(root, 'docs', 'plan', 'slices', '04-b.md'), '## Open for the owner\n\n- from b\n');
    const snapshot = collect({ root, project: PROJECT });
    assert.equal(byKey(snapshot.items)['demo-app/slice-4/waiting'].title, 'pick the store');
    assert.match(snapshot.notices.join(''), /slice 4 matches 2 files/);
    rmSync(join(root, 'docs', 'plan', 'slices', '04-b.md'));
    assert.equal(byKey(collect({ root, project: PROJECT }).items)['demo-app/slice-4/waiting'].title, 'from a');
  });

  test('owner steps of a block with no status row make no card, and a notice says so', () => {
    const snapshot = buildSnapshot({ project: PROJECT, planText: table('| 5 | Five | planned | | | |'), unverifiedText: '### Slice 5: x\n\n- **You:** do five\n\n### Slice 8: y\n\n- **You:** do eight\n' });
    assert.deepEqual(snapshot.items.filter((item) => item.type === 'waiting_for_me').map((item) => item.title), ['do five']);
    assert.match(snapshot.notices.join(''), /slice 8 has owner steps in unverified.md but no status row/);
  });

  test('owner steps of a slice dropped for an empty title make no card (its parent card is not sent), and notices say so', () => {
    for (const title of ['', '   ']) {
      const snapshot = buildSnapshot({ project: PROJECT, planText: table(`| 5 | ${title} | planned | | | |`), unverifiedText: '### Slice 5: x\n\n- **You:** do five\n' });
      assert.deepEqual(snapshot.items.filter((item) => item.type === 'waiting_for_me'), []);
      assert.ok(snapshot.notices.some((notice) => /slice 5 has an empty title/.test(notice)));
      assert.ok(snapshot.notices.some((notice) => /slice 5 has owner steps in unverified.md but no status row/.test(notice)));
    }
  });

  test('openForOwner ignores a heading quoted in a code fence and a horizontal rule', () => {
    assert.equal(openForOwner('```md\n## Open for the owner\n\nSample text.\n```\n\nBody.\n'), '');
    assert.equal(openForOwner('## Open for the owner\n\n---\n'), '');
    assert.equal(openForOwner('## Open for the owner\n\n- ---\n- Pick the store\n'), 'Pick the store');
  });

  test('gitSource has an overall deadline: once it has passed, the next read throws a SourceError', () => {
    const source = gitSource(FIXTURE, 'HEAD', 0);
    assert.throws(() => source.read('plan.md'), (error) => error instanceof SourceError && error.path === 'plan.md');
    assert.throws(() => source.list('docs'), SourceError);
  });

  test('on overflow a dry run prints the withheld items, not []; a send prints nothing', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => `| ${index + 1} | S${index + 1} | planned | | | |`).join('\n');
    const root = mkdtempSync(join(tmpdir(), 'sync-dry-'));
    writeFileSync(join(root, 'plan.md'), table(rows));
    const dry = await runSync(['--root', root, '--project', PROJECT, '--dry-run'], {});
    assert.equal(JSON.parse(dry.stdout).length, 201);
    assert.match(dry.stderr, /201 items exceed the 200-item cap, nothing sent/);
    assert.ok(!dry.stdout.includes('undefined'));
  });

  test('the result line names only the counts the board gave', () => {
    const snapshot = { project: PROJECT, items: [1, 2] };
    assert.equal(syncLine(snapshot, { created: 1, updated: 0, closed: 2, unchanged: 3 }), 'sync-docs: demo-app items=2 created=1 updated=0 closed=2 unchanged=3');
    assert.equal(syncLine(snapshot, { created: 1 }), 'sync-docs: demo-app items=2 created=1');
    assert.equal(syncLine(snapshot, undefined), 'sync-docs: demo-app items=2 the board gave no counts');
    assert.ok(!syncLine(snapshot, 'text').includes('undefined'));
  });

  test('a park note is a marked line in the slice header: prose, later sections and code fences do not count', () => {
    assert.equal(parkNote('### Slice 9\n\nParked slices are listed in plan.md.\n'), '');
    assert.equal(parkNote('### Slice 9\n\n*Parked: waits for the deploy.*\n'), 'Parked: waits for the deploy.');
    assert.equal(parkNote('### Slice 9\n\n#### Why\n\n*Parked: late.*\n'), '');
    assert.equal(parkNote('### Slice 9\n\n```\n*Parked: in a fence.*\n```\n'), '');
  });

  test('"Open for the owner" keeps every list item across blank lines, skips code fences, and strips numbers', () => {
    const text = '## Open for the owner\n\n1. Pick the store.\n\n```\n- not an ask\n```\n\n2) Approve the DNS change.\n3. none\n\nAn unrelated paragraph.\n\n## Next\n- no\n';
    assert.equal(openForOwner(text), 'Pick the store. Approve the DNS change.');
    assert.equal(openForOwner('## Open for the owner\n\nNo action needed.\n'), '');
    assert.equal(openForOwner('## Open for the owner\n\n- Nothing to do\n- —\n'), '');
    assert.equal(openForOwner('## Open for the owner\n\nPick the store.\nThen the region.\n\nLater paragraph.\n'), 'Pick the store. Then the region.');
    assert.equal(openForOwner('## Open for the owner\n\n- Pick the store\n  and the region.\n'), 'Pick the store and the region.');
  });

  test('"so that" runs to the end of its sentence and is read before the title is clipped', () => {
    const unverifiedText = `### Slice 5: x\n\n- **You:** open v1.2 on the phone, e.g. the S21, so that the release in v1.2.3 can go out. Then tell me.\n- **You:** ${'long '.repeat(80)}so that it ships.\n`;
    const owner = buildItems({ project: PROJECT, planText: table('| 5 | Five | planned | | | |'), unverifiedText }).filter((item) => item.type === 'waiting_for_me');
    assert.equal(owner[0].why, 'Slice 5: Five — so that the release in v1.2.3 can go out.');
    assert.equal(owner[1].why, 'Slice 5: Five — so that it ships.');
    assert.ok(owner[1].title.length <= 300);
  });

  test('the title of a parked card loses a trailing attribution', () => {
    const card = byKey(buildItems({ project: PROJECT, planText: table('| 9 | Nine | parked: pick the store (user, 2026-11-15) | | | |') }))['demo-app/slice-9/waiting'];
    assert.equal(card.title, 'pick the store');
  });
});
