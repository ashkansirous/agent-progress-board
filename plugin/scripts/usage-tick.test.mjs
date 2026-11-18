/* global process, fetch, Response, URL, setTimeout */
// Tests for usage-tick.mjs: a fake board and a temp Claude folder; the real board, the real
// profile and the real token are never touched.
// Run: node --test plugin/scripts/usage-tick.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeGoal } from './hooks/hook-input.mjs';
import { envFor, runNode } from './test-helpers.mjs';
import { readPlanCapEnabled, reportUsageEnabled, resolveEnvironment } from './report-progress.mjs';
import { listRecordFiles } from './usage-report.mjs';
import { GATE_FILE, LOCK_FILE, LOCK_STALE_MS, SEND_BATCH_SIZE, STATE_FILE, TASK_MAX_AGE_MS, TICK_GAP_MS, acquireLock, claudeDirOf, pendingReports, readTask, requestTick, runTick } from './usage-tick.mjs';

const TEST_TOKEN = 'test-token-not-real';
const OPUS = 'claude-opus-test';
const SONNET = 'claude-sonnet-test';
const NOW = Date.parse('2026-11-16T12:00:00Z');
const AT = '2026-11-16T11:59:00Z';
// A status line file written at the run's own time: the cap guard holds files older than the first run (Slice 30).
const FILE_AT = '2026-11-16T12:00:00Z';

let board;
let reports;
let claudeDir;
let taskRoot;
let env;

function recordLine(model, usage, at) {
  const full = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, ...usage };
  return JSON.stringify({ type: 'assistant', timestamp: at, cwd: '/work/demo', message: { model, usage: full } }) + String.fromCharCode(10);
}

// The file's modified time is set to the simulated time, so the tick's change check is deterministic.
function stamp(path, atMs) {
  utimesSync(path, atMs / 1000, atMs / 1000);
}

function startBoard() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const call = JSON.parse(body).params;
      reports.push({ name: call.name, args: call.arguments });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"stored":true}' }] } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function writeSession(id, lines, atMs = NOW - 1000) {
  const dir = join(claudeDir, 'projects', 'proj');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${id}.jsonl`), lines);
  stamp(join(dir, `${id}.jsonl`), atMs);
}

function writeHelper(sessionId, helperId, agentType, lines) {
  const dir = join(claudeDir, 'projects', 'proj', sessionId, 'subagents');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `agent-${helperId}.jsonl`), lines);
  stamp(join(dir, `agent-${helperId}.jsonl`), NOW - 1000);
  writeFileSync(join(dir, `agent-${helperId}.meta.json`), JSON.stringify({ agentType }));
}

function tick(options = {}) {
  return runTick({ env, now: NOW, capClock: () => NOW, taskRoot, ...options });
}

before(async () => { board = await startBoard(); });
after(() => board.close());

beforeEach(() => {
  reports = [];
  claudeDir = mkdtempSync(join(tmpdir(), 'usage-tick-claude-'));
  taskRoot = mkdtempSync(join(tmpdir(), 'usage-tick-task-'));
  env = {
    AGENT_BOARD_URL: `http://127.0.0.1:${board.address().port}`,
    AGENT_BOARD_TOKEN: TEST_TOKEN,
    AGENT_BOARD_PROJECT: 'demo-app',
    AGENT_BOARD_CLAUDE_DIR: claudeDir,
    AGENT_BOARD_SESSION_ROOT: claudeDir, // the state folder: the gate, lock and state files are checked where the Claude folder is
    CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP: 'true', // the cap reading is off by default (Slice 22 decision 6)
  };
});

