/* global process */
// What a finished step cost (Slice 54): models, tokens by kind and the peak context, worked out from the session's transcript.
// - The transcript is read only from the offset kept for it (`<id>.cost-<hash>.json` in the state folder), and only when a step
//   ends or an agent stops (task-steps.mjs, session-done.mjs), never on every hook. Streamed assistant lines of one request share
//   a `message.id`: they are merged by it (each token kind keeps its largest value), so a request counts once.
// - A request goes to the innermost step open at its time for its agent id (the latest start); a subagent request with no
//   open step of its own goes to the main thread's step open then. The request whose tool call opens a task (TaskUpdate
//   in_progress) belongs to that task, whatever its clock says. What fits no step is the "outside any step" bucket.
// - Only a finished task (a start and an end seen by the hooks) gets a cost. The result is written whole to `<id>.costs.json`
//   (recomputed from the transcript state, so a lost write is repaired by the next one); `withCosts` puts it on the steps:
//   on a mirrored task row, on a reported step the task matches by label (with the task's observed times, so the board shows
//   it), and on a finished agent's row (the agent's whole transcript, timed by its observed start and stop).
// - A transcript state keeps per-step aggregates for the requests it has settled and, as a window, only the newest requests
//   (the last HOLD_MS of transcript time, where a streamed line may still add to a request): its size does not grow with the session.
// - Read, compute and write run under one create-exclusive lock file per session (`<id>.cost.lock`): a hook that cannot get it
//   within LOCK_WAIT_MS skips its cost (fail open); the offset only moves under the lock, so the next hook carries it.
// Local files only, never prints, fails open (every error leaves the costs as they were).
import { Buffer } from 'node:buffer';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { STEP_LABEL_MAX, safeId, stateRoot } from './report-progress.mjs';
import { COST_LOCK_SUFFIX, COST_STATE_INFIX, COST_SUFFIX, readGoal, readStoppedAt, readTasks, writeJson } from './hooks/hook-input.mjs';
import { sameLabel } from './hooks/task-steps.mjs';
import { TASK_ID_PREFIX, agentRowId, taskRowId } from './hooks/background-agents.mjs';

export { COST_SUFFIX };
const STATE_INFIX = COST_STATE_INFIX;
const OBSERVED = 'observed';
const DONE = 'done';
const READ_MAX_BYTES = 16 * 1024 * 1024; // one call reads at most this much new transcript; the rest comes on the next call
const REQUESTS_MAX = 20000; // requests kept unsettled per transcript; the oldest are settled beyond it, never dropped
const HOLD_MS = 2 * 60 * 1000; // a request newer than the transcript's latest line by less than this may still be streamed to: it stays in the window
const LOCK_WAIT_MS = 500; // how long a hook waits for the session's cost lock before it skips its cost
const LOCK_STALE_MS = 15 * 1000; // a lock older than this belongs to a hook that died: every hook that takes it is killed after 5 s (plugin/hooks/hooks.json)
const LOCK_RETRY_MS = 25;
const MODELS_MAX = 20; // the board's limit of models in one cost
const MODEL_NAME_MAX = 120; // the board's limit of one model name: a longer one is cut here so the board never drops the cost
const WRITER_HASH_LENGTH = 16;

// The cost's `writer`: an opaque short hash of the session id, so the board never holds the raw id (same value in the row and in cost_ref).
export function writerOf(sessionId) {
  return createHash('sha256').update(String(sessionId)).digest('hex').slice(0, WRITER_HASH_LENGTH);
}
const TASK_UPDATE = 'TaskUpdate';
const IN_PROGRESS = 'in_progress';
const SYNTHETIC_MODEL = '<synthetic>';

const toMs = (value) => (typeof value === 'string' ? Date.parse(value) : NaN);
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

// The task ids a request's tool calls start (TaskUpdate with status in_progress).
function opensOf(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && block.type === 'tool_use' && block.name === TASK_UPDATE && block.input && block.input.status === IN_PROGRESS)
    .map((block) => String(block.input.taskId || block.input.task_id || ''))
    .filter(Boolean);
}

