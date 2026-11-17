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
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool, resolveConfig } from '../report-progress.mjs';
import { CARD_NOTE, hasActiveAgent, mergeSteps, readBackgroundAgents } from './background-agents.mjs';
import {
  CLOSED_BY, HOOK_SOURCE, HOOK_TIMEOUT_MS, addStoppedAgent, hasMarker, listMarkers, parseInput, readGoal, readMarkerKey, readSeen, readStdinText,
  readStoppedAgents, removeMarker, sessionContext, sessionIdOf, stateRoot, touchSeen, writeGoal,
} from './hook-input.mjs';

export const DEAD_SESSION_MS = 30 * 60 * 1000; // a waiting card whose session sent nothing for this long is closed
export const EVENT = { stop: 'Stop', subagentStop: 'SubagentStop', prompt: 'UserPromptSubmit' };
export const NOTE = { stopped: 'Session stopped', resumed: 'Session resumed', ended: 'Session ended' };
const SWEEP_LIMIT = 5; // dead waiting cards closed per run, so one hook never passes its time budget
const NO_ITEM = /no item/;

function callOptions(options) {
  return { timeoutMs: HOOK_TIMEOUT_MS, ...options };
}

// Saves the goal file with the closed flag and the list last sent; the goal time stays as it was. The file is read
// again here: the network call before it takes up to 2 s, and the session's own report may have changed the file
// meanwhile, so only the fields in `patch` are written over the file's current content.
function saveGoal(id, goal, patch, root, now) {
  const current = readGoal(id, root, now) || goal;
  writeGoal(id, { ...current, at: now, ...patch }, root, now);
}

async function sendCard(config, goal, id, root, args, now, options) {
  const outcome = await callTool(config, args.tool, args.body, callOptions(options));
  const gone = !outcome.ok && NO_ITEM.test(outcome.error || '');
  if (outcome.ok || gone) saveGoal(id, goal, args.patch, root, now);
  else process.stderr.write(`report-progress hook: card skipped (${outcome.error})\n`); // state unchanged: the next hook retries
  return outcome;
}

// Every in_progress report of the hooks repeats the session's open question: the board clears one that a
// report moving the card to in_progress leaves out (answersQuestion in src/domain/upsert.ts).
function keepQuestion(goal, body) {
  return goal.needsYou ? { ...body, needs_you: goal.needsYou } : body;
}

// Stop: close the card, or keep it open with the agents as steps.
async function stopCard(input, env, goal, root, now, options) {
  const config = resolveConfig(env);
  const id = sessionIdOf(input);
  const agents = readBackgroundAgents(input, now, readStoppedAgents(id, root, now));
  if (hasActiveAgent(agents)) {
    const steps = mergeSteps(goal.steps, agents);
    const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, note: CARD_NOTE, steps });
    return sendCard(config, goal, id, root, { tool: 'report_progress', body, patch: { sig: JSON.stringify(steps) } }, now, options);
  }
  // A done report would clear the open question, and the person still has to answer it: leave the card as it is.
  if (goal.needsYou) return { skipped: 'question open' };
  const body = { key: goal.key, source: HOOK_SOURCE, note: NOTE.stopped };
  return sendCard(config, goal, id, root, { tool: 'mark_done', body, patch: { closed: true, closedBy: CLOSED_BY.stop } }, now, options);
}

// SubagentStop: the stopped agent is done; send the list only when it differs from the last one sent.
async function subagentCard(input, env, goal, root, now, options) {
  const id = sessionIdOf(input);
  const agents = readBackgroundAgents(input, now, readStoppedAgents(id, root, now));
  if (!agents.length) return { skipped: 'no background agents' };
  const steps = mergeSteps(goal.steps, agents);
  const sig = JSON.stringify(steps);
  if (sig === goal.sig) return { skipped: 'steps unchanged' };
  const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, steps, ...(hasActiveAgent(agents) ? { note: CARD_NOTE } : {}) });
  return sendCard(resolveConfig(env), goal, sessionIdOf(input), root, { tool: 'report_progress', body, patch: { sig } }, now, options);
}

// UserPromptSubmit: the work goes on, so a card the Stop hook closed is open again. A card the session itself
// finished stays finished. The person's typed prompt answers an open question: it is cleared on the board
// (needs_you null) and in the goal file, the only clearing besides the session's own null or done.
async function resumeCard(input, env, goal, root, now, options) {
  const reopen = goal.closed && goal.closedBy === CLOSED_BY.stop;
  if (goal.closed && !reopen) return { skipped: 'card not closed by Stop' };
  if (!reopen && !goal.needsYou) return { skipped: 'nothing to resume' };
  const body = {
    key: goal.key, status: 'in_progress', source: HOOK_SOURCE,
    ...(reopen ? { note: NOTE.resumed } : {}),
    ...(goal.needsYou ? { needs_you: null } : {}),
  };
  return sendCard(resolveConfig(env), goal, sessionIdOf(input), root, { tool: 'report_progress', body, patch: { closed: false, closedBy: '', needsYou: '' } }, now, options);
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