describe('runTick', () => {
  test('sends one report per agent and model with the totals and the session as task', async () => {
    writeSession('s1', recordLine(OPUS, { input_tokens: 4, output_tokens: 6 }, AT) + recordLine(SONNET, { output_tokens: 2 }, AT));
    writeHelper('s1', 'h1', 'code-review-pass', recordLine(SONNET, { cache_read_input_tokens: 90 }, AT));
    const outcome = await tick();
    assert.equal(outcome.sent, 3);
    const byKey = Object.fromEntries(reports.map((r) => [`${r.args.agent_key}|${r.args.model}`, r.args]));
    assert.equal(reports.every((r) => r.name === 'report_usage'), true);
    assert.deepEqual(
      [byKey[`demo-app/session-s1|${OPUS}`].input_tokens, byKey[`demo-app/session-s1|${OPUS}`].output_tokens],
      [4, 6],
    );
    const helper = byKey[`demo-app/session-s1/agent-h1|${SONNET}`];
    assert.deepEqual([helper.cache_read_tokens, helper.agent_kind, helper.task_key], [90, 'code-review-pass', 'demo-app/session-s1']);
    assert.equal(byKey[`demo-app/session-s1|${OPUS}`].agent_kind, 'main');
    assert.equal(helper.record_at, AT);
  });

  test('uses the task and step the session reported', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(taskRoot, 's1.task.json'), JSON.stringify({ key: 'demo-app/slice-7', step: 'review pass 1' }));
    await tick();
    assert.deepEqual([reports[0].args.task_key, reports[0].args.step], ['demo-app/slice-7', 'review pass 1']);
  });

  test('a session that reported its own card sends usage under that card key; a task file still wins', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeGoal('s1', { key: 'demo-app/session-abc123', project: 'demo-app', title: 't', steps: [] }, taskRoot);
    await tick();
    assert.equal(reports[0].args.task_key, 'demo-app/session-abc123');
    assert.equal(reports[0].args.agent_key, 'demo-app/session-s1');
    reports.length = 0;
    writeSession('s1', recordLine(OPUS, { output_tokens: 4 }, AT), NOW + 1000);
    writeFileSync(join(taskRoot, 's1.task.json'), JSON.stringify({ key: 'demo-app/slice-7', step: '' }));
    await tick({ now: NOW + TICK_GAP_MS });
    assert.equal(reports.find((r) => r.name === 'report_usage').args.task_key, 'demo-app/slice-7');
  });

  test('a task file older than 24 hours is ignored; a sanitised session id is found', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const file = join(taskRoot, 's1.task.json');
    writeFileSync(file, JSON.stringify({ key: 'demo-app/slice-7', step: 'old' }));
    const old = (Date.now() - TASK_MAX_AGE_MS - 60000) / 1000;
    utimesSync(file, old, old);
    await tick();
    assert.deepEqual([reports[0].args.task_key, reports[0].args.step], ['demo-app/session-s1', undefined]);
    writeFileSync(join(taskRoot, 'a_b_c.task.json'), JSON.stringify({ key: 'k', step: 's' }));
    assert.deepEqual(readTask('a.b:c', taskRoot), { taskKey: 'k', step: 's' });
    assert.deepEqual(readTask('a.b:c', taskRoot, Date.now() + TASK_MAX_AGE_MS + 60000), { taskKey: '', step: '' });
  });

  test('the same run sends a cap reading from the status line file after the token reports', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { subscriptionType: 'max', expiresAt: NOW - 1 } }));
    stamp(join(claudeDir, '.credentials.json'), NOW - 24 * 3600000);
    writeFileSync(join(claudeDir, 'usage-latest.json'), JSON.stringify({ at: FILE_AT, rate_limits: { seven_day: { used_percentage: 30 } } }));
    await tick();
    assert.deepEqual(reports.map((r) => r.name), ['report_usage', 'report_cap']);
    assert.deepEqual([reports[1].args.plan, reports[1].args.source], ['max', 'status-line-file']);
  });

  test('an error that is not about the lock still runs the cap reading (Slice 30)', async () => {
    writeFileSync(join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { subscriptionType: 'max', expiresAt: NOW - 1 } }));
    stamp(join(claudeDir, '.credentials.json'), NOW - 24 * 3600000);
    writeFileSync(join(claudeDir, 'usage-latest.json'), JSON.stringify({ at: FILE_AT, rate_limits: { seven_day: { used_percentage: 30 } } }));
    const unreadable = () => { throw new Error('folder unreadable'); };
    const stderr = mock.method(process.stderr, 'write', () => true);
    let outcome;
    try {
      outcome = await tick({ listFiles: unreadable });
    } finally {
      stderr.mock.restore();
    }
    assert.deepEqual(outcome, { skipped: 'error' });
    assert.deepEqual(reports.map((r) => r.name), ['report_cap']);
  });

  test('a cap reading that throws never stops the token reports', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token', subscriptionType: 'max' } }));
    const throwing = (url, init) => {
      if (String(url).includes('api/oauth/usage')) throw new Error('boom');
      return fetch(url, init);
    };
    const outcome = await tick({ options: { fetchImpl: throwing } });
    assert.equal(outcome.sent, 1);
    assert.deepEqual(reports.map((r) => r.name), ['report_usage']);
  });

  test('a lock lost during the cap reading stops the run without sending the cap reading (review 11)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token', subscriptionType: 'max', expiresAt: NOW + 3600000 } }));
    const stealing = async (url, init) => {
      if (!String(url).includes('api/oauth/usage')) return fetch(url, init);
      writeFileSync(join(claudeDir, LOCK_FILE), 'someone-else');
      return { ok: true, json: async () => ({ seven_day: { utilization: 9 } }) };
    };
    const outcome = await tick({ options: { fetchImpl: stealing } });
    assert.deepEqual(outcome, { skipped: 'lock lost' });
    assert.deepEqual(reports.map((r) => r.name), ['report_usage']);
    assert.equal(readFileSync(join(claudeDir, LOCK_FILE), 'utf8'), 'someone-else');
  });

  test('two ticks send no double use; new lines send the larger total', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    await tick({ force: true, now: NOW + TICK_GAP_MS });
    assert.equal(reports.length, 1, 'nothing changed, nothing sent');
    writeSession('s1', recordLine(OPUS, { output_tokens: 4 }, '2026-11-16T12:06:00Z'), NOW + TICK_GAP_MS + 1000);
    await tick({ now: NOW + 2 * TICK_GAP_MS });
    assert.equal(reports.length, 2);
    assert.equal(reports[1].args.output_tokens, 10);
  });

  test('a board that is down is not an error and the totals are sent on the next tick', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const down = await tick({ env: { ...env, AGENT_BOARD_URL: 'http://127.0.0.1:1' } });
    assert.deepEqual([down.sent, down.failed], [0, 1]);
    await tick({ now: NOW + TICK_GAP_MS });
    assert.equal(reports.length, 1);
  });

  test('a file whose scan throws once is fully counted on the next run (review 4)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    let failed = false;
    const original = fs.openSync;
    const opening = mock.method(fs, 'openSync', (...args) => {
      if (!failed && String(args[0]).endsWith('s1.jsonl')) { failed = true; throw new Error('EBUSY'); }
      return original(...args);
    });
    syncBuiltinESMExports();
    try {
      await tick();
    } finally {
      opening.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(failed, true);
    assert.equal(reports.length, 0);
    await tick({ force: true, now: NOW + TICK_GAP_MS });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].args.output_tokens, 6);
  });

  test('a known file whose scan throws once, with an old modified time, is counted next run (review 5)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    assert.equal(reports.length, 1);
    writeSession('s1', recordLine(OPUS, { output_tokens: 4 }, '2026-11-16T12:00:30Z'), NOW + 1000);
    let failed = false;
    const original = fs.openSync;
    const opening = mock.method(fs, 'openSync', (...args) => {
      if (!failed) { failed = true; throw new Error('EBUSY'); }
      return original(...args);
    });
    syncBuiltinESMExports();
    try {
      await tick({ now: NOW + TICK_GAP_MS });
    } finally {
      opening.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(failed, true);
    assert.equal(reports.length, 1);
    const file = join(claudeDir, 'projects', 'proj', 's1.jsonl');
    stamp(file, NOW + 2000);
    await tick({ force: true, now: NOW + 2 * TICK_GAP_MS });
    assert.equal(reports.length, 2);
    assert.equal(reports[1].args.output_tokens, 10);
    const saved = JSON.parse(readFileSync(join(claudeDir, STATE_FILE), 'utf8'));
    assert.equal(saved.files[file].retry, undefined, 'the marker is removed once a scan succeeds');
  });

  test('entries with a wrong-typed tail or cwd never stop the run (review 5)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeSession('s2', recordLine(OPUS, { output_tokens: 3 }, AT));
    writeSession('s3', recordLine(OPUS, { output_tokens: 2 }, AT));
    const dir = join(claudeDir, 'projects', 'proj');
    const bad = (extra) => ({ offset: 0, models: {}, ...extra });
    writeFileSync(join(claudeDir, STATE_FILE), JSON.stringify({
      lastRunAt: NOW - 600000,
      files: { [join(dir, 's1.jsonl')]: bad({ tail: 5 }), [join(dir, 's2.jsonl')]: bad({ cwd: 5 }) },
    }));
    const outcome = await tick();
    assert.equal(outcome.sent, 3);
    const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 1, recordAt: AT };
    const states = {
      bad: { sessionId: 'x', cwd: 5, models: { [OPUS]: totals } },
      good: { sessionId: 'y', cwd: '/work/demo', models: { [OPUS]: totals } },
    };
    const found = pendingReports(states, { projectOf: (cwd) => cwd.toLowerCase(), taskRoot });
    assert.deepEqual(found.map((report) => report.path), ['good']);
    assert.deepEqual(Object.keys(states), ['good']);
  });

  test('malformed saved state is dropped, never thrown on (review 4)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const statePath = join(claudeDir, STATE_FILE);
    const file = join(claudeDir, 'projects', 'proj', 's1.jsonl');
    writeFileSync(statePath, JSON.stringify({ lastRunAt: NOW - 600000, files: { [file]: { offset: 'x', models: 5 } } }));
    await tick();
    assert.equal(reports.length, 1, 'a bad entry means first-seen, counted from the cutoff');
    const entry = { offset: 0, models: {}, recent: {} };
    writeFileSync(statePath, JSON.stringify({ lastRunAt: NOW - 600000, files: { [file]: entry } }));
    await tick({ now: NOW + 1000 });
    assert.equal(reports.length, 2, 'recent that is not a list drops the entry, so the file counts again (review 7)');
    writeFileSync(statePath, JSON.stringify([1, 2]));
    assert.doesNotThrow(() => JSON.parse(readFileSync(statePath, 'utf8')));
    const outcome = await tick({ force: true, now: NOW + TICK_GAP_MS });
    assert.equal(typeof outcome, 'object');
    writeFileSync(statePath, 'not json{');
    assert.equal(typeof (await tick({ force: true, now: NOW + 2 * TICK_GAP_MS })), 'object');
  });

  test('no token sends nothing', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    assert.deepEqual(await tick({ env: { ...env, AGENT_BOARD_TOKEN: '' } }), { skipped: 'no token' });
    assert.equal(reports.length, 0);
  });
});

