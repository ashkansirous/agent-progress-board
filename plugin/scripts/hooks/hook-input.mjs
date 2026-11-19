/* global process */
// Shared by the board hooks: read the hook's stdin JSON, build keys and keep the small per-session files.
// A hook must be fast and fail open, so every helper here swallows errors.
// Files live in the state folder (report-progress.mjs stateRoot): `<id>` (waiting marker), `<id>.goal.json`
// (the session's own card), `<id>.prompt.json` (the reminder's prompt counter) and `<id>.seen` (last activity).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { SENDER_LOG_LINES, logSender, projectSlug, resolveConfig, safeId, sendCardReport, stateRoot } from '../report-progress.mjs';

// The sender log and the one call that logs a card report live in report-progress.mjs (the CLI uses them too).
export { SENDER_LOG_LINES, logSender, safeId, sendCardReport };

export const HOOK_TIMEOUT_MS = 2000;
export const HOOK_SOURCE = 'hook';
export const SESSION_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // a file older than this belongs to a session that ended
export const CLOSED_BY = { stop: 'stop', session: 'session' };
export const CARD_KIND = { task: 'task', slice: 'slice' };
const GOAL_SUFFIX = '.goal.json';
const PROMPT_SUFFIX = '.prompt.json';
const SEEN_SUFFIX = '.seen';
const STOPPED_SUFFIX = '.stopped';

export function parseInput(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// '' when stdin is empty. A read error is also '' but says so on stderr, so a launcher that gives
// a non-blocking pipe does not look the same as "no session id".
export function readStdinText(reader = () => readFileSync(0, 'utf8')) {
  try {
    return reader();
  } catch (error) {
    process.stderr.write(`report-progress hook: stdin unreadable (${error && error.code ? error.code : 'error'})\n`);
    return '';
  }
}

export function sessionIdOf(input) {
  return input && typeof input.session_id === 'string' ? input.session_id.trim() : '';
}

function sessionFile(id, suffix, root) {
  const safe = safeId(id);
  return safe ? join(root, `${safe}${suffix}`) : '';
}

// Written to a temp file of its own, then renamed over the target, so a reader never sees half a file and two
// writers never share a temp file.
// On Windows a rename fails with EPERM/EBUSY/EACCES while another hook holds the target, so it is retried a few times
// with a short synchronous pause (about 100 ms in all) before the write is given up.
const RENAME_BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_PAUSES_MS = [10, 20, 30, 40];

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(temp, file, rename) {
  for (const pause of RENAME_PAUSES_MS) {
    try {
      rename(temp, file);
      return;
    } catch (error) {
      if (!RENAME_BUSY.has(error && error.code)) throw error;
      pauseSync(pause);
    }
  }
  rename(temp, file);
}

// A temp file left by a process that was killed between its write and its rename is removed by the next write of the
// same file once it is this old.
const STALE_TEMP_MS = 10 * 60 * 1000;

// A hook is one short process, so each file's temps are swept once per process, on its first write: later writes of the
// same file skip the directory listing. One temp file that cannot be read (already gone, held) never ends the sweep.
const sweptFiles = new Set();

function removeStaleTemps(file) {
  const dir = dirname(file);
  if (sweptFiles.has(file)) return;
  sweptFiles.add(file);
  try {
    const prefix = `${basename(file)}.`;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      removeIfStale(join(dir, name));
    }
  } catch { /* the next process retries */ }
}

function removeIfStale(path) {
  try {
    if (Date.now() - statSync(path).mtimeMs > STALE_TEMP_MS) removeFile(path);
  } catch { /* gone or unreadable: the next process retries */ }
}

export function writeJson(file, value, rename = renameSync) {
  if (!file) return;
  const temp = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temp, JSON.stringify(value));
    renameWithRetry(temp, file, rename);
    removeStaleTemps(file);
  } catch {
    removeFile(temp); /* fail open: the session is then judged by the board's own rules */
  }
}

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function removeFile(file) {
  if (!file) return;
  try {
    rmSync(file, { force: true });
  } catch { /* the next call retries */ }
}

