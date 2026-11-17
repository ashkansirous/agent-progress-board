#!/usr/bin/env node
/* global process, fetch, AbortSignal */
// Report progress to an agent progress board (an MCP server; client guide: docs/clients.md in this repository).
// One plain HTTPS POST of a JSON-RPC `tools/call` per run.
//
// Fails open: a missing URL or token, a timeout, a refused connection, any HTTP or tool error
// is one stderr line and exit 0, so a board outage never blocks or fails the caller.
// The token is never printed, logged or written to a file.
//
// Usage: node report-progress.mjs [--tool report_progress|mark_done|ask_human]
//          (--key <key> | --slice <N>) [--project <slug>] [--type slice|problem|waiting_for_me|bug|unplanned]
//          [--status open|in_progress|blocked|done|stale] [--title ..] [--why ..] [--parent ..]
//          [--priority P0..P3] [--note ..] [--source hook|agent|human] [--link "Label|https://url"]...
//          [--details-file <path>] [--details "<text>"] [--parent-key <key>]
//          [--agent <kind>] [--model <name>] [--session <id>]
//          [--steps "a|b|c" | --steps-file <path>] [--touches "<Touches line>"] [--touches-file <slice file>]
//          [--step-active "<label>" | --step-done "<label>"] [--step-skipped "<label>"]...
// Steps: --steps gives the labels inline (the first is active unless a step flag names one); --steps-file reads a
// JSON file `{ "agent": "..", "steps": [{ "label": "..", "note": "..", "needsTouch": [".."] }] }`.
// --touches (or --touches-file, which reads the slice file's Touches line) drops steps whose
// `needsTouch` words are not path segments or extensions in it. `steps` goes out only when a step
// flag names a step in the list (the whole list: before it done, it active, the rest pending); with
// --step-done the next step becomes active. Otherwise the field is left out and the board keeps its list.
// The task key and step are written to `<state>/<session>.task.json` (session: --session, else
// CLAUDE_CODE_SESSION_ID); the goal reminder hook reads it. The model comes from --model, else AGENT_BOARD_MODEL.
// --slice N --part B reports on the part's key `<project>/slice-N/part-B` as type
// `part` with `parent_key` the slice's key; the step flags work as for any task. mark_done with --part sends
// only the part's key (and source, note). A --part with no value, a letter that is not A to Z, no --slice, or
// --key / --waiting beside it sends nothing: one stderr line, exit 0 (never a report on the whole slice).
// --slice N builds the key `<project>/slice-N` (leading zeros stripped, see sliceKey);
// --slice N --waiting builds `<project>/slice-N/waiting`.
// <project> defaults to AGENT_BOARD_PROJECT, else the repo folder name (see projectSlug).
// Config: CLAUDE_PLUGIN_OPTION_BOARD_URL / CLAUDE_PLUGIN_OPTION_BOARD_TOKEN (set by the plugin), else
// AGENT_BOARD_URL / AGENT_BOARD_TOKEN. State lives under CLAUDE_PLUGIN_DATA (see stateRoot).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const URL_OPTION_VARIABLE = 'CLAUDE_PLUGIN_OPTION_BOARD_URL';
export const TOKEN_OPTION_VARIABLE = 'CLAUDE_PLUGIN_OPTION_BOARD_TOKEN';
export const URL_VARIABLE = 'AGENT_BOARD_URL';
export const TOKEN_VARIABLE = 'AGENT_BOARD_TOKEN';
export const ENVIRONMENT_VARIABLE = 'AGENT_BOARD_ENV';
export const ENVIRONMENT_MAX_LENGTH = 40; // the board's limit for the environment field
export const TIMEOUT_MS = 3000;
export const MODEL_VARIABLE = 'AGENT_BOARD_MODEL'; // the model comes from the caller at run time, never from a list here
export const SESSION_VARIABLE = 'CLAUDE_CODE_SESSION_ID';
export const STEP_STATE = { done: 'done', active: 'active', pending: 'pending' };
export const STEP_LABEL_MAX = 80; // the board's limits (docs/clients.md, Steps)
export const STEP_NOTE_MAX = 120;
export const STEPS_MAX = 30;
const STEP_SEPARATOR = '|';
export const STATE_FOLDER = 'claude-board-hooks';
export const STATE_ROOT_VARIABLE = 'AGENT_BOARD_SESSION_ROOT'; // a test or a user override of the state folder
export const PLUGIN_DATA_VARIABLE = 'CLAUDE_PLUGIN_DATA';
export const TASK_SUFFIX = '.task.json';
export const TASK_STATUS = { inProgress: 'in_progress', blocked: 'blocked', waiting: 'waiting' };
const WAITING_SUFFIX = '/waiting';
export const TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000; // an older task file belongs to a session that ended without a done report

