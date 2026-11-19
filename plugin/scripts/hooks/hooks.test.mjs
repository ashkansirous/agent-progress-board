/* global process, URL */
// Tests for the board hooks and background-agent reading. A local fake HTTP server stands in for the board.
// Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { AGENT_FRESH_MS, mergeSteps, placeAgents, readBackgroundAgents, subagentsDir } from './background-agents.mjs';
import { closeAnsweredWaiting, handle as remind, REMINDER_TEXT } from './goal-reminder.mjs';
import { SENDER_LOG_LINES, addStoppedAgent, hasMarker, listMarkers, logSender, readGoal, readStdinText, readStoppedAt, removeGoal, removeStoppedAgent, touchSeen, updateGoal, writeGoal, writeJson, writeMarker, writePrompt } from './hook-input.mjs';
import { DEAD_SESSION_MS, run as runDone, startContext } from './session-done.mjs';
import { execFileSync } from 'node:child_process';
import { branchOf, run as runWaiting, titleOf, usableCwd } from './session-waiting.mjs';
import { cleanUpAfterTests, envFor, callsOf, replyOk, runNode, startFakeBoard, trackedTemp } from '../test-helpers.mjs';
import { markOrchestrator, orchestratorFilePath } from '../report-progress.mjs';

const HOOKS = fileURLToPath(new URL('.', import.meta.url));
const WAITING_HOOK = join(HOOKS, 'session-waiting.mjs');
const DONE_HOOK = join(HOOKS, 'session-done.mjs');
const REMINDER_HOOK = join(HOOKS, 'goal-reminder.mjs');
const NOW = Date.now(); // file times are real, so the clock under test is the real one
const MINUTE = 60 * 1000;
const CARD = 'demo-app/session-abc';
const BOARD_TOOL = 'mcp__plugin_agent-board_agent-board__report_progress';
cleanUpAfterTests();

function folder(prefix = 'board-hook-') {
  return trackedTemp(prefix);
}