// One transcript line as a request update, a compaction, or null (any other line, or one that does not parse).
export function parseLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (!entry || typeof entry !== 'object') return null;
  if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
    const at = toMs(entry.timestamp);
    return Number.isFinite(at) ? { kind: 'compaction', at } : null;
  }
  const message = entry.message;
  const usage = message && message.usage;
  if (entry.type !== 'assistant' || !message || !usage || typeof message.id !== 'string' || !message.model || message.model === SYNTHETIC_MODEL) return null;
  const at = toMs(entry.timestamp);
  if (!Number.isFinite(at)) return null;
  return {
    kind: 'request',
    id: message.id,
    at,
    model: String(message.model).slice(0, MODEL_NAME_MAX),
    input: count(usage.input_tokens),
    read: count(usage.cache_read_input_tokens),
    write: count(usage.cache_creation_input_tokens),
    output: count(usage.output_tokens),
    opens: opensOf(message.content),
  };
}

// The same request seen again (a later streamed line): the earliest time, the largest of each token kind, every task it opens.
export function mergeRequest(known, update) {
  if (!known) return { at: update.at, model: update.model, input: update.input, read: update.read, write: update.write, output: update.output, opens: update.opens };
  return {
    at: Math.min(known.at, update.at),
    model: update.model,
    input: Math.max(known.input, update.input),
    read: Math.max(known.read, update.read),
    write: Math.max(known.write, update.write),
    output: Math.max(known.output, update.output),
    opens: [...new Set([...known.opens, ...update.opens])],
  };
}

const NEWLINE = 0x0a;

// The state with the lines of `text` (no trailing newline) applied: requests merged by id, compactions listed.
function withLines(state, text, offset) {
  const requests = { ...state.requests };
  const compactions = [...state.compactions];
  for (const line of text.split('\n')) {
    const parsed = line ? parseLine(line) : null;
    if (!parsed) continue;
    if (parsed.kind === 'compaction') compactions.push(parsed.at);
    else requests[parsed.id] = mergeRequest(requests[parsed.id], parsed);
  }
  return { ...state, offset, requests, compactions };
}

// New transcript bytes (read from the state's offset, at most `limit`) applied to a transcript state `{ offset, requests, compactions }`;
// returns the new state. The offset moves by raw bytes to the byte after the last 0x0A, so invalid UTF-8 never drifts it, and each complete
// line is decoded on its own. A half-written last line waits for the next call. A line longer than `limit` fills the whole read with no
// newline: it is skipped whole (the offset moves past it, `skipping` until its newline is found, `skipped` counts it), never stalls the offset.
export function applyBytes(state, buffer, limit = READ_MAX_BYTES) {
  let from = 0;
  if (state.skipping) {
    const newline = buffer.indexOf(NEWLINE);
    if (newline < 0) return buffer.length >= limit ? { ...state, offset: state.offset + buffer.length } : state;
    from = newline + 1;
  }
  const end = buffer.lastIndexOf(NEWLINE);
  if (end < from) {
    const base = { ...state, offset: state.offset + from, skipping: false };
    if (from === 0 && buffer.length >= limit) return { ...base, offset: state.offset + buffer.length, skipping: true, skipped: (state.skipped || 0) + 1 };
    return from > 0 ? base : state;
  }
  return { ...withLines(state, buffer.subarray(from, end).toString('utf8'), state.offset + end + 1), skipping: false };
}

// The same, for text (tests and callers that hold a string).
export function applyText(state, text) {
  return applyBytes(state, Buffer.from(text, 'utf8'));
}

// The bytes of `path` from `offset` (at most `limit`), and whether the file is shorter than the offset (rewritten: start over).
function readFrom(path, offset, limit) {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    if (size < offset) return { buffer: Buffer.alloc(0), restart: true };
    const length = Math.min(size - offset, limit);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return { buffer, restart: false };
  } finally {
    closeSync(fd);
  }
}

const emptyState = (path, agent) => ({ path, agent, offset: 0, requests: {}, compactions: [], settled: emptySettled(), skipping: false, skipped: 0 });

