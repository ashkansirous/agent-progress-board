#!/usr/bin/env node
/* global process */
// Stop, SubagentStop and UserPromptSubmit hook: keeps the session's cards true. Fails open: never blocks, always exit 0.
// - Stop: the session's own card (the key its MCP report_progress calls used, kept by goal-reminder.mjs) is
//   marked done "Session stopped", unless a background agent's record changed in the last 10 minutes: then the
//   card stays in_progress with the note "background agents running" and one step per agent.
// - SubagentStart: the agent's place (the step running now) is recorded, its row is sent, and its helper is told its
//   card key and row id (additionalContext).
// - SubagentStop: the finished agent's step turns done (only when the list changed).
// - UserPromptSubmit: a card closed by Stop is reopened ("Session resumed").
// - Stop and UserPromptSubmit (not SubagentStop): the `<project>/waiting-<id>` waiting item of this session (key from
//   its marker) is marked done; goal-reminder.mjs does the same after a main-thread tool call. All three: the waiting items
//   of sessions on this machine that sent nothing for 30 minutes are closed "Session ended".
// Input (stdin JSON): session_id, cwd, hook_event_name, transcript_path, agent_id. Env as in report-progress.mjs.
import { realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOrchestrator, resolveConfig } from '../report-progress.mjs';
import { AGENT_FRESH_MS, AGENT_PREFIX, AGENT_STATE, CARD_NOTE, RESUME_SLACK_MS, agentRowId, hasActiveAgent, hasAgentMeta, isForegroundAgent, mergeSteps, placeAgents, readBackgroundAgents, subagentsDir } from './background-agents.mjs';
import {
  CLOSED_BY, HOOK_SOURCE, ORCH_CLOSE, HOOK_TIMEOUT_MS, addStoppedAgent, hasMarker, listMarkers, parseInput, readGoal, readMarkerKey, readSeen, readStdinText,
  readStoppedAt, removeMarker, removeStoppedAgent, sendCardReport, sessionContext, sessionIdOf, stateRoot, touchSeen, updateGoal,
} from './hook-input.mjs';

export const DEAD_SESSION_MS = 30 * 60 * 1000; // a waiting card whose session sent nothing for this long is closed
export const EVENT = { stop: 'Stop', subagentStart: 'SubagentStart', subagentStop: 'SubagentStop', prompt: 'UserPromptSubmit' };
export const NOTE = { stopped: 'Session stopped', resumed: 'Session resumed', ended: 'Session ended' };
const HELD_SLACK_MS = RESUME_SLACK_MS; // transcript writes this soon after Stop belong to the Stop itself
const PENDING_AGENT_MS = AGENT_FRESH_MS; // an agent with no files yet keeps its row this long from its recorded start
const CLOSING_WINDOW_MS = HOOK_TIMEOUT_MS + 500; // a close that started this recently may still be in flight
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

// The recorded places after another write: what the file holds now wins, and only the places it lacks are added, so a
// concurrent hook's entry is never dropped by one that read the file earlier.
function mergeParents(current, parents) {
  return { ...parents, ...(current.agentParents || {}) };
}

async function sendCard(config, id, root, args, now, options) {
  const started = Date.now();
  const outcome = await sendCardReport(root, 'session-done', id, config, args.tool, args.body, callOptions(options));
  const gone = !outcome.ok && NO_ITEM.test(outcome.error || '');
  if (outcome.ok || gone) saveGoal(id, args.patch, root, now, now + (Date.now() - started));
  else process.stderr.write(`report-progress hook: card skipped (${outcome.error})\n`); // state unchanged: the next hook retries
  return outcome;
}

// Every in_progress report of the hooks repeats the session's open question: the board clears one that a
// report moving the card to in_progress leaves out (answersQuestion in src/domain/upsert.ts).
// A slice card's status is doc sync's: its hook reports carry none, so they never move it.
function keepQuestion(goal, body) {
  const sent = goal.slice ? withoutStatus(body) : body;
  return goal.needsYou ? { ...sent, needs_you: goal.needsYou } : sent;
}

function withoutStatus(body) {
  const rest = { ...body };
  delete rest.status;
  return rest;
}

