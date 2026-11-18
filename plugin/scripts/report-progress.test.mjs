/* global URL */
// Tests for report-progress.mjs. A local fake HTTP server stands in for the board.
// Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  activeTaskCard, buildArguments, callTool, keepStep, loadStepList, parseArgs, parseLinks, parseStepLabels, projectSlug, readTaskFile,
  readTouchesFile, resolveConfig, resolveEnvironment, sliceKey, slugify, stateRoot, stepStates, taskFilePath,
} from './report-progress.mjs';
import { TEST_TOKEN, cleanUpAfterTests, envFor, replyOk, runNode, startFakeBoard, trackedTemp } from './test-helpers.mjs';

const SCRIPT = fileURLToPath(new URL('./report-progress.mjs', import.meta.url));
cleanUpAfterTests();

function stateFolder() {
  return join(trackedTemp('board-state-'), 'state');
}

describe('keys and config', () => {
  test('slugify lower-cases and joins with dashes', () => {
    assert.equal(slugify('My Demo_App'), 'my-demo-app');
    assert.equal(slugify('--x--'), 'x');
  });

  test('sliceKey has no leading zero', () => {
    assert.equal(sliceKey('demo', '03'), 'demo/slice-3');
    assert.equal(sliceKey('demo', '0'), 'demo/slice-0');
  });

  test('projectSlug uses the env override, else the main checkout folder name', () => {
    assert.equal(projectSlug('/anywhere', { AGENT_BOARD_PROJECT: 'My Project' }), 'my-project');
    const repo = join(trackedTemp('board-repo-'), 'Demo Repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    mkdirSync(join(repo, 'sub'));
    assert.equal(projectSlug(repo, {}), 'demo-repo');
    assert.equal(projectSlug(join(repo, 'sub'), {}), 'demo-repo');
  });

  test('resolveConfig: the plugin options win, the plain variables follow, /mcp is added once, no default address', () => {
    assert.deepEqual(resolveConfig({ CLAUDE_PLUGIN_OPTION_BOARD_URL: 'https://b.example/', CLAUDE_PLUGIN_OPTION_BOARD_TOKEN: 't1', AGENT_BOARD_URL: 'https://other', AGENT_BOARD_TOKEN: 't2' }),
      { url: 'https://b.example/mcp', token: 't1' });
    assert.deepEqual(resolveConfig({ AGENT_BOARD_URL: 'https://b.example/mcp', AGENT_BOARD_TOKEN: 't2' }), { url: 'https://b.example/mcp', token: 't2' });
    assert.equal(resolveConfig({ AGENT_BOARD_TOKEN: 'only-a-token' }), null);
    assert.equal(resolveConfig({ AGENT_BOARD_URL: 'https://b.example' }), null);
    assert.equal(resolveConfig({}), null);
  });

  test('resolveConfig takes https, and http only for localhost or 127.0.0.1; any other address is refused', () => {
    const at = (address) => resolveConfig({ AGENT_BOARD_URL: address, AGENT_BOARD_TOKEN: 't' });
    assert.equal(at('http://127.0.0.1:8787').url, 'http://127.0.0.1:8787/mcp');
    assert.equal(at('http://localhost:8787/').url, 'http://localhost:8787/mcp');
    for (const bad of ['http://board.example', 'board.example', 'http://localhost.evil.example', 'ftp://board.example']) assert.equal(at(bad), null, bad);
  });

  test('the environment comes from AGENT_BOARD_ENV only, cut to 40 characters', () => {
    assert.equal(resolveEnvironment({ AGENT_BOARD_ENV: ' cloud-vm ' }), 'cloud-vm');
    assert.equal(resolveEnvironment({ AGENT_BOARD_ENV: 'x'.repeat(60) }).length, 40);
    assert.equal(resolveEnvironment({}), '');
  });

  test('state goes to the override, else the plugin data folder, never the plugin folder', () => {
    assert.equal(stateRoot({ AGENT_BOARD_SESSION_ROOT: '/o', CLAUDE_PLUGIN_DATA: '/d' }), '/o');
    assert.equal(stateRoot({ CLAUDE_PLUGIN_DATA: join('/d') }), join('/d', 'state'));
    assert.match(stateRoot({}), /claude-board-hooks$/);
  });

  test('the repo holds no owner host or secrets path', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(source, /workers\.dev|secrets\.env|AGENT_BOARD_SECRETS_FILE/);
  });

  test('--slice N --waiting builds the /waiting key through sliceKey', () => {
    assert.equal(buildArguments(parseArgs(['--slice', '03', '--waiting']), 'demo').key, 'demo/slice-3/waiting');
    assert.equal(buildArguments(parseArgs(['--slice', '03']), 'demo').key, 'demo/slice-3');
    assert.equal(buildArguments(parseArgs([]), 'demo'), null);
  });

  test('parseArgs and parseLinks', () => {
    const parsed = parseArgs(['--key', 'a/b', '--link', 'PR|https://x/1', '--link', 'bad', '--waiting', '--title', 'T']);
    assert.equal(parsed.key, 'a/b');
    assert.equal(parsed.waiting, true);
    assert.deepEqual(parseLinks(parsed.link), [{ label: 'PR', url: 'https://x/1' }]);
  });
});

