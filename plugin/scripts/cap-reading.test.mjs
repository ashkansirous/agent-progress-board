/* global DOMException */
// Tests for cap-reading.mjs: a fake credentials file in a temp folder, an injected usage fetch and
// a fake board; the real credentials, the real address and the live board are never touched.
// Run: node --test skills/report-progress/cap-reading.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import {
  BETA_HEADER, BETA_VALUE, CAP_STATE_FILE, CREDENTIALS_FILE, LATEST_FILE, OK_GAP_MS, RETRY_GAP_MS, SOURCE_API,
  SOURCE_STATUSLINE, USAGE_URL, planOf, sendCapReading, windowsFromApi, windowsFromStatusLine,
} from './cap-reading.mjs';

const FAKE_TOKEN = 'fake-access-token-not-real';
const NOW = Date.parse('2026-11-16T18:00:00Z');
const RESET = '2026-11-17T17:00:00.736540+00:00';
const RESET_ISO = '2026-11-17T17:00:00Z';
const CONFIG = { url: 'http://board.invalid/mcp', token: 'board-token-not-real' };
const PLAN = 'max (default_claude_max_20x)';
const DAY_MS = 24 * 3600000;

const API_BODY = {
  five_hour: null,
  seven_day: { utilization: 9, resets_at: RESET },
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 9, resets_at: RESET, scope: null },
    { kind: 'weekly_scoped', group: 'weekly', percent: 10, resets_at: RESET, scope: { model: { id: null, display_name: 'Top Model' }, surface: null } },
  ],
  seven_day_breakdown: { rows: [{ key: 'claude_code', percent: 100 }, { key: 'chat', percent: 0 }] },
};

let dir;
let boardCalls;
let usageCalls;

// The credentials file is dated a day before NOW unless a test says otherwise (the status line
// file is not sent when the credentials changed after it was written).
function writeCredentials(overrides = {}, modifiedAt = NOW - DAY_MS) {
  const oauth = { accessToken: FAKE_TOKEN, expiresAt: NOW + 3600000, subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', ...overrides };
  const path = join(dir, CREDENTIALS_FILE);
  writeFileSync(path, JSON.stringify({ claudeAiOauth: oauth }));
  utimesSync(path, modifiedAt / 1000, modifiedAt / 1000);
}

function writeLatest(atMs, limits) {
  writeFileSync(join(dir, LATEST_FILE), JSON.stringify({ at: new Date(atMs).toISOString(), rate_limits: limits }));
}

function answering(body, ok = true) {
  return async (url, init) => {
    usageCalls.push({ url, init });
    return { ok, status: ok ? 200 : 429, json: async () => body };
  };
}

function boardFetch() {
  return async (_url, init) => {
    boardCalls.push(JSON.parse(init.body).params);
    return { ok: true, text: async () => JSON.stringify({ result: { content: [{ text: '{"stored":1}' }] } }) };
  };
}

// One injected fetch for both calls: the usage address goes to `usage`, the board's to the fake board.
function routed(usage) {
  const board = boardFetch();
  return (url, init) => (String(url) === USAGE_URL ? usage(url, init) : board(url, init));
}

function send(at, fetchImpl) {
  return sendCapReading({ config: CONFIG, claudeDir: dir, clock: () => at, options: { fetchImpl } });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cap-reading-'));
  boardCalls = [];
  usageCalls = [];
});