// The session's background agents. An agent that is working again after its stop was resumed: its stop file is deleted
// (only its own), so a later stop writes a new time.
function currentAgents(input, id, root, now) {
  const stopped = readStoppedAt(id, root);
  const agents = readBackgroundAgents(input, now, stopped);
  for (const agent of agents) {
    if (agent.state === AGENT_STATE.active && Object.hasOwn(stopped, agent.id)) removeStoppedAgent(id, agent.id, root);
  }
  return agents;
}

// Stop: close the card, or keep it open with the agents as steps.
async function stopCard(input, env, goal, root, now, options) {
  const config = resolveConfig(env);
  const id = sessionIdOf(input);
  const agents = knownAgents(input, currentAgents(input, id, root, now), goal.agentParents, goal.agentStarts, now);
  if (hasActiveAgent(agents)) {
    const parents = placeAgents(goal.steps, agents, goal.agentParents);
    const steps = mergeSteps(goal.steps, agents, parents);
    const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, note: CARD_NOTE, steps });
    const sentAt = Date.now(); // taken before the hold is written: a close that sees the hold is written at or after it
    // Held before the call, so a SubagentStop of the last agent during it already finds the hold; heldAt is then
    // the time the call returned, so its network time does not eat HELD_SLACK_MS.
    saveGoal(id, (current) => ({ ...heldFields(current, now), agentParents: mergeParents(current, parents) }), root, now);
    const patch = (current, doneAt) => ({ sig: JSON.stringify(steps), ...heldFields(current, doneAt), agentParents: mergeParents(current, parents) });
    const outcome = await sendCard(config, id, root, { tool: 'report_progress', body, patch }, now, options);
    return reCloseIfClosedMeanwhile(config, id, root, outcome, sentAt, options);
  }
  return closeCard(config, goal, id, root, now, options);
}

// The held report above takes up to 2 s: the last SubagentStop may have closed the card during it, and the board would
// then keep this older in_progress report over the close. The goal file says whether that happened, so the close is
// sent once more, after the report (Slice 45, Slice 29 follow-up #2).
// `closedAt` is the clock time of the close's write to the goal file (closeFields), so only a close written at or after
// `sentAt`, the clock before the hold was written (so before any close that can see the hold), counts: a close from before the report never re-closes.
async function reCloseIfClosedMeanwhile(config, id, root, outcome, sentAt, options) {
  const after = readGoal(id, root, Date.now());
  if (!outcome.ok || !after || !closeLaterThan(after, sentAt)) return outcome;
  process.stderr.write('report-progress hook: stop report landed after the close, closing again\n');
  const body = { key: after.key, source: HOOK_SOURCE, note: NOTE.stopped };
  return sendCard(config, id, root, { tool: 'mark_done', body, patch: closeFields }, Date.now(), options);
}

// The one rule for "a later close wins": a close is later than a report sent at `sentAt` when it was written at or after
// it (`closedAt`), or is still in flight (`closing`, written before the close call and cleared when the call ends, on every outcome
// (closeCard's finally), so it is set only by a close that has not returned). A close in flight may land
// after the report, and the file cannot show it closed yet.
function closeLaterThan(goal, sentAt) {
  const written = goal.closed && goal.closedBy === CLOSED_BY.stop && goal.closedAt >= sentAt;
  const inFlight = goal.closing > 0 && Date.now() - goal.closing <= CLOSING_WINDOW_MS;
  return written || inFlight;
}

// The goal fields of a close, written when the close call returned: `closedAt` is the real clock then, never the hook's start time.
function closeFields() {
  return { closed: true, closedBy: CLOSED_BY.stop, closedAt: Date.now(), closing: 0, held: false, heldAt: 0 };
}

// The hold goes on only a card the file does not already show closed (another hook may have closed it meanwhile).
function heldFields(current, at) {
  return current.closed ? {} : { held: true, heldAt: at };
}