// The JSON of a state file, or null. A file older than SESSION_FILE_MAX_AGE_MS belongs to a session
// that ended: it is ignored and removed, so a reused id starts clean.
function readFreshJson(file, now, onStale = () => {}) {
  if (!file) return null;
  try {
    if (now - statSync(file).mtimeMs > SESSION_FILE_MAX_AGE_MS) {
      removeFile(file);
      onStale();
      return null;
    }
    return readJson(file);
  } catch {
    return null;
  }
}

// The waiting item's key. `ask_human` refuses an existing key of another type, so it must never equal the session
// card's key (`<project>/session-<id>`, which the board's rules give the session's own card).
export function sessionKeyOf(project, id) {
  return `${project}/waiting-${id}`;
}

// null when the hook has nothing to report (no session id, or no board address and token).
export function sessionContext(input, env) {
  const id = sessionIdOf(input);
  const config = resolveConfig(env);
  if (!id || !config) return null;
  const project = projectSlug(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd(), env);
  return { config, project, key: sessionKeyOf(project, id), id };
}

// One small file per session that raised a waiting item, so Stop and SubagentStop can skip
// (no git, no network) in every session that never waited. It holds the item's key, so a later run in
// another session can close it when this one died.
export function writeMarker(input, key, root, kind = '') {
  const file = sessionFile(sessionIdOf(input), '', root);
  writeJson(file, kind ? { key, kind } : { key });
}

// The notification type stored in the session's marker (what the open card was raised for), '' when none.
export function readMarkerKind(input, root) {
  const value = readJson(sessionFile(sessionIdOf(input), '', root));
  return value && typeof value.kind === 'string' ? value.kind : '';
}

// The key stored in the session's marker, or '' when there is no marker (or it holds no key).
export function readMarkerKey(input, root) {
  const value = readJson(sessionFile(sessionIdOf(input), '', root));
  return value && typeof value.key === 'string' ? value.key : '';
}

// How long a stopped agent's file is kept: longer than background-agents AGENT_FRESH_MS (10 min) plus its resume slack,
// so an agent whose last write came after its stop is never listed without its stop time.
const STOPPED_KEEP_MS = 12 * 60 * 1000;
const STOPPED_WRITE_TRIES = 4; // the first write and up to three more, each repairing one removed-folder race

// The stopped agents of a session: one small file per agent in `<id>.stopped/` holding `{ id, at }`. Parallel
// SubagentStop hooks each write only their own file (temp, then rename), so none can lose another's stop and no
// lock is needed.
function stoppedDir(id, root) {
  return sessionFile(id, STOPPED_SUFFIX, root);
}

// The file name is a hash of the whole agent id, so two ids that differ only in characters safeId would replace
// cannot share a file; the id itself is kept inside the file.
function stoppedFile(id, agentId, root) {
  const dir = stoppedDir(id, root);
  if (!dir || typeof agentId !== 'string' || !agentId) return '';
  return join(dir, `${createHash('sha256').update(agentId).digest('hex').slice(0, 32)}.json`);
}

// The session's stopped-agents folder goes with the rest of its state files.
function removeStoppedFolder(id, root) {
  const dir = stoppedDir(id, root);
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* the next call retries */ }
}

function stoppedEntries(id, root) {
  const dir = stoppedDir(id, root);
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ file: join(dir, name), value: readJson(join(dir, name)) }))
      .filter(({ value }) => value && typeof value.id === 'string' && Number.isFinite(value.at));
  } catch {
    return [];
  }
}

// `{ agentId: stoppedAtMs }` of the agents whose SubagentStop ran and that were not resumed since, so a later Stop
// counts them done even when their meta file does not say `finished`.
export function readStoppedAt(id, root) {
  return Object.fromEntries(stoppedEntries(id, root).map(({ value }) => [value.id, value.at]));
}