describe('windowsFromApi', () => {
  test('maps weekly and the scoped model, skips a null window, never sends the surface rows', () => {
    const windows = windowsFromApi(API_BODY);
    assert.deepEqual(windows, [
      { kind: 'weekly', percent: 9, reset_at: RESET_ISO },
      { kind: 'weekly:top-model', percent: 10, reset_at: RESET_ISO },
    ]);
  });

  test('a non-null five_hour is sent as short; without limits seven_day is the weekly', () => {
    const windows = windowsFromApi({ five_hour: { utilization: 3, resets_at: RESET }, seven_day: { utilization: 9, resets_at: RESET } });
    assert.deepEqual(windows.map((w) => [w.kind, w.percent]), [['weekly', 9], ['short', 3]]);
  });

  test('a null percent is no reading, not zero', () => {
    assert.deepEqual(windowsFromApi({ seven_day: { utilization: null, resets_at: RESET }, five_hour: null }), []);
  });

  test('a long kind is cut to 60 characters and a repeated kind is sent once, the first (review 4)', () => {
    const scoped = (name, percent) => ({ kind: 'weekly_scoped', percent, resets_at: RESET, scope: { model: { display_name: name } } });
    const windows = windowsFromApi({ limits: [
      { kind: 'weekly_all', percent: 9, resets_at: RESET },
      scoped('Same', 1), scoped('same', 2), scoped('x'.repeat(200), 3),
    ] });
    assert.deepEqual(windows.map((w) => [w.kind.length <= 60, w.percent]), [[true, 9], [true, 1], [true, 3]]);
    assert.equal(windows.filter((w) => w.kind === 'weekly:same').length, 1);
  });

  test('at most 20 windows', () => {
    const limits = {};
    for (let i = 0; i < 30; i += 1) limits[`window${i}`] = { used_percentage: i };
    assert.equal(windowsFromStatusLine(limits).length, 20);
  });
});

describe('reset_at (review 1)', () => {
  test('two address answers whose reset fractions differ send the same string', () => {
    const a = windowsFromApi({ seven_day: { utilization: 9, resets_at: '2026-11-17T17:00:00.736540+00:00' } });
    const b = windowsFromApi({ seven_day: { utilization: 9, resets_at: '2026-11-17T17:00:00.073112+00:00' } });
    assert.equal(a[0].reset_at, '2026-11-17T17:00:00Z');
    assert.equal(b[0].reset_at, a[0].reset_at);
  });

  test('the status line file (epoch seconds) gives the same string as the address, rounded to the minute', () => {
    const epoch = Date.parse('2026-11-17T17:00:00.736Z') / 1000;
    assert.equal(windowsFromStatusLine({ seven_day: { used_percentage: 9, resets_at: epoch } })[0].reset_at, RESET_ISO);
    assert.equal(windowsFromStatusLine({ seven_day: { used_percentage: 9, resets_at: epoch + 40 } })[0].reset_at, '2026-11-17T17:01:00Z');
  });

  test('a window name that is an Object.prototype key is used as text, not looked up (review 6)', () => {
    const windows = windowsFromStatusLine({ constructor: { used_percentage: 9 } });
    assert.deepEqual(windows, [{ kind: 'constructor', percent: 9 }]);
  });

  test('a reset epoch of 0 or below, or an invalid date, is left out (pass 2, 3)', () => {
    for (const resets_at of [0, -5, 'garbage']) {
      assert.deepEqual(windowsFromStatusLine({ seven_day: { used_percentage: 9, resets_at } }), [{ kind: 'weekly', percent: 9 }]);
    }
  });

  test('an unparsable reset time is left out, the window stays', () => {
    assert.deepEqual(windowsFromApi({ seven_day: { utilization: 9, resets_at: 'soon' } }), [{ kind: 'weekly', percent: 9 }]);
  });
});

describe('planOf', () => {
  test('joins type and tier, or gives the type alone', () => {
    assert.equal(planOf({ claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }), PLAN);
    assert.equal(planOf({ claudeAiOauth: { subscriptionType: 'pro' } }), 'pro');
    assert.equal(planOf(null), '');
  });
});

