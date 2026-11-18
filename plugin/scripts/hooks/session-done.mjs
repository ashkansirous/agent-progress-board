#!/usr/bin/env node
/* global process */
// Stop, SubagentStop and UserPromptSubmit hook: keeps the session's cards true. Fails open: never blocks, always exit 0.
// - Stop: the session's own card (the key its MCP report_progress calls used, kept by goal-reminder.mjs) is
//   marked done "Session stopped", unless a background agent's record changed in the last 10 minutes: then the
//   card stays in_progress with the note "background agents running" and one step per agent.
// - SubagentStop: the finished agent's step turns done (only when the list changed).
// - UserPromptSubmit: a card closed by Stop is reopened ("Session resumed").
// - Stop and UserPromptSubmit (not SubagentStop): the `<project>/waiting-<id>` waiting item of this session (key from
//   its marker) is marked done; goal-reminder.mjs does the same after a main-thread tool call. All three: the waiting items
//   of sessions on this machine that sent nothing for 30 minutes are closed "Session ended".
// Input (stdin JSON): session_id, cwd, hook_event_name, transcript_path, agent_id. Env as in report-progress.mjs.
import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool, resolveConfig } from '../report-progress.mjs';
import { AGENT_STATE, CARD_NOTE, RESUME_SLACK_MS, hasActiveAgent, mergeSteps, readBackgroundAgents } from './background-agents.mjs';
import {
  CLOSED_BY, HOOK_SOURCE, HOOK_TIMEOUT_MS, addStoppedAgent, hasMarker, listMarkers, parseInput, readGoal, readMarkerKey, readSeen, readStdinText,
  readStoppedAt, removeMarker, removeStoppedAgent, sessionContext, sessionIdOf, stateRoot, touchSeen, updateGoal,
} from './hook-input.mjs';

export const DEAD_SESSION_MS = 30 * 60 * 1000; // a waiting card whose session sent nothing for this long is closed
export const EVENT = { stop: 'Stop', subagentStop: 'SubagentStop', prompt: 'UserPromptSubmit' };
export const NOTE = { stopped: 'Session stopped', resumed: 'Session resumed', ended: 'Session ended' };
const HELD_SLACK_MS = RESUME_SLACK_MS; // transcript writes this soon after Stop belong to the Stop itself
const SWEEP_LIMIT = 5; // dead waiting cards closed per run, so one hook never passes its time budget
const NO_ITEM = /no item/;

function callOptions(options) {
  return { timeoutMs: HOOK_TIMEOUT_MS, ...options };
}

// Saves the goal file with the closed flag and the list last sent; the goal time stays as it was. The file is read
// again here, right before the write: the network call before it takes up to 2 s, and the session's own report may
// have changed the file meanwhile, so only the fields in `patch` are written over the file's current content. A
// file that is gone (the goal was removed meanwhile) is not written back. `patch` is an object, or a function of
// the file's current content and the time the call returned that returns one.
function saveGoal(id, patch, root, now, doneAt = now) {
  updateGoal(id, root, now, (current) => {
    if (!current) return null;
    return { ...current, at: now, ...(typeof patch === 'function' ? patch(current, doneAt) : patch) };
  });
}

async function sendCard(config, id, root, args, now, options) {
  const started = Date.now();
  const outcome = await callTool(config, args.tool, args.body, callOptions(options));
  const gone = !outcome.ok && NO_ITEM.test(outcome.error || '');
  if (outcome.ok || gone) saveGoal(id, args.patch, root, now, now + (Date.now() - started));
  else process.stderr.write(`report-progress hook: card skipped (${outcome.error})\n`); // state unchanged: the next hook retries
  return outcome;
}

// Every in_progress report of the hooks repeats the session's open question: the board clears one that a
// report moving the card to in_progress leaves out (answersQuestion in src/domain/upsert.ts).
function keepQuestion(goal, body) {
  return goal.needsYou ? { ...body, needs_you: goal.needsYou } : body;
}

// The session's background agents. An agent that is working again after its stop was resumed: its stop file is deleted
// (only its own), so a later stop writes a new time.
function currentAgents(input, id, root, now) {
  const stopped = readStoppedAt(id, root);
  const agents = readBackgroundAgents(input, now, stopped);
  for (const agent of agents) {
    if (agent.state === AGENT_STATE.active && agent.id in stopped) removeStoppedAgent(id, agent.id, root);
  }
  return agents;
}