const PART_LETTER = /^[A-Z]$/;
const PART_TYPE = 'part';
const WRITE_TOOLS = new Set(['report_progress', 'mark_done', 'ask_human']);
const FIELD_ARGS = ['project', 'type', 'status', 'title', 'why', 'parent', 'priority', 'note', 'source', 'agent', 'model'];
const REPEATABLE = new Set(['link', 'step-skipped']);
const SWITCHES = new Set(['waiting']);

// Where the hooks and the CLI keep per-session files: the override variable, else the plugin's data folder
// (kept across plugin updates, never the plugin folder itself), else a temp folder for a run outside a plugin.
export function stateRoot(env = process.env) {
  if (env[STATE_ROOT_VARIABLE]) return env[STATE_ROOT_VARIABLE];
  if (env[PLUGIN_DATA_VARIABLE]) return join(env[PLUGIN_DATA_VARIABLE], 'state');
  return join(tmpdir(), STATE_FOLDER);
}

// Where the work runs ("laptop", "cloud-vm"): free text from the environment, never hard-coded;
// '' when it is not set (the field is then not sent).
export function resolveEnvironment(env = process.env) {
  return String(env[ENVIRONMENT_VARIABLE] || '').trim().slice(0, ENVIRONMENT_MAX_LENGTH);
}

// null when the address or the token is missing: the caller then does nothing. The plugin's options come
// first, then the plain environment variables; there is no built-in board address.
export function resolveConfig(env = process.env) {
  const token = String(env[TOKEN_OPTION_VARIABLE] || env[TOKEN_VARIABLE] || '').trim();
  const address = String(env[URL_OPTION_VARIABLE] || env[URL_VARIABLE] || '').trim();
  if (!token || !address) return null;
  if (!isAllowedAddress(address)) {
    process.stderr.write('report-progress: board address must start with https:// (http:// only for localhost or 127.0.0.1); nothing sent\n');
    return null;
  }
  const base = address.replace(/\/+$/, '').replace(/\/mcp$/, '');
  return { url: `${base}/mcp`, token };
}

// https always; http only for a local board, so the bearer token never crosses a network in clear text.
function isAllowedAddress(address) {
  if (/^https:\/\//i.test(address)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i.test(address);
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The repo's folder name (the main checkout's, also from inside a worktree), lower-cased with
// non-alphanumerics as `-`. AGENT_BOARD_PROJECT wins when set.
export function projectSlug(dir = process.cwd(), env = process.env) {
  if (env.AGENT_BOARD_PROJECT) return slugify(env.AGENT_BOARD_PROJECT);
  try {
    const raw = execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true }).trim(); // windowsHide: a detached run has no console, so git would open a window each call
    const common = resolve(dir, raw); // relative to dir on old and new git alike
    if (basename(common) === '.git') return slugify(basename(dirname(common)));
  } catch { /* not a git folder: fall back to the folder name */ }
  return slugify(basename(resolve(dir)));
}

export function normaliseSliceNumber(number) {
  const text = String(number).trim().toLowerCase();
  return text.replace(/^0+(?=\d)/, '');
}

export function sliceKey(project, number) {
  return `${project}/slice-${normaliseSliceNumber(number)}`;
}

function decodeBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    return JSON.parse(lines.map((line) => line.slice(5).trim()).join(''));
  }
}

function toolResult(body) {
  const result = body && body.result;
  const text = result && result.content && result.content[0] ? String(result.content[0].text) : '';
  if (!result || result.isError) return { ok: false, error: `tool error: ${text || 'no result'}` };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
}

// One tools/call. Never throws: returns { ok, data } or { ok: false, error }.
export async function callTool(config, name, args, options = {}) {
  const { timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = options;
  const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return toolResult(decodeBody(await response.text()));
  } catch (error) {
    return { ok: false, error: error && error.name === 'TimeoutError' ? 'timeout' : `request failed (${error && error.name})` };
  }
}

