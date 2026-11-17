/* global structuredClone, Buffer */
// Running token totals per agent and model, read from Claude Code's own session records
// (Slice 11 part A). Pure file reading: no network, no board. usage-tick.mjs sends the totals.
//
// Layout under the projects folder:
//   <project>/<session>.jsonl                          the main session
//   <project>/<session>/subagents/agent-<id>.jsonl     a helper (+ agent-<id>.meta.json)
// Each assistant line holds message.model and message.usage with the four token kinds.
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const MAIN_KIND = 'main';
const DEFAULT_HELPER_KIND = 'agent';
const SUBAGENT_DIR = 'subagents';
const SESSION_EXT = '.jsonl';
const HELPER_PREFIX = 'agent-';
const META_EXT = '.meta.json';
const ASSISTANT_TYPE = 'assistant';
const NEWLINE = 0x0a;
const RECENT_IDS = 50;
const CHUNK_BYTES = 1024 * 1024; // one read of a record file; the lock is refreshed between reads
export const TAIL_BYTES = 64;

export function emptyTotals() {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, recordAt: '', sentRecordAt: '', attemptedRecordAt: '', sentSignature: '' };
}

export function emptyFileState() {
  return { offset: 0, tail: '', cwd: '', models: {}, recent: [] };
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// One record line -> { model, at, cwd, usage } or null when it is not an assistant message with usage.
export function parseUsageLine(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  const message = record && record.message;
  if (!record || record.type !== ASSISTANT_TYPE || !message || !message.usage) return null;
  if (typeof message.model !== 'string' || !message.model || message.model.startsWith('<')) return null;
  return {
    model: message.model,
    id: typeof message.id === 'string' ? message.id : '',
    at: typeof record.timestamp === 'string' ? record.timestamp : '',
    cwd: typeof record.cwd === 'string' ? record.cwd : '',
    usage: message.usage,
  };
}

function usageCounts(usage) {
  return [
    count(usage.input_tokens),
    count(usage.cache_creation_input_tokens),
    count(usage.cache_read_input_tokens),
    count(usage.output_tokens),
  ];
}

// Claude Code writes one message on several lines (one per content block), each with the same
// id and usage. The most recent ids are kept in the state so a message split across two scans is
// counted once; a repeat with larger numbers adds only the difference (the larger value counts).
function takeNewCounts(state, parsed) {
  const counts = usageCounts(parsed.usage);
  if (!parsed.id) return counts;
  const seen = state.recent.find((entry) => entry.id === parsed.id && entry.model === parsed.model);
  if (!seen) {
    state.recent.push({ id: parsed.id, model: parsed.model, counts });
    if (state.recent.length > RECENT_IDS) state.recent.shift();
    return counts;
  }
  const extra = counts.map((value, index) => Math.max(0, value - seen.counts[index]));
  seen.counts = seen.counts.map((value, index) => Math.max(value, counts[index]));
  return extra;
}

function addRecord(state, parsed) {
  const totals = state.models[parsed.model] || emptyTotals();
  const [input, cacheWrite, cacheRead, output] = takeNewCounts(state, parsed);
  totals.input += input;
  totals.cacheWrite += cacheWrite;
  totals.cacheRead += cacheRead;
  totals.output += output;
  if (parsed.at > totals.recordAt) totals.recordAt = parsed.at;
  state.models[parsed.model] = totals;
  if (!state.cwd && parsed.cwd) state.cwd = parsed.cwd;
}

function readFrom(path, offset, size) {
  const buffer = Buffer.alloc(size - offset);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(handle);
  }
  return buffer;
}

function tailHex(path, offset) {
  return readFrom(path, Math.max(0, offset - TAIL_BYTES), offset).toString('hex');
}

// True when the file still starts with what was read before: it is at least as long as the saved
// offset and the 64 bytes before that offset are unchanged. A file never read (offset 0) continues.
function continuesPrevious(path, previous, size) {
  if (previous.offset === 0) return true;
  if (size < previous.offset) return false;
  return tailHex(path, previous.offset) === previous.tail;
}

// Counts a line when no "since" time is set, or when the line's own time is after it.
function isCounted(parsed, sinceMs) {
  return !sinceMs || Date.parse(parsed.at) > sinceMs;
}

