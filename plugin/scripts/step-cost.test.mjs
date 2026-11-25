/* global process */
// Tests for the step cost reader (Slice 54): a fixture transcript with two steps, a subagent and a compaction, made-up content.
// Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { appendFileSync, existsSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { taskRowId } from './hooks/background-agents.mjs';
import { addStoppedAgent, readGoal, removeGoal, writeGoal, writeTask } from './hooks/hook-input.mjs';
import { run } from './hooks/session-done.mjs';
import { handle } from './hooks/task-steps.mjs';
import { applyBytes, applyText, computeCosts, parseLine, readCosts, refreshCosts, settle, syncState, withCosts, writerOf } from './step-cost.mjs';
import { callsOf, cleanUpAfterTests, envFor, replyOk, startFakeBoard, trackedTemp } from './test-helpers.mjs';

cleanUpAfterTests();
const NOW = Date.now(); // goal files are aged by the real clock
const MINUTE = 60 * 1000;
const T0 = NOW - 60 * MINUTE; // 10:00
const at = (minutes, seconds = 0) => T0 + minutes * MINUTE + seconds * 1000;
const iso = (ms) => new Date(ms).toISOString();
const CARD = 'demo-app/task-abc';

function request(id, ms, model, usage, extra = {}) {
  const [input, read, write, output] = usage;
  const message = { id, model, usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: output }, content: extra.content || [] };
  return JSON.stringify({ type: 'assistant', timestamp: iso(ms), message });
}

const opens = (taskId) => [{ type: 'tool_use', name: 'TaskUpdate', input: { taskId, status: 'in_progress' } }];
const compaction = (ms) => JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: iso(ms), compactMetadata: { trigger: 'manual', preTokens: 9, postTokens: 1 } });

// m0 is streamed on two lines (the second has the final usage); m2 opens task t2 before t2's own start; m5 fits no step.
const MAIN = [
  request('m0', at(0, 30), 'model-a', [5, 1000, 200, 10]),
  request('m0', at(0, 31), 'model-a', [5, 1000, 200, 50]),
  request('m1', at(3), 'model-a', [2, 3000, 0, 100]),
  request('m2', at(4, 55), 'model-a', [1, 3500, 100, 20], { content: opens('t2') }),
  request('m3', at(8), 'model-b', [3, 5000, 0, 70]),
  compaction(at(12)),
  request('m4', at(13), 'model-b', [4, 1000, 800, 10]),
  request('m5', at(30), 'model-b', [9, 9, 9, 9]),
].join('\n') + '\n';
const SUB = request('s1', at(6), 'model-c', [7, 200, 0, 9]) + '\n';

const TASKS = [
  { taskId: 't1', subject: 'Write text', agentId: '', cardKey: CARD, createdAt: at(-1), startedAt: at(0), doneAt: at(5) },
  { taskId: 't2', subject: 'Check links', agentId: '', cardKey: CARD, createdAt: at(-1), startedAt: at(5, 10), doneAt: at(20) },
];

function stateOf(text, agent = '') {
  return { ...applyText({ path: 'x', agent, offset: 0, requests: {}, compactions: [] }, text), agent };
}

describe('reading a transcript', () => {
  test('merges the lines of one request by message id and ignores other lines', () => {
    const state = stateOf(`${MAIN}not json\n{"type":"user"}\n`);
    assert.equal(Object.keys(state.requests).length, 6);
    assert.deepEqual([state.requests.m0.output, state.requests.m0.input], [50, 5]);
    assert.deepEqual(state.compactions, [at(12)]);
    assert.equal(parseLine('{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"id":"x","model":"<synthetic>","usage":{}}}'), null);
    assert.equal(parseLine(request('long', at(1), 'm'.repeat(200), [1, 1, 1, 1])).model.length, 120, 'a model name is cut to the board\'s limit (check 2 finding 2)');
  });

  test('a half-written last line waits for the next read: the offset stops before it', () => {
    const first = request('a', at(1), 'model-a', [1, 1, 1, 1]);
    const state = applyText({ path: 'x', agent: '', offset: 0, requests: {}, compactions: [] }, `${first}\n${request('b', at(2), 'model-a', [1, 1, 1, 1]).slice(0, 30)}`);
    assert.equal(state.offset, Buffer.byteLength(`${first}\n`));
    assert.deepEqual(Object.keys(state.requests), ['a']);
  });
});