describe('environment (A6)', () => {
  test('the variable is used; none sends no field', async () => {
    assert.equal(resolveEnvironment({ AGENT_BOARD_ENV: 'cloud-vm' }), 'cloud-vm');
    assert.equal(resolveEnvironment({}), '');
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    assert.equal('environment' in reports[0].args, false);
  });

  test('the tick sends the environment on every report', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT) + recordLine(SONNET, { output_tokens: 1 }, AT));
    await tick({ env: { ...env, AGENT_BOARD_ENV: 'cloud-vm' } });
    assert.deepEqual(reports.map((r) => r.args.environment), ['cloud-vm', 'cloud-vm']);
  });

  test('an environment longer than 40 characters is cut to 40', () => {
    const long = 'e'.repeat(55);
    assert.equal(resolveEnvironment({ AGENT_BOARD_ENV: long }), 'e'.repeat(40));
  });
});

function fakeSpawn(calls, onCall = () => {}) {
  return (command, args, options) => {
    onCall();
    const child = { unrefCalled: false, unref() { this.unrefCalled = true; } };
    calls.push({ command, args, options, child });
    return child;
  };
}

describe('the hook entry (requestTick)', () => {
  test('writes the gate before the background run starts, detached, with no window and no output', () => {
    const calls = [];
    const gatePath = join(claudeDir, GATE_FILE);
    let gateAtSpawn = '';
    const spawnFn = fakeSpawn(calls, () => { gateAtSpawn = readFileSync(gatePath, 'utf8'); });
    assert.deepEqual(requestTick({ env, now: NOW, spawnFn }), { started: true });
    assert.equal(gateAtSpawn, String(NOW));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args.slice(1), ['--run']);
    requestTick({ env, now: NOW, force: true, spawnFn: fakeSpawn(calls) });
    assert.deepEqual(calls[1].args.slice(1), ['--run', '--force'], 'a forced hook starts a forced run');
    assert.deepEqual([calls[0].options.detached, calls[0].options.stdio, calls[0].options.windowsHide], [true, 'ignore', true]);
    assert.equal(calls[0].child.unrefCalled, true);
  });

  test('inside the five minutes it starts nothing and leaves the gate; force starts anyway', () => {
    const calls = [];
    writeFileSync(join(claudeDir, GATE_FILE), String(NOW - 1000));
    assert.deepEqual(requestTick({ env, now: NOW, spawnFn: fakeSpawn(calls) }), { skipped: 'gate' });
    assert.equal(calls.length, 0);
    assert.equal(readFileSync(join(claudeDir, GATE_FILE), 'utf8'), String(NOW - 1000));
    assert.deepEqual(requestTick({ env, now: NOW, force: true, spawnFn: fakeSpawn(calls) }), { started: true });
    assert.equal(calls.length, 1);
  });

  test('a gate older than five minutes is due', () => {
    const calls = [];
    writeFileSync(join(claudeDir, GATE_FILE), String(NOW - TICK_GAP_MS));
    assert.deepEqual(requestTick({ env, now: NOW, spawnFn: fakeSpawn(calls) }), { started: true });
  });

  test('a spawn that throws, or a child that emits error, never throws or prints (review 4)', () => {
    const written = [];
    const stderr = mock.method(process.stderr, 'write', (chunk) => { written.push(String(chunk)); return true; });
    try {
      const throwing = () => { throw new Error('spawn failed'); };
      assert.deepEqual(requestTick({ env, now: NOW, force: true, spawnFn: throwing }), { skipped: 'no start' });
      const child = new EventEmitter();
      child.unref = () => {};
      assert.deepEqual(requestTick({ env, now: NOW, force: true, spawnFn: () => child }), { started: true });
      assert.doesNotThrow(() => child.emit('error', new Error('ENOENT')));
    } finally {
      stderr.mock.restore();
    }
    assert.deepEqual(written, []);
  });

  test('AGENT_BOARD_USAGE=off still starts the run (the heartbeat)', () => {
    const calls = [];
    assert.deepEqual(requestTick({ env: { ...env, AGENT_BOARD_USAGE: 'off' }, now: NOW, spawnFn: fakeSpawn(calls) }), { started: true });
    assert.equal(calls.length, 1);
  });

  test('CLAUDE_CONFIG_DIR is the Claude folder when AGENT_BOARD_CLAUDE_DIR is not set', () => {
    assert.equal(claudeDirOf({ CLAUDE_CONFIG_DIR: '/cfg' }), '/cfg');
    assert.equal(claudeDirOf({ CLAUDE_CONFIG_DIR: '/cfg', AGENT_BOARD_CLAUDE_DIR: '/own' }), '/own');
    assert.equal(claudeDirOf({}).endsWith('.claude'), true);
  });

  test('a cloud-like home (no Claude folder variable, records under <home>/.claude/projects) is found and sent (Slice 28)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'usage-tick-cloud-home-'));
    try {
      const dir = join(home, '.claude', 'projects', 'repo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'cloud1.jsonl'), recordLine(OPUS, { output_tokens: 9 }, new Date().toISOString())); // the child runs on the real clock
      mkdirSync(join(home, 'state'), { recursive: true });
      // The home folder is the child's own environment: this process's environment is never changed.
      const childEnv = envFor(env.AGENT_BOARD_URL, join(home, 'state'), { HOME: home, USERPROFILE: home, AGENT_BOARD_ENV: 'cloud' });
      // A developer's own settings must not change what the child does.
      for (const name of ['CLAUDE_CONFIG_DIR', 'AGENT_BOARD_CLAUDE_DIR', 'AGENT_BOARD_USAGE', 'CLAUDE_PLUGIN_OPTION_REPORT_USAGE', 'CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP', 'CLAUDE_PLUGIN_OPTION_ENVIRONMENT']) delete childEnv[name];
      const script = fileURLToPath(new URL('./usage-tick.mjs', import.meta.url));
      const result = await runNode(script, ['--run'], childEnv);
      assert.equal(result.code, 0);
      assert.deepEqual(reports.map((r) => [r.args.environment, r.args.output_tokens]), [['cloud', 9]]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('neither the not-due nor the due call lists a folder; the background run does', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const listing = mock.method(fs, 'readdirSync');
    syncBuiltinESMExports();
    try {
      writeFileSync(join(claudeDir, GATE_FILE), String(NOW - 1000));
      requestTick({ env, now: NOW, spawnFn: fakeSpawn([]) });
      requestTick({ env, now: NOW + TICK_GAP_MS, spawnFn: fakeSpawn([]) });
      assert.equal(listing.mock.callCount(), 0, 'the hook path walks no folder');
      await tick();
      assert.equal(listing.mock.callCount() > 0, true, 'the background run does walk');
    } finally {
      listing.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

describe('the background run', () => {
  test('a second run at once finds the lock and exits; the first still sends', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const [first, second] = await Promise.all([tick(), tick()]);
    assert.deepEqual(second, { skipped: 'locked' });
    assert.equal(first.sent, 1);
    assert.equal(reports.length, 1);
    assert.equal(existsSync(join(claudeDir, LOCK_FILE)), false, 'the lock is released');
  });

  test('a live lock stops the run and stays', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(claudeDir, LOCK_FILE), '1');
    assert.deepEqual(await tick(), { skipped: 'locked' });
    assert.equal(existsSync(join(claudeDir, LOCK_FILE)), true);
    assert.equal(reports.length, 0);
  });

  test('a lock older than two minutes is deleted and the same run works (review 2)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const lock = join(claudeDir, LOCK_FILE);
    writeFileSync(lock, '1');
    const old = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
    utimesSync(lock, old, old);
    assert.equal((await tick()).sent, 1);
    assert.equal(existsSync(lock), false, 'released at the end');
    assert.equal(reports.length, 1);
  });

  test('a forced run that finds the lock held asks again and works once it is free (review 1)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const lock = join(claudeDir, LOCK_FILE);
    writeFileSync(lock, 'finishing-run');
    setTimeout(() => rmSync(lock, { force: true }), 40);
    assert.equal((await tick({ force: true, retryDelayMs: 25 })).sent, 1);
    assert.equal(reports.length > 0, true);
  });

  test('a forced run gives up fail-open after its attempts; an unforced run does not wait', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(claudeDir, LOCK_FILE), 'held-run');
    const started = Date.now();
    assert.deepEqual(await tick({ force: true, retryAttempts: 3, retryDelayMs: 20 }), { skipped: 'locked' });
    assert.equal(Date.now() - started >= 40, true, 'it waited between its attempts');
    assert.equal(readFileSync(join(claudeDir, LOCK_FILE), 'utf8'), 'held-run');
    const plainStarted = Date.now();
    assert.deepEqual(await tick({ retryAttempts: 3, retryDelayMs: 500 }), { skipped: 'locked' });
    assert.equal(Date.now() - plainStarted < 400, true);
    assert.equal(reports.length, 0);
  });

  test('a state that cannot be saved sends nothing and leaves no temp file', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    mkdirSync(join(claudeDir, STATE_FILE)); // a folder where the file belongs: the rename fails, and there is no direct write to fall back on
    assert.deepEqual(await tick(), { skipped: 'state not saved' });
    assert.equal(reports.length, 0);
    assert.deepEqual(readdirSync(claudeDir).filter((name) => name.endsWith('.tmp')), []);
    assert.equal(existsSync(join(claudeDir, LOCK_FILE)), false);
  });

  test('totals that changed under the same record time are sent, one millisecond later', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    writeSession('s1', recordLine(OPUS, { output_tokens: 4 }, AT), NOW + 1000);
    await tick({ now: NOW + TICK_GAP_MS });
    assert.equal(reports.length, 2);
    assert.equal(reports[1].args.output_tokens, 10);
    assert.equal(Date.parse(reports[1].args.record_at) - Date.parse(reports[0].args.record_at), 1);
  });

  test('a first-seen file with old and new lines counts only the new ones', async () => {
    const old = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    writeSession('s1', recordLine(OPUS, { output_tokens: 100 }, old) + recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].args.output_tokens, 6);
  });

  test('a rewritten file is found and its old lines are not counted again', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    const path = join(claudeDir, 'projects', 'proj', 's1.jsonl');
    const old = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const rewritten = recordLine(OPUS, { output_tokens: 90 }, old) + recordLine(OPUS, { output_tokens: 90 }, AT) + recordLine(OPUS, { output_tokens: 5 }, '2026-11-16T12:03:00Z');
    writeFileSync(path, rewritten);
    stamp(path, NOW + 1000);
    await tick({ now: NOW + TICK_GAP_MS });
    assert.equal(reports.length, 2);
    assert.equal(reports[1].args.output_tokens, 5, 'only the line newer than the previous run counts');
  });

  test('a record file with no working folder is reported under its folder name', async () => {
    const line = JSON.stringify({ type: 'assistant', timestamp: AT, message: { model: OPUS, usage: { output_tokens: 3 } } }) + '\n';
    writeSession('s1', line);
    await tick();
    assert.equal(reports[0].args.agent_key, 'proj/session-s1');
  });
});

