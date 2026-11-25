#!/usr/bin/env node
/* global process */
// TaskCreated, TaskCompleted, PostToolUse (matcher TaskUpdate), PreCompact and PostCompact hook (Slice 53): the session's
// own task list (Claude Code's task tools) becomes steps of its bound card, with the times the hooks saw.
// - TaskCreated / TaskCompleted: input `task_id`, `task_subject`, `agent_id` (inside a subagent). No time in the input: the
//   hook's own clock is the observed time (completed = the step's end). A task is never timed from its creation.
// - PostToolUse TaskUpdate: `tool_input` task id (`taskId` or `task_id`) and `status`; `in_progress` starts the step. The subject
//   is the one TaskCreated stored; an input with neither a known task nor a subject is ignored.
// - PreCompact / PostCompact: one compaction counted on the step running on the session's own card; sent with the next step report.
// Local files only, then one report through sendCardReport (session-done.mjs `resendSteps`) when the session has a card.
// Never blocks, never prints a decision, never reads a transcript; the exit code is always 0.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isOrchestrator } from '../report-progress.mjs';
import { runningKey, taskCountKey } from './background-agents.mjs';
import { addCompaction, parseInput, readGoal, readStdinText, readTask, readTasks, removeTask, sessionIdOf, stateRoot, takeCompacting, touchSeen, writeCompacting, writeTask } from './hook-input.mjs';

export const EVENT = { created: 'TaskCreated', completed: 'TaskCompleted', tool: 'PostToolUse', preCompact: 'PreCompact', postCompact: 'PostCompact' };
const TASK_UPDATE_TOOL = 'TaskUpdate';
const IN_PROGRESS = 'in_progress';
const DELETED = 'deleted';
const BOARD_REPORT_TOOL = /^mcp__(?:plugin_agent-board_)?agent-board__report_progress$/;

function text(value) {
  return typeof value === 'string' ? value : '';
}

function agentOf(input) {
  return text(input.agent_id);
}

// The task id of a TaskUpdate call: `taskId` or `task_id` (the docs do not name the key).
export function updateTarget(toolInput) {
  const call = toolInput && typeof toolInput === 'object' ? toolInput : {};
  return { taskId: text(call.taskId) || text(call.task_id), status: text(call.status), subject: text(call.subject) };
}

// The one matching rule (Slice 53 Decision 2): a task and a reported step are the same step when their labels are equal
// ignoring case and spaces.
export function sameLabel(left, right) {
  const flat = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
  return flat(left) === flat(right);
}

// The key of the card open now, '' when none: a task belongs to the card it was created under.
function openCardKey(id, root, now) {
  const goal = readGoal(id, root, now);
  return goal && goal.key && !goal.closed ? goal.key : '';
}

function blankTask(taskId, subject, agentId, now, cardKey) {
  return { taskId, subject, agentId, cardKey, createdAt: now, startedAt: 0, doneAt: 0 };
}

function recordCreated(input, id, root, now) {
  const taskId = text(input.task_id);
  if (!taskId) return false;
  const known = readTask(id, taskId, root);
  writeTask(id, { ...(known || blankTask(taskId, '', agentOf(input), now, openCardKey(id, root, now))), subject: text(input.task_subject) || (known ? known.subject : '') }, root);
  return true;
}

function recordCompleted(input, id, root, now) {
  const taskId = text(input.task_id);
  if (!taskId) return false;
  const known = readTask(id, taskId, root) || blankTask(taskId, text(input.task_subject), agentOf(input), now, openCardKey(id, root, now));
  if (known.doneAt) return false; // the first completion is the one seen
  writeTask(id, { ...known, doneAt: now }, root); // kept even with no name yet: its creation gives the name later
  return Boolean(known.subject); // a task with no name is no step, so nothing is sent until it has one
}

function recordUpdate(input, id, root, now) {
  const { taskId, status, subject } = updateTarget(input.tool_input);
  if (!taskId) return false;
  if (status === DELETED) return deleteTask(id, taskId, root);
  if (status !== IN_PROGRESS) return false;
  const known = readTask(id, taskId, root) || blankTask(taskId, subject, agentOf(input), now, openCardKey(id, root, now));
  if (!known.subject) return false; // no name
  if (known.doneAt) { // reopened after completion: the end is cleared, the first start stays
    writeTask(id, { ...known, startedAt: known.startedAt || now, doneAt: 0 }, root);
    return true;
  }
  if (known.startedAt) return false; // already started: the first start is the one seen
  writeTask(id, { ...known, startedAt: now }, root);
  return true;
}