// Marks the card done "Session stopped". A done report would clear the open question, and the person still has to
// answer it: with one open the card is left as it is.
async function closeCard(config, goal, id, root, now, options) {
  if (goal.slice) {
    saveGoal(id, { held: false, heldAt: 0 }, root, now); // a slice card is never closed by a hook
    return { skipped: 'slice card' };
  }
  if (goal.needsYou) {
    saveGoal(id, { held: false, heldAt: 0 }, root, now); // the card is not closed, so no hold is waiting on it
    return { skipped: 'question open' };
  }
  const body = { key: goal.key, source: HOOK_SOURCE, note: NOTE.stopped };
  saveGoal(id, { closing: Date.now() }, root, now); // before the call, so a Stop report sent meanwhile sees the close coming
  try {
    return await sendCard(config, id, root, { tool: 'mark_done', body, patch: closeFields }, now, options);
  } finally {
    try {
      saveGoal(id, { closing: 0 }, root, now); // the close is no longer in flight, whether it succeeded, failed or threw
    } catch { /* a locked goal file must not replace the close outcome */ }
  }
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
  const agents = knownAgents(input, currentAgents(input, id, root, now), goal.agentParents, goal.agentStarts, now);
  if (goal.held && !hasActiveAgent(agents)) {
    if (mainThreadWorked(input, goal)) return releaseHold(id, root, now); // a new turn is running: its own Stop closes the card
    return closeCard(resolveConfig(env), goal, id, root, now, options);
  }
  if (!agents.length) return { skipped: 'no background agents' };
  const parents = placeAgents(goal.steps, agents, goal.agentParents);
  saveGoal(id, (current) => ({ agentParents: mergeParents(current, parents) }), root, now); // before the send: a failed send must not lose the place
  const steps = mergeSteps(goal.steps, agents, parents);
  const sig = JSON.stringify(steps);
  if (sig === goal.sig) return { skipped: 'steps unchanged' };
  const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, steps, ...(hasActiveAgent(agents) ? { note: CARD_NOTE } : {}) });
  const patch = (current) => ({ sig, agentParents: mergeParents(current, parents) });
  return sendCard(resolveConfig(env), id, root, { tool: 'report_progress', body, patch }, now, options);
}

// SubagentStart: the agent's place is recorded now (the step running when it starts, by id), before any send, and its
// row is put on the card at once, so its helper can report under `agent-<id>` from its first step. The agent's files
// may not exist yet: its row then has the plain label and the next hook run gives the description.
async function startCard(input, env, goal, root, now, options) {
  const id = sessionIdOf(input);
  const agentId = typeof input.agent_id === 'string' ? input.agent_id : '';
  if (!agentId) return { skipped: 'no agent id' };
  if (isForegroundAgent(input, agentId)) return { skipped: 'foreground agent' }; // the session waits for it: no row, no note
  const parents = placeAgents(goal.steps, [{ id: agentId }], goal.agentParents);
  saveGoal(id, (current) => ({ agentParents: mergeParents(current, { [agentId]: parents[agentId] }), agentStarts: { ...current.agentStarts, [agentId]: now } }), root, now);
  // The merged file, read after the write: another agent starting at the same time has its row in it, and the list sent
  // here replaces the board's, so it must hold every known agent, not only this one.
  const merged = readGoal(id, root, now) || goal;
  const placed = merged.agentParents || parents;
  const agents = knownAgents(input, currentAgents(input, id, root, now), placed, merged.agentStarts || {}, now);
  const steps = mergeSteps(merged.steps, agents, placed);
  const body = keepQuestion(goal, { key: goal.key, status: 'in_progress', source: HOOK_SOURCE, steps, note: CARD_NOTE });
  const patch = (current) => ({ sig: JSON.stringify(steps), agentParents: mergeParents(current, placed) });
  return sendCard(resolveConfig(env), id, root, { tool: 'report_progress', body, patch }, now, options);
}

// The listed agents plus a plain row for each recorded agent whose files do not exist yet, kept for PENDING_AGENT_MS from
// its recorded start (`starts`, the goal file's agentStarts), then dropped.
// An agent that aged out of the list has files, so it gets no row; only one with no files yet does.
// With no agent folder to look in (no usable transcript_path) nothing is known about the recorded agents: no plain rows.
function knownAgents(input, listed, parents, starts, now) {
  if (!subagentsDir(input)) return listed;
  const missing = Object.keys(parents).filter((agentId) => !listed.some((agent) => agent.id === agentId)
    && now - (starts[agentId] ?? -Infinity) <= PENDING_AGENT_MS && !hasAgentMeta(input, agentId));
  return [...listed, ...missing.map((agentId) => ({ id: agentId, label: AGENT_PREFIX, model: '', state: AGENT_STATE.active, atMs: now }))];
}