// A resumed agent: only its own file goes. A file already gone is fine.
export function removeStoppedAgent(id, agentId, root) {
  removeFile(stoppedFile(id, agentId, root));
  try {
    rmdirSync(stoppedDir(id, root)); // only an empty folder goes; one with other agents' files stays
  } catch { /* not empty, or already gone */ }
}

// Records the stop time of an agent (a resumed agent that stops again gets a new time) and deletes the files older
// than STOPPED_KEEP_MS, one by one, so the folder stays small.
export function addStoppedAgent(id, agentId, root, now = Date.now(), write = writeJson) {
  const file = stoppedFile(id, agentId, root);
  if (!file) return;
  // A concurrent removeStoppedAgent may remove the empty folder between mkdir and the temp file's write, once per
  // resumed agent: the first write is unconditional (a second stop of the same agent id updates `at`), then write
  // again only while the file is missing, up to STOPPED_WRITE_TRIES times in all.
  write(file, { id: agentId, at: now });
  for (let attempt = 1; attempt < STOPPED_WRITE_TRIES && !existsSync(file); attempt += 1) write(file, { id: agentId, at: now });
  for (const entry of stoppedEntries(id, root)) {
    if (now - entry.value.at > STOPPED_KEEP_MS) removeFile(entry.file);
  }
}

export function hasMarker(input, root) {
  const file = sessionFile(sessionIdOf(input), '', root);
  return Boolean(file) && existsSync(file);
}

export function removeMarker(input, root) {
  removeFile(sessionFile(sessionIdOf(input), '', root));
}