// A session transcript path with a subagents folder next to it; each agent is { id, description, ageMs, finished }.
function sessionWithAgents(agents, now = NOW) {
  const dir = folder('board-session-');
  const transcript = join(dir, 'sess-1.jsonl');
  const subagents = join(dir, 'sess-1', 'subagents');
  mkdirSync(subagents, { recursive: true });
  for (const agent of agents) {
    const record = join(subagents, `agent-${agent.id}.jsonl`);
    const lines = [{ type: 'user', message: { role: 'user', content: agent.prompt || 'Do the work' } }];
    if (agent.model) lines.push({ type: 'assistant', message: { role: 'assistant', model: agent.model, content: [] } });
    writeFileSync(record, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    const at = new Date(now - agent.ageMs);
    utimesSync(record, at, at);
    writeFileSync(join(subagents, `agent-${agent.id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', ...(agent.description ? { description: agent.description } : {}), ...(agent.finished ? { finished: true } : {}), ...(agent.shape ? { requestShape: agent.shape } : {}) }));
  }
  return transcript;
}

function stoppedIds(root) {
  return Object.keys(readStoppedAt('sess-1', root));
}

function withCard(root, extra = {}) {
  writeGoal('sess-1', { key: CARD, project: 'demo-app', title: 'Translate', why: 'for release', steps: [{ label: 'Write text', state: 'active' }, { label: 'Ship', state: 'pending' }], ...extra }, root, NOW);
}

describe('background agents', () => {
  test('the agent folder sits next to the transcript', () => {
    assert.equal(subagentsDir({ transcript_path: join('/p', 'sess-1.jsonl') }), join('/p', 'sess-1', 'subagents'));
    assert.equal(subagentsDir({}), '');
    assert.equal(subagentsDir({ transcript_path: '/p/notes.txt' }), '');
  });

  test('only records changed within 10 minutes count; the description labels the agent', () => {
    const transcript = sessionWithAgents([
      { id: 'a1', description: 'Translate texts', ageMs: MINUTE },
      { id: 'a2', description: 'Draw pictures', ageMs: AGENT_FRESH_MS - MINUTE },
      { id: 'old', description: 'Old helper', ageMs: AGENT_FRESH_MS + MINUTE },
    ]);
    const agents = readBackgroundAgents({ transcript_path: transcript }, NOW);
    assert.deepEqual(agents.map((agent) => [agent.label, agent.state]), [['Draw pictures', 'active'], ['Translate texts', 'active']]);
  });

  test('a finished meta file and the stopped agent are done', () => {
    const transcript = sessionWithAgents([
      { id: 'a1', description: 'Translate texts', ageMs: MINUTE },
      { id: 'a2', description: 'Draw pictures', ageMs: MINUTE, finished: true },
    ]);
    const agents = readBackgroundAgents({ transcript_path: transcript }, NOW, { a1: NOW });
    assert.deepEqual(agents.map((agent) => agent.state), ['done', 'done']);
  });

  test('no folder, no transcript path or an unreadable meta file gives an empty list or a fallback label', () => {
    assert.deepEqual(readBackgroundAgents({ transcript_path: join(folder(), 'x.jsonl') }, NOW), []);
    assert.deepEqual(readBackgroundAgents({}, NOW), []);
  });

  test('an agent with no description is labelled by the start of its prompt, never by its type; the model is read', () => {
    const transcript = sessionWithAgents([
      { id: 'a1', prompt: 'Compare sync-first and cache-first for a notes app, then write up the trade-offs in detail', ageMs: MINUTE, model: 'model-small' },
      { id: 'a2', description: 'Record the audio', ageMs: 2 * MINUTE },
    ]);
    const agents = readBackgroundAgents({ transcript_path: transcript }, NOW);
    const bare = agents.find((agent) => agent.id === 'a1');
    assert.equal(bare.label, 'Helper agent: Compare sync-first and cache-first for a notes ap…');
    assert.equal(bare.model, 'model-small');
    assert.ok(agents.every((agent) => !agent.label.includes('general-purpose')));
  });

  test('a secret in an agent prompt or description is masked in its label', () => {
    const secret = ['hunter', 'two', 'value'].join('');
    const transcript = sessionWithAgents([
      { id: 'a1', prompt: `use the token: ${secret} to call the API`, ageMs: MINUTE },
      { id: 'a2', description: `password=${secret}`, prompt: 'x', ageMs: MINUTE },
    ]);
    const agents = readBackgroundAgents({ transcript_path: transcript }, NOW);
    for (const agent of agents) assert.ok(!agent.label.includes(secret), agent.label);
    assert.ok(agents.find((agent) => agent.id === 'a1').label.startsWith('Helper agent: '));
  });

  test('mergeSteps puts an agent under the step that was running, keeps the session steps as sent and lets several agents run', () => {
    const sent = [{ label: 'Plan', state: 'done' }, { label: 'Record audio', state: 'active' }, { label: 'Ship', state: 'pending' }];
    const agents = [
      { id: 'a', label: 'Translate texts', state: 'active', model: 'model-small' },
      { id: 'b', label: 'Draw pictures', state: 'active' },
      { id: 'c', label: 'Check links', state: 'done' },
    ];
    const parents = placeAgents(sent, agents);
    assert.deepEqual(parents, { a: 'label:Record audio', b: 'label:Record audio', c: 'label:Record audio' });
    const merged = mergeSteps(sent, agents, parents);
    assert.deepEqual(merged.map((step) => `${step.label}:${step.state}`), ['Plan:done', 'Record audio:active', 'Ship:pending']);
    const rows = merged[1].children;
    assert.deepEqual(rows.map((step) => `${step.label}:${step.state}`), ['Translate texts:active', 'Draw pictures:active', 'Check links:done']);
    assert.deepEqual(rows.map((step) => step.note), ['Helper agent · model-small', 'Helper agent', 'Helper agent']);
    assert.ok(rows.every((step) => step.id.startsWith('agent-') && !('children' in step)), 'no children sent: a helper\'s subtree is kept by the board');
  });

  test('mergeSteps puts an agent at the root when no step was running, or its recorded step is gone', () => {
    const sent = [{ label: 'Plan', state: 'pending' }];
    const agents = [{ id: 'a', label: 'Helper', state: 'active' }];
    assert.deepEqual(placeAgents(sent, agents), { a: '' });
    assert.deepEqual(mergeSteps(sent, agents, { a: '' }).map((step) => step.label), ['Plan', 'Helper']);
    assert.deepEqual(mergeSteps(sent, agents, { a: 'label:Gone' }).map((step) => step.label), ['Plan', 'Helper']);
  });

  test('placeAgents keeps the place recorded when the agent was first seen, and the places of agents no longer listed', () => {
    const agents = [{ id: 'a', label: 'Helper', state: 'active' }];
    assert.deepEqual(placeAgents([{ label: 'Later', state: 'active' }], agents, { a: 'label:Earlier', old: 'id:s1' }), { a: 'label:Earlier', old: 'id:s1' });
  });

  test('placement is by id: two steps with one label, the agent goes under the one it ran under', () => {
    const sent = [{ id: 's1', label: 'Review', state: 'done' }, { id: 's2', label: 'Review', state: 'active' }];
    const agents = [{ id: 'a', label: 'H', state: 'active' }];
    const parents = placeAgents(sent, agents);
    assert.equal(parents.a, 'id:s2');
    const merged = mergeSteps(sent, agents, parents);
    assert.equal('children' in merged[0], false);
    assert.deepEqual(merged[1].children.map((step) => step.id), ['agent-a']);
  });

  test('a step with its own children keeps them and gets the agent rows after them (a helper child is not lost)', () => {
    const sent = [{ id: 's3', label: 'Record audio', state: 'active', children: [{ label: 'Mic', state: 'done' }] }];
    const merged = mergeSteps(sent, [{ id: 'a', label: 'H', state: 'active' }], { a: 'id:s3' });
    assert.deepEqual(merged[0].children.map((step) => step.label), ['Mic', 'H']);
  });

  test('a step the session marked done is sent active, with a note, while its agent runs; a finished agent leaves it done', () => {
    const sent = [{ id: 's3', label: 'Record audio', state: 'done', children: [{ label: 'Mic', state: 'done' }] }];
    const running = mergeSteps(sent, [{ id: 'a', label: 'H', state: 'active' }], { a: 'id:s3' });
    assert.equal(running[0].state, 'active');
    assert.match(running[0].note, /still running/);
    assert.equal(running[0].children[1].state, 'active');
    const finished = mergeSteps(sent, [{ id: 'a', label: 'H', state: 'done' }], { a: 'id:s3' });
    assert.equal(finished[0].state, 'done');
  });

  test('a nested step with a running agent makes its done ancestors active too', () => {
    const sent = [{ id: 'p', label: 'P', state: 'done', children: [{ id: 'c', label: 'C', state: 'done' }] }];
    const merged = mergeSteps(sent, [{ id: 'a', label: 'H', state: 'active' }], { a: 'id:c' });
    assert.deepEqual([merged[0].state, merged[0].children[0].state], ['active', 'active']);
  });

  test('when the last agent under a step ages out, the step is sent with its own children list so the old row goes', () => {
    const sent = [{ id: 's3', label: 'Record audio', state: 'active' }];
    const merged = mergeSteps(sent, [], { gone: 'id:s3' });
    assert.deepEqual(merged, [{ id: 's3', label: 'Record audio', state: 'active', children: [] }]);
  });

  test('an agent row leaves room for its helper\'s subtree: never deeper than level 3, else under the level-2 ancestor', () => {
    const deep = [{ id: 'l1', label: 'L1', state: 'active', children: [{ id: 'l2', label: 'L2', state: 'active', children: [{ id: 'l3', label: 'L3', state: 'active', children: [{ id: 'l4', label: 'L4', state: 'active' }] }] }] }];
    const agents = [{ id: 'a', label: 'H', state: 'active' }];
    const level3 = mergeSteps(deep, agents, { a: 'id:l3' });
    assert.deepEqual(level3[0].children[0].children.map((step) => step.id), ['l3', 'agent-a'], 'row beside L3, under L2');
    assert.deepEqual(level3[0].children[0].children[0].children.map((step) => step.id), ['l4'], 'L3 keeps only its own child');
    const level2 = mergeSteps(deep, agents, { a: 'id:l2' });
    assert.deepEqual(level2[0].children[0].children.map((step) => step.id), ['l3', 'agent-a'], 'owner L2: row at level 3');
  });

  test('the 200-step budget counts nested steps', () => {
    const sent = [{ label: 'big', state: 'pending', children: Array.from({ length: 198 }, (_, index) => ({ label: `c${index}`, state: 'pending' })) }];
    const merged = mergeSteps(sent, [{ id: 'a', label: 'H', state: 'active' }, { id: 'b', label: 'I', state: 'active' }], {});
    assert.equal(merged.length, 2, 'only one root agent row fits in 200');
  });

  test('mergeSteps over the 200-step limit drops the oldest finished agents first', () => {
    const sent = Array.from({ length: 198 }, (_, index) => ({ label: `s${index}`, state: 'pending' }));
    const agents = [
      { id: 'old', label: 'Old done', state: 'done' },
      { id: 'run', label: 'Running', state: 'active' },
      { id: 'new', label: 'New done', state: 'done' },
    ];
    const merged = mergeSteps(sent, agents, {});
    assert.equal(merged.length, 200);
    assert.deepEqual(merged.slice(198).map((step) => step.label), ['Running', 'New done']);
  });
});

describe('Stop, SubagentStop and UserPromptSubmit (session-done)', () => {
  async function setup(agents) {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const input = (event, extra = {}) => ({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: event, transcript_path: sessionWithAgents(agents), ...extra });
    return { board, root, env, input };
  }

  test('Stop with no background agent marks the card done "Session stopped"', async () => {
    const { board, root, env, input } = await setup([{ id: 'old', description: 'Old helper', ageMs: AGENT_FRESH_MS + MINUTE }]);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board), [{ tool: 'mark_done', args: { key: CARD, source: 'hook', note: 'Session stopped' } }]);
    assert.equal(readGoal('sess-1', root, NOW).closed, true);
  });

  test('an orchestrator session closes a card it reported before the mark once, then sends nothing (Slice 41)', async () => {
    const { board, root, env, input } = await setup([]);
    markOrchestrator('sess-1', root);
    await runDone(input('Stop'), env, {}, NOW);
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['mark_done']);
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    assert.equal(board.requests.length, 1);
  });

  test('a failed orchestrator close is tried once per card: later hooks send nothing (Slice 41)', async () => {
    const board = await startFakeBoard((record, res) => { res.writeHead(500); res.end('down'); });
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    markOrchestrator('sess-1', root);
    const input = (event) => ({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: event, transcript_path: sessionWithAgents([]) });
    await runDone(input('Stop'), env, {}, NOW);
    await runDone(input('Stop'), env, {}, NOW);
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    board.server.close();
    assert.equal(board.requests.length, 1);
    assert.deepEqual(readGoal('sess-1', root, NOW).orchClose, { key: CARD, outcome: 'failed' });
  });

  test('a goal file with only the old slice flag still reads as a slice, and a write stores no slice flag (Slice 41)', () => {
    const root = folder();
    writeJson(join(root, 'sess-1.goal.json'), { at: NOW, goalAt: NOW, key: 'proj/slice-9', slice: true });
    const goal = readGoal('sess-1', root, NOW);
    assert.equal(goal.kind, 'slice');
    assert.equal(goal.slice, true);
    writeGoal('sess-1', goal, root, NOW);
    const stored = JSON.parse(readFileSync(join(root, 'sess-1.goal.json'), 'utf8'));
    assert.equal('slice' in stored, false);
    assert.equal(stored.kind, 'slice');
  });

  test('a slice card is never closed or reopened by the hooks (Slice 41)', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { key: 'proj/slice-9', kind: 'slice' });
    await runDone(input('Stop'), env, {}, NOW);
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    board.server.close();
    assert.equal(board.requests.length, 0);
  });

  test('a slice card gets helper-agent steps with no status, and is still never closed (Slice 41)', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { key: 'proj/slice-9', kind: 'slice', steps: [{ id: 's1', label: 'Write text', state: 'active' }] });
    await runDone(input('SubagentStart', { agent_id: 'a9' }), env, {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.equal(call.tool, 'report_progress');
    assert.equal(call.args.key, 'proj/slice-9');
    assert.equal('status' in call.args, false);
    assert.deepEqual(call.args.steps[0].children.map((step) => step.id), ['agent-a9']);
    assert.equal(readGoal('sess-1', root, NOW).kind, 'slice');
  });

  test('Stop with a fresh background agent keeps the card in_progress with the note and the agent as a step', async () => {
    const { board, root, env, input } = await setup([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: 2 * MINUTE }]);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.equal(callsOf(board).length, 1);
    assert.equal(call.tool, 'report_progress');
    assert.equal(call.args.status, 'in_progress');
    assert.equal(call.args.note, 'background agents running');
    assert.deepEqual(call.args.steps.map((step) => `${step.label}:${step.state}`), ['Write text:active', 'Ship:pending']);
    const rows = call.args.steps[0].children;
    assert.deepEqual(rows.map((step) => `${step.label}:${step.state}`), ['Draw pictures:active', 'Translate texts:active'], 'both agents run, under the step that was running');
    assert.deepEqual(readGoal('sess-1', root, NOW).agentParents, { a1: 'label:Write text', a2: 'label:Write text' });
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('SubagentStart records the running step by id before the send, sends the row, and tells the helper its key and row id', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { steps: [{ id: 's1', label: 'Write text', state: 'active' }, { id: 's2', label: 'Ship', state: 'pending' }] });
    const start = input('SubagentStart', { agent_id: 'a9' });
    await runDone(start, env, {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.deepEqual(call.args.steps[0].children.map((step) => step.id), ['agent-a9']);
    assert.deepEqual(readGoal('sess-1', root, NOW).agentParents, { a9: 'id:s1' });
    const context = JSON.parse(startContext(start, env, root, NOW)).hookSpecificOutput;
    assert.equal(context.hookEventName, 'SubagentStart');
    assert.ok(context.additionalContext.includes(CARD) && context.additionalContext.includes('agent-a9'));
  });

  test('an agent recorded at start with no files yet keeps its active row for 10 minutes from its start, then is dropped', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { steps: [{ id: 's1', label: 'Write text', state: 'active' }] });
    await runDone(input('SubagentStart', { agent_id: 'a9' }), env, {}, NOW);
    await runDone(input('Stop'), env, {}, NOW + MINUTE);
    await runDone(input('Stop'), env, {}, NOW + AGENT_FRESH_MS + MINUTE);
    board.server.close();
    const [, early, late] = callsOf(board);
    assert.equal(early.tool, 'report_progress');
    assert.deepEqual(early.args.steps[0].children.map((step) => `${step.id}:${step.state}`), ['agent-a9:active']);
    assert.equal(late.tool, 'mark_done', 'past 10 minutes with no files the agent is dropped');
  });

  test('two agents starting at once: the later hook keeps the first one\'s place and sends both rows', async () => {
    const root = folder();
    withCard(root, { steps: [{ id: 's1', label: 'Write text', state: 'active' }] });
    const transcript = sessionWithAgents([{ id: 'a1', description: 'First', ageMs: MINUTE }, { id: 'a2', description: 'Second', ageMs: MINUTE }]);
    const board = await startFakeBoard(replyOk);
    const env = envFor(board.url, root);
    const start = (agentId) => ({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'SubagentStart', agent_id: agentId, transcript_path: transcript });
    updateGoal('sess-1', root, NOW, (current) => ({ ...current, agentParents: { a1: 'id:s1' } })); // the other hook wrote after this one read
    await runDone(start('a2'), env, {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.deepEqual(readGoal('sess-1', root, NOW).agentParents, { a1: 'id:s1', a2: 'id:s1' });
    assert.deepEqual(call.args.steps[0].children.map((step) => step.id), ['agent-a1', 'agent-a2']);
  });

  test('SubagentStart with no transcript_path sends no row for an agent recorded earlier', async () => {
    const root = folder();
    withCard(root, { steps: [{ id: 's1', label: 'Write text', state: 'active' }], agentParents: { old: 'id:s1' } });
    const board = await startFakeBoard(replyOk);
    await runDone({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'SubagentStart', agent_id: 'a2' }, envFor(board.url, root), {}, NOW);
    board.server.close();
    assert.equal(callsOf(board).length, 1);
    assert.deepEqual(callsOf(board)[0].args.steps[0].children.map((step) => step.id), []);
    assert.deepEqual(readGoal('sess-1', root, NOW).agentParents, { old: 'id:s1', a2: 'id:s1' });
  });

  test('the saved sig is the one of the tree sent, built from the merged places', async () => {
    const root = folder();
    withCard(root, { steps: [{ id: 's1', label: 'Write text', state: 'active' }] });
    const transcript = sessionWithAgents([{ id: 'a1', description: 'First', ageMs: MINUTE }, { id: 'a2', description: 'Second', ageMs: MINUTE }]);
    const board = await startFakeBoard(replyOk);
    updateGoal('sess-1', root, NOW, (current) => ({ ...current, agentParents: { a1: 'id:s1' } }));
    await runDone({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'SubagentStart', agent_id: 'a2', transcript_path: transcript }, envFor(board.url, root), {}, NOW);
    board.server.close();
    assert.equal(readGoal('sess-1', root, NOW).sig, JSON.stringify(callsOf(board)[0].args.steps));
  });

  test('a foreground agent changes nothing on the card and gets no row id', async () => {
    const root = folder();
    withCard(root);
    const transcript = sessionWithAgents([{ id: 'f1', description: 'Waited for', ageMs: MINUTE, shape: 'foreground' }]);
    const board = await startFakeBoard(replyOk);
    const env = envFor(board.url, root);
    const start = { session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'SubagentStart', agent_id: 'f1', transcript_path: transcript };
    await runDone(start, env, {}, NOW);
    board.server.close();
    assert.equal(callsOf(board).length, 0);
    assert.deepEqual(readGoal('sess-1', root, NOW).agentParents, {});
    assert.equal(startContext(start, env, root, NOW), '');
  });

  test('the place recorded at start holds after the session moves on; a failed send keeps the place', async () => {
    const root = folder();
    const env = envFor('http://127.0.0.1:1', root);
    withCard(root, { steps: [{ id: 's1', label: 'Write text', state: 'active' }, { id: 's2', label: 'Ship', state: 'pending' }] });
    const transcript = sessionWithAgents([{ id: 'a9', description: 'Helper', ageMs: MINUTE }]);
    await runDone({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'SubagentStart', agent_id: 'a9', transcript_path: transcript }, env, {}, NOW);
    assert.deepEqual(readGoal('sess-1', root, NOW).agentParents, { a9: 'id:s1' }, 'saved although the send failed');
    updateGoal('sess-1', root, NOW, (current) => ({ ...current, steps: [{ id: 's1', label: 'Write text', state: 'done' }, { id: 's2', label: 'Ship', state: 'active' }] }));
    const board = await startFakeBoard(replyOk);
    await runDone({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'Stop', transcript_path: transcript }, envFor(board.url, root), {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.equal(call.args.steps[0].state, 'active', 'done step with a running agent is sent active');
    assert.deepEqual(call.args.steps[0].children.map((step) => step.id), ['agent-a9']);
    assert.equal('children' in call.args.steps[1], false);
  });

  test('SubagentStop turns the stopped agent done and sends the list once', async () => {
    const { board, env, input } = await setup([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: MINUTE }]);
    await runDone(input('SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    await runDone(input('SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    board.server.close();
    const calls = callsOf(board);
    assert.equal(calls.length, 1, 'the unchanged list is not sent twice');
    assert.deepEqual(calls[0].args.steps[0].children.map((step) => `${step.label}:${step.state}`), ['Translate texts:done', 'Draw pictures:active']);
  });

  test('UserPromptSubmit reopens a card the Stop hook closed; an open card is left alone', async () => {
    const { board, root, env, input } = await setup([]);
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    assert.equal(board.requests.length, 0);
    await runDone(input('Stop'), env, {}, NOW);
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    board.server.close();
    const calls = callsOf(board);
    assert.deepEqual(calls.map((call) => call.tool), ['mark_done', 'report_progress']);
    assert.deepEqual(calls[1].args, { key: CARD, status: 'in_progress', source: 'hook', note: 'Session resumed' });
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('a Stop with an open needs_you question closes nothing; with background agents the report repeats the question', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { needsYou: 'Which language first?' });
    await runDone(input('Stop'), env, {}, NOW);
    assert.equal(board.requests.length, 0, 'no done report: it would clear the question');
    const withAgent = await sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(input('SubagentStop', { transcript_path: withAgent, agent_id: 'none' }), env, {}, NOW);
    await runDone(input('Stop', { transcript_path: withAgent }), env, {}, NOW);
    board.server.close();
    const calls = callsOf(board);
    assert.ok(calls.length >= 1);
    for (const call of calls) assert.deepEqual([call.tool, call.args.needs_you], ['report_progress', 'Which language first?']);
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('the next prompt answers an open question: cleared on the board and in the goal file, then Stop closes the card', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { needsYou: 'Which language first?' });
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    assert.equal(readGoal('sess-1', root, NOW).needsYou, '');
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    const calls = callsOf(board);
    assert.deepEqual(calls[0], { tool: 'report_progress', args: { key: CARD, status: 'in_progress', source: 'hook', needs_you: null } });
    assert.equal(calls[1].tool, 'mark_done');
  });

  test('a Stop after a SubagentStop counts that agent done, though its meta file does not say finished', async () => {
    const { board, env, input } = await setup([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(input('SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress', 'mark_done']);
  });

  test('the question the session sent is remembered until it clears it or finishes', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    const call = (args) => ({ session_id: 'sess-1', hook_event_name: 'PostToolUse', tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', ...args } });
    const report = (args, at) => remind(call(args), env, NOW + at);
    remind({ session_id: 'sess-1', hook_event_name: 'UserPromptSubmit' }, env, NOW);
    report({ title: 'Translate', needs_you: 'Which language?' }, 0);
    assert.equal(readGoal('sess-1', root, NOW).needsYou, 'Which language?');
    report({ status: 'in_progress' }, 1000);
    assert.equal(readGoal('sess-1', root, NOW).needsYou, 'Which language?');
    report({ needs_you: null }, 2000);
    assert.equal(readGoal('sess-1', root, NOW).needsYou, '');
  });

  test('a card the session finished itself is not reopened by the next prompt; a Stop-closed one is', async () => {
    const { board, root, env, input } = await setup([]);
    withCard(root, { closed: true, closedBy: 'session' });
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    assert.equal(board.requests.length, 0);
    withCard(root, { closed: true, closedBy: 'stop' });
    await runDone(input('UserPromptSubmit'), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.args.note), ['Session resumed']);
  });

  test('a failed board call leaves the card state alone, so the next hook retries', async () => {
    const failing = await startFakeBoard((_, res) => { res.writeHead(500); res.end('boom'); });
    const root = folder();
    withCard(root);
    const stop = { session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'Stop' };
    await runDone(stop, envFor(failing.url, root), {}, NOW);
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
    await runDone(stop, envFor(failing.url, root), {}, NOW);
    failing.server.close();
    assert.equal(failing.requests.length, 2, 'the second Stop tries again');
  });

  test('a second Stop does not close a card that is already closed', async () => {
    const { board, env, input } = await setup([]);
    await runDone(input('Stop'), env, {}, NOW);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    assert.equal(board.requests.length, 1);
  });

  test('a session with no card and no waiting item makes no network call', async () => {
    const board = await startFakeBoard(replyOk);
    const env = envFor(board.url, folder());
    await runDone({ session_id: 'never-reported', cwd: process.cwd(), hook_event_name: 'Stop' }, env, {}, NOW);
    board.server.close();
    assert.equal(board.requests.length, 0);
  });

  test('a board that is down or answers 500 does not throw', async () => {
    const failing = await startFakeBoard((_, res) => { res.writeHead(500); res.end('boom'); });
    const root = folder();
    withCard(root);
    const outcome = await runDone({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'Stop' }, envFor(failing.url, root), {}, NOW);
    failing.server.close();
    assert.equal(outcome.skipped, 'session never waited');
    assert.equal(failing.requests.length, 1);
  });
});

describe('review fixes (session-done, background agents)', () => {
  test('a SubagentStop with no open card still remembers the agent, so a later Stop does not count it as working', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    const input = (event, extra = {}) => ({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: event, transcript_path: transcript, ...extra });
    withCard(root, { closed: true, closedBy: 'session' });
    await runDone(input('SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    withCard(root);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['mark_done']);
  });

  test('the goal file written after a hook call keeps what the session wrote meanwhile', async () => {
    const root = folder();
    const board = await startFakeBoard((record, res) => {
      writeGoal('sess-1', { key: CARD, title: 'Renamed meanwhile', needsYou: 'Delete the files?', steps: [] }, root, NOW);
      replyOk(record, res);
    });
    const env = envFor(board.url, root);
    withCard(root);
    await runDone({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'SubagentStop', agent_id: 'a1', transcript_path: sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: MINUTE }]) }, env, {}, NOW);
    board.server.close();
    const goal = readGoal('sess-1', root, NOW);
    assert.equal(goal.title, 'Renamed meanwhile');
    assert.equal(goal.needsYou, 'Delete the files?');
    assert.notEqual(goal.sig, '');
  });

  test('mergeSteps keeps agents with equal labels, each its own row', () => {
    const merged = mergeSteps([], [
      { id: 'a', label: 'Write text', state: 'done' },
      { id: 'b', label: 'Write text', state: 'active' },
    ]);
    assert.deepEqual(merged.map((step) => `${step.label}:${step.state}:${step.id}`), ['Write text:done:agent-a', 'Write text:active:agent-b']);
  });
});

describe('waiting cards', () => {
  test('Notification makes a waiting_for_me item for the session and leaves a marker with its key', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const outcome = await runWaiting({ session_id: 'sess-9', cwd: process.cwd(), message: 'Claude needs your permission' }, envFor(board.url, root));
    board.server.close();
    assert.equal(outcome.ok, true);
    const [{ tool, args }] = callsOf(board);
    assert.equal(tool, 'report_progress');
    assert.deepEqual(args, {
      key: 'demo-app/waiting-sess-9', project: 'demo-app', type: 'waiting_for_me', status: 'open', title: args.title,
      needs_you: 'Claude needs your permission', after_answer: null, source: 'hook',
    });
    assert.match(args.title, /^demo-app/);
    assert.deepEqual(listMarkers(root).map((marker) => [marker.id, marker.key]), [['sess-9', 'demo-app/waiting-sess-9']]);
  });

  test('a SubagentStop never closes the main thread\'s waiting item', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    await runWaiting({ session_id: 'sess-9', cwd: process.cwd(), message: 'hi' }, env);
    await runDone({ session_id: 'sess-9', cwd: process.cwd(), hook_event_name: 'SubagentStop', agent_id: 'a1' }, env, {}, Date.now());
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress']);
    assert.equal(hasMarker({ session_id: 'sess-9' }, root), true);
  });

  test('the waiting item is closed with the key stored in the marker, not one rebuilt from the current project', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    writeMarker({ session_id: 'sess-9' }, 'other-app/waiting-sess-9', root);
    await runDone({ session_id: 'sess-9', cwd: process.cwd(), hook_event_name: 'Stop' }, envFor(board.url, root), {}, Date.now());
    board.server.close();
    assert.deepEqual(callsOf(board), [{ tool: 'mark_done', args: { key: 'other-app/waiting-sess-9', source: 'hook', note: 'Session stopped' } }]);
    assert.equal(hasMarker({ session_id: 'sess-9' }, root), false);
  });

  test('a main-thread tool call after an answered prompt closes the waiting item; a subagent\'s call and a session that never waited do not', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    const tool = (extra = {}) => ({ session_id: 'sess-9', cwd: process.cwd(), hook_event_name: 'PostToolUse', tool_name: 'Read', ...extra });
    assert.deepEqual(await closeAnsweredWaiting(tool(), env), { skipped: 'session never waited' });
    await runWaiting({ session_id: 'sess-9', cwd: process.cwd(), message: 'hi' }, env);
    await closeAnsweredWaiting(tool({ agent_id: 'a1' }), env);
    assert.equal(hasMarker({ session_id: 'sess-9' }, root), true);
    await closeAnsweredWaiting(tool(), env);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress', 'mark_done']);
    assert.equal(hasMarker({ session_id: 'sess-9' }, root), false);
  });

  test('Stop and UserPromptSubmit mark the waiting item done and remove its marker', async () => {
    for (const event of ['Stop', 'UserPromptSubmit']) {
      const board = await startFakeBoard(replyOk);
      const root = folder();
      const env = envFor(board.url, root);
      await runWaiting({ session_id: 'sess-9', cwd: process.cwd(), message: 'hi' }, env);
      await runDone({ session_id: 'sess-9', cwd: process.cwd(), hook_event_name: event }, env, {}, Date.now());
      board.server.close();
      assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress', 'mark_done'], event);
      assert.deepEqual(callsOf(board)[1].args, { key: 'demo-app/waiting-sess-9', source: 'hook', note: 'Session stopped' });
      assert.equal(hasMarker({ session_id: 'sess-9' }, root), false, event);
    }
  });

  test('a dead session\'s waiting card is closed "Session ended" by the next hook of any session; a fresh one stays', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    writeMarker({ session_id: 'dead-1' }, 'demo-app/waiting-dead-1', root);
    writeMarker({ session_id: 'fresh-1' }, 'demo-app/waiting-fresh-1', root);
    writeMarker({ session_id: 'busy-1' }, 'demo-app/waiting-busy-1', root);
    const old = new Date(NOW - DEAD_SESSION_MS - MINUTE);
    const recent = new Date(NOW - 5 * MINUTE);
    utimesSync(join(root, 'dead-1'), old, old);
    utimesSync(join(root, 'fresh-1'), recent, recent);
    utimesSync(join(root, 'busy-1'), old, old);
    touchSeen('busy-1', root, NOW - MINUTE); // silent marker, but the session itself did something a minute ago
    utimesSync(join(root, 'busy-1.seen'), recent, recent);
    await runDone({ session_id: 'other', cwd: process.cwd(), hook_event_name: 'UserPromptSubmit' }, env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board), [{ tool: 'mark_done', args: { key: 'demo-app/waiting-dead-1', source: 'hook', note: 'Session ended' } }]);
    assert.deepEqual(listMarkers(root).map((marker) => marker.id).sort(), ['busy-1', 'fresh-1']);
  });

  test('the calling session\'s own marker is never closed as dead', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    writeMarker({ session_id: 'me' }, 'demo-app/waiting-me', root);
    const old = new Date(NOW - 2 * DEAD_SESSION_MS);
    utimesSync(join(root, 'me'), old, old);
    await runDone({ session_id: 'me', cwd: process.cwd(), hook_event_name: 'Stop' }, envFor(board.url, root), {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.args.note), ['Session stopped']); // the stop path, not "Session ended"
  });
});

function startRepo(repo, branch) {
  execFileSync('git', ['init', '-q', '-b', branch, repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'x']);
}

describe('waiting card title and folder (session-waiting)', () => {
  test('usableCwd keeps only an absolute path to an existing folder', () => {
    const dir = folder();
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.equal(usableCwd(dir), dir);
    for (const bad of ['relative/dir', '.', join(dir, 'missing'), join(dir, 'file.txt'), '', undefined, null, 42, {}]) {
      assert.equal(usableCwd(bad), undefined, String(bad));
    }
  });

  test('titleOf reads the branch from the HEAD file and never runs git (a repo config cannot run a program)', () => {
    const repo = folder('board-repo-');
    startRepo(repo, 'topic-x');
    const marker = join(repo, 'ran.txt');
    execFileSync('git', ['-C', repo, 'config', 'core.fsmonitor', `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}','x')"`]);
    assert.equal(titleOf({ cwd: repo }, { project: 'demo-app' }, null), 'demo-app · topic-x');
    assert.equal(existsSync(marker), false);
  });

  test('branchOf follows the gitdir a worktree\'s .git file points to; detached or missing HEAD gives no branch', () => {
    const repo = folder('board-repo-');
    startRepo(repo, 'main');
    const work = folder('board-wt-');
    const gitDir = join(repo, '.git', 'wt');
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/feat/topic-z\n');
    writeFileSync(join(work, '.git'), `gitdir: ${gitDir}\n`);
    assert.equal(branchOf(work), 'feat/topic-z');
    writeFileSync(join(gitDir, 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    assert.equal(branchOf(work), null);
    assert.equal(titleOf({ cwd: work }, { project: 'demo-app' }, null), 'demo-app');
    assert.equal(branchOf(folder('board-none-')), null);
  });

  test('branchOf walks up from a subfolder to the first folder that holds .git', () => {
    const repo = folder('board-repo-');
    startRepo(repo, 'topic-sub');
    const deep = join(repo, 'plugin', 'scripts');
    mkdirSync(deep, { recursive: true });
    assert.equal(branchOf(deep), 'topic-sub');
    assert.equal(titleOf({ cwd: deep }, { project: 'demo-app' }, null), 'demo-app · topic-sub');
  });

  test('the waiting card title is masked like the other texts', async () => {
    const board = await startFakeBoard(replyOk);
    const root = trackedTemp('board-wait-root-');
    writeGoal('sess-m', { key: 'demo-app/session-sess-m', title: 'Rotate token: abc123secret' }, root);
    await runWaiting({ session_id: 'sess-m', cwd: process.cwd(), notification_type: 'permission_prompt', message: 'm' }, envFor(board.url, root));
    board.server.close();
    assert.equal(callsOf(board)[0].args.title, 'Rotate token: ***');
  });

  test('Slice 45 #12: a title is masked before the 200-character cut, so a cut never leaves half a secret', () => {
    const goal = { title: `${'x'.repeat(190)} token=abcdefghijklmnop`, closed: false };
    const title = titleOf({}, { project: 'demo-app' }, goal);
    assert.ok(!title.includes('abcd') && !title.includes('token=a'), title);
    assert.ok(title.length <= 200, String(title.length));
  });

  test('Slice 45 #12: with no usable cwd there is no branch, never the hook folder\'s ancestor repo', () => {
    assert.equal(titleOf({ cwd: undefined }, { project: 'demo-app' }, null), 'demo-app');
    assert.equal(titleOf({}, { project: 'demo-app' }, null), 'demo-app');
  });

  test('titleOf never sends a closed goal\'s title; an open goal\'s title still wins', () => {
    const repo = folder('board-repo-');
    startRepo(repo, 'topic-y');
    assert.equal(titleOf({ cwd: repo }, { project: 'demo-app' }, { title: 'Old goal', closed: true }), 'demo-app · topic-y');
    assert.equal(titleOf({ cwd: repo }, { project: 'demo-app' }, { title: 'Live goal', closed: false }), 'Live goal');
  });
});

describe('goal reminder and card key (goal-reminder)', () => {
  const promptInput = { session_id: 'sess-1', hook_event_name: 'UserPromptSubmit' };
  const toolInput = (extra = {}) => ({ session_id: 'sess-1', hook_event_name: 'PostToolUse', tool_name: 'Read', ...extra });

  test('a session with no goal is reminded once, at its second tool call', () => {
    const env = { AGENT_BOARD_SESSION_ROOT: folder() };
    assert.equal(remind(promptInput, env, NOW), '');
    assert.equal(remind(toolInput(), env, NOW), '');
    const out = JSON.parse(remind(toolInput(), env, NOW));
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.equal(out.hookSpecificOutput.additionalContext, REMINDER_TEXT);
    assert.equal(remind(toolInput(), env, NOW), '');
  });

  test('the reminder asks whether the prompt started a task with an outcome, and comes once per prompt, again at the next prompt (Slice 41)', () => {
    const env = { AGENT_BOARD_SESSION_ROOT: folder() };
    assert.match(REMINDER_TEXT, /If this prompt started a task with an outcome, report it on the board/);
    remind(promptInput, env, NOW);
    remind(toolInput(), env, NOW);
    assert.ok(remind(toolInput(), env, NOW));
    for (let index = 0; index < 5; index += 1) assert.equal(remind(toolInput(), env, NOW), '');
    remind(promptInput, env, NOW + MINUTE);
    remind(toolInput(), env, NOW + MINUTE);
    assert.ok(remind(toolInput(), env, NOW + MINUTE));
  });

  test('an orchestrator session (marked with report-progress --orchestrator) gets no reminder but its card reports are recorded (Slice 41)', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    assert.equal(markOrchestrator('sess-1', root), true);
    remind(promptInput, env, NOW);
    for (let index = 0; index < 4; index += 1) assert.equal(remind(toolInput(), env, NOW), '');
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', title: 'T' } }), env, NOW);
    assert.equal(readGoal('sess-1', root, NOW).key, CARD);
    remind(toolInput({ tool_name: BOARD_TOOL.replace('report_progress', 'mark_done'), tool_input: { key: CARD } }), env, NOW);
    assert.equal(readGoal('sess-1', root, NOW).closed, true);
  });

  test('a report on a slice card with no agent counts as the session\'s card: no reminder, flagged as a slice (Slice 41)', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: 'proj/slice-9', outcome: 'Code merged', title: 'Build slice 9' } }), env, NOW);
    assert.equal(remind(toolInput(), env, NOW), '');
    const goal = readGoal('sess-1', root, NOW);
    assert.equal(goal.key, 'proj/slice-9');
    assert.equal(goal.slice, true);
  });

  test('a later own-card report for another key does not move the bound card while it is open (Slice 41)', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: 'proj/task-ab', agent: 'session', outcome: 'A plan', title: 'Refine' } }), env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: 'proj/slice-7', outcome: 'Note', title: 'Dependency' } }), env, NOW);
    const goal = readGoal('sess-1', root, NOW);
    assert.equal(goal.key, 'proj/task-ab');
    assert.equal(goal.kind, 'task');
  });

  test('once the bound card is closed, the next own-card report moves the goal to the new card and kind (Slice 41)', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: 'proj/slice-9', outcome: 'Code merged', title: 'Build slice 9' } }), env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL.replace('report_progress', 'mark_done'), tool_input: { key: 'proj/slice-9' } }), env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: 'proj/task-ab', agent: 'session', outcome: 'A plan', title: 'Refine' } }), env, NOW);
    const goal = readGoal('sess-1', root, NOW);
    assert.equal(goal.key, 'proj/task-ab');
    assert.equal(goal.kind, 'task');
    assert.equal(goal.slice, false);
    assert.equal(goal.closed, false);
  });

  test('a marked orchestrator keeps its mark fresh on every hook call (Slice 41)', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    markOrchestrator('sess-1', root);
    const file = orchestratorFilePath('sess-1', root);
    const old = new Date(NOW - 23 * 60 * MINUTE);
    utimesSync(file, old, old);
    remind(promptInput, env, NOW);
    assert.ok(Math.abs(statSync(file).mtimeMs - NOW) < 1000);
  });

  test('a goal sent before this prompt, even 90 minutes ago, does not count: the session is still reminded', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    writeGoal('sess-1', { key: CARD, title: 'Old topic', goalAt: NOW - 90 * MINUTE }, root, NOW);
    remind(promptInput, env, NOW);
    remind(toolInput(), env, NOW);
    assert.equal(JSON.parse(remind(toolInput(), env, NOW)).hookSpecificOutput.additionalContext, REMINDER_TEXT);
  });

  test('a subagent tool call counts for nothing and gets no reminder', () => {
    const env = { AGENT_BOARD_SESSION_ROOT: folder() };
    remind(promptInput, env, NOW);
    for (let index = 0; index < 4; index += 1) assert.equal(remind(toolInput({ agent_id: 'a1' }), env, NOW), '');
  });

  test('the session\'s steps are stored with ids and children; a report with under_step never replaces them', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    const steps = [{ id: 's1', label: 'Plan', state: 'active', children: [{ label: 'Draft', state: 'pending' }] }];
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', title: 'T', steps } }), env, NOW);
    assert.deepEqual(readGoal('sess-1', root, NOW).steps, steps);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, under_step: 'agent-abc', steps: [{ label: 'fr', state: 'active' }] } }), env, NOW + 1000);
    assert.deepEqual(readGoal('sess-1', root, NOW + 1000).steps, steps);
  });

  test('a helper\'s plain report on the session key (agent_id set, no under_step) never replaces the session\'s steps', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    const steps = [{ id: 's1', label: 'Plan', state: 'active' }];
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', title: 'T', steps } }), env, NOW);
    remind(toolInput({ agent_id: 'a1', tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', steps: [{ label: 'mine', state: 'active' }] } }), env, NOW + 1000);
    assert.deepEqual(readGoal('sess-1', root, NOW + 1000).steps, steps);
  });

  test('a helper report with under_step, even done or titled, changes none of the session\'s goal fields', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', title: 'T', why: 'W', needs_you: 'Q?' } }), env, NOW);
    const before = readGoal('sess-1', root, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, under_step: 'agent-abc', status: 'done', title: 'Helper', why: 'H', needs_you: null } }), env, NOW + 1000);
    const after = readGoal('sess-1', root, NOW + 1000);
    for (const field of ['title', 'why', 'closed', 'needsYou']) assert.equal(after[field], before[field], field);
  });

  test('the stored steps keep at most 200 nodes in all, nested ones counted', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    const steps = [{ label: 'big', state: 'active', children: Array.from({ length: 250 }, (_, index) => ({ label: `c${index}`, state: 'pending' })) }];
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', title: 'T', steps } }), env, NOW);
    assert.equal(readGoal('sess-1', root, NOW).steps[0].children.length, 199);
  });

  test('a main-thread report_progress with agent "session" records the card key, title and steps; no reminder follows', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    const steps = [{ label: 'Plan', state: 'active' }, { label: 'Build', state: 'pending', note: 'later' }];
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, project: 'demo-app', type: 'unplanned', agent: 'session', title: 'Translate', why: 'release', steps } }), env, NOW);
    assert.equal(remind(toolInput(), env, NOW + 1000), '');
    const goal = readGoal('sess-1', root, NOW + 1000);
    assert.equal(goal.key, CARD);
    assert.equal(goal.title, 'Translate');
    assert.deepEqual(goal.steps, steps);
    assert.equal(goal.closed, false);
  });

  test('a report for another card, a subagent\'s report and a non-board tool are not recorded', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: 'demo-app/slice-3', title: 'x', agent: 'implement-slice' } }), env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, agent_id: 'a1', tool_input: { key: CARD, agent: 'session', title: 'x' } }), env, NOW);
    remind(toolInput({ tool_name: 'mcp__other__report_progress', tool_input: { key: CARD, agent: 'session', title: 'x' } }), env, NOW);
    assert.equal(readGoal('sess-1', root, NOW), null);
  });

  test('a later report on the same card keeps its title and sent steps; mark_done and status done close it', () => {
    const root = folder();
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, agent: 'session', title: 'Translate', steps: [{ label: 'Plan', state: 'active' }] } }), env, NOW);
    remind(toolInput({ tool_name: BOARD_TOOL, tool_input: { key: CARD, status: 'in_progress' } }), env, NOW + 1000);
    assert.deepEqual([readGoal('sess-1', root, NOW).title, readGoal('sess-1', root, NOW).steps.length], ['Translate', 1]);
    remind(toolInput({ tool_name: 'mcp__plugin_agent-board_agent-board__mark_done', tool_input: { key: CARD } }), env, NOW + 2000);
    assert.equal(readGoal('sess-1', root, NOW).closed, true);
  });

  test('a session with an active task file gets no reminder', () => {
    const root = folder();
    writeFileSync(join(root, 'sess-1.task.json'), JSON.stringify({ key: 'demo-app/slice-3', step: 'x', status: 'in_progress' }));
    const env = { AGENT_BOARD_SESSION_ROOT: root };
    remind(promptInput, env, Date.now());
    remind(toolInput(), env, Date.now());
    assert.equal(remind(toolInput(), env, Date.now()), '');
  });

  test('prompt counters are kept per session in the state folder', () => {
    const root = folder();
    writePrompt('sess-1', { at: NOW, tools: 1, reminded: false }, root);
    assert.equal(existsSync(join(root, 'sess-1.prompt.json')), true);
  });
});

