/* global process, URL */
// Tests for the board hooks and background-agent reading. A local fake HTTP server stands in for the board.
// Run: node --test "plugin/**/*.test.mjs"
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { AGENT_FRESH_MS, mergeSteps, readBackgroundAgents, subagentsDir } from './background-agents.mjs';
import { closeAnsweredWaiting, handle as remind, REMINDER_TEXT } from './goal-reminder.mjs';
import { addStoppedAgent, hasMarker, listMarkers, readGoal, readStdinText, readStoppedAt, removeGoal, touchSeen, updateGoal, writeGoal, writeJson, writeMarker, writePrompt } from './hook-input.mjs';
import { DEAD_SESSION_MS, run as runDone } from './session-done.mjs';
import { run as runWaiting } from './session-waiting.mjs';
import { cleanUpAfterTests, envFor, callsOf, replyOk, runNode, startFakeBoard, trackedTemp } from '../test-helpers.mjs';

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
    writeFileSync(record, '{}\n');
    const at = new Date(now - agent.ageMs);
    utimesSync(record, at, at);
    writeFileSync(join(subagents, `agent-${agent.id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: agent.description, ...(agent.finished ? { finished: true } : {}) }));
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

  test('mergeSteps keeps the sent steps, gives the active slot to the first running agent and never lists two active', () => {
    const sent = [{ label: 'Write text', state: 'active' }, { label: 'Ship', state: 'pending' }];
    const agents = [
      { id: 'a', label: 'Translate texts', state: 'active' },
      { id: 'b', label: 'Draw pictures', state: 'active' },
      { id: 'c', label: 'Check links', state: 'done' },
    ];
    const merged = mergeSteps(sent, agents);
    assert.deepEqual(merged.map((step) => `${step.label}:${step.state}`), ['Write text:pending', 'Ship:pending', 'Translate texts:active', 'Draw pictures:pending', 'Check links:done']);
    assert.equal(merged.filter((step) => step.state === 'active').length, 1);
  });

  test('mergeSteps leaves the sent list as sent when no agent runs, and skips a label the session already has', () => {
    const sent = [{ label: 'Write text', state: 'active' }];
    assert.deepEqual(mergeSteps(sent, [{ id: 'c', label: 'Check links', state: 'done' }]).map((step) => step.state), ['active', 'done']);
    assert.equal(mergeSteps(sent, [{ id: 'd', label: 'Write text', state: 'active' }]).length, 1);
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

  test('Stop with a fresh background agent keeps the card in_progress with the note and the agent as a step', async () => {
    const { board, root, env, input } = await setup([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: 2 * MINUTE }]);
    await runDone(input('Stop'), env, {}, NOW);
    board.server.close();
    const [call] = callsOf(board);
    assert.equal(callsOf(board).length, 1);
    assert.equal(call.tool, 'report_progress');
    assert.equal(call.args.status, 'in_progress');
    assert.equal(call.args.note, 'background agents running');
    assert.deepEqual(call.args.steps.map((step) => `${step.label}:${step.state}`), ['Write text:pending', 'Ship:pending', 'Draw pictures:active', 'Translate texts:pending']);
    assert.equal(readGoal('sess-1', root, NOW).closed, false);
  });

  test('SubagentStop turns the stopped agent done and sends the list once', async () => {
    const { board, env, input } = await setup([{ id: 'a1', description: 'Translate texts', ageMs: MINUTE }, { id: 'a2', description: 'Draw pictures', ageMs: MINUTE }]);
    await runDone(input('SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    await runDone(input('SubagentStop', { agent_id: 'a1' }), env, {}, NOW);
    board.server.close();
    const calls = callsOf(board);
    assert.equal(calls.length, 1, 'the unchanged list is not sent twice');
    assert.deepEqual(calls[0].args.steps.filter((step) => step.label !== 'Write text' && step.label !== 'Ship').map((step) => `${step.label}:${step.state}`), ['Translate texts:done', 'Draw pictures:active']);
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

  test('mergeSteps keeps a new agent whose label an earlier finished agent had, and agents with equal labels', () => {
    const merged = mergeSteps([], [
      { id: 'a', label: 'Write text', state: 'done' },
      { id: 'b', label: 'Write text', state: 'active' },
    ]);
    assert.deepEqual(merged.map((step) => `${step.label}:${step.state}`), ['Write text:done', 'Write text:active']);
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
    assert.equal(call.args.steps.find((step) => step.label === 'Translate texts').state, 'active');
  });

  test('mergeSteps keeps one active step when the running agent has the label of the session\'s active step', () => {
    const merged = mergeSteps([{ label: 'Translate texts', state: 'active' }, { label: 'Ship', state: 'pending' }], [{ id: 'a1', label: 'Translate texts', state: 'active' }]);
    assert.deepEqual(merged.map((step) => `${step.label}:${step.state}`), ['Translate texts:active', 'Ship:pending']);
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

  test('a session step with the agent\'s label keeps its own note', () => {
    const merged = mergeSteps([{ label: 'Review', state: 'pending', note: 'my note' }], [{ id: 'a1', label: 'Review', state: 'active' }]);
    assert.deepEqual(merged, [{ label: 'Review', state: 'active', note: 'my note' }]);
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