describe('plugin/hooks/hooks.json', () => {
  const hooks = JSON.parse(readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8')).hooks;
  const usageEntries = (event) => hooks[event].flatMap((entry) => entry.hooks).filter((hook) => (hook.args || []).some((arg) => /usage-tick\.mjs$/.test(arg)));

  test('PostToolUse runs usage-tick.mjs through the gate; Stop and SubagentStop run it with --force', () => {
    const gated = usageEntries('PostToolUse');
    assert.equal(gated.length, 1);
    assert.equal(gated[0].args.length, 1, 'no --force: the five-minute gate applies');
    for (const event of ['Stop', 'SubagentStop']) {
      const forced = usageEntries(event);
      assert.equal(forced.length, 1, event);
      assert.deepEqual(forced[0].args.slice(1), ['--force']);
    }
  });

  test('the hook command is bounded and starts from the plugin folder', () => {
    for (const event of ['PostToolUse', 'Stop', 'SubagentStop']) {
      const [hook] = usageEntries(event);
      assert.equal(hook.args[0].startsWith('${CLAUDE_PLUGIN_ROOT}/scripts/'), true);
      assert.equal(hook.timeout <= 5, true);
    }
  });
});

describe('the plugin options (Slice 22)', () => {
  const OPTION_OFF = { CLAUDE_PLUGIN_OPTION_REPORT_USAGE: 'false' };

  test('report_usage false: the hook still starts the run; the run makes no usage or cap call', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const calls = [];
    assert.deepEqual(requestTick({ env: { ...env, ...OPTION_OFF }, now: NOW, spawnFn: fakeSpawn(calls) }), { started: true });
    assert.equal(calls.length, 1);
    await tick({ env: { ...env, ...OPTION_OFF } });
    assert.equal(reports.length, 0, 'no usage call, no cap call (no task file, so no heartbeat)');
  });

  test('usage read while report_usage is off is never sent after it is turned on again (check review #1)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick({ env: { ...env, ...OPTION_OFF } });
    assert.equal(existsSync(join(claudeDir, STATE_FILE)), true, 'the scan state advanced');
    await tick({ env, now: NOW + 60 * 60 * 1000 });
    assert.equal(reports.filter((r) => r.name === 'report_usage').length, 0, 'the off-period usage is not sent');
    writeSession('s1', recordLine(OPUS, { output_tokens: 4 }, AT), NOW + 2 * 60 * 60 * 1000);
    await tick({ env, now: NOW + 3 * 60 * 60 * 1000 });
    const sent = reports.filter((r) => r.name === 'report_usage');
    assert.equal(sent.length, 1, 'only usage after turning it on is sent');
  });

  test('report_usage true, empty or unset keeps reporting on; unclear text turns it off (check review #5)', () => {
    for (const value of ['true', '', undefined]) {
      assert.equal(reportUsageEnabled({ CLAUDE_PLUGIN_OPTION_REPORT_USAGE: value }), true, String(value));
    }
    for (const value of ['false', 'FALSE', '0', 'no', 'disabled']) {
      assert.equal(reportUsageEnabled({ CLAUDE_PLUGIN_OPTION_REPORT_USAGE: value }), false, value);
    }
    assert.equal(reportUsageEnabled({ AGENT_BOARD_USAGE: 'off' }), false);
  });

  test('read_plan_cap is off unless it is true, and never on while report_usage is off (review 4)', () => {
    for (const value of [undefined, '', 'false', '0', 'garbage']) {
      assert.equal(readPlanCapEnabled({ CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP: value }), false, String(value));
    }
    assert.equal(readPlanCapEnabled({ CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP: 'true' }), true);
    assert.equal(readPlanCapEnabled({ CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP: 'true', CLAUDE_PLUGIN_OPTION_REPORT_USAGE: 'false' }), false);
    assert.equal(readPlanCapEnabled({ CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP: 'true', AGENT_BOARD_USAGE: 'off' }), false);
  });

  test('with read_plan_cap off the tokens are sent and no cap call is made', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick({ env: { ...env, CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP: 'false' } });
    assert.deepEqual(reports.map((r) => r.name), ['report_usage']);
  });

  test('the environment option labels every usage report, and wins over AGENT_BOARD_ENV', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick({ env: { ...env, CLAUDE_PLUGIN_OPTION_ENVIRONMENT: 'desktop', AGENT_BOARD_ENV: 'other' } });
    assert.equal(reports[0].args.environment, 'desktop');
  });

  test('the cap reading reads the sign-in file in the Claude folder, keeps its state in the state folder', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'usage-tick-state-'));
    writeFileSync(join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token', subscriptionType: 'max', expiresAt: NOW + 3600000 } }));
    writeFileSync(join(claudeDir, 'usage-latest.json'), JSON.stringify({ at: FILE_AT, rate_limits: { seven_day: { used_percentage: 30 } } }));
    await tick({ env: { ...env, AGENT_BOARD_SESSION_ROOT: stateDir }, taskRoot: stateDir });
    assert.equal(reports.filter((r) => r.name === 'report_cap').length, 1);
    assert.equal(existsSync(join(stateDir, 'cap-reading-state.json')), true);
    assert.equal(existsSync(join(claudeDir, 'cap-reading-state.json')), false, 'nothing is written to the Claude folder');
    assert.equal(existsSync(join(claudeDir, STATE_FILE)), false);
  });
});