// What the new agent is told (hookSpecificOutput.additionalContext): its card key and its own row id. '' without a card.
export function startContext(input, env, root, now = Date.now()) {
  const id = sessionIdOf(input);
  const goal = id ? readGoal(id, root, now) : null;
  const agentId = typeof input.agent_id === 'string' ? input.agent_id : '';
  if (!goal || !goal.key || !agentId || !resolveConfig(env) || isForegroundAgent(input, agentId)) return '';
  const row = agentRowId(agentId);
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'report-progress.mjs');
  const text = `Board card: key "${goal.key}". Your own row on it is the step with id "${row}". To show your steps there, report them with under_step "${row}" (the board's report_progress tool with key, under_step and steps, or: node "${script}" --key "${goal.key}" --steps "a|b|c" --under-step ${row}). Do not report any other step or open a card of your own.`;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT.subagentStart, additionalContext: text } });
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
    key: goal.key, source: HOOK_SOURCE,
    ...(goal.slice ? {} : { status: 'in_progress' }),
    ...(reopen ? { note: NOTE.resumed } : {}),
    ...(goal.needsYou ? { needs_you: null } : {}),
  };
  return sendCard(resolveConfig(env), sessionIdOf(input), root, { tool: 'report_progress', body, patch: resumedPatch(goal) }, now, options);
}

// The goal file after a resume. The question it cleared is cleared in the file only when the file still holds it: a
// question the session asked during the call stays. `sig` goes, so the next agent list is sent whatever the last was.
function resumedPatch(goal) {
  return (current) => ({ closed: false, closedBy: '', closedAt: 0, closing: 0, held: false, heldAt: 0, sig: '', needsYou: current.needsYou === goal.needsYou ? '' : current.needsYou });
}

// A session marked an orchestrator after it reported a card: that card is closed once, at the next hook, and the
// goal file keeps it closed (the heartbeat has stopped, so it would only turn stale).
async function closeOrchestratorCard(goal, id, env, root, now, options) {
  if (goal.closed || goal.slice) return { skipped: 'orchestrator' };
  // One attempt per card, sent or failed: a board that is down never makes every later hook wait on the call again.
  if (goal.orchClose && goal.orchClose.key === goal.key) return { skipped: `orchestrator close already ${goal.orchClose.outcome}` };
  const outcome = await closeCard(resolveConfig(env), goal, id, root, now, options);
  saveGoal(id, { orchClose: { key: goal.key, outcome: outcome.ok ? ORCH_CLOSE.sent : ORCH_CLOSE.failed } }, root, now);
  return outcome;
}

// The session's own card, by event. Nothing without a card key and a board address (no network then).
export async function updateCard(input, env, root, now, options) {
  const id = sessionIdOf(input);
  const goal = id ? readGoal(id, root, now) : null;
  if (!goal || !goal.key || !resolveConfig(env)) return { skipped: 'no card' };
  if (isOrchestrator(id, { root, now })) return closeOrchestratorCard(goal, id, env, root, now, options);
  const event = input.hook_event_name;
  if (event === EVENT.stop && !goal.closed) return stopCard(input, env, goal, root, now, options);
  if (event === EVENT.subagentStart && !goal.closed) return startCard(input, env, goal, root, now, options);
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
  const outcome = await sendCardReport(root, 'session-done', sessionIdOf(input), context.config, 'mark_done', args, callOptions(options));
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
    const outcome = await sendCardReport(root, 'session-done:sweep', marker.id, config, 'mark_done', { key: marker.key, source: HOOK_SOURCE, note: NOTE.ended }, callOptions(options));
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
  const fromAgent = input.hook_event_name === EVENT.subagentStop || input.hook_event_name === EVENT.subagentStart;
  const waiting = fromAgent ? { skipped: 'subagent event' } : markWaitingDone(input, env, root, options);
  const [outcome] = await Promise.all([
    waiting,
    updateCard(input, env, root, now, options),
    closeDeadWaiting(env, root, id, now, options),
  ]);
  return outcome;
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const hookInput = parseInput(readStdinText());
  if (hookInput.hook_event_name === EVENT.subagentStart) {
    try {
      const out = startContext(hookInput, process.env, stateRoot(process.env));
      if (out) process.stdout.write(out);
    } catch { /* fail open */ }
  }
  run(hookInput)
    .catch(() => {})
    .finally(() => process.exit(0));
}