describe('callTool against a fake board', () => {
  let board;
  before(async () => { board = await startFakeBoard(replyOk); });
  after(() => board.server.close());

  test('sends the guide headers and a tools/call body', async () => {
    const result = await callTool({ url: `${board.url}/mcp`, token: TEST_TOKEN }, 'mark_done', { key: 'a/slice-1' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { key: 'a/slice-1' });
    const sent = board.requests.at(-1);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, '/mcp');
    assert.equal(sent.headers.authorization, `Bearer ${TEST_TOKEN}`);
    assert.match(sent.headers.accept, /text\/event-stream/);
    assert.equal(sent.body.params.name, 'mark_done');
  });

  test('reports a timeout without throwing', async () => {
    const hung = await startFakeBoard(() => {});
    const result = await callTool({ url: `${hung.url}/mcp`, token: 't' }, 'report_progress', { key: 'k' }, { timeoutMs: 150 });
    hung.server.closeAllConnections();
    hung.server.close();
    assert.deepEqual(result, { ok: false, error: 'timeout' });
  });
});

describe('report-progress CLI', () => {
  test('a report is posted with the key built from --slice 03, config from the plugin options', async () => {
    const board = await startFakeBoard(replyOk);
    const result = await runNode(SCRIPT, ['--slice', '03', '--type', 'slice', '--status', 'in_progress', '--title', 'Export button',
      '--why', 'in review', '--link', 'PR|https://example.test/pull/1', '--source', 'agent'], envFor(board.url, stateFolder()));
    board.server.close();
    assert.equal(result.code, 0);
    assert.deepEqual(board.requests[0].body.params.arguments, {
      key: 'demo-app/slice-3', project: 'demo-app', type: 'slice', status: 'in_progress', title: 'Export button',
      why: 'in review', source: 'agent', links: [{ label: 'PR', url: 'https://example.test/pull/1' }],
    });
  });

  test('the plain AGENT_BOARD_URL and AGENT_BOARD_TOKEN work without the plugin options', async () => {
    const board = await startFakeBoard(replyOk);
    const env = envFor('', stateFolder(), { CLAUDE_PLUGIN_OPTION_BOARD_URL: '', CLAUDE_PLUGIN_OPTION_BOARD_TOKEN: '', AGENT_BOARD_URL: board.url, AGENT_BOARD_TOKEN: TEST_TOKEN });
    await runNode(SCRIPT, ['--key', 'demo-app/x', '--status', 'in_progress'], env);
    board.server.close();
    assert.equal(board.requests.length, 1);
    assert.equal(board.requests[0].headers.authorization, `Bearer ${TEST_TOKEN}`);
  });

  test('report_progress carries the environment from AGENT_BOARD_ENV; mark_done does not', async () => {
    const board = await startFakeBoard(replyOk);
    const env = envFor(board.url, stateFolder(), { AGENT_BOARD_ENV: 'cloud-vm' });
    await runNode(SCRIPT, ['--key', 'demo-app/slice-3', '--status', 'in_progress'], env);
    await runNode(SCRIPT, ['--tool', 'mark_done', '--key', 'demo-app/slice-3'], env);
    board.server.close();
    assert.equal(board.requests[0].body.params.arguments.environment, 'cloud-vm');
    assert.equal('environment' in board.requests[1].body.params.arguments, false);
  });

  test('mark_done sends only key, source and note; a details file becomes details_md', async () => {
    const board = await startFakeBoard(replyOk);
    const details = join(trackedTemp('board-'), 'details.md');
    writeFileSync(details, '# Details\n');
    const env = envFor(board.url, stateFolder());
    await runNode(SCRIPT, ['--tool', 'mark_done', '--key', 'demo-app/slice-3', '--status', 'done', '--note', 'merged'], env);
    await runNode(SCRIPT, ['--key', 'demo-app/slice-3', '--details-file', details], env);
    board.server.close();
    assert.deepEqual(board.requests[0].body.params.arguments, { key: 'demo-app/slice-3', note: 'merged' });
    assert.equal(board.requests[1].body.params.arguments.details_md, '# Details');
  });

  test('a missing token or a missing address does nothing and exits 0', async () => {
    const board = await startFakeBoard(replyOk);
    const noToken = await runNode(SCRIPT, ['--slice', '3'], envFor(board.url, stateFolder(), { CLAUDE_PLUGIN_OPTION_BOARD_TOKEN: '' }));
    const noAddress = await runNode(SCRIPT, ['--slice', '3'], envFor('', stateFolder()));
    board.server.close();
    assert.equal(noToken.code, 0);
    assert.equal(noAddress.code, 0);
    assert.equal(board.requests.length, 0);
  });

  test('a refused connection exits 0 with one stderr line and no token', async () => {
    const board = await startFakeBoard(replyOk);
    const url = board.url;
    board.server.close();
    const result = await runNode(SCRIPT, ['--slice', '3'], envFor(url, stateFolder()));
    assert.equal(result.code, 0);
    assert.match(result.stderr, /skipped/);
    assert.ok(!result.stderr.includes(TEST_TOKEN));
  });

  test('HTTP 500 and a tool error exit 0', async () => {
    const failing = await startFakeBoard((_, res) => { res.writeHead(500); res.end('boom'); });
    const toolError = await startFakeBoard((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'field key: no item x' }] } }));
    });
    const first = await runNode(SCRIPT, ['--slice', '3'], envFor(failing.url, stateFolder()));
    const second = await runNode(SCRIPT, ['--slice', '3'], envFor(toolError.url, stateFolder()));
    failing.server.close();
    toolError.server.close();
    assert.equal(first.code, 0);
    assert.match(first.stderr, /HTTP 500/);
    assert.equal(second.code, 0);
    assert.match(second.stderr, /no item x/);
  });

  test('a hung board times out after about 3 seconds and exits 0', async () => {
    const hung = await startFakeBoard(() => {});
    const result = await runNode(SCRIPT, ['--slice', '3'], envFor(hung.url, stateFolder()));
    hung.server.closeAllConnections();
    hung.server.close();
    assert.equal(result.code, 0);
    assert.match(result.stderr, /timeout/);
    assert.ok(result.ms < 6000, `took ${result.ms} ms`);
  });
});