describe('what each step cost', () => {
  const { costs, outside } = computeCosts([stateOf(MAIN), stateOf(SUB, 'ag1')], TASKS);

  test('tokens by model and kind, the largest request as the peak, and no compaction for step 1', () => {
    assert.deepEqual(costs.t1, {
      models: [{ model: 'model-a', input_tokens: 7, cache_read_tokens: 4000, cache_write_tokens: 200, output_tokens: 150 }],
      peak_context: 3002,
      compactions: 0,
    });
  });

  test('step 2 takes the request that opened it, a later model, the subagent with no step of its own, and the compaction', () => {
    assert.deepEqual(costs.t2.models, [
      { model: 'model-a', input_tokens: 1, cache_read_tokens: 3500, cache_write_tokens: 100, output_tokens: 20 },
      { model: 'model-b', input_tokens: 7, cache_read_tokens: 6000, cache_write_tokens: 800, output_tokens: 80 },
      { model: 'model-c', input_tokens: 7, cache_read_tokens: 200, cache_write_tokens: 0, output_tokens: 9 },
    ]);
    assert.equal(costs.t2.peak_context, 5003, 'the request after the compaction (1,804) is smaller than the one before it');
    assert.equal(costs.t2.compactions, 1);
  });

  test('what fits no step stays in the outside bucket, so the totals add up', () => {
    assert.equal(outside.requests, 1);
    const all = [...Object.values(costs).flatMap((cost) => cost.models), ...Object.values(outside.models)];
    const sum = (key) => all.reduce((total, row) => total + row[key], 0);
    assert.equal(sum('input_tokens'), 5 + 2 + 1 + 3 + 4 + 7 + 9);
  });

  test('an unfinished task has no cost', () => {
    const open = computeCosts([stateOf(MAIN)], [{ ...TASKS[1], doneAt: 0 }]);
    assert.deepEqual(open.costs, {});
  });
});

async function session() {
  const board = await startFakeBoard(replyOk);
  const root = trackedTemp('board-cost-');
  const env = envFor(board.url, root);
  const transcript = join(trackedTemp('board-cost-transcript-'), 'main.jsonl');
  writeGoal('sess-1', { key: CARD, project: 'demo-app', title: 'Translate', why: 'for release', steps: [] }, root, NOW);
  for (const task of TASKS) writeTask('sess-1', task, root);
  return { board, root, env, transcript, input: (extra = {}) => ({ session_id: 'sess-1', cwd: process.cwd(), transcript_path: transcript, ...extra }) };
}

