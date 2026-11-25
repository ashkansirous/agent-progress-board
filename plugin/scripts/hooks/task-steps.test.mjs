/* global process */
// Tests for the task-tool hook (Slice 53). A local fake HTTP server stands in for the board.
// Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TASK_ID_PREFIX as P, mergeSteps, taskRowId } from './background-agents.mjs';
import { handle as remind } from './goal-reminder.mjs';
import { readCompactions, readGoal, readTasks, writeGoal } from './hook-input.mjs';
import { afterBoardReport, handle, updateTarget } from './task-steps.mjs';
import { cleanUpAfterTests, envFor, callsOf, replyOk, startFakeBoard, trackedTemp } from '../test-helpers.mjs';

const NOW = Date.now(); // goal files are aged by the real clock, so the clock under test is the real one
const MINUTE = 60 * 1000;
const T0 = NOW - 60 * MINUTE; // "10:00"
const CARD = 'demo-app/task-abc';
const BOARD_TOOL = 'mcp__plugin_agent-board_agent-board__report_progress';
const iso = (ms) => new Date(ms).toISOString();
cleanUpAfterTests();

async function setup(goal = {}) {
  const board = await startFakeBoard(replyOk);
  const root = trackedTemp('board-tasks-');
  const env = envFor(board.url, root);
  writeGoal('sess-1', { key: CARD, project: 'demo-app', title: 'Translate', why: 'for release', steps: [{ id: 's1', label: 'Write text', state: 'active' }], ...goal }, root, NOW);
  const input = (event, extra = {}) => ({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: event, ...extra });
  const created = (id, subject, extra = {}) => input('TaskCreated', { task_id: id, task_subject: subject, ...extra });
  const completed = (id, extra = {}) => input('TaskCompleted', { task_id: id, ...extra });
  const started = (id, extra = {}) => input('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: id, status: 'in_progress' }, ...extra });
  return { board, root, env, input, created, completed, started };
}

describe('task tools become card steps', () => {
  test('create, start at 10:00, complete at 10:05, then a batched done at 10:50 leaves 10:00 to 10:05 observed', async () => {
    const { board, root, env, created, completed, started } = await setup();
    await handle(created('t1', 'write  TEXT'), env, T0 - MINUTE);
    await handle(started('t1'), env, T0);
    await handle(completed('t1'), env, T0 + 5 * MINUTE);
    // The agent's own batched report arrives at 10:50 and marks the step done.
    const batched = { session_id: 'sess-1', hook_event_name: 'PostToolUse', tool_name: BOARD_TOOL, tool_input: { key: CARD, status: 'in_progress', steps: [{ id: 's1', label: 'Write text', state: 'done' }] } };
    remind(batched, env, T0 + 50 * MINUTE);
    await afterBoardReport(batched, env, T0 + 50 * MINUTE);
    board.server.close();
    const calls = callsOf(board).filter((call) => call.tool === 'report_progress');
    const last = calls[calls.length - 1].args;
    assert.equal(last.source, 'hook');
    assert.equal(last.steps.length, 1, 'a matching task fills the reported step; no second step');
    assert.deepEqual(
      { state: last.steps[0].state, started_at: last.steps[0].started_at, started_source: last.steps[0].started_source, done_at: last.steps[0].done_at, done_source: last.steps[0].done_source },
      { state: 'done', started_at: iso(T0), started_source: 'observed', done_at: iso(T0 + 5 * MINUTE), done_source: 'observed' },
    );
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('a task no reported step names is a step of its own: pending, active at the start, done at the completion', async () => {
    const { board, env, created, completed, started } = await setup();
    await handle(created('t2', 'Check links'), env, T0);
    await handle(started('t2'), env, T0 + MINUTE);
    await handle(completed('t2'), env, T0 + 2 * MINUTE);
    board.server.close();
    const sent = callsOf(board).map((call) => call.args.steps.find((step) => step.id === `${P}t2`));
    assert.deepEqual(sent.map((step) => step.state), ['pending', 'active', 'done']);
    assert.equal('started_at' in sent[0], false, 'creation is never a start');
    assert.equal(sent[1].started_at, iso(T0 + MINUTE));
    assert.deepEqual([sent[2].started_at, sent[2].done_at, sent[2].done_source], [iso(T0 + MINUTE), iso(T0 + 2 * MINUTE), 'observed']);
    assert.equal(sent[2].label, 'Check links');
  });

  test('the session\'s own steps are sent again unchanged beside the task steps', async () => {
    const { board, env, created } = await setup();
    await handle(created('t3', 'Other'), env, T0);
    board.server.close();
    const [call] = callsOf(board);
    assert.deepEqual(call.args.steps.map((step) => step.label), ['Write text', 'Other']);
  });

  test('a TaskUpdate with another status, no task id, or an unknown task with no subject changes nothing', async () => {
    const { board, root, env, started } = await setup();
    await handle({ ...started('t1'), tool_input: { taskId: 't1', status: 'completed' } }, env, T0);
    await handle({ ...started('t1'), tool_input: { status: 'in_progress' } }, env, T0);
    await handle(started('nobody'), env, T0);
    board.server.close();
    assert.equal(board.requests.length, 0);
    assert.deepEqual(readTasks('sess-1', root), []);
  });

  test('the task id is read from taskId or task_id', () => {
    assert.equal(updateTarget({ taskId: 'a', status: 'in_progress' }).taskId, 'a');
    assert.equal(updateTarget({ task_id: 'b' }).taskId, 'b');
    assert.equal(updateTarget(null).taskId, '');
  });

  test('a session with no card, or a closed card, sends nothing but keeps the task', async () => {
    const { board, root, env, created } = await setup({ closed: true, closedBy: 'session' });
    await handle(created('t4', 'Late'), env, T0);
    board.server.close();
    assert.equal(board.requests.length, 0);
    assert.equal(readTasks('sess-1', root).length, 1);
  });

  test('a compaction counts on the running task and goes out with the next report', async () => {
    const { board, root, env, input, created, started } = await setup();
    await handle(created('t5', 'Long job'), env, T0);
    await handle(started('t5'), env, T0 + MINUTE);
    await handle(input('PreCompact', { trigger: 'auto' }), env, T0 + 2 * MINUTE);
    await handle(input('PostCompact', { trigger: 'auto' }), env, T0 + 3 * MINUTE);
    assert.deepEqual(readCompactions('sess-1', root, CARD), { 'task:t5': 1 });
    await handle(created('t6', 'Next'), env, T0 + 4 * MINUTE);
    board.server.close();
    const calls = callsOf(board);
    const step = calls[calls.length - 1].args.steps.find((candidate) => candidate.id === `${P}t5`);
    assert.equal(step.compactions, 1);
  });

  test('a compaction with no task running counts on the step the session has running', async () => {
    const { board, root, env, input } = await setup();
    await handle(input('PostCompact', { trigger: 'manual' }), env, T0);
    board.server.close();
    assert.deepEqual(readCompactions('sess-1', root, CARD), { 'id:s1': 1 });
  });

  test('compaction counts belong to the card: a task left started on card A takes none of card B\'s compactions', async () => {
    const { board, root, env, input, created, started } = await setup();
    await handle(created('t3', 'Left open'), env, T0);
    await handle(started('t3'), env, T0 + MINUTE);
    writeGoal('sess-1', { key: 'demo-app/task-b', project: 'demo-app', title: 'Other', why: 'x', steps: [{ id: 's1', label: 'Build', state: 'active' }] }, root, NOW);
    await handle(input('PostCompact', { trigger: 'auto' }), env, T0 + 2 * MINUTE);
    board.server.close();
    assert.deepEqual(readCompactions('sess-1', root, 'demo-app/task-b'), { 'id:s1': 1 });
    assert.deepEqual(readCompactions('sess-1', root, CARD), {});
  });

  test('a task made inside a subagent is a child of that agent\'s row', () => {
    const agents = [{ id: 'a1', label: 'Helper', model: '', state: 'active', atMs: NOW }];
    const tasks = { items: [{ taskId: 't7', subject: 'Sub job', agentId: 'a1', createdAt: T0, startedAt: T0, doneAt: 0 }], compactions: {} };
    const steps = mergeSteps([{ id: 's1', label: 'Write text', state: 'active' }], agents, { a1: 'id:s1' }, tasks);
    const row = steps[0].children[0];
    assert.equal(row.id, 'agent-a1');
    assert.deepEqual(row.children.map((child) => [child.id, child.state]), [[`${P}t7`, 'active']]);
  });

  test('two long task ids that differ only past the cut keep two distinct row ids within the limit', () => {
    const long = 'x'.repeat(90);
    const items = [`${long}-one`, `${long}-two`].map((taskId) => ({ taskId, subject: 'Job', agentId: '', createdAt: T0, startedAt: 0, doneAt: 0 }));
    const steps = mergeSteps([], [], {}, { items, compactions: {} });
    const ids = steps.map((step) => step.id);
    assert.equal(new Set(ids).size, 2);
    assert.ok(ids.every((id) => id.length <= 80 && id.startsWith(P)));
    assert.equal(taskRowId('t1'), `${P}t1`);
  });

  test('a deleted task leaves the card; a task reopened after completion loses its end', async () => {
    const { board, root, env, created, completed, started } = await setup();
    await handle(created('d1', 'Gone soon'), env, T0);
    await handle(created('d2', 'Redo'), env, T0);
    await handle(started('d2'), env, T0 + MINUTE);
    await handle(completed('d2'), env, T0 + 2 * MINUTE);
    await handle({ ...started('d1'), tool_input: { taskId: 'd1', status: 'deleted' } }, env, T0 + 3 * MINUTE);
    assert.deepEqual(readTasks('sess-1', root).map((task) => task.taskId), ['d2']);
    await handle(started('d2'), env, T0 + 4 * MINUTE);
    board.server.close();
    const calls = callsOf(board);
    const last = calls[calls.length - 1].args.steps;
    assert.equal(last.some((step) => step.id === `${P}d1`), false);
    const redo = last.find((step) => step.id === `${P}d2`);
    assert.deepEqual([redo.state, redo.started_at, 'done_at' in redo], ['active', iso(T0 + MINUTE), false]);
  });

  test('a task belongs to the card it was created under: a new card does not show the old card\'s tasks', async () => {
    const { board, root, env, created } = await setup();
    await handle(created('a1', 'Old card task'), env, T0);
    writeGoal('sess-1', { key: 'demo-app/task-next', project: 'demo-app', title: 'Next', why: 'w', steps: [{ id: 'n1', label: 'Next step', state: 'active' }] }, root, NOW);
    await handle(created('b1', 'New card task'), env, T0 + MINUTE);
    board.server.close();
    const calls = callsOf(board);
    assert.deepEqual(calls[calls.length - 1].args.steps.map((step) => step.id), ['n1', `${P}b1`]);
  });

  test('a helper report (under its row or whole) sends nothing: the board keeps the mirrored rows', async () => {
    const { board, root, env, created } = await setup();
    await handle(created('h1', 'Mirrored'), env, T0);
    const before = callsOf(board).length;
    const base = { session_id: 'sess-1', hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: BOARD_TOOL };
    await afterBoardReport({ ...base, tool_input: { key: CARD, under_step: 'agent-a1', steps: [{ label: 'own', state: 'active' }] } }, env, T0 + MINUTE);
    await afterBoardReport({ ...base, tool_input: { key: CARD, steps: [{ label: 'own', state: 'active' }] } }, env, T0 + MINUTE);
    board.server.close();
    assert.equal(callsOf(board).length, before);
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('deleting the last task sends the list with no task rows, and an unchanged list is not sent again', async () => {
    const { board, root, env, created, started } = await setup();
    await handle(created('x1', 'Only task'), env, T0);
    await handle({ ...started('x1'), tool_input: { taskId: 'x1', status: 'deleted' } }, env, T0 + MINUTE);
    const calls = callsOf(board);
    assert.equal(readTasks('sess-1', root).length, 0);
    assert.deepEqual(calls[calls.length - 1].args.steps.map((step) => step.id), ['s1']);
    const count = calls.length;
    await handle({ ...started('x1'), tool_input: { taskId: 'x1', status: 'deleted' } }, env, T0 + 2 * MINUTE);
    board.server.close();
    assert.equal(callsOf(board).length, count);
  });

  test('a task made with no card open binds to the first card that shows it, once', async () => {
    const { board, root, env, created } = await setup();
    writeGoal('sess-1', { key: CARD, project: 'demo-app', title: 'Translate', why: 'w', steps: [{ id: 's1', label: 'Write text', state: 'active' }], closed: true }, root, NOW);
    await handle(created('n1', 'Made with no card'), env, T0);
    assert.equal(readTasks('sess-1', root)[0].cardKey, '');
    writeGoal('sess-1', { key: 'demo-app/task-first', project: 'demo-app', title: 'First', why: 'w', steps: [{ id: 'f1', label: 'First step', state: 'active' }] }, root, NOW);
    await handle(created('n2', 'Second'), env, T0 + MINUTE);
    assert.equal(readTasks('sess-1', root).find((task) => task.taskId === 'n1').cardKey, 'demo-app/task-first');
    writeGoal('sess-1', { key: 'demo-app/task-second', project: 'demo-app', title: 'Second', why: 'w', steps: [{ id: 'g1', label: 'Other', state: 'active' }] }, root, NOW);
    await handle(created('n3', 'Third'), env, T0 + 2 * MINUTE);
    board.server.close();
    const calls = callsOf(board);
    assert.deepEqual(calls[calls.length - 1].args.steps.map((step) => step.id), ['g1', `${P}n3`]);
  });

  test('a completion seen before the task has a name is kept and shows once the creation names it', async () => {
    const { board, root, env, created, completed } = await setup();
    const result = await handle(completed('late'), env, T0);
    assert.equal(result.skipped, 'nothing to send');
    assert.equal(readTasks('sess-1', root)[0].doneAt, T0);
    await handle(created('late', 'Named later'), env, T0 + MINUTE);
    board.server.close();
    const calls = callsOf(board);
    const step = calls[calls.length - 1].args.steps.find((candidate) => candidate.id === `${P}late`);
    assert.deepEqual([step.label, step.state], ['Named later', 'done']);
  });

  test('a hook report never passes the board\'s 200 steps: the reported steps stay, the oldest finished tasks go first', () => {
    const own = Array.from({ length: 150 }, (_, index) => ({ id: `r${index}`, label: `Reported ${index}`, state: 'done' }));
    const items = Array.from({ length: 100 }, (_, index) => ({ taskId: `k${index}`, subject: `Task ${index}`, agentId: '', createdAt: T0 + index, startedAt: T0, doneAt: index < 90 ? T0 + 1 : 0 }));
    const steps = mergeSteps(own, [], {}, { items, compactions: {} });
    assert.equal(steps.length, 200);
    assert.equal(steps.slice(0, 150).every((step, index) => step.id === `r${index}`), true);
    const kept = steps.slice(150).map((step) => step.id);
    assert.equal(kept.includes(`${P}k99`), true, 'running tasks are kept');
    assert.equal(kept.includes(`${P}k0`), false, 'the oldest finished task is dropped');
  });

  test('a task of an agent with no row is a top-level step', () => {
    const tasks = { items: [{ taskId: 't8', subject: 'Orphan', agentId: 'gone', createdAt: T0, startedAt: 0, doneAt: 0 }], compactions: {} };
    const steps = mergeSteps([{ id: 's1', label: 'Write text', state: 'active' }], [], {}, tasks);
    assert.deepEqual(steps.map((step) => step.id), ['s1', `${P}t8`]);
  });
});