// Stop: close the card, or keep it open with the agents as steps.
async function stopCard(input, env, goal, root, now, options) {
  const config = resolveConfig(env);
  const id = sessionIdOf(input);
  const agents = currentAgents(input, id, root, now);
  if (hasActiveAgent(agents)) {
    const steps = mergeSteps(goal.steps, agents);
    const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, note: CARD_NOTE, steps });
    // Held before the call, so a SubagentStop of the last agent during it already finds the hold; heldAt is then
    // the time the call returned, so its network time does not eat HELD_SLACK_MS.
    saveGoal(id, { held: true, heldAt: now }, root, now);
    const patch = (current, doneAt) => ({ sig: JSON.stringify(steps), held: true, heldAt: doneAt });
    return sendCard(config, id, root, { tool: 'report_progress', body, patch }, now, options);
  }
  return closeCard(config, goal, id, root, now, options);
}

// Marks the card done "Session stopped". A done report would clear the open question, and the person still has to
// answer it: with one open the card is left as it is.
async function closeCard(config, goal, id, root, now, options) {
  if (goal.needsYou) {
    saveGoal(id, { held: false, heldAt: 0 }, root, now); // the card is not closed, so no hold is waiting on it
    return { skipped: 'question open' };
  }
  const body = { key: goal.key, source: HOOK_SOURCE, note: NOTE.stopped };
  return sendCard(config, id, root, { tool: 'mark_done', body, patch: { closed: true, closedBy: CLOSED_BY.stop, held: false, heldAt: 0 } }, now, options);
}

// True when the main transcript was written after Stop held the card: a finished agent woke the main thread (or the
// person typed) and a turn is running, so the last SubagentStop must not close the card under it.
function mainThreadWorked(input, goal) {
  const transcript = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  try {
    return Boolean(transcript) && goal.heldAt > 0 && statSync(transcript).mtimeMs > goal.heldAt + HELD_SLACK_MS;
  } catch {
    return false; // no transcript to read: the card closes as before
  }
}

function releaseHold(id, root, now) {
  saveGoal(id, { held: false, heldAt: 0 }, root, now);
  return { skipped: 'main thread is working' };
}

// SubagentStop: the stopped agent is done; send the list only when it differs from the last one sent. When Stop
// left the card open for the agents (`held`) and none is running any more, the turn is over: the card is closed.
async function subagentCard(input, env, goal, root, now, options) {
  const id = sessionIdOf(input);
  const agents = currentAgents(input, id, root, now);
  if (goal.held && !hasActiveAgent(agents)) {
    if (mainThreadWorked(input, goal)) return releaseHold(id, root, now); // a new turn is running: its own Stop closes the card
    return closeCard(resolveConfig(env), goal, id, root, now, options);
  }
  if (!agents.length) return { skipped: 'no background agents' };
  const steps = mergeSteps(goal.steps, agents);
  const sig = JSON.stringify(steps);
  if (sig === goal.sig) return { skipped: 'steps unchanged' };
  const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, steps, ...(hasActiveAgent(agents) ? { note: CARD_NOTE } : {}) });
  return sendCard(resolveConfig(env), id, root, { tool: 'report_progress', body, patch: { sig } }, now, options);
}

// UserPromptSubmit: the work goes on, so a card the Stop hook closed is open again. A card the session itself
// finished stays finished. The person's typed prompt answers an open question: it is cleared on the board
// (needs_you null) and in the goal file, the only clearing besides the session's own null or done.
async function resumeCard(input, env, goal, root, now, options) {
  const reopen = goal.closed && goal.closedBy === CLOSED_BY.stop;
  // A new prompt means the turn is not over: a stale hold goes, whatever else happens below.
  if (goal.held) saveGoal(sessionIdOf(input), { held: false, heldAt: 0 }, root, now);
  if (goal.closed && !reopen) return { skipped: 'card not closed by Stop' };
  if (!reopen && !goal.needsYou) return { skipped: 'nothing to resume' };
  const body = {
    key: goal.key, status: 'in_progress', source: HOOK_SOURCE,
    ...(reopen ? { note: NOTE.resumed } : {}),
    ...(goal.needsYou ? { needs_you: null } : {}),
  };
  return sendCard(resolveConfig(env), sessionIdOf(input), root, { tool: 'report_progress', body, patch: resumedPatch(goal) }, now, options);
}