describe('task steps', () => {
  const STEPS = [{ label: 'Plan' }, { label: 'Build' }, { label: 'Ship' }];

  function stepsFile(content) {
    const file = join(trackedTemp('board-steps-'), 'steps.json');
    writeFileSync(file, JSON.stringify(content));
    return file;
  }

  test('keepStep drops a step whose words are not in the Touches line, keeps all with none given', () => {
    const android = { label: 'Android build', needsTouch: ['android', '.kt'] };
    assert.equal(keepStep(android, ''), true);
    assert.equal(keepStep(android, '`app/src/Main.kt`'), true);
    assert.equal(keepStep(android, '`web/src/page.tsx`'), false);
    assert.equal(keepStep({ label: 'Any' }, '`web/x.ts`'), true);
  });

  test('keepStep matches whole path segments and dotted extensions, not substrings', () => {
    const kotlin = { label: 'K', needsTouch: ['.kt'] };
    assert.equal(keepStep(kotlin, 'build.gradle.kts'), false);
    assert.equal(keepStep({ label: 'I', needsTouch: ['ios'] }, 'docs/scenarios.md'), false);
    assert.equal(keepStep({ label: 'I', needsTouch: ['ios'] }, 'src/iOSApp/View.swift'), true);
    assert.equal(keepStep({ label: 'W', needsTouch: ['windows'] }, 'src/MyApp.Windows/App.cs'), true);
  });

  test('keepStep keeps every platform step when a Touches path matches sharedTouch', () => {
    const ios = { label: 'iOS', needsTouch: ['ios'] };
    assert.equal(keepStep(ios, 'src/Page.xaml', ['.xaml']), true);
    assert.equal(keepStep(ios, 'src/Other.cs', ['.xaml']), false);
  });

  test('readTouchesFile takes the Touches line and its continuation lines', () => {
    const file = join(trackedTemp('board-touch-'), 'slice.md');
    writeFileSync(file, '# S\n\n**Touches:** `a/**`,\n  `b/**`\n\n**Migrations:** none\n');
    const text = readTouchesFile(file);
    assert.match(text, /a\/\*\*/);
    assert.match(text, /b\/\*\*/);
    assert.doesNotMatch(text, /Migrations/);
    assert.equal(readTouchesFile(join(trackedTemp('board-touch-'), 'missing.md')), '');
  });

  test('loadStepList reads a path, trims by Touches, drops blank and repeated labels, and gives null for a missing file', () => {
    const file = stepsFile({ agent: 'builder', steps: [{ label: ' Plan ' }, { label: '' }, { label: 'Plan' }, 7, { label: 'iOS', needsTouch: ['ios'] }] });
    assert.deepEqual(loadStepList(file, '`web/x.ts`'), { agent: 'builder', steps: [{ label: 'Plan' }] });
    assert.equal(loadStepList(join(trackedTemp('board-steps-'), 'none.json')), null);
    assert.equal(loadStepList(''), null);
  });

  test('parseStepLabels trims, drops blanks and repeats, and cuts to the board limits', () => {
    assert.deepEqual(parseStepLabels(' a | b ||a|c'), ['a', 'b', 'c']);
    assert.equal(parseStepLabels('x'.repeat(200))[0].length, 80);
    assert.equal(parseStepLabels(Array.from({ length: 250 }, (_, index) => `s${index}`).join('|')).length, 200);
  });

  test('--under-step sends the list as that step\'s children and writes no task file', async () => {
    const board = await startFakeBoard(replyOk);
    const root = stateFolder();
    const env = { ...envFor(board.url, root), CLAUDE_CODE_SESSION_ID: 'sess-u' };
    await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps', 'a|b', '--under-step', 'agent-a1'], env);
    board.server.close();
    const [withList] = board.requests.map((request) => request.body.params.arguments);
    assert.equal(withList.under_step, 'agent-a1');
    assert.deepEqual(withList.steps.map((step) => step.label), ['a', 'b']);
    assert.equal(existsSync(join(root, 'sess-u.task.json')), false);
  });

  test('a bare --under-step (no id) warns on stderr and sends nothing; exit 0', async () => {
    const board = await startFakeBoard(replyOk);
    const env = { ...envFor(board.url, stateFolder()), CLAUDE_CODE_SESSION_ID: 'sess-b' };
    const bare = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps', 'a|b', '--under-step'], env);
    board.server.close();
    assert.match(bare.stderr, /--under-step needs a step id/);
    assert.equal(bare.code, 0);
    assert.equal(board.requests.length, 0);
  });

  test('--under-step with no list, and an id over 80 characters, warn on stderr and send nothing; both exit 0', async () => {
    const board = await startFakeBoard(replyOk);
    const env = { ...envFor(board.url, stateFolder()), CLAUDE_CODE_SESSION_ID: 'sess-w' };
    const noList = await runNode(SCRIPT, ['--key', 'demo-app/t', '--under-step', 'agent-a1', '--note', 'x'], env);
    const tooLong = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps', 'a|b', '--under-step', 'x'.repeat(81)], env);
    board.server.close();
    assert.match(noList.stderr, /--under-step needs a step list.*nothing sent/);
    assert.equal(noList.code, 0);
    assert.match(tooLong.stderr, /over 80 characters/);
    assert.equal(tooLong.code, 0);
    assert.equal(board.requests.length, 0, 'neither report was sent');
  });

  test('stepStates: before the active one done, after pending; done moves on; unknown is null; skipped is left out', () => {
    assert.deepEqual(stepStates(STEPS, 'Build').map((step) => step.state), ['done', 'active', 'pending']);
    assert.deepEqual(stepStates(STEPS, '', 'Plan').map((step) => step.state), ['done', 'active', 'pending']);
    assert.deepEqual(stepStates(STEPS, '', 'Ship').map((step) => step.state), ['done', 'done', 'done']);
    assert.equal(stepStates(STEPS, 'Nope'), null);
    assert.deepEqual(stepStates(STEPS, 'Ship', '', ['Build']).map((step) => step.label), ['Plan', 'Ship']);
  });

  test('CLI --steps sends the whole list with the first step active and writes the task file', async () => {
    const board = await startFakeBoard(replyOk);
    const state = stateFolder();
    const env = envFor(board.url, state, { CLAUDE_CODE_SESSION_ID: 'sess-1', AGENT_BOARD_MODEL: 'big-model' });
    await runNode(SCRIPT, ['--key', 'demo-app/t', '--title', 'T', '--steps', 'Plan|Build|Ship'], env);
    board.server.close();
    const sent = board.requests[0].body.params.arguments;
    assert.deepEqual(sent.steps, [{ label: 'Plan', state: 'active' }, { label: 'Build', state: 'pending' }, { label: 'Ship', state: 'pending' }]);
    assert.equal(sent.model, 'big-model');
    assert.deepEqual(readTaskFile('sess-1', state), { key: 'demo-app/t', step: 'Plan', status: 'in_progress', project: 'demo-app' });
    assert.equal(activeTaskCard('sess-1', { taskRoot: state }), true);
  });

  test('CLI --steps-file with --step-done moves on; --touches-file trims the list; mark_done removes the task file', async () => {
    const board = await startFakeBoard(replyOk);
    const state = stateFolder();
    const file = stepsFile({ agent: 'builder', steps: [{ label: 'Plan' }, { label: 'Build' }, { label: 'iOS build', needsTouch: ['ios'] }] });
    const slice = join(trackedTemp('board-touch-'), 'slice.md');
    writeFileSync(slice, '**Touches:** `web/page.ts`\n');
    const env = envFor(board.url, state, { CLAUDE_CODE_SESSION_ID: 'sess-2' });
    await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', file, '--touches-file', slice, '--step-done', 'Plan'], env);
    const sent = board.requests[0].body.params.arguments;
    assert.equal(sent.agent, 'builder');
    assert.deepEqual(sent.steps.map((step) => `${step.label}:${step.state}`), ['Plan:done', 'Build:active']);
    assert.equal(existsSync(taskFilePath('sess-2', state)), true);
    await runNode(SCRIPT, ['--tool', 'mark_done', '--key', 'demo-app/t'], env);
    board.server.close();
    assert.equal(existsSync(taskFilePath('sess-2', state)), false);
  });

  test('a report with a steps file but no step flag, an unknown step or a missing file still reports, without a list', async () => {
    const board = await startFakeBoard(replyOk);
    const file = stepsFile({ steps: STEPS });
    const env = envFor(board.url, stateFolder());
    const noFlag = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', file], env);
    const unknown = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', file, '--step-active', 'Nope'], env);
    const missing = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', join(trackedTemp('board-'), 'none.json'), '--step-active', 'Plan'], env);
    board.server.close();
    assert.equal(board.requests.length, 3);
    for (const request of board.requests) assert.equal('steps' in request.body.params.arguments, false);
    assert.match(unknown.stderr, /not in the list/);
    assert.match(missing.stderr, /unreadable/);
    assert.equal(noFlag.code + unknown.code + missing.code, 0);
  });

  test('--step-skipped leaves those steps out; alone or with an unknown label it says so on stderr', async () => {
    const board = await startFakeBoard(replyOk);
    const file = stepsFile({ steps: STEPS });
    const env = envFor(board.url, stateFolder());
    await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', file, '--step-active', 'Ship', '--step-skipped', 'Build'], env);
    const alone = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', file, '--step-skipped', 'Build'], env);
    const unknown = await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps-file', file, '--step-active', 'Ship', '--step-skipped', 'Zzz'], env);
    board.server.close();
    assert.deepEqual(board.requests[0].body.params.arguments.steps.map((step) => step.label), ['Plan', 'Ship']);
    assert.match(alone.stderr, /needs --step-active or --step-done/);
    assert.match(unknown.stderr, /"Zzz" is not in the list/);
  });

  test('the task file holds the reported status; a /waiting child or ask_human marks it waiting; resolving it resumes', async () => {
    const board = await startFakeBoard(replyOk);
    const state = stateFolder();
    const env = envFor(board.url, state, { CLAUDE_CODE_SESSION_ID: 'sess-3' });
    await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps', 'A|B', '--status', 'blocked'], env);
    assert.equal(readTaskFile('sess-3', state).status, 'blocked');
    await runNode(SCRIPT, ['--key', 'demo-app/t', '--steps', 'A|B', '--status', 'in_progress'], env);
    assert.equal(readTaskFile('sess-3', state).status, 'in_progress');
    await runNode(SCRIPT, ['--tool', 'ask_human', '--key', 'demo-app/t/waiting', '--title', 'Q'], env);
    assert.equal(readTaskFile('sess-3', state).status, 'waiting');
    await runNode(SCRIPT, ['--tool', 'mark_done', '--key', 'demo-app/t/waiting'], env);
    board.server.close();
    assert.equal(readTaskFile('sess-3', state).status, 'in_progress');
  });

  test('a helper card (--parent-key) never writes the task file', async () => {
    const board = await startFakeBoard(replyOk);
    const state = stateFolder();
    const env = envFor(board.url, state, { CLAUDE_CODE_SESSION_ID: 'sess-4' });
    await runNode(SCRIPT, ['--key', 'demo-app/t/helper', '--parent-key', 'demo-app/t', '--steps', 'A|B'], env);
    board.server.close();
    assert.equal(existsSync(taskFilePath('sess-4', state)), false);
    assert.equal(board.requests[0].body.params.arguments.parent_key, 'demo-app/t');
  });
});