describe('reading from the kept offset', () => {
  test('a second read takes only what the transcript gained, and the costs follow', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN.split('\n').slice(0, 3).join('\n') + '\n');
    assert.equal(refreshCosts(input(), env, NOW), true);
    const first = readCosts('sess-1', root);
    assert.deepEqual(Object.keys(first), ['t1']);
    assert.equal(first.t1.models[0].output_tokens, 150);
    appendFileSync(transcript, MAIN.split('\n').slice(3).join('\n'));
    assert.equal(refreshCosts(input(), env, NOW), true);
    assert.deepEqual(Object.keys(readCosts('sess-1', root)).sort(), ['t1', 't2']);
    assert.equal(refreshCosts(input(), env, NOW), false, 'nothing new: nothing changes');
    board.server.close();
  });

  test('seq is raised only when a cost\'s numbers change; an unchanged cost is not resent (Decision 10)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN.split('\n').slice(0, 3).join('\n') + '\n');
    refreshCosts(input(), env, NOW);
    const first = readCosts('sess-1', root).t1;
    assert.equal(first.writer, writerOf('sess-1'));
    assert.notEqual(first.writer, 'sess-1', 'the raw session id is never sent');
    assert.match(first.writer, /^[0-9a-f]{16}$/);
    assert.equal(refreshCosts(input(), env, NOW + 5000), false, 'a Stop that read nothing new stores and resends nothing');
    assert.equal(readCosts('sess-1', root).t1.seq, first.seq);
    // More transcript that leaves t1's numbers alone (a later request of t2) keeps t1's seq; t2 gets its own cost.
    appendFileSync(transcript, MAIN.split('\n').slice(3).join('\n'));
    refreshCosts(input(), env, NOW + 6000);
    assert.equal(readCosts('sess-1', root).t1.seq, first.seq, 'same numbers, same seq');
    assert.equal(readCosts('sess-1', root).t2.seq > 0, true);
    board.server.close();
  });

  test('a transcript that restarts keeps the counter growing: the costs file is not part of the transcript', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    const before = readCosts('sess-1', root).t1;
    writeFileSync(transcript, MAIN.split('\n').slice(0, 2).join('\n') + '\n');
    refreshCosts(input(), env, NOW);
    const after = readCosts('sess-1', root).t1;
    assert.equal(after.seq > before.seq, true, 'the numbers changed after the restart, so seq went up, never down');
    board.server.close();
  });

  test('a subagent stop reads that agent\'s own file under its agent id', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    const subFile = join(trackedTemp('board-cost-sub-'), 'agent-ag1.jsonl');
    writeFileSync(subFile, SUB);
    refreshCosts(input(), env, NOW);
    const before = readCosts('sess-1', root).t2.models.length;
    assert.equal(refreshCosts(input({ agent_id: 'ag1', agent_transcript_path: subFile }), env, NOW), true);
    assert.equal(before, 2);
    assert.deepEqual(readCosts('sess-1', root).t2.models.map((model) => model.model), ['model-a', 'model-b', 'model-c']);
    board.server.close();
  });

  test('a transcript that is shorter than the offset is read again from the start', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    writeFileSync(transcript, MAIN.split('\n').slice(0, 3).join('\n') + '\n');
    refreshCosts(input(), env, NOW);
    assert.deepEqual(Object.keys(readCosts('sess-1', root)), ['t1']);
    board.server.close();
  });

  test('no card, no task or an unreadable transcript changes nothing and never throws', async () => {
    const { board, root, env, input } = await session();
    assert.equal(refreshCosts(input({ transcript_path: join(root, 'missing.jsonl') }), env, NOW), false);
    assert.equal(refreshCosts({ session_id: 'nobody', transcript_path: 'x' }, env, NOW), false);
    board.server.close();
  });
});

describe('reading by bytes (Decision 13)', () => {
  const EMPTY = { path: 'x', agent: '', offset: 0, requests: {}, compactions: [] };

  test('the offset moves by raw bytes: a chunk ending in invalid UTF-8 does not drift it', () => {
    const line = Buffer.from(`${request('a', at(1), 'model-a', [1, 1, 1, 1])}\n`);
    const buffer = Buffer.concat([line, Buffer.from([0xe2, 0x82])]); // a cut multi-byte character after the last newline
    const state = applyBytes(EMPTY, buffer);
    assert.equal(state.offset, line.length);
    const bad = Buffer.concat([Buffer.from([0xff, 0xfe, 0x0a]), line]); // a line of invalid bytes, then a good one
    const next = applyBytes(EMPTY, bad);
    assert.equal(next.offset, bad.length);
    assert.deepEqual(Object.keys(next.requests), ['a']);
  });

  test('a line over the read limit is skipped whole, counted, and the offset moves past its newline', () => {
    const dir = trackedTemp('board-cost-long-');
    const file = join(dir, 'long.jsonl');
    const good = `${request('a', at(1), 'model-a', [1, 1, 1, 1])}\n`;
    const after = `${request('b', at(2), 'model-a', [2, 2, 2, 2])}\n`;
    const limit = Buffer.byteLength(good) + 20;
    const long = `${'x'.repeat(limit * 2 + 50)}\n`;
    writeFileSync(file, good + long + after);
    let state = { ...EMPTY };
    for (let round = 0; round < 40 && state.offset < Buffer.byteLength(good + long + after); round += 1) {
      const before = state.offset;
      state = syncState(state, file, limit);
      assert.equal(state.offset > before || state.offset === Buffer.byteLength(good + long + after), true, 'every read moves the offset');
    }
    assert.equal(state.offset, Buffer.byteLength(good + long + after));
    assert.deepEqual(Object.keys(state.requests).sort(), ['a', 'b']);
    assert.equal(state.skipped, 1);
    assert.equal(state.skipping, false);
  });
});