export function parseArgs(argv) {
  const out = { link: [], 'step-skipped': [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) continue;
    const name = flag.slice(2);
    if (SWITCHES.has(name)) { out[name] = true; continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      if (name === 'part') out.part = ''; // a --part with no value must still be seen as given, never as absent
      continue;
    }
    index += 1;
    if (REPEATABLE.has(name)) out[name].push(value);
    else out[name] = value;
  }
  return out;
}

export function parseLinks(specs) {
  return specs
    .map((spec) => {
      const cut = spec.indexOf('|');
      return cut > 0 ? { label: spec.slice(0, cut).trim(), url: spec.slice(cut + 1).trim() } : null;
    })
    .filter(Boolean);
}

// "a|b|c" as unique, trimmed labels cut to the board's limits.
export function parseStepLabels(text) {
  const seen = new Set();
  return String(text || '')
    .split(STEP_SEPARATOR)
    .map((label) => label.trim().slice(0, STEP_LABEL_MAX))
    .filter((label) => label && !seen.has(label) && seen.add(label))
    .slice(0, STEPS_MAX);
}

// `--slice N` is the slice's key, `--slice N --waiting` its `/waiting` child.
function waitingKey(project, parsed) {
  if (!parsed.slice) return '';
  return parsed.waiting ? `${sliceKey(project, parsed.slice)}/waiting` : sliceKey(project, parsed.slice);
}

// `--slice N --part B` is the part's key `<project>/slice-N/part-B`; its slice is the `parent_key`.
// Null when the letter is not one capital A to Z or no slice is given.
export function partKey(project, number, letter) {
  const upper = String(letter || '').trim().toUpperCase();
  if (!number || !PART_LETTER.test(upper)) return null;
  return `${sliceKey(project, number)}/part-${upper}`;
}

// Why a `--part` report cannot be built, or '' when it can (or `--part` was not given). A given
// `--part` is never dropped back to a report on the whole slice, for any tool.
export function partProblem(project, parsed) {
  if (!('part' in parsed)) return '';
  if (parsed.key || parsed.waiting) return 'bad --part: it goes with --slice only, not --key or --waiting';
  if (!partKey(project, parsed.slice, parsed.part)) return 'bad --part: give --slice <N> and one letter A to Z';
  return '';
}

// Build the tool arguments from parsed CLI arguments. Returns null when no key can be built.
export function buildArguments(parsed, project, detailsText, environment = '', steps = null) {
  if (partProblem(project, parsed)) return null;
  const part = 'part' in parsed ? partKey(project, parsed.slice, parsed.part) : null;
  const key = part || parsed.key || waitingKey(project, parsed);
  if (!key) return null;
  const args = { key };
  if (environment) args.environment = environment;
  if (steps) args.steps = steps;
  const fields = { ...parsed, project: parsed.project || project };
  for (const field of FIELD_ARGS) {
    if (fields[field]) args[field] = fields[field];
  }
  if (parsed['parent-key']) args.parent_key = parsed['parent-key'];
  if (part) Object.assign(args, { type: PART_TYPE, parent_key: sliceKey(project, parsed.slice) });
  const links = parseLinks(parsed.link);
  if (links.length) args.links = links;
  if (detailsText) args.details_md = detailsText;
  else if (parsed.details) args.details_md = parsed.details;
  return args;
}

function toolArguments(tool, args) {
  if (tool === 'mark_done') return { key: args.key, ...(args.source ? { source: args.source } : {}), ...(args.note ? { note: args.note } : {}) };
  return args;
}

function readDetails(path) {
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    process.stderr.write('report-progress: details file unreadable, skipped\n');
    return '';
  }
}

// A step with `needsTouch` stays only when one of its words is found in the slice's Touches line
// (`--touches`); with no Touches line given, nothing is dropped. Keeping a needed step beats
// dropping it, so the matching is generous (segmentMatches). A steps file's `sharedTouch` list names
// shared code (`.xaml`): when a Touches path matches one, no platform step is dropped.
export function keepStep(step, touches, sharedTouch = []) {
  const words = Array.isArray(step.needsTouch) ? step.needsTouch : [];
  const paths = touchPaths(touches);
  if (!words.length || !paths.length) return true;
  if (anyTouchMatches(paths, sharedTouch)) return true;
  return anyTouchMatches(paths, words);
}

