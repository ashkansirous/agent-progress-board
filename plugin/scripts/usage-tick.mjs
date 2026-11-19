#!/usr/bin/env node
/* global process, setTimeout */
// Send token usage to the Agent Progress Board (Slice 11 part A): one `report_usage` per agent and
// model, as running totals, read from Claude Code's own session records (usage-report.mjs).
//
// The hook never does the work itself (the walk over every record file takes seconds). Called by a
// hook, this script only reads the tiny gate file `usage-tick.gate` (one time stamp); not due, it
// exits at once; due, it writes the new time into the gate first, starts itself again detached in
// the background (`--run`, no output, not waited for) and exits. session-done.mjs starts the same
// run with the gate ignored (`--force`) and never waits.
//
// The background run takes the lock file `usage-tick.lock` (it holds the run's own token and is
// refreshed while the run works; a run that finds a live lock exits; a lock older than two minutes
// is stale: it is deleted and the same call creates a fresh one, there is no takeover of a live one; a
// forced run (--force, from Stop and SubagentStop) asks for a held lock a few times before it gives up;
// a run that finds its token gone stops at once; a run deletes the lock only if it still holds
// its token), reads every record file changed since the
// last run, whoever fired it, and sends one `report_usage` per agent and model as running totals.
// The scan state (last run time, per file byte offset, last 64 bytes, totals, what was sent) lives
// in `usage-tick-state.json`, written to a temp file and renamed. A run that cannot save its state
// sends nothing, so it never sends the same numbers again on every run.
//
// Fails open: no token, no records, a timeout or any error is at most one stderr line, exit 0.
// The token is never printed, logged or stored. Usage: node usage-tick.mjs [--force | --run]
// Env: the plugin's options (CLAUDE_PLUGIN_OPTION_BOARD_URL, _BOARD_TOKEN, _ENVIRONMENT, _REPORT_USAGE) or
//      AGENT_BOARD_URL, AGENT_BOARD_TOKEN, AGENT_BOARD_ENV (see report-progress.mjs),
//      AGENT_BOARD_CLAUDE_DIR (the Claude folder it READS; else CLAUDE_CONFIG_DIR; default ~/.claude),
//      AGENT_BOARD_USAGE=off, or the option report_usage = false (send no token or cap report; the task
//      heartbeat still goes). The cap reading runs only when the option read_plan_cap
//      (CLAUDE_PLUGIN_OPTION_READ_PLAN_CAP) is on as well; it is off by default.
// The gate, lock, scan state and cap state are this plugin's own, kept in the state folder
// (CLAUDE_PLUGIN_DATA/state, see stateRoot in report-progress.mjs); nothing is written to the Claude folder.
// The board cards of sessions come from the sessions' own MCP reports and the hooks (Slice 21): this script
// sends token counts, the task heartbeat and the cap reading, and opens no card.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_MAX_AGE_MS, TASK_STATUS, callTool, projectSlug, readPlanCapEnabled, reportUsageEnabled, resolveConfig, resolveEnvironment, slugify, stateRoot, taskFilePath } from './report-progress.mjs';

// The hook call (this script run directly without --run) only reads the gate and, when due, starts the
// background run: it never loads the modules that only the run needs (Slice 30). Anything else that
// imports this file (the tests, the background run) gets them loaded before its first use.
const RUN_FLAG = '--run';
export const LOG_FILE = 'usage-tick.log'; // before the module loads below: a failed load writes it
const HOOK_CALL = isInvokedDirectly() && !process.argv.includes(RUN_FLAG);
let sendCapReading;
let readGoal;
let agentKindOf;
let emptyFileState;
let listRecordFiles;
let metaKindOf;
let scanFile;
if (!HOOK_CALL) {
  try {
    ({ sendCapReading } = await import('./cap-reading.mjs'));
    ({ readGoal } = await import('./hooks/hook-input.mjs'));
    ({ agentKindOf, emptyFileState, listRecordFiles, metaKindOf, scanFile } = await import('./usage-report.mjs'));
  } catch (error) {
    logSkipped(error); // fails open: a module that cannot load ends the run quietly, for an importer too
    if (isInvokedDirectly()) process.exit(0);
  }
}

