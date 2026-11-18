// The session's background agents, read from the files Claude Code keeps next to the session transcript:
// `<session>/subagents/agent-<id>.jsonl` (its record, written while it works) and `agent-<id>.meta.json`
// (`description`, `agentType`, `finished`). An agent whose record changed in the last AGENT_FRESH_MS is working.
// Local files only; every helper fails open with an empty list.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STEP_LABEL_MAX, STEPS_MAX } from '../report-progress.mjs';
import { clip } from './hook-input.mjs';

export const AGENT_FRESH_MS = 10 * 60 * 1000;
export const AGENT_STATE = { active: 'active', done: 'done' };
export const AGENT_NOTE = 'running in background'; // the note on an agent's step
export const CARD_NOTE = 'background agents running'; // the note on the session card kept open for them
const AGENT_FILE = /^agent-(.+)\.meta\.json$/;
const SUBAGENT_FOLDER = 'subagents';
const TRANSCRIPT_EXT = /\.jsonl$/;

// The folder holding the session's agent files: next to its transcript, in a folder of the same name.
export function subagentsDir(input) {
  const transcript = input && typeof input.transcript_path === 'string' ? input.transcript_path : '';
  return transcript && TRANSCRIPT_EXT.test(transcript) ? join(transcript.replace(TRANSCRIPT_EXT, ''), SUBAGENT_FOLDER) : '';
}

function readMeta(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function modifiedAt(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
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
export function readBackgroundAgents(input, now = Date.now(), stopped = {}) {
  const dir = subagentsDir(input);
  if (!dir) return [];
  const stops = stopTimes(stopped);
  try {
    return readdirSync(dir)
      .map((name) => AGENT_FILE.exec(name))
      .filter(Boolean)
      .map(([name, id]) => ({ id, meta: readMeta(join(dir, name)), atMs: modifiedAt(join(dir, `agent-${id}.jsonl`)) }))
      .filter((agent) => now - agent.atMs <= AGENT_FRESH_MS || stoppedRecently(stops, agent, now))
      .map(({ id, meta, atMs }) => ({
        id,
        atMs,
        label: clip(meta.description || meta.agentType || id, STEP_LABEL_MAX),
        state: meta.finished === true || stoppedAfterLastWrite(stops, id, atMs) ? AGENT_STATE.done : AGENT_STATE.active,
      }))
      .sort((left, right) => left.atMs - right.atMs);
  } catch {
    return [];
  }
}

export function hasActiveAgent(agents) {
  return agents.some((agent) => agent.state === AGENT_STATE.active);
}

// The first running agent takes the active slot. When the session sent a step with the agent's own label, that step
// (which was just made pending) is the agent's step and becomes the active one, since the label filter below drops
// the agent itself; true when the slot is taken this way.
function takeActiveSlot(own, agents) {
  const first = agents.find((agent) => agent.state === AGENT_STATE.active);
  const index = first ? own.findIndex((step) => step.label === first.label && step.state !== 'done') : -1;
  if (index < 0) return false;
  own[index] = { ...own[index], state: 'active', note: own[index].note || AGENT_NOTE }; // the session's own note stays
  return true;
}

// The step list to send: the steps the session sent, then one step per background agent. The board accepts one
// active step at most (src/domain/steps.ts), so the first running agent takes the active slot (the session is
// idle while its agents work) and a step the session had active goes back to pending; further running agents
// are pending with a note; finished ones are done. Labels the session itself sent are not repeated; agents with
// the same label as each other each keep their own step.
export function mergeSteps(sent, agents) {
  const hasRunning = hasActiveAgent(agents);
  const own = sent.map((step) => (hasRunning && step.state === 'active' ? { ...step, state: 'pending' } : step));
  const known = new Set(own.map((step) => step.label));
  let activeTaken = takeActiveSlot(own, agents);
  const added = agents
    .filter((agent) => !known.has(agent.label))
    .map((agent) => {
      if (agent.state === AGENT_STATE.done) return { label: agent.label, state: 'done' };
      const state = activeTaken ? 'pending' : 'active';
      activeTaken = true;
      return { label: agent.label, state, note: AGENT_NOTE };
    });
  return [...own, ...added].slice(0, STEPS_MAX);
}
