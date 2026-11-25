// The session's background agents, read from the files Claude Code keeps next to the session transcript:
// `<session>/subagents/agent-<id>.jsonl` (its record, written while it works) and `agent-<id>.meta.json`
// (`description`, `agentType`, `finished`). An agent whose record changed in the last AGENT_FRESH_MS is working.
// Local files only; every helper fails open with an empty list.
import { Buffer } from 'node:buffer';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STEP_LABEL_MAX, STEP_NOTE_MAX, STEPS_MAX } from '../report-progress.mjs';
import { clip } from './hook-input.mjs';
import { MASK_WINDOW, maskSecrets } from './waiting-card.mjs';

export const AGENT_FRESH_MS = 10 * 60 * 1000;
export const AGENT_STATE = { active: 'active', done: 'done' };
export const AGENT_PREFIX = 'Helper agent'; // the start of an agent's label when it has no description, and of its note
const PROMPT_CHARS_MAX = 50; // characters of the agent's prompt in its fallback label
const HEAD_BYTES = 64 * 1024; // the part of an agent's record read for its prompt and model
const AGENT_ID_PREFIX = 'agent-'; // the step id of an agent's row: stable across reports, so what a helper reported under it is kept
export const STEP_DEPTH_MAX = 4; // the board's levels of sub-steps (src/domain/steps.ts, MAX_STEP_DEPTH)
const RUNNING_NOTE = 'a background agent is still running'; // on a step the session marked done while its agent works
const KEY_ID = 'id:'; // a step address in the goal file: by the session's own id, else by label
const KEY_LABEL = 'label:';
export const CARD_NOTE = 'background agents running'; // the note on the session card kept open for them
const AGENT_FILE = /^agent-(.+)\.meta\.json$/;
const SUBAGENT_FOLDER = 'subagents';
const TRANSCRIPT_EXT = /\.jsonl$/;

// The folder holding the session's agent files: next to its transcript, in a folder of the same name.
export function subagentsDir(input) {
  const transcript = input && typeof input.transcript_path === 'string' ? input.transcript_path : '';
  return transcript && TRANSCRIPT_EXT.test(transcript) ? join(transcript.replace(TRANSCRIPT_EXT, ''), SUBAGENT_FOLDER) : '';
}

const FOREGROUND_SHAPE = 'foreground'; // `requestShape` in an agent's meta file when the session waits for it

// True when the agent's meta file says the session waits for it (a foreground agent gets no row). A file that does not
// exist yet says nothing: the agent is treated as a background one, as before.
export function isForegroundAgent(input, agentId) {
  const dir = subagentsDir(input);
  if (!dir || !agentId) return false;
  return readMeta(join(dir, `agent-${agentId}.meta.json`)).requestShape === FOREGROUND_SHAPE;
}

// True when the agent's meta file exists: an agent recorded at start but without one has not written its files yet.
export function hasAgentMeta(input, agentId) {
  const dir = subagentsDir(input);
  return Boolean(dir) && existsSync(join(dir, `agent-${agentId}.meta.json`));
}

function readMeta(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function lineOf(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null; // a line cut by the end of the head
  }
}

function promptOf(record) {
  const content = record.message && record.message.content;
  if (typeof content === 'string') return content;
  const part = Array.isArray(content) ? content.find((item) => item && item.type === 'text' && typeof item.text === 'string') : null;
  return part ? part.text : '';
}

// The first user text (the agent's prompt) and the first model name in the head of an agent's record.
function headFacts(text) {
  const facts = { prompt: '', model: '' };
  for (const record of text.split('\n').map(lineOf).filter(Boolean)) {
    if (!facts.prompt && record.type === 'user' && !record.isMeta) facts.prompt = promptOf(record);
    if (!facts.model && record.type === 'assistant' && record.message && typeof record.message.model === 'string') facts.model = record.message.model;
    if (facts.prompt && facts.model) break;
  }
  return facts;
}

