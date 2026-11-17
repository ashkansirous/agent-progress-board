/* global process */
// Shared by the board hooks: read the hook's stdin JSON, build keys and keep the small per-session files.
// A hook must be fast and fail open, so every helper here swallows errors.
// Files live in the state folder (report-progress.mjs stateRoot): `<id>` (waiting marker), `<id>.goal.json`
// (the session's own card), `<id>.prompt.json` (the reminder's prompt counter) and `<id>.seen` (last activity).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectSlug, resolveConfig, stateRoot } from '../report-progress.mjs';

export const HOOK_TIMEOUT_MS = 2000;
export const HOOK_SOURCE = 'hook';
export const SESSION_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // a file older than this belongs to a session that ended
export const CLOSED_BY = { stop: 'stop', session: 'session' };
const GOAL_SUFFIX = '.goal.json';
const PROMPT_SUFFIX = '.prompt.json';
const SEEN_SUFFIX = '.seen';
const AGENTS_SUFFIX = '.agents.json';

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

export function safeId(id) {
  return String(id || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

export function sessionIdOf(input) {
  return input && typeof input.session_id === 'string' ? input.session_id.trim() : '';
}

function sessionFile(id, suffix, root) {
  const safe = safeId(id);
  return safe ? join(root, `${safe}${suffix}`) : '';
}

function writeJson(file, value) {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  } catch { /* fail open: the session is then judged by the board's own rules */ }
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
function readFreshJson(file, now) {
  if (!file) return null;
  try {
    if (now - statSync(file).mtimeMs > SESSION_FILE_MAX_AGE_MS) {
      removeFile(file);
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
export function writeMarker(input, key, root) {
  const file = sessionFile(sessionIdOf(input), '', root);
  writeJson(file, { key });
}

// The key stored in the session's marker, or '' when there is no marker (or it holds no key).
export function readMarkerKey(input, root) {
  const value = readJson(sessionFile(sessionIdOf(input), '', root));
  return value && typeof value.key === 'string' ? value.key : '';
}

// Ids of the agents whose SubagentStop ran (`<id>.agents.json`), so a later Stop counts them done even when
// their meta file does not say `finished`.
export function readStoppedAgents(id, root, now = Date.now()) {
  const value = readFreshJson(sessionFile(id, AGENTS_SUFFIX, root), now);
  return value && Array.isArray(value.ids) ? value.ids.filter((agentId) => typeof agentId === 'string') : [];
}

export function addStoppedAgent(id, agentId, root, now = Date.now()) {
  if (!agentId) return;
  const ids = readStoppedAgents(id, root, now);
  if (!ids.includes(agentId)) writeJson(sessionFile(id, AGENTS_SUFFIX, root), { ids: [...ids, agentId] });
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
// is not sent twice.
export function writeGoal(id, goal, root, now = Date.now()) {
  writeJson(sessionFile(id, GOAL_SUFFIX, root), { at: now, goalAt: now, ...goal });
}

function goalSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((step) => step && typeof step.label === 'string' && typeof step.state === 'string');
}

// The goal file's content, or null. A goal whose own goalAt is older than SESSION_FILE_MAX_AGE_MS no longer
// counts, however often the file was rewritten.
export function readGoal(id, root, now = Date.now()) {
  const value = readFreshJson(sessionFile(id, GOAL_SUFFIX, root), now);
  if (!value || !Number.isFinite(value.at)) return null;
  const goalAt = Number.isFinite(value.goalAt) ? value.goalAt : value.at;
  if (now - goalAt > SESSION_FILE_MAX_AGE_MS) return null;
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
    needsYou: text(value.needsYou),
    sig: text(value.sig),
  };
}

export function removeGoal(id, root) {
  removeFile(sessionFile(id, GOAL_SUFFIX, root));
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