export const TICK_GAP_MS = 5 * 60 * 1000;
export const LOCK_STALE_MS = 2 * 60 * 1000;
export const FIRST_TICK_WINDOW_MS = 60 * 60 * 1000;
export const SEND_TIMEOUT_MS = 2000;
export const SEND_BATCH_SIZE = 5;
export const LOCK_RETRY_ATTEMPTS = 4; // a forced run asks for the lock this many times in all
export const LOCK_RETRY_DELAY_MS = 1000;
export const GATE_FILE = 'usage-tick.gate';
export const LOCK_FILE = 'usage-tick.lock';
export const STATE_FILE = 'usage-tick-state.json';
const CLAUDE_DIR_VARIABLE = 'AGENT_BOARD_CLAUDE_DIR';
const CLAUDE_CONFIG_VARIABLE = 'CLAUDE_CONFIG_DIR'; // Claude Code's own setting for its folder
const PROJECTS_FOLDER = 'projects';
export { TASK_MAX_AGE_MS }; // the task file's age limit, defined next to activeTaskCard in report-progress.mjs
export const HEARTBEAT_MIN_AGE_MS = 60 * 1000; // a task file written this recently was just reported by a step report
export const ACTIVE_WINDOW_MS = 15 * 60 * 1000; // a session counts as active only when a record file changed this recently
const USAGE_TOOL = 'report_usage';
const PROGRESS_TOOL = 'report_progress';
const FORCE_FLAG = '--force';
const EXISTS_CODE = 'EEXIST';
const SERIES_SPLIT_MS = 1;
const LOCK_LOST = Symbol('lock lost');

// The Claude folder this script reads (session records, sign-in file): never written to.
export function claudeDirOf(env = process.env) {
  return env[CLAUDE_DIR_VARIABLE] || env[CLAUDE_CONFIG_VARIABLE] || join(homedir(), '.claude');
}

// Debug-only: a device check reads these lines (the detached run has no other output).
function logDebug(text) {
  if (process.env.AGENT_BOARD_DEBUG) process.stderr.write(`usage-tick: ${text}\n`);
}

function readGate(path) {
  try {
    return Number(readFileSync(path, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

function writeGate(path, now) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(now));
  } catch { /* the next hook call simply asks again */ }
}

function startBackgroundRun(env, spawnFn, force) {
  const script = fileURLToPath(import.meta.url);
  const args = force ? [script, RUN_FLAG, FORCE_FLAG] : [script, RUN_FLAG];
  const child = spawnFn(process.execPath, args, { env, detached: true, stdio: 'ignore', windowsHide: true });
  if (child && typeof child.on === 'function') child.on('error', () => {});
  child.unref();
}

// What a hook calls: read the gate, and when a run is due (or force) write the gate first and start
// the background run. Never walks a folder, never touches the network, never waits.
// Returns { skipped } or { started: true }.
export function requestTick({ force = false, env = process.env, now = Date.now(), spawnFn = spawn } = {}) {
  const gatePath = join(stateRoot(env), GATE_FILE);
  if (!force && now - readGate(gatePath) < TICK_GAP_MS) {
    logDebug('gate closed, no run started');
    return { skipped: 'gate' };
  }
  writeGate(gatePath, now);
  try {
    startBackgroundRun(env, spawnFn, force);
  } catch {
    return { skipped: 'no start' };
  }
  logDebug('background run started');
  return { started: true };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTotalsShape(totals) {
  return isPlainObject(totals) && ['input', 'cacheWrite', 'cacheRead', 'output'].every((name) => Number.isFinite(totals[name]));
}

function isStringWhenPresent(value) {
  return value === undefined || typeof value === 'string';
}

function isFileStateShape(entry) {
  return isPlainObject(entry) && Number.isFinite(entry.offset) && isPlainObject(entry.models)
    && Object.values(entry.models).every(isTotalsShape)
    && (entry.recent === undefined || Array.isArray(entry.recent))
    && ['cwd', 'folder', 'tail'].every((name) => isStringWhenPresent(entry[name]))
    && (entry.sinceMs === undefined || Number.isFinite(entry.sinceMs));
}

// Keeps only the file entries of the saved shape; a malformed entry is dropped (that file is then
// first-seen), a malformed whole file is no state. Never throws.
function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    const files = {};
    for (const [file, entry] of Object.entries(isPlainObject(state.files) ? state.files : {})) {
      if (isFileStateShape(entry)) files[file] = entry;
    }
    return { lastRunAt: Number(state.lastRunAt) || 0, files };
  } catch {
    return { lastRunAt: 0, files: {} };
  }
}

