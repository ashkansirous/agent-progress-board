#!/usr/bin/env node
/* global process */
// UserPromptSubmit and PostToolUse hook. Two jobs, both on local files only (no network, no git):
// - It keeps the session's own card key: a main-thread call of the board's report_progress tool (agent "session")
//   is written to `<id>.goal.json`, so session-done.mjs knows which card to close, reopen or add agent steps to.
// - A session whose card has no goal since the current prompt is reminded once, at its second tool call, to
//   report goal, purpose and steps (`<id>.prompt.json`, `<id>.goal.json`).
// Never blocks: a missing or broken state file means no reminder, and the exit code is always 0.
// - After a main-thread tool call it closes the session's waiting item, if a marker exists (a prompt was answered).
// Input (stdin JSON): session_id, hook_event_name, tool_name, tool_input, agent_id.
// Output: PostToolUse additionalContext, or nothing.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STEPS_MAX, STEP_ID_MAX, STEP_LABEL_MAX, STEP_NOTE_MAX, activeTaskCard } from '../report-progress.mjs';
import { STEP_DEPTH_MAX } from './background-agents.mjs';
import { markWaitingDone } from './session-done.mjs';
import { CLOSED_BY, parseInput, readGoal, readPrompt, readStdinText, sessionIdOf, stateRoot, touchSeen, updateGoal, writePrompt } from './hook-input.mjs';

export const REMIND_AT_TOOL = 2;
export const REMINDER_TEXT = 'This session has no board card with a goal for the current prompt. The agent-board skill says to call the board\'s report_progress tool with the goal, what it is for and the steps, unless the turn is a one-line answer.';
const EVENT = { prompt: 'UserPromptSubmit', tool: 'PostToolUse' };
const SESSION_AGENT = 'session'; // the agent kind the board's reporting rules give the session's own card
const BOARD_TOOL = /^mcp__(?:plugin_agent-board_)?agent-board__(report_progress|mark_done)$/;
const STEP_STATES = new Set(['done', 'active', 'pending']);

function text(value) {
  return typeof value === 'string' ? value : '';
}

// The session's steps as it sent them, ids and children included, so the hooks can send them again unchanged. At most
// STEPS_MAX nodes in all (nested ones count) and STEP_DEPTH_MAX levels: what the board would refuse is cut here.
function stepLevel(list, depth, budget) {
  const out = [];
  for (const step of list) {
    if (budget.left <= 0) break;
    if (!step || typeof step.label !== 'string' || !STEP_STATES.has(step.state)) continue;
    budget.left -= 1;
    const children = Array.isArray(step.children) && depth < STEP_DEPTH_MAX ? stepLevel(step.children, depth + 1, budget) : null;
    out.push({
      ...(typeof step.id === 'string' && step.id ? { id: step.id.slice(0, STEP_ID_MAX) } : {}),
      label: step.label.slice(0, STEP_LABEL_MAX),
      state: step.state,
      ...(step.note ? { note: String(step.note).slice(0, STEP_NOTE_MAX) } : {}),
      ...(children ? { children } : {}),
    });
  }
  return out;
}

function stepsOf(value) {
  return Array.isArray(value) ? stepLevel(value, 1, { left: STEPS_MAX }) : null;
}

// The open question after this report: the board clears it on done, on needs_you null and on a text-less
// in_progress report from another status, so the hooks keep what the session last sent until one of those.
function openQuestion(call, base, closed) {
  if (closed || call.needs_you === null) return '';
  return text(call.needs_you) || base.needsYou || '';
}

// The tool call's report on the session's own card, as a goal-file update; null when it is for another card.
// The first report with agent "session" names the card; later calls count while they use that key.
export function cardUpdate(input, goal) {
  const match = BOARD_TOOL.exec(typeof input.tool_name === 'string' ? input.tool_name : '');
  const call = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const key = text(call.key);
  if (!match || !key) return null;
  // A report with under_step is a helper's list of children of one step: it changes none of the session's own fields
  // (steps, title, why, closed, question), whatever status or title it carries.
  if (call.under_step) return null;  if (!(goal && goal.key === key) && !(match[1] === 'report_progress' && call.agent === SESSION_AGENT)) return null;
  const steps = stepsOf(call.steps);
  const base = goal && goal.key === key ? goal : { goalAt: undefined, title: '', why: '', steps: [] };
  const closed = match[1] === 'mark_done' || call.status === 'done';
  return {
    ...base,
    key,
    project: text(call.project) || base.project || '',
    title: text(call.title) || base.title,
    why: text(call.why) || base.why,
    steps: steps || base.steps,
    sig: steps ? '' : base.sig || '', // a list the session just sent is not what the hooks last sent
    closed,
    closedBy: closed ? CLOSED_BY.session : '',
    needsYou: openQuestion(call, base, closed),
    goalAt: call.title ? undefined : base.goalAt, // a report with a title is a goal report: its time is now
  };
}

// The goal file is read again right before this write (updateGoal), so a hook's own write (session-done.mjs saveGoal) is kept.
function recordCard(input, id, root, now) {
  updateGoal(id, root, now, (current) => {
    const update = cardUpdate(input, current);
    if (!update) return null;
    const { goalAt, ...rest } = update;
    return { ...rest, at: now, ...(goalAt === undefined ? {} : { goalAt }) };
  });
}

// The reminder JSON for this hook call, or '' when none is due. Updates the prompt and goal state.
export function handle(input, env = process.env, now = Date.now(), options = {}) {
  const id = sessionIdOf(input);
  if (!id) return '';
  const root = stateRoot(env);
  touchSeen(id, root, now);
  if (input.hook_event_name === EVENT.prompt) {
    writePrompt(id, { at: now, tools: 0, reminded: false }, root);
    return '';
  }
  if (input.hook_event_name !== EVENT.tool) return '';
  // A subagent's tool call carries the parent's session_id plus `agent_id` (Claude Code hooks, common
  // input fields): it counts toward no prompt, names no card and gets no reminder. `agent_type` is not used: a
  // session started with --agent has it on the main thread too.
  if (typeof input.agent_id === 'string' && input.agent_id) return '';
  recordCard(input, id, root, now);
  const prompt = readPrompt(id, root, now);
  if (!prompt || prompt.reminded) return '';
  const tools = prompt.tools + 1;
  const goal = readGoal(id, root, now);
  const hasTask = activeTaskCard(id, { taskRoot: options.taskRoot || root, now });
  const goalSent = Boolean(goal) && goal.goalAt >= prompt.at;
  const due = tools >= REMIND_AT_TOOL && !hasTask && !goalSent;
  writePrompt(id, { at: prompt.at, tools, reminded: due || prompt.reminded }, root);
  if (!due) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT.tool, additionalContext: REMINDER_TEXT } });
}

// A main-thread tool call finished, so a prompt the session was waiting on is answered: its waiting item is done.
// Only a file-exists check when the session never waited; a subagent's tool call says nothing about the main thread.
export async function closeAnsweredWaiting(input, env = process.env, options = {}) {
  if (input.hook_event_name !== EVENT.tool || (typeof input.agent_id === 'string' && input.agent_id)) return { skipped: 'not a main-thread tool call' };
  return markWaitingDone(input, env, stateRoot(env), options);
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = 0; // set first, so nothing below can leave another code; not process.exit: a pending stdout write on a pipe would be cut
  const input = parseInput(readStdinText());
  try {
    const out = handle(input);
    if (out) process.stdout.write(out);
  } catch { /* fail open */ }
  Promise.resolve()
    .then(() => closeAnsweredWaiting(input))
    .catch(() => {})
    .finally(() => { process.exitCode = 0; });
}