describe('the cost goes on the step', () => {
  test('withCosts puts it on a finished task row, and not on a running one', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    const rows = [
      { id: taskRowId('t1'), label: 'Write text', state: 'done' },
      { id: taskRowId('t2'), label: 'Check links', state: 'active' },
    ];
    const marked = withCosts(rows, 'sess-1', root);
    assert.equal(marked[0].cost.peak_context, 3002);
    assert.equal('cost' in marked[1], false);
    board.server.close();
  });

  test('a reported step the task matches by label takes the cost; a nested step with that label does not', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    const marked = withCosts([{ id: 's1', label: 'write  TEXT', state: 'done', children: [{ id: 's1a', label: 'Write text', state: 'done' }] }], 'sess-1', root);
    assert.equal(marked[0].cost.models[0].model, 'model-a');
    assert.equal('cost' in marked[0].children[0], false);
    board.server.close();
  });

  test('completing a step sends its cost with the step, on the TaskCompleted hook', async () => {
    const { board, env, transcript, input } = await session();
    writeFileSync(join(transcript, '..', 'main.jsonl'), MAIN);
    // The tasks exist as files already; the hook sees t1 complete at 10:05.
    await handle(input({ hook_event_name: 'TaskCompleted', task_id: 't1' }), env, at(5));
    board.server.close();
    const calls = callsOf(board).filter((call) => call.tool === 'report_progress');
    const sent = calls[calls.length - 1].args.steps.find((step) => step.id === taskRowId('t1'));
    assert.equal(sent.state, 'done');
    assert.equal(sent.cost.peak_context, 3002);
    assert.deepEqual(sent.cost.models.map((model) => model.model), ['model-a']);
  });

  test('a subagent stopping sends the costs its transcript added, even with no background agent', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    const subFile = join(trackedTemp('board-cost-sub-'), 'agent-ag1.jsonl');
    writeFileSync(subFile, SUB);
    await run(input({ hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_transcript_path: subFile }), env, {}, at(25));
    board.server.close();
    const calls = callsOf(board).filter((call) => call.tool === 'report_progress');
    assert.ok(calls.length >= 1, 'the step list with the costs was sent');
    const t2 = calls[calls.length - 1].args.steps.find((step) => step.id === taskRowId('t2'));
    assert.deepEqual(t2.cost.models.map((model) => model.model), ['model-a', 'model-b', 'model-c']);
    assert.equal(readCosts('sess-1', root).t2.compactions, 1);
  });

  test('the Stop of a slice card sends the last step\'s cost before it leaves the card open', async () => {
    const { board, root, env, transcript, input } = await session();
    writeGoal('sess-1', { key: CARD, project: 'demo-app', title: 'Translate', why: 'for release', steps: [], kind: 'slice' }, root, NOW);
    writeFileSync(transcript, MAIN);
    await run(input({ hook_event_name: 'Stop' }), env, {}, at(25));
    board.server.close();
    const calls = callsOf(board).filter((call) => call.tool === 'report_progress');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.steps.find((step) => step.id === taskRowId('t1')).cost.peak_context, 3002);
    assert.equal(calls[0].args.status, undefined, 'a slice card is never moved by a hook');
  });

  test('the costs file holds only measured facts: no transcript text', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    const text = readFileSync(join(root, 'sess-1.costs.json'), 'utf8');
    assert.equal(text.includes('TaskUpdate'), false);
    assert.equal(readGoal('sess-1', root, NOW).key, CARD);
    board.server.close();
  });

  test('a label-only reported step gets the cost and the task\'s observed times, so the board shows it (finding 1)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    const [marked] = withCosts([{ label: 'Write text', state: 'done' }], 'sess-1', root);
    assert.equal(marked.cost.peak_context, 3002);
    assert.deepEqual([marked.started_at, marked.started_source, marked.done_at, marked.done_source], [iso(at(0)), 'observed', iso(at(5)), 'observed']);
    assert.equal('cost' in withCosts([{ label: 'Write text', state: 'active' }], 'sess-1', root)[0], false, 'a step that is not done gets none');
    board.server.close();
  });

  test('a stopped agent\'s row gets its whole transcript as cost, timed by its observed start and stop (finding 1)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeGoal('sess-1', { key: CARD, project: 'demo-app', title: 'Translate', why: 'for release', steps: [], agentStarts: { ag1: at(6, -30) } }, root, NOW);
    writeFileSync(transcript, MAIN);
    const subFile = join(trackedTemp('board-cost-sub-'), 'agent-ag1.jsonl');
    writeFileSync(subFile, SUB);
    refreshCosts(input({ agent_id: 'ag1', agent_transcript_path: subFile }), env, NOW);
    const rows = [{ id: 'agent-ag1', label: 'Implement it', state: 'done' }, { id: 'agent-ag2', label: 'Other', state: 'done' }];
    assert.equal('cost' in withCosts(rows, 'sess-1', root, NOW)[0], false, 'no stop seen yet: no observed end');
    addStoppedAgent('sess-1', 'ag1', root, at(7));
    const [row, other] = withCosts(rows, 'sess-1', root, NOW);
    assert.deepEqual(row.cost, { agent_id: 'ag1', writer: writerOf('sess-1'), models: [{ model: 'model-c', input_tokens: 7, cache_read_tokens: 200, cache_write_tokens: 0, output_tokens: 9 }], peak_context: 207, compactions: 0, seq: row.cost.seq });
    assert.equal(Number.isInteger(row.cost.seq), true);
    assert.deepEqual([row.started_at, row.done_at, row.done_source], [iso(at(6, -30)), iso(at(7)), 'observed']);
    assert.equal('cost' in other, false);
    assert.equal('cost' in withCosts([{ ...rows[0], state: 'active' }], 'sess-1', root, NOW)[0], false);
    board.server.close();
  });

  test('a SubagentStop in a session with no task still reads the agent\'s transcript (finding 1)', async () => {
    const board = await startFakeBoard(replyOk);
    const root = trackedTemp('board-cost-solo-');
    const env = envFor(board.url, root);
    writeGoal('solo', { key: CARD, project: 'demo-app', title: 'Translate', why: 'for release', steps: [] }, root, NOW);
    const subFile = join(trackedTemp('board-cost-sub-'), 'agent-ag1.jsonl');
    writeFileSync(subFile, SUB);
    assert.equal(refreshCosts({ session_id: 'solo', agent_id: 'ag1', agent_transcript_path: subFile }, env, NOW), true);
    assert.equal(JSON.parse(readFileSync(join(root, 'solo.costs.json'), 'utf8')).agents.ag1.peak_context, 207);
    assert.equal(refreshCosts({ session_id: 'solo', transcript_path: subFile }, env, NOW), false, 'a Stop with no task and no stopping agent reads nothing');
    board.server.close();
  });
});