describe('hook processes', () => {
  test('an unreadable stdin is one stderr line, not silence', () => {
    const error = Object.assign(new Error('x'), { code: 'EAGAIN' });
    const original = process.stderr.write;
    let seen = '';
    process.stderr.write = (chunk) => { seen += chunk; return true; };
    try {
      assert.equal(readStdinText(() => { throw error; }), '');
    } finally {
      process.stderr.write = original;
    }
    assert.match(seen, /stdin unreadable \(EAGAIN\)/);
  });

  test('the hooks do nothing without a token, a session id or valid JSON, and exit 0', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const noToken = envFor(board.url, root, { CLAUDE_PLUGIN_OPTION_BOARD_TOKEN: '' });
    const withToken = envFor(board.url, root);
    const results = [
      await runNode(WAITING_HOOK, [], noToken, JSON.stringify({ session_id: 's' })),
      await runNode(WAITING_HOOK, [], withToken, JSON.stringify({ message: 'no id' })),
      await runNode(WAITING_HOOK, [], withToken, 'not json'),
      await runNode(DONE_HOOK, [], noToken, JSON.stringify({ session_id: 's', hook_event_name: 'Stop' })),
      await runNode(REMINDER_HOOK, [], withToken, ''),
    ];
    board.server.close();
    assert.deepEqual(results.map((result) => result.code), [0, 0, 0, 0, 0]);
    assert.equal(board.requests.length, 0);
  });

  test('the hooks exit 0 when the board is down or answers 500', async () => {
    const failing = await startFakeBoard((_, res) => { res.writeHead(500); res.end('boom'); });
    const down = await startFakeBoard(replyOk);
    const downUrl = down.url;
    down.server.close();
    const root = folder();
    const input = JSON.stringify({ session_id: 'sess-1', cwd: process.cwd(), message: 'm', hook_event_name: 'Stop' });
    const first = await runNode(WAITING_HOOK, [], envFor(failing.url, root), input);
    const second = await runNode(WAITING_HOOK, [], envFor(downUrl, root), input);
    failing.server.close();
    assert.equal(first.code, 0);
    assert.match(first.stderr, /HTTP 500/);
    assert.equal(second.code, 0);
    assert.equal(hasMarker({ session_id: 'sess-1' }, root), false);
  });

  test('the done hook as a process closes a card and exits 0; the reminder hook prints its JSON', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    writeGoal('sess-1', { key: CARD, steps: [] }, root, Date.now());
    const stop = await runNode(DONE_HOOK, [], env, JSON.stringify({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: 'Stop' }));
    assert.equal(stop.code, 0);
    assert.equal(board.requests[0].body.params.name, 'mark_done');
    await runNode(REMINDER_HOOK, [], env, JSON.stringify({ session_id: 'sess-2', hook_event_name: 'UserPromptSubmit' }));
    await runNode(REMINDER_HOOK, [], env, JSON.stringify({ session_id: 'sess-2', hook_event_name: 'PostToolUse', tool_name: 'Read' }));
    const second = await runNode(REMINDER_HOOK, [], env, JSON.stringify({ session_id: 'sess-2', hook_event_name: 'PostToolUse', tool_name: 'Read' }));
    board.server.close();
    assert.equal(second.code, 0);
    assert.equal(JSON.parse(second.stdout).hookSpecificOutput.additionalContext, REMINDER_TEXT);
  });

  test('the hooks keep state under CLAUDE_PLUGIN_DATA, never the plugin folder', async () => {
    const board = await startFakeBoard(replyOk);
    const data = folder('board-data-');
    const env = envFor(board.url, '', { CLAUDE_PLUGIN_DATA: data, AGENT_BOARD_SESSION_ROOT: '' });
    await runNode(WAITING_HOOK, [], env, JSON.stringify({ session_id: 'sess-1', cwd: process.cwd(), message: 'm' }));
    board.server.close();
    assert.equal(existsSync(join(data, 'state', 'sess-1')), true);
    assert.match(readFileSync(join(data, 'state', 'sess-1'), 'utf8'), /waiting-sess-1/);
  });
});