function boardAnswer(body) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(body) }] } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recordingFetch(sink, answer) {
  return async (_url, init) => {
    sink.push(JSON.parse(init.body).params.arguments);
    return answer(sink.length);
  };
}

function timeoutError() {
  return Object.assign(new Error('timed out'), { name: 'TimeoutError' });
}

describe('the lock (review 1)', () => {
  test('a run that lost its lock does not delete the new owner lock', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const lock = join(claudeDir, LOCK_FILE);
    const fetchImpl = async () => {
      writeFileSync(lock, 'someone-else');
      return boardAnswer({ stored: true });
    };
    await tick({ options: { fetchImpl } });
    assert.equal(readFileSync(lock, 'utf8'), 'someone-else');
  });

  test('the lock time is refreshed while the run works, so a long run is not stale', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const lock = join(claudeDir, LOCK_FILE);
    let ageAtSend = Infinity;
    const listFiles = (dir, opts) => {
      const aged = (Date.now() - 10 * LOCK_STALE_MS) / 1000;
      utimesSync(lock, aged, aged);
      return listRecordFiles(dir, opts);
    };
    const fetchImpl = async () => {
      ageAtSend = Date.now() - statSync(lock).mtimeMs;
      return boardAnswer({ stored: true });
    };
    await tick({ listFiles, options: { fetchImpl } });
    assert.equal(ageAtSend < LOCK_STALE_MS, true, `lock age at the send was ${ageAtSend} ms`);
  });

  test('a stale lock is deleted by acquireLock, leaves no other file, and the run holds a token lock', async () => {
    const lock = join(claudeDir, LOCK_FILE);
    writeFileSync(lock, 'dead-run');
    const old = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
    utimesSync(lock, old, old);
    const token = acquireLock(lock, Date.now());
    assert.match(token, /^\d+\.[0-9a-f]{16}$/, 'the same call deletes the stale lock and takes a fresh one');
    assert.equal(readFileSync(lock, 'utf8'), token);
    assert.deepEqual(readdirSync(claudeDir).filter((name) => name.includes('.stale.')), []);
    assert.equal(acquireLock(lock, Date.now()), '', 'the fresh lock is live');
  });

  test('a fresh lock is left alone and the run does no work', () => {
    const lock = join(claudeDir, LOCK_FILE);
    writeFileSync(lock, 'live-run');
    assert.equal(acquireLock(lock, Date.now()), '');
    assert.equal(readFileSync(lock, 'utf8'), 'live-run');
  });

  test('ownership lost mid-run stops before the next save and send', async () => {
    for (let i = 0; i <= SEND_BATCH_SIZE; i += 1) writeSession(`s${i}`, recordLine(OPUS, { output_tokens: 6 }, AT));
    const lock = join(claudeDir, LOCK_FILE);
    const seen = [];
    const fetchImpl = async (...args) => {
      seen.push(args);
      writeFileSync(lock, 'someone-else');
      return boardAnswer({ stored: true });
    };
    const outcome = await tick({ options: { fetchImpl } });
    assert.deepEqual(outcome, { skipped: 'lock lost' });
    assert.equal(seen.length, SEND_BATCH_SIZE, 'only the first batch went out');
    assert.equal(readFileSync(lock, 'utf8'), 'someone-else');
  });

  test('a lock that vanished stops the run before any save', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const lock = join(claudeDir, LOCK_FILE);
    const listFiles = (dir, opts) => {
      rmSync(lock);
      return listRecordFiles(dir, opts);
    };
    assert.deepEqual(await tick({ listFiles }), { skipped: 'lock lost' });
    assert.equal(existsSync(join(claudeDir, STATE_FILE)), false);
    assert.equal(reports.length, 0);
  });

  test('a final state save that fails is not reported as recorded', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const state = join(claudeDir, STATE_FILE);
    const fetchImpl = async () => {
      rmSync(state);
      mkdirSync(state);
      return boardAnswer({ stored: true });
    };
    const outcome = await tick({ options: { fetchImpl } });
    assert.equal(outcome.skipped, 'state not saved');
  });
});