// The transcript state after reading what `path` gained since the state's offset.
export function syncState(state, path, limit = READ_MAX_BYTES) {
  const { buffer, restart } = readFrom(path, state.offset, limit);
  if (restart) return syncState(emptyState(path, state.agent), path, limit);
  return applyBytes(state, buffer, limit);
}

function stateFile(id, path, root) {
  const safe = safeId(id);
  return safe ? join(root, `${safe}${STATE_INFIX}${createHash('sha256').update(path).digest('hex').slice(0, 16)}.json`) : '';
}

function readJsonFile(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function settledOf(value) {
  const ok = isObject(value) && isObject(value.tasks) && isObject(value.outside) && isObject(value.total);
  return ok ? value : emptySettled();
}

function stateOf(value, path, agent) {
  const ok = value && value.path === path && Number.isFinite(value.offset) && isObject(value.requests) && Array.isArray(value.compactions);
  return ok
    ? { path, agent, offset: value.offset, requests: value.requests, compactions: value.compactions, settled: settledOf(value.settled), skipping: value.skipping === true, skipped: count(value.skipped) }
    : emptyState(path, agent);
}

// Every transcript state of the session, read from the state folder.
function readStates(id, root) {
  const safe = safeId(id);
  if (!safe || !existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith(`${safe}${STATE_INFIX}`) && name.endsWith('.json'))
    .map((name) => readJsonFile(join(root, name)))
    .filter((value) => value && typeof value.path === 'string')
    .map((value) => stateOf(value, value.path, typeof value.agent === 'string' ? value.agent : ''));
}

// The task a request or compaction at `at` belongs to, for an agent: the latest-started task of that agent open then; a
// subagent with none open of its own falls back to the main thread's.
function taskAt(tasks, agent, at) {
  const open = (owner) => tasks.filter((task) => task.agentId === owner && task.startedAt && task.startedAt <= at && (!task.doneAt || at <= task.doneAt));
  const own = open(agent).sort((left, right) => right.startedAt - left.startedAt)[0];
  if (own || !agent) return own || null;
  return open('').sort((left, right) => right.startedAt - left.startedAt)[0] || null;
}

// A bucket is plain data (it is stored in the transcript state): the tokens by model, the largest request and the counts.
function emptyBucket() {
  return { models: {}, peak: 0, compactions: 0, requests: 0 };
}

function emptySettled() {
  return { tasks: {}, outside: emptyBucket(), total: emptyBucket() };
}

const emptyRow = (model) => ({ model, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });

function addToRow(row, from) {
  row.input_tokens += from.input_tokens;
  row.cache_read_tokens += from.cache_read_tokens;
  row.cache_write_tokens += from.cache_write_tokens;
  row.output_tokens += from.output_tokens;
}

function addRequest(bucket, request) {
  const row = bucket.models[request.model] || emptyRow(request.model);
  addToRow(row, { input_tokens: request.input, cache_read_tokens: request.read, cache_write_tokens: request.write, output_tokens: request.output });
  bucket.models[request.model] = row;
  bucket.peak = Math.max(bucket.peak, request.input + request.read + request.write);
  bucket.requests += 1;
}

function mergeBucket(into, from) {
  for (const row of Object.values(from.models || {})) {
    const target = into.models[row.model] || emptyRow(row.model);
    addToRow(target, row);
    into.models[row.model] = target;
  }
  into.peak = Math.max(into.peak, from.peak || 0);
  into.compactions += from.compactions || 0;
  into.requests += from.requests || 0;
}

const bucketIn = (buckets, key) => buckets[key] || (buckets[key] = emptyBucket());

// The task a request belongs to: the task its own tool call opens (the one of its agent first, if two share an id), else the
// innermost task open at its time (`taskAt`); null when it fits none.
function taskOfRequest(request, agent, tasks) {
  const opened = request.opens.flatMap((taskId) => tasks.filter((task) => task.taskId === taskId));
  return opened.find((task) => task.agentId === agent) || opened[0] || taskAt(tasks, agent, request.at);
}

// Moves the requests and compactions that can no longer change out of the state's window into its per-step aggregates:
// those older than the transcript's latest line by HOLD_MS (a streamed line may still add to a newer request), and the oldest
// beyond REQUESTS_MAX. Nothing is dropped: the aggregates carry them, so the state stays small whatever the session's length.
export function settle(state, tasks) {
  const entries = Object.entries(state.requests).sort((left, right) => left[1].at - right[1].at);
  const latest = Math.max(entries.reduce((top, [, request]) => Math.max(top, request.at), 0), state.compactions.reduce((top, at) => Math.max(top, at), 0));
  const cutoff = latest - HOLD_MS;
  const count = Math.max(entries.filter(([, request]) => request.at <= cutoff).length, entries.length - REQUESTS_MAX);
  const settled = JSON.parse(JSON.stringify(settledOf(state.settled)));
  const requests = { ...state.requests };
  for (const [id, request] of entries.slice(0, count)) {
    const task = taskOfRequest(request, state.agent, tasks);
    addRequest(task ? bucketIn(settled.tasks, task.taskId) : settled.outside, request);
    addRequest(settled.total, request);
    delete requests[id];
  }
  const sorted = [...state.compactions].sort((left, right) => left - right);
  const old = Math.max(sorted.filter((at) => at <= cutoff).length, sorted.length - REQUESTS_MAX);
  for (const at of sorted.slice(0, old)) {
    const task = taskAt(tasks, state.agent, at);
    (task ? bucketIn(settled.tasks, task.taskId) : settled.outside).compactions += 1;
    settled.total.compactions += 1;
  }
  return { ...state, requests, compactions: sorted.slice(old), settled };
}

// The measured costs of the session's tasks and agents: `{ costs: { taskId: cost }, agents: { agentId: cost }, outside }`. A cost is
// the board's `cost` object. A state counts as its settled aggregates plus its window, put on the steps as they are now. An agent's
// cost is everything its own transcript holds. `outside` is the bucket of what fitted no step (kept so the totals add up, sent nowhere).
export function computeCosts(states, tasks, writer = '') {
  const buckets = {};
  const agentBuckets = {};
  const outside = emptyBucket();
  for (const state of states) {
    const settled = settledOf(state.settled);
    const total = emptyBucket();
    for (const [taskId, bucket] of Object.entries(settled.tasks)) mergeBucket(bucketIn(buckets, taskId), bucket);
    mergeBucket(outside, settled.outside);
    mergeBucket(total, settled.total);
    for (const request of Object.values(state.requests)) {
      const task = taskOfRequest(request, state.agent, tasks);
      addRequest(task ? bucketIn(buckets, task.taskId) : outside, request);
      addRequest(total, request);
    }
    for (const at of state.compactions) {
      const task = taskAt(tasks, state.agent, at);
      (task ? bucketIn(buckets, task.taskId) : outside).compactions += 1;
      total.compactions += 1;
    }
    if (state.agent) mergeBucket(bucketIn(agentBuckets, state.agent), total);
  }
  const costs = {};
  for (const task of tasks) {
    const bucket = buckets[task.taskId];
    if (!bucket || bucket.requests === 0 || !task.startedAt || !task.doneAt) continue;
    costs[task.taskId] = costOf(task.agentId, bucket, writer);
  }
  const agents = {};
  for (const [agentId, bucket] of Object.entries(agentBuckets)) if (bucket.requests > 0) agents[agentId] = costOf(agentId, bucket, writer);
  return { costs, agents, outside };
}

// The board's `cost` object, minus `seq` (`storeCosts` adds it). `writer` is the session id: it keys the stored row, so one session
// is the only writer of its rows and the board never compares numbers across sessions (Slice 54 Decision 10).
function costOf(agentId, bucket, writer) {
  const models = Object.values(bucket.models).sort((left, right) => left.model.localeCompare(right.model)).slice(0, MODELS_MAX);
  return { ...(agentId ? { agent_id: agentId } : {}), ...(writer ? { writer } : {}), models, peak_context: bucket.peak, compactions: bucket.compactions };
}

function costsFile(id, root) {
  const safe = safeId(id);
  return safe ? join(root, `${safe}${COST_SUFFIX}`) : '';
}

// `{ costs, agents }` last computed for the session (`{ taskId: cost }` and `{ agentId: cost }`); empty maps when none.
function readStored(id, root) {
  const value = readJsonFile(costsFile(id, root));
  return { costs: value && isObject(value.costs) ? value.costs : {}, agents: value && isObject(value.agents) ? value.agents : {} };
}

// `{ taskId: cost }` last computed for the session; {} when none.
export function readCosts(id, root) {
  return readStored(id, root).costs;
}

// The transcripts this hook call names: the main one, and a stopped subagent's own file.
function namedTranscripts(input) {
  const named = [];
  if (typeof input.transcript_path === 'string' && input.transcript_path) named.push({ path: input.transcript_path, agent: '' });
  if (typeof input.agent_transcript_path === 'string' && input.agent_transcript_path && typeof input.agent_id === 'string' && input.agent_id) {
    named.push({ path: input.agent_transcript_path, agent: input.agent_id });
  }
  return named;
}

function syncNamed(input, id, root, tasks) {
  for (const { path, agent } of namedTranscripts(input)) {
    try {
      const file = stateFile(id, path, root);
      const state = settle(syncState(stateOf(readJsonFile(file), path, agent), path), tasks);
      writeJson(file, state);
    } catch { /* an unreadable transcript leaves its state as it was */ }
  }
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockFile(id, root) {
  const safe = safeId(id);
  return safe ? join(root, `${safe}${COST_LOCK_SUFFIX}`) : '';
}

const newToken = () => `${process.pid}-${randomUUID()}`;

// A lock is stale only when its holder is dead (Decision 12): every hook that takes it has a timeout far below LOCK_STALE_MS, so an older
// lock belongs to a killed process. It is stolen by renaming it to a unique name and deleting that: of several hooks that find it stale
// only one rename succeeds, and the others get ENOENT. The moved file is never renamed back (that could overwrite a lock a third hook made).
function stealIfStale(file) {
  try {
    if (Date.now() - statSync(file).mtimeMs <= LOCK_STALE_MS) return;
    const moved = `${file}.stale-${newToken()}`;
    renameSync(file, moved);
    rmSync(moved, { force: true });
  } catch { /* gone already, or another hook won the steal: the next try decides */ }
}

// The token written into the lock file once made (create-exclusive), or '' when another hook still holds it after LOCK_WAIT_MS.
function takeLock(file) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = newToken();
  mkdirSync(dirname(file), { recursive: true });
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, token);
      } finally {
        closeSync(fd);
      }
      return token;
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'EBUSY', 'EACCES'].includes(error && error.code)) return '';
      stealIfStale(file);
    }
    if (Date.now() >= deadline) return '';
    pause(LOCK_RETRY_MS);
  }
}