function readHead(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    return headFacts(buffer.toString('utf8', 0, readSync(fd, buffer, 0, HEAD_BYTES, 0)));
  } catch {
    return { prompt: '', model: '' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// The description; with none, "Helper agent: <first words of its prompt>"; never the bare agent type.
function agentLabel(meta, head) {
  const description = typeof meta.description === 'string' ? maskSecrets(meta.description.slice(0, MASK_WINDOW)) : '';
  if (description.trim()) return clip(description, STEP_LABEL_MAX);
  const words = clip(maskSecrets(head.prompt.slice(0, MASK_WINDOW)), PROMPT_CHARS_MAX); // mask first, then cut
  return clip(words ? `${AGENT_PREFIX}: ${words}` : AGENT_PREFIX, STEP_LABEL_MAX);
}

// The one reader of a file's time: its mtime, or null when it cannot be stat-ed for any reason (missing, busy, no
// access); never "quiet since 1970".
export function modifiedAt(file, stat = statSync) {
  try {
    return stat(file).mtimeMs;
  } catch {
    return null;
  }
}

// An agent's last-known time (Slice 49, fourth design): the record's mtime whenever it can be read, so a meta rewrite
// after a stop never moves a readable record's time. Whenever the record's stat fails, for any reason (ENOENT
// included), the meta file's mtime is used (written at SubagentStart): a new agent with no record yet is fresh, and a
// crashed one with no record ages out AGENT_LIVE_MS after its start. If the meta's stat fails too, the time is
// unknown, null.
export function agentTime(dir, id, stat = statSync) {
  const record = modifiedAt(join(dir, `agent-${id}.jsonl`), stat);
  if (record !== null) return record;
  try {
    return stat(join(dir, `agent-${id}.meta.json`)).mtimeMs;
  } catch {
    return null;
  }
}

// A record written this long after the stop still belongs to the stop (a late flush), not to new work; the same
// window as the Stop hold's slack in session-done.mjs.
export const RESUME_SLACK_MS = 3000;

// The stops as a Map of agent id to stop time. `stopped` is an object of `{ id: stoppedAtMs }` (what
// hook-input.readStoppedAt returns), the only shape.
function stopTimes(stopped) {
  return new Map(stopped && typeof stopped === 'object' ? Object.entries(stopped) : []);
}

// An agent whose record changed after its stop was resumed: it is working again, not stopped.
function stoppedAfterLastWrite(stops, id, atMs) {
  return stops.has(id) && atMs <= stops.get(id) + RESUME_SLACK_MS;
}

// An agent that stopped within AGENT_FRESH_MS and wrote nothing since is listed (done) even when its record is older
// than AGENT_FRESH_MS: a long silent tool call must not drop it at the moment it stops.
function stoppedRecently(stops, agent, now) {
  const at = stops.get(agent.id);
  return Number.isFinite(at) && now - at <= AGENT_FRESH_MS && stoppedAfterLastWrite(stops, agent.id, agent.atMs);
}

// [{ id, label, state, atMs }] of the agents whose record changed within AGENT_FRESH_MS, oldest change first.
// An agent is `done` when its meta file says `finished` or it stopped (`stopped`, from the SubagentStop hook's
// agent_id: that hook may run before the meta file is updated) and its record did not change since; else it is
// `active`. A stopped agent with an old record is not listed.
export function readBackgroundAgents(input, now = Date.now(), stopped = {}, stat = statSync) {
  const dir = subagentsDir(input);
  if (!dir) return [];
  const stops = stopTimes(stopped);
  try {
    return readdirSync(dir)
      .map((name) => AGENT_FILE.exec(name))
      .filter(Boolean)
      .map(([name, id]) => ({ id, meta: readMeta(join(dir, name)), time: agentTime(dir, id, stat) }))
      .map((agent) => ({ ...agent, unknown: agent.time === null, atMs: agent.time ?? now })) // unknown time: listed as written just now (Slice 49)
      .filter((agent) => agent.meta.requestShape !== FOREGROUND_SHAPE) // the session waits for a foreground agent: no row (Slice 47 4j)
      .filter((agent) => now - agent.atMs <= AGENT_FRESH_MS || stoppedRecently(stops, agent, now))
      .map((agent) => ({ ...agent, head: readHead(join(dir, `agent-${agent.id}.jsonl`)) }))
      .map(({ id, meta, atMs, unknown, head }) => ({
        id,
        atMs,
        label: agentLabel(meta, head),
        model: head.model,
        state: meta.finished === true || (stops.has(id) && (unknown || stoppedAfterLastWrite(stops, id, atMs))) ? AGENT_STATE.done : AGENT_STATE.active,
      }))
      .sort((left, right) => left.atMs - right.atMs);
  } catch {
    return [];
  }
}

// How long an agent may be quiet and still count as running: a crashed agent ages out after this (Slice 48 3).
export const AGENT_LIVE_MS = 24 * 60 * 60 * 1000;

// Returns undefined when the agent folder is missing or unreadable, so nothing is pruned on a guess.
// The ids of the agents that still run, the one rule for what the goal file's prune must keep: the meta file does not
// say `finished`, the agent did not stop (its record unchanged since the stop), and its record was written within
// AGENT_LIVE_MS. The listed agents of `readBackgroundAgents` are only those written in the last 10 minutes, so a long
// silent tool call is not listed but is kept; one quiet for a day is taken as crashed (Slice 48 3, pr-184-check-medium #1).
export function liveAgentIds(input, stopped = {}, now = Date.now(), stat = statSync) {
  const dir = subagentsDir(input);
  if (!dir) return undefined;
  const stops = stopTimes(stopped);
  try {
    return readdirSync(dir)
      .map((name) => AGENT_FILE.exec(name))
      .filter(Boolean)
      .map(([name, id]) => ({ id, meta: readMeta(join(dir, name)), atMs: agentTime(dir, id, stat) }))
      .filter((agent) => agent.meta.requestShape !== FOREGROUND_SHAPE && agent.meta.finished !== true)
      .filter((agent) => (agent.atMs === null ? !stops.has(agent.id) : !stoppedAfterLastWrite(stops, agent.id, agent.atMs))) // unknown time: a stop file still stops it (Slice 49)
      .filter((agent) => agent.atMs === null || now - agent.atMs <= AGENT_LIVE_MS) // neither time readable: keep
      .map((agent) => agent.id);
  } catch {
    return undefined; // unknown, not "none running": the caller prunes nothing (pr-184-check-2-medium #1)
  }
}

export function hasActiveAgent(agents) {
  return agents.some((agent) => agent.state === AGENT_STATE.active);
}

// The row id of an agent: what its helper reports under (`under_step`), told to the helper at SubagentStart.
export function agentRowId(agentId) {
  return `${AGENT_ID_PREFIX}${agentId}`;
}

// Every step of the tree with its path of indices, parents before their children.
function walkSteps(steps, path = []) {
  return steps.flatMap((step, index) => {
    const here = [...path, index];
    return [{ step, path: here }, ...walkSteps(Array.isArray(step.children) ? step.children : [], here)];
  });
}

// A step's address in the goal file: its own `id` when the session gave one (stable), else its label.
function stepKey(step) {
  return typeof step.id === 'string' && step.id ? `${KEY_ID}${step.id}` : `${KEY_LABEL}${step.label}`;
}

// The address of the step the session had running (the last active one in tree order), '' when none: the step a
// new agent goes under. Recorded when the agent starts (SubagentStart), so the session moving on changes nothing.
export function runningKey(steps) {
  const running = walkSteps(steps).filter(({ step }) => step.state === 'active');
  return running.length ? stepKey(running[running.length - 1].step) : '';
}

// The parent address of every agent: what was recorded for it (`recorded`, the goal file's agentParents, kept for
// agents no longer listed too), else the step the session has running now ('' = the root).
export function placeAgents(steps, agents, recorded = {}) {
  const now = runningKey(steps);
  const parents = { ...recorded };
  for (const agent of agents) if (typeof parents[agent.id] !== 'string') parents[agent.id] = now;
  return parents;
}

// The path of the step an address names: by id, else the first step with that label that is not done (else the first),
// null = the root. The agent's row is one level below its owner and the helper reports its own subtree below the row,
// so the owner sits at STEP_DEPTH_MAX - 2 levels at the deepest: a deeper step gives the place to its ancestor there.
function ownerPath(steps, parent) {
  if (!parent) return null;
  const found = walkSteps(steps).filter(({ step }) => stepKey(step) === parent);
  const open = found.find(({ step }) => step.state !== AGENT_STATE.done);
  const path = (open || found[0] || { path: null }).path;
  return path ? path.slice(0, STEP_DEPTH_MAX - 2) : null;
}

function agentNode(agent) {
  const note = agent.model ? `${AGENT_PREFIX} · ${agent.model}` : AGENT_PREFIX;
  // No `children`: the board keeps what the helper reported under this id (Slice 39).
  return { id: agentRowId(agent.id), label: agent.label, state: agent.state, note: clip(note, STEP_NOTE_MAX) };
}

function countSteps(steps) {
  return steps.reduce((sum, step) => sum + 1 + countSteps(Array.isArray(step.children) ? step.children : []), 0);
}

// Agents that fit in the board's tree with the session's own steps: when over the limit, the oldest finished agents go
// first, then the oldest running ones. `agents` is oldest first. `ownCount` counts every node, nested ones too.
function fitAgents(ownCount, agents) {
  const room = Math.max(0, STEPS_MAX - ownCount);
  let over = agents.length - room;
  const dropped = new Set();
  for (const agent of [...agents.filter((a) => a.state === AGENT_STATE.done), ...agents.filter((a) => a.state !== AGENT_STATE.done)]) {
    if (over <= 0) break;
    dropped.add(agent.id);
    over -= 1;
  }
  return agents.filter((agent) => !dropped.has(agent.id));
}

function pathKey(path) {
  return path.join('.');
}

// Where each shown agent's row goes: Map of owner path key to its rows, and the root rows.
function groupRows(sent, shown, parents) {
  const under = new Map();
  const roots = [];
  for (const agent of shown) {
    const path = ownerPath(sent, parents[agent.id]);
    if (!path) roots.push(agentNode(agent));
    else under.set(pathKey(path), [...(under.get(pathKey(path)) || []), { node: agentNode(agent), running: agent.state === AGENT_STATE.active }]);
  }
  return { under, roots };
}

// The path keys of the steps (and their parents) that have a running agent below: the board would finish them with
// their children if the session had marked them done.
function liveKeys(under) {
  const keys = new Set();
  for (const [key, rows] of under) {
    if (!rows.some((row) => row.running)) continue;
    const parts = key.split('.');
    parts.forEach((_, index) => keys.add(parts.slice(0, index + 1).join('.')));
  }
  return keys;
}

function attach(level, context, prefix = []) {
  return level.map((step, index) => {
    const path = [...prefix, index];
    const key = pathKey(path);
    const rows = (context.under.get(key) || []).map((row) => row.node);
    const kept = Array.isArray(step.children) ? attach(step.children, context, path) : null;
    const live = context.live.has(key) && step.state === AGENT_STATE.done;
    const base = live ? { ...step, state: AGENT_STATE.active, note: clip(RUNNING_NOTE, STEP_NOTE_MAX) } : step;
    if (kept || rows.length) return { ...base, children: [...(kept || []), ...rows] };
    return base; // never `children: []` for a step the hook did not fill: the board keeps its stored non-agent children (Slice 51, G)
  });
}

// The step tree to send: the steps the session sent as it sent them (ids and children included, from the goal file),
// and each background agent as its own child row after the step's own children, under the step recorded when the
// agent started (`parents`, from placeAgents; the root when that step is gone, too deep, or none was running).
// Running agents are `active` (several may be, the board allows it since Slice 39); a step with a running agent below
// it is sent `active` even when the session marked it done, with a note, so the board never finishes the running
// agent with it. An agent row is sent without `children`, so the board keeps what the helper reported under it. A
// step whose agents all aged out is sent as the session sent it, never with `children: []`; the board's rule for a hook
// report (`hookStepsInput`) keeps its stored non-agent children and drops the stored agent rows (Slice 51, G). Over the board's 200-step
// limit (nested steps count) the oldest finished agents are dropped first.
export function mergeSteps(sent, agents, parents = {}) {
  const shown = fitAgents(countSteps(sent), agents);
  const { under, roots } = groupRows(sent, shown, parents);
  const context = { under, live: liveKeys(under) };
  return [...attach(sent, context), ...roots];
}