describe('record times and answers (review 2)', () => {
  test('a send that timed out but was stored never pins the series: the next send is later', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const seen = [];
    const failing = recordingFetch(seen, () => { throw timeoutError(); });
    assert.deepEqual([(await tick({ options: { fetchImpl: failing } })).failed], [1]);
    writeSession('s1', recordLine(OPUS, { output_tokens: 4 }, AT), NOW + 1000);
    await tick({ now: NOW + TICK_GAP_MS, options: { fetchImpl: recordingFetch(seen, () => boardAnswer({ stored: true })) } });
    assert.equal(seen.length, 2);
    assert.equal(Date.parse(seen[1].record_at) > Date.parse(seen[0].record_at), true);
    assert.equal(seen[1].output_tokens, 10);
  });

  test('a board answer stored:false is not recorded as sent and the retry uses a later time', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const seen = [];
    const refused = await tick({ options: { fetchImpl: recordingFetch(seen, () => boardAnswer({ stored: false })) } });
    assert.deepEqual([refused.sent, refused.failed], [0, 1]);
    const again = await tick({ now: NOW + TICK_GAP_MS, options: { fetchImpl: recordingFetch(seen, () => boardAnswer({ stored: true })) } });
    assert.equal(again.sent, 1);
    assert.equal(Date.parse(seen[1].record_at) - Date.parse(seen[0].record_at), 1);
    const next = await tick({ now: NOW + 2 * TICK_GAP_MS, options: { fetchImpl: recordingFetch(seen, () => boardAnswer({ stored: true })) } });
    assert.equal(next.sent, 0, 'now recorded as sent');
  });
});