describe('sendCapReading', () => {
  test('success: asks the address with the header, sends one report_cap, token never in it', async () => {
    writeCredentials();
    const outcome = await send(NOW, routed(answering(API_BODY)));
    assert.deepEqual(outcome, { sent: true, source: SOURCE_API });
    assert.equal(usageCalls[0].url, USAGE_URL);
    assert.equal(usageCalls[0].init.headers[BETA_HEADER], BETA_VALUE);
    assert.equal(usageCalls[0].init.redirect, 'error');
    assert.equal(boardCalls.length, 1);
    assert.equal(boardCalls[0].name, 'report_cap');
    assert.equal(boardCalls[0].arguments.plan, PLAN);
    assert.equal(boardCalls[0].arguments.source, SOURCE_API);
    assert.equal(boardCalls[0].arguments.taken_at, new Date(NOW).toISOString());
    assert.equal(JSON.stringify(boardCalls).includes(FAKE_TOKEN), false);
  });

  test('taken_at is the time the answer arrived; the expiry is checked before the call (review 6)', async () => {
    writeCredentials({ expiresAt: NOW + 1000 });
    const times = [NOW, NOW, NOW + 5000]; // the gap check, before the call, after the answer (past the expiry)
    const clock = () => times.shift() ?? NOW + 5000;
    await sendCapReading({ config: CONFIG, claudeDir: dir, clock, options: { fetchImpl: routed(answering(API_BODY)) } });
    assert.equal(usageCalls.length, 1);
    assert.equal(boardCalls[0].arguments.taken_at, new Date(NOW + 5000).toISOString());
  });

  test('refused: falls back to the status line file with its own time and source', async () => {
    writeCredentials();
    writeLatest(NOW - 60000, { seven_day: { used_percentage: 42, resets_at: Date.parse('2026-11-20T10:00:00Z') / 1000 }, five_hour: { used_percentage: 5 } });
    const outcome = await send(NOW, routed(answering({}, false)));
    assert.equal(outcome.source, SOURCE_STATUSLINE);
    const args = boardCalls[0].arguments;
    assert.equal(args.taken_at, new Date(NOW - 60000).toISOString());
    assert.deepEqual(args.windows.map((w) => [w.kind, w.percent]), [['weekly', 42], ['short', 5]]);
    assert.equal(args.windows[0].reset_at, '2026-11-20T10:00:00Z');
  });

  test('timeout (the fetch throws): falls back to the file', async () => {
    writeCredentials();
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 1 } });
    const failing = async (url) => { usageCalls.push({ url }); throw new DOMException('t', 'TimeoutError'); };
    const outcome = await send(NOW, routed(failing));
    assert.equal(outcome.source, SOURCE_STATUSLINE);
  });

  test('an answer with no weekly figure is a failed read: the file is sent, the retry gap starts (review 3)', async () => {
    writeCredentials();
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 7 } });
    const noWeekly = { five_hour: { utilization: 3, resets_at: RESET }, limits: [{ kind: 'weekly_scoped', percent: 2, scope: { model: { display_name: 'Top' } } }] };
    const outcome = await send(NOW, routed(answering(noWeekly)));
    assert.equal(outcome.source, SOURCE_STATUSLINE);
    await send(NOW + 1000, routed(answering(API_BODY)));
    assert.equal(usageCalls.length, 1, 'the address is not asked again inside the retry gap');
  });

  test('a file older than fifteen minutes is still sent with its own time, never as now', async () => {
    writeCredentials();
    const old = NOW - 3 * 3600000;
    writeLatest(old, { seven_day: { used_percentage: 60 } });
    await send(NOW, routed(answering({}, false)));
    assert.equal(boardCalls[0].arguments.taken_at, new Date(old).toISOString());
  });

  test('a token refresh (credentials file newer) does not drop the file; a changed plan does (pass 2, 2)', async () => {
    writeCredentials({}, NOW - 30000);
    writeLatest(NOW - 60000, { seven_day: { used_percentage: 42 } });
    const first = await send(NOW, routed(answering({}, false)));
    assert.equal(first.source, SOURCE_STATUSLINE, 'no plan saved yet: the file is sent');
    // a good address read saves the plan; later the plan changes and the address refuses
    const later = NOW + RETRY_GAP_MS + 1000;
    await send(later, routed(answering(API_BODY)));
    writeCredentials({ subscriptionType: 'pro', rateLimitTier: '' });
    writeLatest(later + OK_GAP_MS + 1000, { seven_day: { used_percentage: 50 } });
    const changed = await send(later + OK_GAP_MS + 2000, routed(answering({}, false)));
    assert.deepEqual(changed, { skipped: 'no reading' });
    writeCredentials(); // back to the saved plan: sent
    const same = await send(later + OK_GAP_MS + 3000, routed(answering({}, false)));
    assert.equal(same.source, SOURCE_STATUSLINE);
  });

  test('a failed board send starts no four-minute gap (pass 2, 1)', async () => {
    writeCredentials();
    const failingBoard = async () => ({ ok: false, status: 500, text: async () => '' });
    const fetchImpl = (url, init) => (String(url) === USAGE_URL ? answering(API_BODY)(url, init) : failingBoard());
    const outcome = await send(NOW, fetchImpl);
    assert.equal(outcome.sent, undefined);
    const again = await send(NOW + 1000, routed(answering(API_BODY)));
    assert.equal(again.sent, true);
    assert.equal(usageCalls.length, 2);
  });

  test('a file older than the last accepted address reading is not sent (pass 2, 4)', async () => {
    writeCredentials();
    await send(NOW, routed(answering(API_BODY)));
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 3 } });
    const outcome = await send(NOW + RETRY_GAP_MS + OK_GAP_MS, routed(answering({}, false)));
    assert.deepEqual(outcome, { skipped: 'no reading' });
    assert.equal(boardCalls.length, 1);
  });

  test('a file window already reset is dropped; with no weekly left nothing is sent (pass 2, 5)', async () => {
    writeCredentials();
    const future = Date.parse('2026-11-20T10:00:00Z') / 1000;
    const past = NOW / 1000 - 3600;
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 20, resets_at: future }, five_hour: { used_percentage: 5, resets_at: past } });
    await send(NOW, routed(answering({}, false)));
    assert.deepEqual(boardCalls[0].arguments.windows.map((w) => w.kind), ['weekly']);
    writeLatest(NOW + 1000, { seven_day: { used_percentage: 21, resets_at: past } });
    const outcome = await send(NOW + 2000, routed(answering({}, false)));
    assert.deepEqual(outcome, { skipped: 'no reading' });
    assert.equal(boardCalls.length, 1);
  });

  test('an expired token is not used: no address call, the file is sent', async () => {
    writeCredentials({ expiresAt: NOW - 1 });
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 20 } });
    const outcome = await send(NOW, routed(answering(API_BODY)));
    assert.equal(usageCalls.length, 0);
    assert.equal(outcome.source, SOURCE_STATUSLINE);
    assert.equal(JSON.parse(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')).claudeAiOauth.accessToken, FAKE_TOKEN);
  });

  test('after a failure the address is not asked again for fifteen minutes', async () => {
    writeCredentials();
    const fetchImpl = routed(answering({}, false));
    await send(NOW, fetchImpl);
    await send(NOW + RETRY_GAP_MS - 1000, fetchImpl);
    assert.equal(usageCalls.length, 1);
    await send(NOW + RETRY_GAP_MS + 1000, routed(answering(API_BODY)));
    assert.equal(usageCalls.length, 2);
  });

  test('after a success nothing is asked or sent for four minutes, then the address again (review 9)', async () => {
    writeCredentials();
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 7 } });
    const fetchImpl = routed(answering(API_BODY));
    await send(NOW, fetchImpl);
    const inside = await send(NOW + OK_GAP_MS - 1000, fetchImpl);
    assert.deepEqual(inside, { skipped: 'no reading' });
    assert.equal(usageCalls.length, 1);
    assert.equal(boardCalls.length, 1);
    await send(NOW + OK_GAP_MS + 1000, fetchImpl);
    assert.equal(usageCalls.length, 2);
  });

  test('the same status line file is not sent twice', async () => {
    writeCredentials({ expiresAt: NOW - 1 });
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 20 } });
    const fetchImpl = routed(answering({}));
    await send(NOW, fetchImpl);
    const second = await send(NOW + 1000, fetchImpl);
    assert.equal(boardCalls.length, 1);
    assert.deepEqual(second, { skipped: 'no reading' });
  });

  test('no credentials file or no plan: nothing is sent and nothing is written', async () => {
    writeLatest(NOW - 1000, { seven_day: { used_percentage: 20 } });
    const outcome = await send(NOW, routed(answering(API_BODY)));
    assert.deepEqual(outcome, { skipped: 'no reading' });
    assert.equal(boardCalls.length, 0);
    assert.equal(existsSync(join(dir, CAP_STATE_FILE)), false);
  });
});