// Deletes the lock only while it still holds this hook's token: a slow holder never deletes the lock of the hook that stole it.
function releaseLock(file, token) {
  try {
    if (readFileSync(file, 'utf8') === token) rmSync(file, { force: true });
  } catch { /* already gone */ }
}

// Runs `work` while this hook holds the session's cost lock; `fallback` when it could not get it (fail open: the next hook carries the cost).
function underLock(id, root, work, fallback) {
  const file = lockFile(id, root);
  const token = file ? takeLock(file) : '';
  if (!token) return fallback;
  try {
    return work();
  } finally {
    releaseLock(file, token);
  }
}

// Reads what the named transcripts gained, recomputes the session's costs and stores them. True when the stored costs changed.
// Nothing is read for a session with no open card, or with no task and no stopping agent: there is no step to put a cost on.
export function refreshCosts(input, env = process.env, now = Date.now()) {
  try {
    const id = typeof input.session_id === 'string' ? input.session_id.trim() : '';
    const root = stateRoot(env);
    const goal = id ? readGoal(id, root, now) : null;
    const tasks = id ? readTasks(id, root) : [];
    if (!goal || !goal.key || goal.closed) return false;
    if (tasks.length === 0 && !namedTranscripts(input).some((named) => named.agent)) return false;
    return underLock(id, root, () => storeCosts(input, id, root, tasks, now), false);
  } catch {
    return false;
  }
}