describe('the helper kind (review 3)', () => {
  test('a helper seen before its meta file exists is looked at again on the next run', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 1 }, '2026-11-16T10:00:00Z'), NOW - 5 * TICK_GAP_MS);
    writeHelper('s1', 'h1', 'code-review-pass', recordLine(SONNET, { output_tokens: 2 }, AT));
    rmSync(join(claudeDir, 'projects', 'proj', 's1', 'subagents', 'agent-h1.meta.json'));
    const seen = [];
    const answer = () => boardAnswer({ stored: true });
    await tick({ options: { fetchImpl: recordingFetch(seen, answer) } });
    assert.equal(seen[0].agent_kind, 'agent');
    const dir = join(claudeDir, 'projects', 'proj', 's1', 'subagents');
    writeFileSync(join(dir, 'agent-h1.meta.json'), JSON.stringify({ agentType: 'code-review-pass' }));
    appendFileSync(join(dir, 'agent-h1.jsonl'), recordLine(SONNET, { output_tokens: 3 }, '2026-11-16T12:06:00Z'));
    stamp(join(dir, 'agent-h1.jsonl'), NOW + 1000);
    await tick({ now: NOW + TICK_GAP_MS, options: { fetchImpl: recordingFetch(seen, answer) } });
    assert.equal(seen[1].agent_kind, 'code-review-pass');
  });
});

describe('small batches (review 7)', () => {
  test('never more than the batch size is in flight, and every report is sent', async () => {
    const total = SEND_BATCH_SIZE * 2 + 2;
    for (let n = 0; n < total; n += 1) writeSession(`s${n}`, recordLine(OPUS, { output_tokens: 1 + n }, AT));
    let inFlight = 0;
    let most = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return boardAnswer({ stored: true });
    };
    const outcome = await tick({ options: { fetchImpl } });
    assert.equal(outcome.sent, total);
    assert.equal(most, SEND_BATCH_SIZE);
  });
});

describe('command line', () => {
  test('--run exits 0 and prints no token with the board unreachable', () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, new Date().toISOString()), Date.now());
    const script = fileURLToPath(new URL('./usage-tick.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--run'], { env: { ...env, AGENT_BOARD_URL: 'http://127.0.0.1:1' }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_TOKEN), false);
  });

  test('called as a hook with usage off it exits 0 at once and prints nothing', () => {
    const script = fileURLToPath(new URL('./usage-tick.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], { env: { ...env, AGENT_BOARD_USAGE: 'off', AGENT_BOARD_URL: 'http://127.0.0.1:1' }, encoding: 'utf8' });
    assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
  });
});