function removeQuietly(path) {
  try {
    unlinkSync(path);
  } catch { /* already gone */ }
}

// Writes to a temp file and renames it over the state; when the rename fails (Windows, a reader
// holds the file) the temp file is removed and the save has failed (no direct write: one killed half way
// could corrupt the state). False on failure, with one stderr line (no content).
function saveState(path, state) {
  const text = JSON.stringify(state);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, text);
    renameSync(temp, path);
    return true;
  } catch {
    removeQuietly(temp);
  }
  process.stderr.write('usage-tick: state not saved, nothing sent\n');
  return false;
}

function newLockToken() {
  return `${process.pid}.${randomBytes(8).toString('hex')}`;
}

// A lock older than LOCK_STALE_MS belongs to a dead run: it is deleted. True when it was deleted
// (or is already gone), so the caller may create a fresh one.
function removeIfStale(path, now) {
  try {
    if (now - statSync(path).mtimeMs <= LOCK_STALE_MS) return false;
    removeQuietly(path);
  } catch { /* already gone */ }
  return true;
}

// Takes the lock by creating it exclusively with this run's token in it. There is no takeover: a
// stale lock is deleted and this run exits; the next run creates a fresh one. Returns the token,
// or '' when this run must not work.
export function acquireLock(path, now = Date.now()) {
  const token = newLockToken();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token, { flag: 'wx' });
    return token;
  } catch (error) {
    if (!error || error.code !== EXISTS_CODE || !removeIfStale(path, now)) return '';
  }
  return createLockOnce(path, token);
}