function touchPaths(touches) {
  return String(touches || '').split(/[\s,;`'"()[\]]+/).map((path) => path.replace(/[.:;,]+$/, '')).filter(Boolean);
}

function anyTouchMatches(paths, words) {
  const list = Array.isArray(words) ? words : [];
  return list.some((word) => paths.some((path) => touchMatches(path, String(word).toLowerCase())));
}

function touchMatches(path, word) {
  return path.split(/[\\/]+/).filter(Boolean).some((segment) => segmentMatches(segment, word));
}

export const LONG_WORD_MIN = 5;

// A dotted word is an extension (`.kt` is not `.kts`; `Main.xaml.cs` has `.xaml`). A word of five
// letters or more matches inside a segment (`AndroidManifest.xml`, `MyApp.Windows`). A shorter word
// matches a whole token of the segment (split at non-alphanumerics and lower-to-upper changes) or the
// start of the segment when an upper-case letter or a non-letter follows (`iOSApp`), never inside
// `scenarios`. All case-insensitive.
function segmentMatches(segment, word) {
  const lower = segment.toLowerCase();
  if (word.startsWith('.')) return lower.endsWith(word) || lower.includes(`${word}.`);
  if (word.length >= LONG_WORD_MIN) return lower.includes(word);
  const tokens = segment.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((token) => token.toLowerCase());
  return tokens.includes(word) || startsAsWord(segment, word);
}

function startsAsWord(segment, word) {
  if (segment.slice(0, word.length).toLowerCase() !== word) return false;
  const next = segment[word.length];
  return next === undefined || !/[A-Za-z]/.test(next) || next === next.toUpperCase();
}

// The Touches line of a slice file (and the lines after it up to a blank line, a heading or the
// next bold field), so the coordinator passes a path and no shell sees the backticks.
export function readTouchesFile(path) {
  if (!path) return '';
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const start = lines.findIndex((line) => /^\s*(?:[-*+]\s+)?\*\*Touches(?::\*\*|\*\*:?)/i.test(line));
    if (start < 0) return '';
    const rest = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.trim() || /^\s*(#|\*\*|[-*+]\s+\*\*)/.test(line)) break;
      rest.push(line);
    }
    return [lines[start], ...rest].join(' ');
  } catch {
    process.stderr.write('report-progress: touches file unreadable, skipped\n');
    return '';
  }
}

// { agent, steps: [{ label, note? }] } from a steps file (a path), trimmed to the Touches line; null when
// the file is missing or unusable (the report then goes without a list).
export function loadStepList(value, touches = '') {
  if (!value) return null;
  try {
    const file = JSON.parse(readFileSync(resolve(value), 'utf8'));
    const seen = new Set();
    const steps = file.steps
      .filter((step) => step && typeof step.label === 'string' && step.label.trim() && keepStep(step, touches, file.sharedTouch))
      .map((step) => ({ ...step, label: step.label.trim() }))
      .filter((step) => !seen.has(step.label) && seen.add(step.label))
      .slice(0, STEPS_MAX);
    return { agent: typeof file.agent === 'string' ? file.agent : '', steps };
  } catch {
    process.stderr.write('report-progress: steps file unreadable, skipped\n');
    return null;
  }
}

function stepEntry(step, state) {
  const entry = { label: String(step.label).slice(0, STEP_LABEL_MAX), state };
  if (step.note) entry.note = String(step.note).slice(0, STEP_NOTE_MAX);
  return entry;
}

// The whole list with states from the moves named, or null (send no `steps` at all) when the list
// is empty or no flag names a step in it. `done` marks that step and all before it done and makes
// the next step active; `active` alone marks the steps before it done. With both, done wins up to
// its step and the active one counts only when it comes after.
// `skipped` labels name steps that never happened. The board's step states are done, active and pending only
// (src/domain/stepTypes.ts), so a skipped step is left out of the sent list, never shown
// as done. The active step is never left out.
export function stepStates(steps, activeLabel = '', doneLabel = '', skipped = []) {
  const done = doneLabel ? steps.findIndex((step) => step.label === String(doneLabel).trim()) : -1;
  const active = activeLabel ? steps.findIndex((step) => step.label === String(activeLabel).trim()) : -1;
  if (!steps.length || (done < 0 && active < 0)) return null;
  const current = active > done ? active : (done >= 0 && done + 1 < steps.length ? done + 1 : -1);
  const doneUpTo = done >= 0 ? done : active - 1;
  const left = new Set(skipped.map((label) => String(label).trim()));
  const states = steps
    .map((step, index) => {
      if (index === current) return stepEntry(step, STEP_STATE.active);
      if (left.has(step.label)) return null;
      return stepEntry(step, index <= doneUpTo ? STEP_STATE.done : STEP_STATE.pending);
    })
    .filter(Boolean);
  return states.length ? states : null;
}

// Messages for a --step-skipped that cannot work: no move to send it with, or a label the list does not hold.
function skippedProblems(parsed, steps) {
  const skipped = parsed['step-skipped'] ?? [];
  if (!skipped.length) return [];
  if (!parsed['step-active'] && !parsed['step-done']) return ['--step-skipped needs --step-active or --step-done, nothing sent for it'];
  const known = new Set(steps.map((step) => step.label));
  return skipped.filter((label) => !known.has(String(label).trim())).map((label) => `--step-skipped "${label}" is not in the list`);
}

// The one place that names the task file.
export function taskFilePath(sessionId, root = stateRoot()) {
  const id = String(sessionId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return id ? join(root, `${id}${TASK_SUFFIX}`) : '';
}

// The task file: `{ key, step, status, project }` named by the session id. `status` is what the task was
// last reported as (stored as given).
export function writeTaskFile(sessionId, key, step, status = TASK_STATUS.inProgress, project = '', root = stateRoot()) {
  const file = taskFilePath(sessionId, root);
  if (!file || !key) return;
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(file, JSON.stringify({ key, step: step || '', status, ...(project ? { project } : {}) }));
  } catch { /* fail open: the goal reminder then does not know the task */ }
}

export function readTaskFile(sessionId, root = stateRoot()) {
  try {
    const task = JSON.parse(readFileSync(taskFilePath(sessionId, root), 'utf8'));
    return task && typeof task.key === 'string' ? task : null;
  } catch {
    return null;
  }
}

// True when the session works on a task right now: a task file under the state root (default or the
// given override) with status in_progress, written within TASK_MAX_AGE_MS. Such a session reports under its
// task key, so it gets no goal reminder.
export function activeTaskCard(sessionId, { taskRoot, now = Date.now() } = {}) {
  const file = taskFilePath(sessionId, taskRoot);
  if (!file) return false;
  try {
    if (now - statSync(file).mtimeMs > TASK_MAX_AGE_MS) return false;
    const task = readTaskFile(sessionId, taskRoot);
    return Boolean(task) && (task.status || TASK_STATUS.inProgress) === TASK_STATUS.inProgress;
  } catch {
    return false;
  }
}

// The task status a report means: ask_human is waiting; report_progress carries its status as given
// (open, stale, parked, review, blocked, waiting ...) and no status means in_progress.
function taskStatusOf(tool, args, stored = '') {
  if (tool === 'ask_human') return TASK_STATUS.waiting;
  return args.status || stored || TASK_STATUS.inProgress; // no status: the board keeps its stored one, so does the file
}

// A report with no step list still moves the status of the session's task file when it is for that
// task (same key) or is the `/waiting` child of that task's key; step and key stay as they were.
function updateTaskStatus(sessionId, tool, args, root) {
  const task = readTaskFile(sessionId, root);
  if (!task) return;
  const isChild = args.key === `${task.key}${WAITING_SUFFIX}`;
  if (args.key !== task.key && !isChild) return;
  writeTaskFile(sessionId, task.key, task.step, isChild ? TASK_STATUS.waiting : taskStatusOf(tool, args, task.status), task.project, root);
}

// Resolving the task's `/waiting` child (mark_done, or status done) puts the task back to in_progress.
function resumeAfterWaiting(sessionId, args, root) {
  const task = readTaskFile(sessionId, root);
  if (!task || args.key !== `${task.key}${WAITING_SUFFIX}`) return;
  writeTaskFile(sessionId, task.key, task.step, TASK_STATUS.inProgress, task.project, root);
}

// A finished task's file goes. Only that task's file: a file holding another key (a coordinator running two
// slices) stays.
export function removeTaskFile(sessionId, key, root = stateRoot()) {
  const file = taskFilePath(sessionId, root);
  if (!file) return;
  try {
    if (JSON.parse(readFileSync(file, 'utf8')).key !== key) return;
    rmSync(file, { force: true });
  } catch { /* fail open */ }
}

// The step the task is in after a move: the active one, else the last one done.
function currentStep(states) {
  const active = states.find((step) => step.state === STEP_STATE.active);
  if (active) return active.label;
  const done = states.filter((step) => step.state === STEP_STATE.done);
  return done.length ? done[done.length - 1].label : '';
}

// The step list and the labels it came from: --steps gives them inline, else --steps-file reads them.
function stepListOf(parsed, touches) {
  const inline = parsed.steps ? parseStepLabels(parsed.steps) : [];
  if (inline.length) return { agent: '', steps: inline.map((label) => ({ label })), inline: true };
  return loadStepList(parsed['steps-file'], touches);
}

// agent, model and the step list for a report_progress call, as parsed-argument overrides.
function stepContext(parsed, env) {
  const touches = [parsed.touches, readTouchesFile(parsed['touches-file'])].filter(Boolean).join(' ');
  const list = stepListOf(parsed, touches);
  const named = parsed['step-active'] || parsed['step-done'];
  const active = parsed['step-active'] || (list && list.inline && !named ? list.steps[0].label : ''); // a new inline list starts at its first step
  const moved = Boolean(active || parsed['step-done']);
  const steps = list && moved ? stepStates(list.steps, active, parsed['step-done'], parsed['step-skipped']) : null;
  if (list && moved && !steps) process.stderr.write('report-progress: step not in the list, list not sent\n');
  if (list) for (const problem of skippedProblems(parsed, list.steps)) process.stderr.write(`report-progress: ${problem}\n`);
  const agent = parsed.agent || (list && list.agent) || '';
  const model = parsed.model || env[MODEL_VARIABLE] || '';
  return { steps, fields: { ...parsed, ...(agent ? { agent } : {}), ...(model ? { model } : {}) } };
}

// A finished task (mark_done, or status done) drops the session's task file; a sent step list records it.
function trackTask(sessionId, tool, args, steps, env) {
  const root = stateRoot(env);
  if (tool === 'mark_done' || args.status === 'done') {
    removeTaskFile(sessionId, args.key, root);
    resumeAfterWaiting(sessionId, args, root);
  } else if (steps) {
    const stored = readTaskFile(sessionId, root);
    const sameKey = stored && stored.key === args.key ? stored.status : '';
    writeTaskFile(sessionId, args.key, currentStep(steps), taskStatusOf(tool, args, sameKey), args.project, root);
  } else updateTaskStatus(sessionId, tool, args, root);
}

export async function main(argv, env = process.env) {
  const parsed = parseArgs(argv);
  const tool = parsed.tool || 'report_progress';
  if (!WRITE_TOOLS.has(tool)) return process.stderr.write(`report-progress: unknown tool ${tool}\n`);
  const config = resolveConfig(env);
  if (!config) return;
  const project = parsed.project || projectSlug(process.cwd(), env);
  const problem = partProblem(project, parsed);
  if (problem) return process.stderr.write(`report-progress: ${problem}, nothing sent\n`);
  // mark_done and ask_human take no environment, agent, model or steps; only report_progress carries them.
  const isProgress = tool === 'report_progress';
  const environment = isProgress ? resolveEnvironment(env) : '';
  const { agent, model, ...withoutAgent } = parsed; // eslint-disable-line @typescript-eslint/no-unused-vars
  const context = isProgress ? stepContext(parsed, env) : { steps: null, fields: withoutAgent };
  const args = buildArguments(context.fields, project, readDetails(parsed['details-file']), environment, context.steps);
  if (!args) return process.stderr.write('report-progress: no key (give --key or --slice)\n');
  // A helper's card (--parent-key) shares the caller's session id but is not the session's task: only
  // the caller's own reports write or remove the task file.
  if (!parsed['parent-key']) trackTask(parsed.session || env[SESSION_VARIABLE], tool, args, context.steps, env);
  const outcome = await callTool(config, tool, toolArguments(tool, args));
  if (!outcome.ok) process.stderr.write(`report-progress: ${tool} skipped (${outcome.error})\n`);
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2))
    .catch((error) => process.stderr.write(`report-progress: skipped (${error && error.name})\n`))
    .finally(() => process.exit(0));
}