describe('the task heartbeat (Slice 13)', () => {
  const OLD = NOW - 10 * 60 * 1000;

  function writeTask(sessionId, task, atMs = OLD) {
    const file = join(taskRoot, `${sessionId}.task.json`);
    writeFileSync(file, JSON.stringify(task));
    stamp(file, atMs);
  }

  const beats = () => reports.filter((r) => r.name === 'report_progress');

  test('an active session sends one report_progress with only key and project (no status)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeHelper('s1', 'h1', 'general-purpose', recordLine(SONNET, { output_tokens: 2 }, AT));
    writeTask('s1', { key: 'demo-app/slice-13', step: 'Build the slice', status: 'in_progress' });
    await tick();
    assert.equal(beats().length, 1);
    assert.deepEqual(beats()[0].args, { key: 'demo-app/slice-13', project: 'demo-app' });
  });

  test('a sent heartbeat refreshes the task file age; the next tick still sends (review #5)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    const nearLimit = NOW - TASK_MAX_AGE_MS + 60000;
    writeTask('s1', { key: 'demo-app/slice-13', step: '', status: 'in_progress' }, nearLimit);
    await tick();
    assert.equal(beats().length, 1);
    assert.ok(statSync(join(taskRoot, 's1.task.json')).mtimeMs >= NOW - 1000, 'mtime moved to now');
    reports = [];
    writeSession('s1', recordLine(OPUS, { output_tokens: 1 }, AT), NOW + TICK_GAP_MS - 1000);
    await tick({ now: NOW + TICK_GAP_MS });
    assert.equal(beats().length, 1);
  });

  test('a task file without a status counts as in progress', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeTask('s1', { key: 'demo-app/slice-13', step: 'Build the slice' });
    await tick();
    assert.equal(beats().length, 1);
  });

  test('an idle session sends none: no record file changed since the last run', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeTask('s1', { key: 'demo-app/slice-13', step: 's', status: 'in_progress' });
    await tick();
    reports = [];
    await tick({ now: NOW + TICK_GAP_MS });
    assert.equal(beats().length, 0);
  });

  test('a missing, old, fresh, waiting or blocked task sends none', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    await tick();
    assert.equal(beats().length, 0, 'no task file');
    for (const [name, task, at] of [
      ['old', { key: 'demo-app/slice-13', step: '', status: 'in_progress' }, NOW - TASK_MAX_AGE_MS - 60000],
      ['fresh', { key: 'demo-app/slice-13', step: '', status: 'in_progress' }, NOW - 5000],
      ['waiting', { key: 'demo-app/slice-13', step: '', status: 'waiting' }, OLD],
      ['blocked', { key: 'demo-app/slice-13', step: '', status: 'blocked' }, OLD],
    ]) {
      writeTask('s1', task, at);
      reports = [];
      writeSession('s1', recordLine(OPUS, { output_tokens: 1 }, AT));
      await tick();
      assert.equal(beats().length, 0, name);
    }
  });

  test('the stored project is sent; a key without a slash needs the stored project (review #3)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeTask('s1', { key: 'my-key', step: '', status: 'in_progress', project: 'foo' });
    await tick();
    assert.deepEqual(beats()[0].args, { key: 'my-key', project: 'foo' });
  });

  test('stale, parked, open and review statuses send none (review #1)', async () => {
    for (const status of ['stale', 'parked', 'open', 'review']) {
      writeTask('s1', { key: 'demo-app/slice-13', step: '', status, project: 'demo-app' });
      reports = [];
      writeSession('s1', recordLine(OPUS, { output_tokens: 1 }, AT));
      await tick();
      assert.equal(beats().length, 0, status);
    }
  });

  test('a session whose record file changed more than 15 minutes ago sends none (review #8)', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT), NOW - 20 * 60 * 1000);
    writeTask('s1', { key: 'demo-app/slice-13', step: '', status: 'in_progress' });
    await tick();
    assert.equal(beats().length, 0);
  });

  test('a board error on the heartbeat leaves the usage report and the cap reading alone', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    writeFileSync(join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { subscriptionType: 'max', expiresAt: NOW - 1 } }));
    stamp(join(claudeDir, '.credentials.json'), NOW - 24 * 3600000);
    writeFileSync(join(claudeDir, 'usage-latest.json'), JSON.stringify({ at: FILE_AT, rate_limits: { seven_day: { used_percentage: 30 } } }));
    writeTask('s1', { key: 'demo-app/slice-13', step: '', status: 'in_progress' });
    const failing = async (url, init) => {
      if (String(init && init.body).includes('"report_progress"')) return { ok: false, status: 500, text: async () => '' };
      return fetch(url, init);
    };
    const outcome = await tick({ options: { fetchImpl: failing } });
    assert.equal(outcome.sent, 1);
    assert.deepEqual(reports.map((r) => r.name), ['report_usage', 'report_cap']);
  });

  test('usage off (either switch) still sends the heartbeat, and no token or cap report', async () => {
    writeSession('s1', recordLine(OPUS, { output_tokens: 6 }, AT));
    for (const off of [{ AGENT_BOARD_USAGE: 'off' }, { CLAUDE_PLUGIN_OPTION_REPORT_USAGE: 'false' }]) {
      reports = [];
      writeTask('s1', { key: 'demo-app/slice-13', step: '', status: 'in_progress' });
      await tick({ env: { ...env, ...off } });
      assert.deepEqual(reports.map((r) => r.name), ['report_progress'], JSON.stringify(off));
      rmSync(join(claudeDir, STATE_FILE), { force: true });
    }
  });
});