// The goal file after a resume. The question it cleared is cleared in the file only when the file still holds it: a
// question the session asked during the call stays. `sig` goes, so the next agent list is sent whatever the last was.
function resumedPatch(goal) {
  return (current) => ({ closed: false, closedBy: '', held: false, heldAt: 0, sig: '', needsYou: current.needsYou === goal.needsYou ? '' : current.needsYou });
}

// The session's own card, by event. Nothing without a card key and a board address (no network then).
export async function updateCard(input, env, root, now, options) {
  const id = sessionIdOf(input);
  const goal = id ? readGoal(id, root, now) : null;
  if (!goal || !goal.key || !resolveConfig(env)) return { skipped: 'no card' };
  const event = input.hook_event_name;
  if (event === EVENT.stop && !goal.closed) return stopCard(input, env, goal, root, now, options);
  if (event === EVENT.subagentStop && !goal.closed) return subagentCard(input, env, goal, root, now, options);
  if (event === EVENT.prompt) return resumeCard(input, env, goal, root, now, options);
  return { skipped: 'nothing to do' };
}

// The session stopped waiting: its waiting item is done. "no item" means it is already gone.
// The key comes from the marker (the Notification hook stored it), not from the current cwd, which may differ.
export async function markWaitingDone(input, env, root, options) {
  if (!hasMarker(input, root)) return { skipped: 'session never waited' };
  const context = sessionContext(input, env);
  if (!context) return { skipped: 'no session or token' };
  const args = { key: readMarkerKey(input, root) || context.key, source: HOOK_SOURCE, note: NOTE.stopped };
  const outcome = await callTool(context.config, 'mark_done', args, callOptions(options));
  if (outcome.ok || NO_ITEM.test(outcome.error || '')) removeMarker(input, root);
  else process.stderr.write(`report-progress hook: skipped (${outcome.error})\n`);
  return outcome;
}

// Waiting items of dead sessions (no Stop ever ran): marker and session both silent for DEAD_SESSION_MS.
// Runs in whichever session's hook comes next on this machine, never for the calling session itself.
export async function closeDeadWaiting(env, root, currentId, now, options) {
  const config = resolveConfig(env);
  if (!config) return [];
  const dead = listMarkers(root)
    .filter((marker) => marker.id !== currentId && now - marker.atMs > DEAD_SESSION_MS && now - readSeen(marker.id, root) > DEAD_SESSION_MS)
    .slice(0, SWEEP_LIMIT);
  return Promise.all(dead.map(async (marker) => {
    const outcome = await callTool(config, 'mark_done', { key: marker.key, source: HOOK_SOURCE, note: NOTE.ended }, callOptions(options));
    if (outcome.ok || NO_ITEM.test(outcome.error || '')) removeMarker({ session_id: marker.id }, root);
    else process.stderr.write(`report-progress hook: dead session card skipped (${outcome.error})\n`);
    return outcome;
  }));
}

export async function run(input, env = process.env, options = {}, now = Date.now()) {
  const root = stateRoot(env);
  const id = sessionIdOf(input);
  if (id) touchSeen(id, root, now);
  // Remembered whether or not a card is open: a later Stop must not count this agent as still working.
  if (id && input.hook_event_name === EVENT.subagentStop) addStoppedAgent(id, typeof input.agent_id === 'string' ? input.agent_id : '', root, now);
  // At once: each call has its own 2 s network timeout, and in sequence they would pass the hook's budget.
  // The dead-session sweep runs in the same group, so the worst case is one network timeout, not two in a row.
  // A subagent stopping says nothing about the main thread's pending prompt: it never closes the waiting item.
  const waiting = input.hook_event_name === EVENT.subagentStop ? { skipped: 'subagent stop' } : markWaitingDone(input, env, root, options);
  const [outcome] = await Promise.all([
    waiting,
    updateCard(input, env, root, now, options),
    closeDeadWaiting(env, root, id, now, options),
  ]);
  return outcome;
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  run(parseInput(readStdinText()))
    .catch(() => {})
    .finally(() => process.exit(0));
}