describe('a transcript state that stays small, and the right task for a request', () => {
  test('requests older than the hold are settled into per-step aggregates and the totals do not change (finding 5)', () => {
    const state = stateOf(MAIN);
    const settled = settle(state, TASKS);
    assert.deepEqual(Object.keys(settled.requests), ['m5'], 'only the newest request stays in the window');
    assert.deepEqual(settled.compactions, []);
    const before = computeCosts([state], TASKS);
    const after = computeCosts([settled], TASKS);
    assert.deepEqual(after.costs, before.costs);
    assert.equal(after.outside.requests, before.outside.requests);
    assert.equal(after.outside.models['model-b'].input_tokens, before.outside.models['model-b'].input_tokens);
  });

  test('past the window limit the oldest requests are settled, never dropped (finding 5)', () => {
    const lines = Array.from({ length: 20050 }, (_, index) => request(`r${index}`, at(0, 10) + index, 'model-a', [1, 1, 1, 1])).join('\n') + '\n';
    const state = settle(stateOf(lines), TASKS);
    assert.equal(Object.keys(state.requests).length <= 20000, true);
    const { costs } = computeCosts([state], [{ ...TASKS[0], doneAt: at(60) }]);
    assert.equal(costs.t1.models[0].input_tokens, 20050);
  });

  test('the request that opens a task goes to the task of its own agent when two tasks share the id (finding 8)', () => {
    const tasks = [
      { taskId: '1', subject: 'Main', agentId: '', cardKey: CARD, createdAt: at(0), startedAt: at(0), doneAt: at(9) },
      { taskId: '1', subject: 'Sub', agentId: 'ag1', cardKey: CARD, createdAt: at(1), startedAt: at(1), doneAt: at(9) },
    ];
    const state = stateOf(request('x', at(2), 'model-a', [1, 1, 1, 1], { content: opens('1') }) + '\n', 'ag1');
    const { costs } = computeCosts([state], tasks);
    assert.equal(costs['1'].agent_id, 'ag1');
  });
});