describe('slice parts', () => {
  test('--slice 11 --part b builds the part key, type part and parent_key; the letter is upper-cased', () => {
    const args = buildArguments(parseArgs(['--slice', '11', '--part', 'b', '--status', 'in_progress']), 'demo');
    assert.equal(args.key, 'demo/slice-11/part-B');
    assert.equal(args.type, 'part');
    assert.equal(args.parent_key, 'demo/slice-11');
  });

  test('a part with no slice, a bad letter, no value or --key/--waiting beside it builds nothing', () => {
    for (const argv of [['--part', 'b'], ['--slice', '11', '--part', 'ab'], ['--slice', '11', '--part'], ['--slice', '11', '--part', '3'],
      ['--slice', '11', '--part', 'b', '--key', 'x/y'], ['--slice', '11', '--part', 'b', '--waiting']]) {
      assert.equal(buildArguments(parseArgs(argv), 'demo'), null, argv.join(' '));
    }
  });

  test('CLI mark_done with a bad --part sends nothing, says why, exits 0', async () => {
    const board = await startFakeBoard(replyOk);
    const result = await runNode(SCRIPT, ['--tool', 'mark_done', '--slice', '11', '--part', 'ab'], envFor(board.url, stateFolder()));
    board.server.close();
    assert.equal(result.code, 0);
    assert.match(result.stderr, /bad --part/);
    assert.equal(board.requests.length, 0);
  });
});