// A deleted task leaves the list; true when there was one to remove.
function deleteTask(id, taskId, root) {
  if (!readTask(id, taskId, root)) return false;
  removeTask(id, taskId, root);
  return true;
}

// The step key a compaction is counted on: the main thread's task running now, else the step the session's own report has running.
// Only the open card's own tasks count (a task of an earlier card, or one made with no card open, is not this card's).
export function compactionKey(id, root, now) {
  const card = openCardKey(id, root, now);
  const running = readTasks(id, root).filter((task) => !task.agentId && task.startedAt && !task.doneAt && (!task.cardKey || task.cardKey === card));
  if (running.length) return taskCountKey(running[running.length - 1].taskId);
  const goal = readGoal(id, root, now);
  return goal ? runningKey(goal.steps) : '';
}

function recordCompaction(event, id, root, now) {
  if (event === EVENT.preCompact) {
    writeCompacting(id, compactionKey(id, root, now), openCardKey(id, root, now), root, now);
    return;
  }
  const noted = takeCompacting(id, root) || { key: compactionKey(id, root, now), card: openCardKey(id, root, now) };
  addCompaction(id, noted.key, noted.card, root, now);
}

// What the event changed in the state files; true when a step report may be due. Compactions are sent with the next report.
export function record(input, id, root, now) {
  switch (input.hook_event_name) {
    case EVENT.created: return recordCreated(input, id, root, now);
    case EVENT.completed: return recordCompleted(input, id, root, now);
    case EVENT.tool: return input.tool_name === TASK_UPDATE_TOOL && recordUpdate(input, id, root, now);
    case EVENT.preCompact:
    case EVENT.postCompact:
      recordCompaction(input.hook_event_name, id, root, now);
      return false;
    default: return false;
  }
}

// The report after a change: the card's whole list with the session's tasks in it. Nothing for a session with no open card.
async function sendIfOpen(input, env, id, root, now, options) {
  const goal = readGoal(id, root, now);
  if (!goal || !goal.key || goal.closed) return { skipped: 'no open card' };
  if (isOrchestrator(id, { root, now })) return { skipped: 'orchestrator' };
  // Loaded here, not at the top: session-done.mjs needs background-agents.mjs, which imports the matching rule from this file.
  const { resendSteps } = await import('./session-done.mjs');
  return resendSteps(input, env, goal, root, now, options);
}

// The session's own board report (a main-thread report_progress) changed its steps: the observed times of a task whose label
// it names go on again, so a batched "done" never leaves the step with a guessed time. Called by goal-reminder.mjs after it
// recorded the report.
export async function afterBoardReport(input, env = process.env, now = Date.now(), options = {}) {
  const id = sessionIdOf(input);
  if (!id || input.hook_event_name !== EVENT.tool || !BOARD_REPORT_TOOL.test(text(input.tool_name))) return { skipped: 'not a board report' };
  const call = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  // A helper's report (whole or under its row) never touches the mirrored task rows: the board keeps them (src/domain/steps.ts
  // `keepMirroredRows`), so nothing is sent for it.
  if (call.under_step || text(input.agent_id)) return { skipped: 'not a board report' };
  const root = stateRoot(env);
  if (readTasks(id, root).length === 0) return { skipped: 'no tasks' };
  return sendIfOpen(input, env, id, root, now, options);
}

export async function handle(input, env = process.env, now = Date.now(), options = {}) {
  const id = sessionIdOf(input);
  if (!id) return { skipped: 'no session' };
  const root = stateRoot(env);
  touchSeen(id, root, now);
  if (!record(input, id, root, now)) return { skipped: 'nothing to send' };
  return sendIfOpen(input, env, id, root, now, options);
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = 0;
  const input = parseInput(readStdinText());
  Promise.resolve()
    .then(() => handle(input))
    .catch(() => {}) // fail open
    .finally(() => { process.exitCode = 0; });
}