const withoutSeq = (cost) => Object.fromEntries(Object.entries(cost).filter(([name]) => name !== 'seq'));

// Each cost with its `seq` (Decision 10): the stored cost's counter when the numbers (tokens, models, peak, compactions) are the same, so a
// Stop that read nothing new rewrites no row; that counter plus one when they changed; a cost not stored before starts from the clock in
// seconds, so a session whose cost files were lost still beats the counter it left on the board.
function sequenced(fresh, stored, now) {
  return Object.fromEntries(Object.entries(fresh).map(([key, cost]) => {
    const before = isObject(stored[key]) ? stored[key] : null;
    const seq = !before || !Number.isFinite(before.seq) ? Math.floor(now / 1000) : JSON.stringify(withoutSeq(before)) === JSON.stringify(cost) ? before.seq : before.seq + 1;
    return [key, { ...cost, seq }];
  }));
}

function storeCosts(input, id, root, tasks, now) {
  syncNamed(input, id, root, tasks);
  const stored = readStored(id, root);
  const fresh = computeCosts(readStates(id, root), tasks, writerOf(id));
  const next = { costs: sequenced(fresh.costs, stored.costs, now), agents: sequenced(fresh.agents, stored.agents, now) };
  if (JSON.stringify(next) === JSON.stringify(stored)) return false;
  writeJson(costsFile(id, root), next);
  return true;
}