// One exclusive create (after a stale lock was deleted); '' when another run got there first.
function createLockOnce(path, token) {
  try {
    writeFileSync(path, token, { flag: 'wx' });
    return token;
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A forced run (Stop, SubagentStop) must not lose the session's last tokens to a run that is just
// finishing: it asks for the lock a few times before it gives up.
async function acquireLockWithRetry(path, lockClock, { force, retryAttempts, retryDelayMs }) {
  const attempts = force ? retryAttempts : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await sleep(retryDelayMs);
    const token = acquireLock(path, lockClock());
    if (token) return token;
  }
  return '';
}

function readLockToken(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// Moves the lock's time forward while the run works, so a long run is never seen as stale, and
// reads it back. False when the token is not this run's own or the file is gone: the run stops.
export function refreshLock(path, token, now = Date.now()) {
  if (readLockToken(path) !== token) return false;
  try {
    utimesSync(path, now / 1000, now / 1000);
  } catch { /* the next refresh tries again */ }
  return readLockToken(path) === token;
}

// Deletes the lock only when it still holds this run's token.
export function releaseLock(path, token) {
  if (readLockToken(path) === token) removeQuietly(path);
}

// The task the session reported with report-progress.mjs, as { taskKey, step } (empty strings when none).
// The task file `{ key, step }` is written by report-progress.mjs (taskFilePath names it). Absent,
// unreadable or older than TASK_MAX_AGE_MS it means no task, so the use goes under the session key.
export function readTask(sessionId, taskRoot = undefined, now = Date.now()) {
  const task = readTaskFile(sessionId, taskRoot, now);
  return task ? { taskKey: task.key, step: task.step } : { taskKey: '', step: '' };
}

// The task file as { key, step, status, ageMs } or null (absent, unreadable, no key or too old).
// A file without `status` (written before Slice 13) counts as in_progress.
function readTaskFile(sessionId, taskRoot, now) {
  try {
    const file = taskFilePath(sessionId, taskRoot);
    const ageMs = now - statSync(file).mtimeMs;
    if (ageMs > TASK_MAX_AGE_MS) return null;
    const task = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof task.key !== 'string' || !task.key) return null;
    return {
      key: task.key,
      step: typeof task.step === 'string' ? task.step : '',
      project: typeof task.project === 'string' ? task.project : '',
      status: typeof task.status === 'string' ? task.status : TASK_STATUS.inProgress,
      ageMs,
    };
  } catch {
    return null;
  }
}

function modifiedAt(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// The kind is cached only once it was read from the helper's meta file; with no meta file yet the
// default is used for this run and the next run looks again.
function kindOf(file, known) {
  if (known && known.kindFromMeta) return { kind: known.kind, kindFromMeta: true };
  const fromMeta = metaKindOf(file);
  return fromMeta ? { kind: fromMeta, kindFromMeta: true } : { kind: agentKindOf(file), kindFromMeta: false };
}

// A first-seen file whose scan failed is kept as an empty entry holding the cutoff it was first
// tried with (`sinceMs`); it is scanned again every run with that same cutoff until it succeeds.
function scanOne(file, known, cutoff, touch) {
  const since = known && known.sinceMs ? known.sinceMs : cutoff;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sinceMs, retry, ...scanned } = scanFile(file.path, known || emptyFileState(), { sinceMs: since, touch });
  return { ...scanned, sessionId: file.sessionId, helperId: file.helperId, folder: file.folder, ...kindOf(file, known) };
}

// Every file whose scan failed carries `retry: true` and is scanned again every run, whatever its
// modified time, until a scan succeeds (scanOne leaves the marker out).
function failedScanState(file, known, cutoff) {
  if (known) return { ...known, retry: true };
  return { ...emptyFileState(), sinceMs: cutoff, retry: true, sessionId: file.sessionId, helperId: file.helperId, folder: file.folder };
}

// Scans the files changed since the cutoff; returns the new per-file state (files gone are dropped).
// A file read from zero counts only lines newer than the cutoff, so old history is never counted.
function scanChanged(files, state, cutoff, touch = () => {}, activeSessions = new Set(), activeCutoff = cutoff) {
  const next = {};
  for (const file of files) {
    const known = state.files[file.path];
    touch();
    try {
      const modified = modifiedAt(file.path);
      const changed = modified > cutoff;
      if (modified > activeCutoff && file.sessionId) activeSessions.add(file.sessionId);
      const due = changed || Boolean(known && (known.sinceMs || known.retry));
      next[file.path] = due ? scanOne(file, known, cutoff, touch) : known;
    } catch (error) {
      if (error === LOCK_LOST) throw error;
      next[file.path] = failedScanState(file, known, cutoff);
    }
    if (!next[file.path]) delete next[file.path];
  }
  return next;
}

function agentKeyOf(project, state) {
  const session = `${project}/session-${state.sessionId}`;
  return state.helperId ? `${session}/agent-${state.helperId}` : session;
}

function signatureOf(totals) {
  return [totals.input, totals.cacheWrite, totals.cacheRead, totals.output].join('|');
}

// The time sent with a series: the newest record time, moved one millisecond past the one last
// sent or attempted (a send that timed out may still have been stored) when the totals changed but
// no newer record time came (the board keeps one sample per time).
function recordAtToSend(totals) {
  const floor = Math.max(Date.parse(totals.sentRecordAt) || 0, Date.parse(totals.attemptedRecordAt) || 0);
  if (!floor || Date.parse(totals.recordAt) > floor) return totals.recordAt;
  return new Date(floor + SERIES_SPLIT_MS).toISOString();
}

// One report per model whose totals changed since the last send.
function reportsOfEntry(path, state, context) {
  const reports = [];
  const project = state.cwd ? context.projectOf(state.cwd) : slugify(state.folder || '');
  if (!project) return reports;
  const goal = state.sessionId ? readGoal(state.sessionId, context.taskRoot) : null;
  const sessionKey = (goal && goal.key) || `${project}/session-${state.sessionId}`; // the plugin's card key when the session reported one
  const task = readTask(state.sessionId, context.taskRoot);
  for (const [model, totals] of Object.entries(state.models)) {
    if (!totals.recordAt || signatureOf(totals) === totals.sentSignature) continue;
    const recordAt = recordAtToSend(totals);
    const args = {
      agent_key: agentKeyOf(project, state),
      model,
      record_at: recordAt,
      input_tokens: totals.input,
      cache_write_tokens: totals.cacheWrite,
      cache_read_tokens: totals.cacheRead,
      output_tokens: totals.output,
      task_key: task.taskKey || sessionKey,
      agent_kind: state.kind,
    };
    if (task.step) args.step = task.step;
    if (context.environment) args.environment = context.environment;
    reports.push({ path, model, recordAt, signature: signatureOf(totals), args });
  }
  return reports;
}

// An entry that throws for any reason is dropped from `states` (that file is first-seen from then
// on) and the other files go on: one entry never stops the run.
export function pendingReports(states, context) {
  const reports = [];
  for (const [path, state] of Object.entries(states)) {
    try {
      reports.push(...reportsOfEntry(path, state, context));
    } catch {
      delete states[path];
    }
  }
  return reports;
}

async function sendAll(config, reports, options) {
  const outcomes = await Promise.all(reports.map((report) => callTool(config, USAGE_TOOL, report.args, { timeoutMs: SEND_TIMEOUT_MS, ...options })));
  return outcomes.map((outcome, index) => ({ report: reports[index], outcome }));
}

// The board answers stored:false when it kept an earlier sample for that series and time.
function isStored(outcome) {
  return outcome.ok && !(outcome.data && typeof outcome.data === 'object' && outcome.data.stored === false);
}

function markAttempted(states, reports) {
  for (const report of reports) states[report.path].models[report.model].attemptedRecordAt = report.recordAt;
}

function markSent(states, results) {
  let failures = 0;
  for (const { report, outcome } of results) {
    if (!isStored(outcome)) {
      failures += 1;
      continue;
    }
    const totals = states[report.path].models[report.model];
    totals.sentRecordAt = report.recordAt;
    totals.sentSignature = report.signature;
  }
  return failures;
}

// Sends in small batches. Before each batch the record times about to be sent are saved as
// attempted, so a send that times out but was stored never pins the series to old totals.
async function sendInBatches({ config, reports, states, statePath, lastRunAt, options, touch }) {
  let sent = 0;
  let failed = 0;
  for (let from = 0; from < reports.length; from += SEND_BATCH_SIZE) {
    const batch = reports.slice(from, from + SEND_BATCH_SIZE);
    touch();
    markAttempted(states, batch);
    if (!saveState(statePath, { lastRunAt, files: states })) return { sent, failed: failed + reports.length - from };
    const bad = markSent(states, await sendAll(config, batch, options));
    failed += bad;
    sent += batch.length - bad;
  }
  return { sent, failed };
}

function projectResolver(env) {
  const cache = new Map();
  return (cwd) => {
    if (!cache.has(cwd)) cache.set(cwd, projectSlug(cwd, env)); // the git lookup runs once per folder
    return cache.get(cwd);
  };
}

// The task heartbeat (Slice 13): one report_progress per task still being worked on, with only the
// key, the project and status in_progress, so the board moves heartbeat_at and keeps every other
// field. A session counts as worked on when one of its record files changed since the last run and
// within the last ACTIVE_WINDOW_MS (so a session that ended during a long gap is not revived).
// Nothing is sent for a task file that is gone, older than 24 hours, written in the last minute
// (a step report just went out) or not in_progress (waiting or blocked).
export function heartbeatArgs(activeSessions, taskRoot, now) {
  const byKey = new Map();
  for (const sessionId of activeSessions) {
    const task = readTaskFile(sessionId, taskRoot, now);
    if (!task || task.status !== TASK_STATUS.inProgress || task.ageMs < HEARTBEAT_MIN_AGE_MS) continue;
    // The project the report used; only a file written before it was stored falls back to the key prefix.
    const project = task.project || (task.key.includes('/') ? task.key.split('/')[0] : '');
    if (project) byKey.set(task.key, { key: task.key, project });
  }
  return [...byKey.values()];
}

// A sent heartbeat is a report, so the task file's age restarts: an active task never ages past 24 hours.
// The next tick is at least the gate interval later, well over HEARTBEAT_MIN_AGE_MS, so it still sends.
function refreshTaskFiles(activeSessions, taskRoot, sentKeys, now) {
  for (const sessionId of activeSessions) {
    const task = readTaskFile(sessionId, taskRoot, now);
    if (!task || !sentKeys.has(task.key)) continue;
    try {
      utimesSync(taskFilePath(sessionId, taskRoot), now / 1000, now / 1000);
    } catch { /* fail open */ }
  }
}

// Never stops the run: only a lost lock passes through. One stderr line per branch (no output is
// read from the detached run, a device check reads it with the hook's stderr redirected).
async function runHeartbeats({ config, activeSessions, taskRoot, now, options, touch }) {
  try {
    const beats = heartbeatArgs(activeSessions, taskRoot, now);
    touch();
    const outcomes = await Promise.all(beats.map((args) => callTool(config, PROGRESS_TOOL, args, { timeoutMs: SEND_TIMEOUT_MS, ...options })));
    const sentKeys = new Set(beats.filter((_, i) => outcomes[i].ok).map((args) => args.key));
    refreshTaskFiles(activeSessions, taskRoot, sentKeys, now);
    const stored = sentKeys.size;
    if (beats.length) process.stderr.write(`usage-tick: heartbeat ${stored} of ${beats.length} task(s) sent\n`);
  } catch (error) {
    if (error === LOCK_LOST) throw error;
    process.stderr.write(`usage-tick: heartbeat skipped (${error && error.name})\n`);
  }
}

// Everything read while the option is off counts as already sent, so turning it on sends only what comes later.
function markAllSent(states) {
  for (const state of Object.values(states)) {
    for (const totals of Object.values(state.models || {})) {
      totals.sentRecordAt = totals.recordAt;
      totals.sentSignature = signatureOf(totals);
    }
  }
}

// The usage option is off: no token report and no cap reading; the task heartbeat (Slice 22 decision 4)
// for the sessions whose record files changed lately. The scan state still advances past what is read,
// marked as sent without sending it (review #1, `reviews/pr-104-check-medium.md`).
async function runHeartbeatsOnly({ config, env, now, taskRoot, options, statePath, listFiles, touch }) {
  logDebug('usage off, heartbeat only');
  const { states, activeSessions } = scanRecords({ env, now, statePath, listFiles, touch });
  markAllSent(states);
  const saved = saveState(statePath, { lastRunAt: now, files: states });
  if (!saved) logDebug('heartbeat only: state not saved');
  await runHeartbeats({ config, activeSessions, taskRoot, now, options, touch });
  return saved ? { sent: 0, failed: 0, heartbeatOnly: true } : { skipped: 'state not saved', sent: 0, failed: 0, heartbeatOnly: true };
}

// The scan both runs start with: the record files changed since the last run, folded into the saved state.
function scanRecords({ env, now, statePath, listFiles, touch }) {
  const state = readState(statePath);
  const cutoff = state.lastRunAt || now - FIRST_TICK_WINDOW_MS;
  const files = listFiles(join(claudeDirOf(env), PROJECTS_FOLDER), { withKinds: false });
  const activeSessions = new Set();
  const states = scanChanged(files, state, cutoff, touch, activeSessions, Math.max(cutoff, now - ACTIVE_WINDOW_MS));
  return { states, activeSessions };
}

// The work, with the lock held: scan, save the state (no save, no send), send, save the sent marks.
async function runLocked({ config, env, now, taskRoot, options, statePath, listFiles, touch }) {
  const { states, activeSessions } = scanRecords({ env, now, statePath, listFiles, touch });
  touch();
  if (!saveState(statePath, { lastRunAt: now, files: states })) return { skipped: 'state not saved' };
  const context = { projectOf: projectResolver(env), taskRoot, environment: resolveEnvironment(env) };
  const reports = pendingReports(states, context);
  const tally = await sendInBatches({ config, reports, states, statePath, lastRunAt: now, options, touch });
  touch();
  await runHeartbeats({ config, activeSessions, taskRoot, now, options, touch });
  if (!saveState(statePath, { lastRunAt: now, files: states })) return { skipped: 'state not saved', ...tally };
  if (tally.failed) process.stderr.write(`usage-tick: ${tally.failed} report(s) skipped\n`);
  return tally;
}

// An error that is not the lost lock (an unreadable folder, a bug) ends only the token reports of this
// firing, so the cap reading after it still runs (Slice 30); a lost lock passes through.
async function runLockedOrSkip(args) {
  try {
    return await runLocked(args);
  } catch (error) {
    if (error === LOCK_LOST) throw error;
    process.stderr.write(`usage-tick: token reports skipped (${error && error.name}: ${error && error.message})\n`);
    logDebug(`token reports error: ${error && (error.stack || error.message)}`);
    return { skipped: 'error' };
  }
}

// The cap reading (Slice 11 part B) in the same firing. Its failure never stops the token reports
// (they are already sent); only a lost lock passes through, so the run stops at once.
async function runCapReading({ config, claudeDir, stateDir, clock, touch, options }) {
  try {
    const outcome = await sendCapReading({ config, claudeDir, stateDir, clock, touch, options });
    logDebug(outcome.sent ? `cap reading sent (${outcome.source})` : `cap reading skipped (${outcome.skipped})`);
  } catch (error) {
    if (error === LOCK_LOST) throw error;
    process.stderr.write(`usage-tick: cap reading skipped (${error && error.name})\n`);
  }
}

// The background run (`--run`): no gate, one at a time. Returns { skipped } or { sent, failed }.
export async function runTick({ env = process.env, now = Date.now(), taskRoot = stateRoot(env), options = {}, listFiles = listRecordFiles, lockClock = Date.now, capClock = Date.now, force = false, retryAttempts = LOCK_RETRY_ATTEMPTS, retryDelayMs = LOCK_RETRY_DELAY_MS } = {}) {
  const config = resolveConfig(env);
  if (!config) return { skipped: 'no token' };
  const claudeDir = claudeDirOf(env);
  const stateDir = stateRoot(env);
  const lockPath = join(stateDir, LOCK_FILE);
  const token = await acquireLockWithRetry(lockPath, lockClock, { force, retryAttempts, retryDelayMs });
  if (!token) return { skipped: 'locked' };
  const touch = () => {
    if (!refreshLock(lockPath, token, lockClock())) throw LOCK_LOST;
  };
  try {
    if (!reportUsageEnabled(env)) return await runHeartbeatsOnly({ config, env, now, taskRoot, options, statePath: join(stateDir, STATE_FILE), listFiles, touch });
    const tally = await runLockedOrSkip({ config, env, now, taskRoot, options, listFiles, touch, statePath: join(stateDir, STATE_FILE) });
    if (readPlanCapEnabled(env)) await runCapReading({ config, claudeDir, stateDir, clock: capClock, touch, options });
    else logDebug('cap reading off (option read_plan_cap)');
    return tally;
  } catch (error) {
    if (error === LOCK_LOST) return { skipped: 'lock lost' };
    throw error;
  } finally {
    releaseLock(lockPath, token);
  }
}

// The reason a run was skipped: the error's name on stderr, and (the background run's stderr goes nowhere) the name and
// the first line of its message in `usage-tick.log` in the state folder, the last one only. Never throws.
function logSkipped(error) {
  process.stderr.write(`usage-tick: skipped (${error && error.name})\n`);
  try {
    const root = stateRoot();
    mkdirSync(root, { recursive: true });
    const message = String((error && error.message) || '').split('\n')[0].slice(0, 200);
    writeFileSync(join(root, LOG_FILE), `${new Date().toISOString()} ${error && error.name}: ${message}\n`);
  } catch { /* fails open */ }
}

// A script path that cannot be resolved counts as not invoked directly: the import must never throw.
function isInvokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const invokedDirectly = isInvokedDirectly();
if (invokedDirectly) {
  const background = process.argv.includes(RUN_FLAG);
  Promise.resolve()
    .then(() => (background ? runTick({ force: process.argv.includes(FORCE_FLAG) }) : requestTick({ force: process.argv.includes(FORCE_FLAG) })))
    .catch(logSkipped)
    .finally(() => process.exit(0));
}