// Markers of every session on this machine: [{ id, key, file, atMs }]. A marker is a file with no dot in its name.
export function listMarkers(root) {
  try {
    return readdirSync(root)
      .filter((name) => name && !name.includes('.'))
      .map((name) => {
        const file = join(root, name);
        const found = statSync(file);
        const value = found.isFile() ? readJson(file) : null;
        return value && typeof value.key === 'string' ? { id: name, key: value.key, file, atMs: found.mtimeMs } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Notes that the session did something (a prompt, a tool call, a hook): a waiting card of a session that
// stays silent is judged by this time.
export function touchSeen(id, root, now = Date.now()) {
  writeJson(sessionFile(id, SEEN_SUFFIX, root), { at: now });
}

// The time the session was last seen, or 0.
export function readSeen(id, root) {
  try {
    return statSync(sessionFile(id, SEEN_SUFFIX, root)).mtimeMs;
  } catch {
    return 0;
  }
}

// The session's own card, as its MCP reports left it (`<id>.goal.json`): `{ at, goalAt, key, project, title, why,
// steps: [{ label, state, note? }], closed, sig }`. `at` is the time of the last write; `goalAt` the time of the
// last report that carried a title, which is the only one the reminder counts; `closed` is set when the card was
// finished and `closedBy` says who ('stop' for the Stop hook, 'session' for the session's own done), so only a
// Stop-closed card is reopened; `needsYou` is the open question the session sent, which every hook report repeats; `sig` is the list the hooks last sent, so an unchanged list
// is not sent twice; `held` is set when Stop left the card open for running background agents, so the last agent's
// SubagentStop closes it unless the main transcript changed after `heldAt` (the time Stop held the card).
export function writeGoal(id, goal, root, now = Date.now()) {
  const stored = { ...goal };
  delete stored.slice; // derived from `kind` at read (readGoal), never stored
  writeJson(sessionFile(id, GOAL_SUFFIX, root), { at: now, goalAt: now, ...stored });
}

// Read, change and write the goal file with no lock: the file is read again right before the write and written
// temp-then-rename, so the window for a lost update is the few milliseconds of `change`, which never waits on the
// network. `change(current)` gets the file's content (null when the file is gone) and returns the goal to write, or
// null to write nothing, so a removed file is never brought back by a caller that returns null for it. `at` never
// moves back.
export function updateGoal(id, root, now, change) {
  const current = readGoal(id, root, now);
  const next = change(current);
  if (!next) return;
  const wanted = Number.isFinite(next.at) ? next.at : now;
  writeGoal(id, { ...next, at: Math.max(wanted, current ? current.at : 0) }, root, now);
}

function goalSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((step) => step && typeof step.label === 'string' && typeof step.state === 'string');
}

// The goal file's content, or null. A goal whose own goalAt is older than SESSION_FILE_MAX_AGE_MS no longer
// counts, however often the file was rewritten.
export function readGoal(id, root, now = Date.now()) {
  const value = readFreshJson(sessionFile(id, GOAL_SUFFIX, root), now, () => removeStoppedFolder(id, root)); // the goal file aged out: its stop files go with it
  if (!value || !Number.isFinite(value.at)) return null;
  const goalAt = Number.isFinite(value.goalAt) ? value.goalAt : value.at;
  if (now - goalAt > SESSION_FILE_MAX_AGE_MS) {
    removeStoppedFolder(id, root); // the session ended: its stop files go with it
    return null;
  }
  const text = (field) => (typeof field === 'string' ? field : '');
  return {
    at: value.at,
    goalAt,
    key: text(value.key),
    project: text(value.project),
    title: text(value.title),
    why: text(value.why),
    steps: goalSteps(value.steps),
    closed: value.closed === true,
    closedBy: value.closedBy === CLOSED_BY.stop || value.closedBy === CLOSED_BY.session ? value.closedBy : '',
    closedAt: Number.isFinite(value.closedAt) ? value.closedAt : 0,
    closing: Number.isFinite(value.closing) ? value.closing : 0, // when a close call started and has not returned (session-done.mjs)
    needsYou: text(value.needsYou),
    sig: text(value.sig),
    kind: cardKindOf(value), // 'task' or 'slice': a slice card's status is doc sync's, so session-done never closes it
    slice: cardKindOf(value) === CARD_KIND.slice,
    orchClose: orchCloseOf(value),
    held: value.held === true,
    heldAt:Number.isFinite(value.heldAt) ? value.heldAt : 0,
    agentParents: parentsOf(value.agentParents),
    agentStarts: startsOf(value.agentStarts),
  };
}

// The one close attempt made for an orchestrator's card: `{ key, outcome }`, or null when none was made.
export const ORCH_CLOSE = { sent: 'sent', failed: 'failed' };
function orchCloseOf(value) {
  const found = value.orchClose;
  if (!found || typeof found.key !== 'string' || !Object.values(ORCH_CLOSE).includes(found.outcome)) return null;
  return { key: found.key, outcome: found.outcome };
}

// The kind a goal file holds; an older file with only `slice: true` is a slice card.
function cardKindOf(value) {
  if (value.kind === CARD_KIND.slice || value.kind === CARD_KIND.task) return value.kind;
  return value.slice === true ? CARD_KIND.slice : CARD_KIND.task;
}

// `{ agentId: ms }`: when each background agent's start was recorded (SubagentStart), so an agent with no files yet
// keeps its row for a bounded time only.
function startsOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, at]) => Number.isFinite(at)));
}

// `{ agentId: address }`: the address of the step each background agent was placed under when it was first seen ('' =
// the root; `id:<step id>` or `label:<label>`, see `stepKey` in background-agents.mjs), kept so a later report puts the
// agent in the same place (placeAgents).
function parentsOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, label]) => typeof label === 'string'));
}

export function removeGoal(id, root) {
  removeFile(sessionFile(id, GOAL_SUFFIX, root));
  removeStoppedFolder(id, root);
}

// `{ at, tools, reminded }` of the session's current prompt, kept by the reminder hook.
export function writePrompt(id, prompt, root) {
  writeJson(sessionFile(id, PROMPT_SUFFIX, root), prompt);
}

export function readPrompt(id, root, now = Date.now()) {
  const value = readFreshJson(sessionFile(id, PROMPT_SUFFIX, root), now);
  if (!value || !Number.isFinite(value.at)) return null;
  return { at: value.at, tools: Number(value.tools) || 0, reminded: Boolean(value.reminded) };
}

export function clip(text, limit) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export { stateRoot };