// Reads only the new complete lines of one record file and returns the updated state (the given
// state is not changed). A half-written last line is left for the next scan. A file whose last 64
// bytes before the saved offset changed, or that got shorter, was rewritten and is read from zero.
// options.sinceMs: for a file read from zero (first seen or rewritten) only lines whose own time
// is after it count, so a copied history is never counted. Throws only on a file error.
export function scanFile(path, previous = emptyFileState(), options = {}) {
  const size = statSync(path).size;
  const state = continuesPrevious(path, previous, size) ? structuredClone(previous) : emptyFileState();
  state.recent = state.recent || [];
  if (size === state.offset) return state;
  const sinceMs = state.offset === 0 ? options.sinceMs : 0;
  const touch = options.touch || (() => {});
  let chunkSize = CHUNK_BYTES;
  while (state.offset < size) {
    const buffer = readFrom(path, state.offset, Math.min(size, state.offset + chunkSize));
    const end = buffer.lastIndexOf(NEWLINE) + 1;
    if (end === 0) {
      if (state.offset + buffer.length >= size) break; // a half-written last line: left for the next scan
      chunkSize *= 2; // one line longer than the chunk: read more
      continue;
    }
    chunkSize = CHUNK_BYTES;
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      const parsed = line ? parseUsageLine(line) : null;
      if (parsed && isCounted(parsed, sinceMs)) addRecord(state, parsed);
    }
    state.offset += end;
    touch();
  }
  state.tail = tailHex(path, state.offset);
  return state;
}

// The helper's agent type from its meta file, or '' when the meta file is missing or unreadable.
function readMetaType(helperPath) {
  try {
    const meta = JSON.parse(readFileSync(helperPath.slice(0, -SESSION_EXT.length) + META_EXT, 'utf8'));
    return typeof meta.agentType === 'string' && meta.agentType ? meta.agentType : DEFAULT_HELPER_KIND;
  } catch {
    return '';
  }
}

function readAgentType(helperPath) {
  return readMetaType(helperPath) || DEFAULT_HELPER_KIND;
}

// The kind as read from the file's meta file ('' when there is none yet); a main file is always MAIN_KIND.
export function metaKindOf(file) {
  return file.helperId ? readMetaType(file.path) : MAIN_KIND;
}

function safeList(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// The agent type of a helper file (its .meta.json), or MAIN_KIND for a main session file. Reads
// the meta file, so a caller asks only for files it will scan.
export function agentKindOf(file) {
  return file.helperId ? readAgentType(file.path) : MAIN_KIND;
}

function listHelpers(projectDir, sessionId, withKinds) {
  const dir = join(projectDir, sessionId, SUBAGENT_DIR);
  return safeList(dir)
    .filter((entry) => entry.isFile() && entry.name.startsWith(HELPER_PREFIX) && entry.name.endsWith(SESSION_EXT))
    .map((entry) => ({
      path: join(dir, entry.name),
      folder: basename(projectDir),
      sessionId,
      helperId: entry.name.slice(HELPER_PREFIX.length, -SESSION_EXT.length),
      kind: withKinds ? readAgentType(join(dir, entry.name)) : '',
    }));
}

function listProject(projectDir, withKinds) {
  const found = [];
  for (const entry of safeList(projectDir)) {
    if (!entry.isFile() || !entry.name.endsWith(SESSION_EXT)) continue;
    const sessionId = basename(entry.name, SESSION_EXT);
    found.push({ path: join(projectDir, entry.name), folder: basename(projectDir), sessionId, helperId: '', kind: MAIN_KIND });
    found.push(...listHelpers(projectDir, sessionId, withKinds));
  }
  return found;
}

// Every main-session and helper record file under a projects folder. withKinds false leaves a
// helper's kind empty (no meta file is read; use agentKindOf for the files that are scanned).
export function listRecordFiles(projectsDir, { withKinds = true } = {}) {
  const found = [];
  for (const entry of safeList(projectsDir)) {
    if (entry.isDirectory()) found.push(...listProject(join(projectsDir, entry.name), withKinds));
  }
  return found;
}
