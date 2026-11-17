// Slice 27: what a waiting card says, and when the Notification hook opens none.
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { writeGoal } from './hook-input.mjs';
import { run as runWaiting } from './session-waiting.mjs';
import { afterAnswerOf, cardText, endsWithQuestion, lastAssistant, questionOf, toolText } from './waiting-card.mjs';
import { cleanUpAfterTests, envFor, callsOf, replyOk, startFakeBoard, trackedTemp } from '../test-helpers.mjs';

after(cleanUpAfterTests);

const STATUS_LINE = 'Slice 4 is merged and the board shows it. Waiting on the 10 minute timer.';
const QUESTION = 'The migration is ready. Once you confirm, I will merge it. Should I merge Slice 4 now?';

function transcript(entries) {
  const dir = trackedTemp('board-wait-');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n'));
  return file;
}

const say = (text, extra = []) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }, ...extra] } });
const bash = (command) => ({ type: 'tool_use', name: 'Bash', input: { command } });

async function notify(extra, entries) {
  const board = await startFakeBoard(replyOk);
  const root = trackedTemp('board-wait-root-');
  const env = envFor(board.url, root);
  const input = { session_id: 'sess-9', cwd: process.cwd(), ...(entries ? { transcript_path: transcript(entries) } : {}), ...extra };
  const outcome = await runWaiting(input, env);
  board.server.close();
  return { outcome, calls: callsOf(board), root };
}

describe('question reading', () => {
  test('only a last line ending with a question mark is a question', () => {
    assert.equal(endsWithQuestion(QUESTION), true);
    assert.equal(endsWithQuestion('Ready.\nShould I go on? **'), true);
    assert.equal(endsWithQuestion(STATUS_LINE), false);
    assert.equal(endsWithQuestion('Should I merge?\nI will wait.'), false);
  });

  test('the question is the last question sentence, at most 300 characters', () => {
    assert.equal(questionOf(QUESTION), 'Should I merge Slice 4 now?');
    assert.equal(questionOf(`${'a'.repeat(400)}?`).length, 300);
  });

  test('after_answer is what the message says follows the answer', () => {
    assert.equal(afterAnswerOf(QUESTION), 'Once you confirm, I will merge it.');
    assert.equal(afterAnswerOf('Should I merge?'), '');
  });

  test('a permission prompt names the tool and its command', () => {
    assert.equal(toolText({ name: 'Bash', input: { command: 'npm test' } }), 'Bash: npm test');
    assert.equal(toolText({ name: 'Task', input: {} }), 'Task');
    assert.deepEqual(cardText('permission_prompt', 'Claude needs your permission', { text: '', tool: { name: 'Bash', input: { command: 'rm -r build' } } }), { needsYou: 'Allow Bash: rm -r build?', afterAnswer: '' });
  });

  test('the last assistant message is read from the transcript tail', () => {
    const file = transcript([say('old'), { type: 'user', message: { role: 'user', content: 'hi' } }, say('Should I go?', [bash('ls')])]);
    assert.deepEqual(lastAssistant(file), { text: 'Should I go?', tool: { name: 'Bash', input: { command: 'ls' } } });
    assert.deepEqual(lastAssistant('/no/such/file'), { text: '', tool: null });
  });
});

describe('the Notification hook', () => {
  test('an idle prompt after a status line opens no card', async () => {
    const { outcome, calls } = await notify({ notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, [say(STATUS_LINE)]);
    assert.deepEqual(outcome, { skipped: 'nothing is asked' });
    assert.deepEqual(calls, []);
  });

  test('an idle prompt after a question opens a card with the question and what follows', async () => {
    const { calls } = await notify({ notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, [say(QUESTION)]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool, 'report_progress');
    assert.equal(calls[0].args.needs_you, 'Should I merge Slice 4 now?');
    assert.equal(calls[0].args.after_answer, 'Once you confirm, I will merge it.');
    assert.equal(calls[0].args.type, 'waiting_for_me');
  });

  test('a permission prompt opens a card that names the tool and command', async () => {
    const { calls } = await notify({ notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, [say('Running the tests.', [bash('npm test')])]);
    assert.equal(calls[0].args.needs_you, 'Allow Bash: npm test?');
  });

  test('the title is the session goal, else the project', async () => {
    const board = await startFakeBoard(replyOk);
    const root = trackedTemp('board-wait-root-');
    writeGoal('sess-9', { key: 'demo-app/session-sess-9', title: 'Ship the picker' }, root);
    await runWaiting({ session_id: 'sess-9', cwd: process.cwd(), notification_type: 'permission_prompt', message: 'm' }, envFor(board.url, root));
    board.server.close();
    assert.equal(callsOf(board)[0].args.title, 'Ship the picker');
  });
});