describe('Slice 29: background-agent state', () => {
  const stopInput = (transcript, event, extra = {}) => ({ session_id: 'sess-1', cwd: process.cwd(), hook_event_name: event, transcript_path: transcript, ...extra });

  test('parallel SubagentStop hooks each keep their agent id', async () => {
    const root = folder();
    const code = `import { addStoppedAgent } from ${JSON.stringify(new URL('./hook-input.mjs', import.meta.url).href)}; addStoppedAgent('sess-1', process.env.TEST_AGENT, ${JSON.stringify(root)});`;
    const names = Array.from({ length: 8 }, (_, index) => `agent${index}`);
    await Promise.all(names.map((name) => runNode('--input-type=module', ['-e', code], { ...process.env, TEST_AGENT: name })));
    assert.deepEqual(stoppedIds(root).sort(), names);
  });

  test('a stopped agent whose record is older than 10 minutes is not listed', () => {
    const transcript = sessionWithAgents([{ id: 'old', description: 'Old helper', ageMs: AGENT_FRESH_MS + MINUTE }, { id: 'new', description: 'New helper', ageMs: MINUTE }]);
    const agents = readBackgroundAgents({ transcript_path: transcript }, NOW, { old: NOW - 20 * MINUTE, new: NOW });
    assert.deepEqual(agents.map((agent) => `${agent.id}:${agent.state}`), ['new:done']);
  });

  test('an agent that wrote after its stop is working again, and a new stop time makes it done', () => {
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    const state = (stopped) => readBackgroundAgents({ transcript_path: transcript }, NOW, stopped)[0].state;
    assert.equal(state({ a1: NOW - 5 * MINUTE }), 'active');
    assert.equal(state({ a1: NOW }), 'done');
  });

  test('a resumed agent shows active in the Stop report', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    addStoppedAgent('sess-1', 'a1', root, NOW - 5 * MINUTE);
    await runDone(stopInput(transcript, 'Stop'), env, {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.equal(call.tool, 'report_progress');
    assert.equal(call.args.steps.flatMap((step) => [step, ...(step.children || [])]).find((step) => step.label === 'Translate texts').state, 'active');
  });

  test('mergeSteps keeps the session\'s active step active when an agent with the same label runs under it', () => {
    const sent = [{ label: 'Translate texts', state: 'active' }, { label: 'Ship', state: 'pending' }];
    const merged = mergeSteps(sent, [{ id: 'a1', label: 'Translate texts', state: 'active' }], { a1: 'label:Translate texts' });
    assert.deepEqual(merged.map((step) => `${step.label}:${step.state}`), ['Translate texts:active', 'Ship:pending']);
    assert.equal(merged[0].children[0].label, 'Translate texts');
  });

  test('a goal file removed during the call is not brought back, and a question asked during a resume call stays', async () => {
    const root = folder();
    let during = () => {};
    const board = await startFakeBoard((record, res) => { during(); replyOk(record, res); });
    const env = envFor(board.url, root);
    const transcript = sessionWithAgents([]);
    withCard(root, { closed: true, closedBy: 'stop', sig: 'old' });
    during = () => writeGoal('sess-1', { ...readGoal('sess-1', root, NOW), needsYou: 'New question?' }, root, NOW);
    await runDone(stopInput(transcript, 'UserPromptSubmit'), env, {}, NOW);
    const goal = readGoal('sess-1', root, NOW);
    assert.equal(goal.needsYou, 'New question?');
    assert.equal(goal.closed, false);
    assert.equal(goal.sig, '', 'a resume resets the list last sent');
    withCard(root);
    during = () => removeGoal('sess-1', root);
    await runDone(stopInput(transcript, 'Stop'), env, {}, NOW);
    board.server.close();
    assert.equal(readGoal('sess-1', root, NOW), null);
  });

  test('the last background agent stopping after Stop closes the card, once', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const running = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(stopInput(running, 'Stop'), env, {}, NOW);
    assert.equal(readGoal('sess-1', root, NOW).held, true);
    await runDone(stopInput(running, 'SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    await runDone(stopInput(running, 'SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress', 'mark_done']);
    const goal = readGoal('sess-1', root, NOW);
    assert.deepEqual([goal.closed, goal.held], [true, false]);
  });

  test('a SubagentStop while another agent still runs does not close the card', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const running = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: MINUTE }]);
    await runDone(stopInput(running, 'Stop'), env, {}, NOW);
    await runDone(stopInput(running, 'SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress', 'report_progress']);
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('a resume after Stop reopens the card with no title or why', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const transcript = sessionWithAgents([]);
    await runDone(stopInput(transcript, 'Stop'), env, {}, NOW);
    await runDone(stopInput(transcript, 'UserPromptSubmit'), env, {}, NOW);
    board.server.close();
    const calls = callsOf(board);
    assert.deepEqual(calls.map((call) => call.tool), ['mark_done', 'report_progress']);
    for (const call of calls) assert.deepEqual([call.args.title, call.args.why], [undefined, undefined]);
    assert.equal(calls[1].args.note, 'Session resumed');
  });

  test('the last SubagentStop does not close a held card when the main thread wrote after Stop', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const running = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(stopInput(running, 'Stop'), env, {}, NOW);
    writeFileSync(running, '{}\n'); // the main transcript: written now, after the hold at NOW - 10 s
    writeGoal('sess-1', { ...readGoal('sess-1', root, NOW), heldAt: NOW - 10000 }, root, NOW);
    await runDone(stopInput(running, 'SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    board.server.close();
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress']);
    const goal = readGoal('sess-1', root, NOW);
    assert.deepEqual([goal.closed, goal.held], [false, false]);
  });

  test('a prompt on a held card with no question ends the hold', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root, { held: true, heldAt: NOW });
    const running = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(stopInput(running, 'UserPromptSubmit'), env, {}, NOW);
    await runDone(stopInput(running, 'SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    board.server.close();
    assert.equal(callsOf(board).some((call) => call.tool === 'mark_done'), false);
    assert.equal(readGoal('sess-1', root, NOW).held, false);
  });

  test('an agent that stops after a long silent call is still listed, done', () => {
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: AGENT_FRESH_MS + 5 * MINUTE }]);
    const agents = readBackgroundAgents({ transcript_path: transcript }, NOW, { a1: NOW });
    assert.deepEqual(agents.map((agent) => `${agent.id}:${agent.state}`), ['a1:done']);
  });

  test('a stop time is kept past the freshness window, and only files older than the keep window are pruned', () => {
    const root = folder();
    addStoppedAgent('sess-1', 'a1', root, NOW - 11 * MINUTE);
    addStoppedAgent('sess-1', 'a2', root, NOW);
    assert.deepEqual(stoppedIds(root).sort(), ['a1', 'a2']);
    addStoppedAgent('sess-1', 'a3', root, NOW + 2 * MINUTE);
    assert.deepEqual(stoppedIds(root).sort(), ['a2', 'a3']);
  });

  test('a resumed agent loses only its own stop file, and a Stop reports it active', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: 30 * 1000 }]);
    addStoppedAgent('sess-1', 'a1', root, NOW - 5 * MINUTE);
    addStoppedAgent('sess-1', 'a2', root, NOW);
    await runDone(stopInput(transcript, 'Stop'), env, {}, NOW);
    board.server.close();
    assert.deepEqual(stoppedIds(root), ['a2']);
  });

  test('a stop file of a removed state folder or an unreadable one is ignored, and no lock folder is made', () => {
    const root = folder();
    assert.deepEqual(stoppedIds(root), []);
    addStoppedAgent('sess-1', 'a1', root, NOW);
    writeFileSync(join(root, 'sess-1.stopped', 'broken.json'), '{nope');
    assert.deepEqual(stoppedIds(root), ['a1']);
    assert.equal(existsSync(join(root, 'sess-1.lock')), false);
  });

  test('the Stop hold time is taken after its own call returns, and `at` never moves back', async () => {
    const board = await startFakeBoard((record, res) => setTimeout(() => replyOk(record, res), 300));
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root);
    const running = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(stopInput(running, 'Stop'), env, {}, NOW);
    board.server.close();
    const goal = readGoal('sess-1', root, NOW + 10000);
    assert.equal(goal.heldAt >= NOW + 250, true, `heldAt ${goal.heldAt - NOW} ms after the start`);
    writeGoal('sess-1', { ...goal, at: NOW + 5000 }, root, NOW);
    updateGoal('sess-1', root, NOW, (current) => ({ ...current, at: NOW }));
    assert.equal(readGoal('sess-1', root, NOW + 10000).at, NOW + 5000);
  });

  test('a prompt clears a stale hold on a card the session finished', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    withCard(root, { closed: true, closedBy: 'session', held: true, heldAt: NOW });
    await runDone(stopInput(sessionWithAgents([]), 'UserPromptSubmit'), env, {}, NOW);
    board.server.close();
    assert.deepEqual([readGoal('sess-1', root, NOW).held, callsOf(board).length], [false, 0]);
  });

  test('the hold is on the goal file while the Stop call is still in flight', async () => {
    const root = folder();
    let heldDuringCall = null;
    const board = await startFakeBoard((record, res) => {
      heldDuringCall = readGoal('sess-1', root, NOW).held;
      replyOk(record, res);
    });
    withCard(root);
    const running = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    await runDone(stopInput(running, 'Stop'), envFor(board.url, root), {}, NOW);
    board.server.close();
    assert.equal(heldDuringCall, true);
  });

  test('a close skipped for an open question ends the hold', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    withCard(root, { needsYou: 'Which one?', held: true, heldAt: NOW });
    const finished = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE, finished: true }]);
    await runDone(stopInput(finished, 'SubagentStop', { agent_id: 'a1' }), envFor(board.url, root), {}, NOW);
    board.server.close();
    const goal = readGoal('sess-1', root, NOW);
    assert.deepEqual([goal.held, goal.closed, callsOf(board).length], [false, false, 0]);
  });

  test('a record flushed shortly after the stop is not a resume and keeps its stop file', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    withCard(root);
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    addStoppedAgent('sess-1', 'a1', root, NOW - MINUTE - 2500);
    await runDone(stopInput(transcript, 'Stop'), envFor(board.url, root), {}, NOW);
    board.server.close();
    assert.deepEqual([stoppedIds(root), callsOf(board).map((call) => call.tool)], [['a1'], ['mark_done']]);
  });

  test('agent ids that differ only in punctuation keep separate stop files, and removing the goal removes them', () => {
    const root = folder();
    addStoppedAgent('sess-1', 'a.b', root, NOW);
    addStoppedAgent('sess-1', 'a b', root, NOW);
    assert.deepEqual(stoppedIds(root).sort(), ['a b', 'a.b']);
    removeGoal('sess-1', root);
    assert.equal(existsSync(join(root, 'sess-1.stopped')), false);
  });

  test('Slice 45 (Slice 29 follow-ups): the stop folder goes with an aged-out goal file and with its last resumed agent', () => {
    const root = folder();
    writeGoal('sess-7', { key: 'demo-app/session-sess-7', project: 'demo-app', title: 't' }, root, NOW);
    addStoppedAgent('sess-7', 'a1', root, NOW);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(join(root, 'sess-7.goal.json'), old, old);
    assert.equal(readGoal('sess-7', root, Date.now()), null);
    assert.equal(existsSync(join(root, 'sess-7.stopped')), false);
    addStoppedAgent('sess-8', 'a1', root, NOW);
    addStoppedAgent('sess-8', 'a2', root, NOW);
    removeStoppedAgent('sess-8', 'a1', root);
    assert.deepEqual(Object.keys(readStoppedAt('sess-8', root)), ['a2']);
    removeStoppedAgent('sess-8', 'a2', root);
    assert.equal(existsSync(join(root, 'sess-8.stopped')), false);
  });

  test('Slice 45: a temp file a killed hook left behind is removed by the next write of the same file, a fresh one is kept', () => {
    const root = folder();
    const file = join(root, 'x.goal.json');
    writeJson(file, { a: 1 });
    const stale = `${file}.1-dead.tmp`;
    const fresh = `${file}.2-live.tmp`;
    writeFileSync(stale, '{');
    writeFileSync(fresh, '{');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(stale, old, old);
    writeJson(file, { a: 2 });
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(fresh), true);
  });

  test('Slice 45: the sender log names the hook, session and the fields a card report sent, and stays short', () => {
    const root = folder();
    logSender(root, 'session-done:report_progress', 'sess-1', 'demo-app/session-sess-1', ['status', 'title']);
    assert.match(readFileSync(join(root, 'senders.log'), 'utf8'), /session-done:report_progress sess-1 demo-app\/session-sess-1 status,title\n$/);
    for (let n = 0; n < SENDER_LOG_LINES * 2 + 5; n += 1) logSender(root, 'h', 'sess-1', 'k', []);
    assert.ok(readFileSync(join(root, 'senders.log'), 'utf8').split('\n').filter(Boolean).length <= SENDER_LOG_LINES * 2);
  });

  test('Slice 45: a Stop that sends a card report is logged with its hook and fields, and a goal-bearing report never names title or why', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    writeGoal('sess-1', { key: 'demo-app/session-sess-1', project: 'demo-app', title: 'Goal' }, root, NOW);
    await runDone({ session_id: 'sess-1', hook_event_name: 'Stop', cwd: process.cwd() }, env, {}, NOW);
    board.server.close();
    const log = readFileSync(join(root, 'senders.log'), 'utf8');
    assert.match(log, /session-done:\w+ sess-1 demo-app\/session-sess-1/);
    assert.doesNotMatch(log, /\btitle\b|\bwhy\b/);
  });

  test('a session step with the agent\'s label stays as it is and the agent is its own row', () => {
    const merged = mergeSteps([{ label: 'Review', state: 'pending', note: 'my note' }], [{ id: 'a1', label: 'Review', state: 'active' }]);
    assert.deepEqual(merged, [{ label: 'Review', state: 'pending', note: 'my note' }, { id: 'agent-a1', label: 'Review', state: 'active', note: 'Helper agent' }]);
  });

  test('one session\'s hooks never write another session\'s card, and no hook report sends a title or why on a session card', async () => {
    const board = await startFakeBoard(replyOk);
    const root = folder();
    const env = envFor(board.url, root);
    const other = 'demo-app/session-other';
    writeGoal('sess-other', { key: other, project: 'demo-app', title: 'Research tools', why: 'other goal', steps: [] }, root, NOW);
    withCard(root);
    const transcript = sessionWithAgents([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }]);
    for (const event of ['UserPromptSubmit', 'Stop', 'SubagentStop', 'Stop']) await runDone(stopInput(transcript, event, { agent_id: 'a1' }), env, {}, NOW);
    await runWaiting({ session_id: 'sess-1', cwd: process.cwd(), notification_type: 'permission_prompt', message: 'Allow it?' }, env);
    board.server.close();
    for (const call of callsOf(board)) {
      assert.notEqual(call.args.key, other);
      if (call.args.key === CARD) assert.deepEqual([call.args.title, call.args.why], [undefined, undefined]);
    }
    const otherGoal = readGoal('sess-other', root, NOW);
    assert.deepEqual([otherGoal.title, otherGoal.why], ['Research tools', 'other goal']);
  });
});

describe('writeJson rename retry', () => {
  function busy() {
    return Object.assign(new Error('busy'), { code: 'EBUSY' });
  }

  test('a rename that fails twice with EBUSY then succeeds still writes the file', () => {
    const root = folder();
    const file = join(root, 'x.json');
    let calls = 0;
    writeJson(file, { a: 1 }, (from, to) => {
      calls += 1;
      if (calls <= 2) throw busy();
      renameSync(from, to);
    });
    assert.equal(calls, 3);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1 });
    assert.deepEqual(readdirSync(root), ['x.json']);
  });

  test('a rename that always fails gives up within about 100 ms and leaves no temp file', () => {
    const root = folder();
    const file = join(root, 'x.json');
    const started = Date.now();
    writeJson(file, { a: 1 }, () => {
      throw busy();
    });
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(readdirSync(root), []);
  });
});