describe('one writer, and files that do not pile up', () => {
  test('a hook that cannot get the session\'s cost lock skips its cost and moves nothing; a stale lock is taken over (finding 3)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    const lock = join(root, 'sess-1.cost.lock');
    writeFileSync(lock, '');
    assert.equal(refreshCosts(input(), env, NOW), false);
    assert.deepEqual(readCosts('sess-1', root), {}, 'nothing was read or written under another hook\'s lock');
    const old = new Date(Date.now() - 60 * 1000);
    utimesSync(lock, old, old);
    assert.equal(refreshCosts(input(), env, NOW), true, 'a lock left by a dead hook is taken over');
    assert.equal(existsSync(lock), false, 'the lock is released');
    board.server.close();
  });

  test('the lock holds its owner\'s token, and a lock that is not this hook\'s is never deleted (review 2 #3)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    const lock = join(root, 'sess-1.cost.lock');
    writeFileSync(lock, 'another-hooks-token');
    assert.equal(refreshCosts(input(), env, NOW), false);
    assert.equal(readFileSync(lock, 'utf8'), 'another-hooks-token', 'a hook that did not get the lock leaves it alone');
    const old = new Date(Date.now() - 60 * 1000);
    utimesSync(lock, old, old);
    assert.equal(refreshCosts(input(), env, NOW), true, 'a stale lock with another token is stolen once');
    assert.equal(existsSync(lock), false);
    assert.deepEqual(readdirSync(root).filter((name) => name.includes('.stale-')), [], 'the renamed-away lock is removed');
    board.server.close();
  });

  test('a lock 15 s old or more is stolen, one younger is not, and the stolen file is never put back (Decision 12)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    const lock = join(root, 'sess-1.cost.lock');
    writeFileSync(lock, 'someone');
    const young = new Date(Date.now() - 12 * 1000);
    utimesSync(lock, young, young);
    assert.equal(refreshCosts(input(), env, NOW), false, 'a 12 s old lock may belong to a live hook');
    assert.equal(readFileSync(lock, 'utf8'), 'someone');
    const dead = new Date(Date.now() - 16 * 1000);
    utimesSync(lock, dead, dead);
    assert.equal(refreshCosts(input(), env, NOW), true, 'a 16 s old lock is a killed hook\'s');
    assert.equal(existsSync(lock), false);
    assert.deepEqual(readdirSync(root).filter((name) => name.includes('.stale-')), []);
    board.server.close();
  });

  test('a fresh lock is waited for and never removed by the waiting hook', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    const lock = join(root, 'sess-1.cost.lock');
    writeFileSync(lock, 'fresh-holder');
    assert.equal(refreshCosts(input(), env, NOW), false, 'a fresh lock is waited for, then skipped');
    assert.equal(readFileSync(lock, 'utf8'), 'fresh-holder');
    board.server.close();
  });

  test('ending the session removes the cost files (finding 6)', async () => {
    const { board, root, env, transcript, input } = await session();
    writeFileSync(transcript, MAIN);
    refreshCosts(input(), env, NOW);
    const names = () => readdirSync(root).filter((name) => name.startsWith('sess-1.cost'));
    assert.equal(names().length >= 2, true);
    removeGoal('sess-1', root);
    assert.deepEqual(names(), []);
    board.server.close();
  });
});