function finishedRow(step, task) {
  return step && step.state === DONE && task.doneAt;
}

// The observed times of a finished task, as step fields: the board shows a cost only for times a hook saw, never the server's own clock.
function observedTimes(startedAt, doneAt) {
  return {
    started_at: new Date(startedAt).toISOString(),
    started_source: OBSERVED,
    done_at: new Date(doneAt).toISOString(),
    done_source: OBSERVED,
  };
}

// `{ agentRowId: { agentId, startedAt, doneAt } }` of the agents with a cost and an observed start and stop (ms); an agent
// with no start or no stop seen by the hooks gets no cost on its row.
function agentRows(agents, id, root, now) {
  const goal = readGoal(id, root, now);
  const starts = (goal && goal.agentStarts) || {};
  const stops = readStoppedAt(id, root);
  return Object.fromEntries(Object.keys(agents)
    .filter((agentId) => Number.isFinite(starts[agentId]) && Number.isFinite(stops[agentId]))
    .map((agentId) => [agentRowId(agentId), { agentId, startedAt: starts[agentId], doneAt: stops[agentId] }]));
}

// The steps of a card's list with the measured cost on each finished row: a mirrored task row by the task's id; else the
// top-level step the task matches by label (task-steps.mjs `sameLabel`), id or not, which also gets the task's observed times
// (a label-only step has none, and the board shows no cost for guessed times); a finished agent's row (the agent's whole
// transcript, with its observed start and stop). Never a row that is not done.
export function withCosts(steps, id, root, now = Date.now()) {
  const { costs, agents } = readStored(id, root);
  const tasks = readTasks(id, root).filter((task) => costs[task.taskId]);
  const rows = agentRows(agents, id, root, now);
  if ((tasks.length === 0 && Object.keys(rows).length === 0) || !Array.isArray(steps)) return steps;
  const taskFor = (step, top) => tasks.find((task) => step.id === taskRowId(task.taskId)
    || (top && !String(step.id || '').startsWith(TASK_ID_PREFIX) && sameLabel(String(task.subject).slice(0, STEP_LABEL_MAX), step.label)));
  const costFor = (step, top) => {
    const row = rows[step.id];
    if (row && step.state === DONE) return { cost: agents[row.agentId], ...observedTimes(row.startedAt, row.doneAt) };
    const task = taskFor(step, top);
    if (!task || !finishedRow(step, task)) return null;
    const own = step.id === taskRowId(task.taskId); // a mirrored row has its observed times already
    return { cost: costs[task.taskId], ...(own ? {} : observedTimes(task.startedAt, task.doneAt)) };
  };
  const mark = (level, top) => level.map((step) => {
    const found = costFor(step, top);
    const children = Array.isArray(step.children) ? mark(step.children, false) : null;
    return { ...step, ...(children ? { children } : {}), ...(found || {}) };
  });
  return mark(steps, true);
}
