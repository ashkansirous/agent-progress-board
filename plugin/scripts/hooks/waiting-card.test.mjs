// Slice 27: what a waiting card says, and when the Notification hook opens none.
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { writeGoal } from './hook-input.mjs';
import { run as runWaiting } from './session-waiting.mjs';
import { afterAnswerOf, cardText, endsWithQuestion, lastAssistant, maskSecrets, questionOf, toolText } from './waiting-card.mjs';
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

  test('a question keeps its leading number and its wrapped lines; only list markers go', () => {
    assert.equal(questionOf('5 backups are old, delete them?'), '5 backups are old, delete them?');
    assert.equal(questionOf('2024 release or hotfix?'), '2024 release or hotfix?');
    assert.equal(questionOf('Ready.\n\n- Should I merge\nSlice 4 now?'), 'Should I merge Slice 4 now?');
    assert.equal(questionOf('1. Pick one?'), 'Pick one?');
  });

  test('a command is clipped to 120 characters and secret-looking values are masked', () => {
    assert.equal(maskSecrets('curl -H "Authorization: Bearer abc123def" https://x.test'), 'curl -H "Authorization: ***" https://x.test');
    assert.equal(maskSecrets('API_KEY=abc123 npm run build'), 'API_KEY=*** npm run build');
    assert.equal(maskSecrets('deploy --token abc123 --env prod'), 'deploy --token *** --env prod');
    assert.equal(maskSecrets('git clone https://user:hunter2@host.test/r.git'), 'git clone https://user:***@host.test/r.git');
    assert.equal(maskSecrets('echo ghp_abcdefghijklmnopqrstuvwxyz0123'), 'echo ***');
    assert.equal(maskSecrets('git status'), 'git status');
    assert.equal(maskSecrets(`curl -d '{"password":"hunter2"}' x`), `curl -d '{"password":***}' x`);
    assert.equal(maskSecrets('curl -u admin:hunter2 https://x.test'), 'curl -u *** https://x.test');
    assert.equal(maskSecrets('git clone https://ghp-Token_9@host.test/r.git'), 'git clone https://***@host.test/r.git');
    const text = toolText({ name: 'Bash', input: { command: `echo ${'x '.repeat(100)}` } });
    assert.equal(text.length, 'Bash: '.length + 120);
    assert.equal(toolText({ name: 'Bash', input: { command: 'PASSWORD=hunter2 ./run' } }), 'Bash: PASSWORD=*** ./run');
  });

  test('the last assistant message is read from the transcript tail', () => {
    const file = transcript([say('old'), { type: 'user', message: { role: 'user', content: 'hi' } }, say('Should I go?', [bash('ls')])]);
    assert.deepEqual(lastAssistant(file), { text: 'Should I go?', tool: { name: 'Bash', input: { command: 'ls' } } });
    assert.deepEqual(lastAssistant('/no/such/file'), { text: '', tool: null });
  });

  test('text and a tool call written as separate entries of one turn are read together', () => {
    const user = { type: 'user', message: { role: 'user', content: 'hi' } };
    const split = (id, content) => ({ type: 'assistant', message: { id, role: 'assistant', content } });
    const file = transcript([
      split('m0', [{ type: 'text', text: 'Earlier turn.' }]), user,
      split('m1', [{ type: 'text', text: 'Should I proceed? Once you confirm, I will merge.' }]),
      split('m1', [{ type: 'thinking', thinking: '...' }]),
      split('m1', [bash('ls')]),
    ]);
    assert.deepEqual(lastAssistant(file), { text: 'Should I proceed? Once you confirm, I will merge.', tool: { name: 'Bash', input: { command: 'ls' } } });
  });

  test('masking a long word, dot or hyphen run is linear (well under the hook timeout)', () => {
    for (const run of ['a.'.repeat(50000), 'a-'.repeat(50000), 'a-1'.repeat(40000), 'a.key'.repeat(20000)]) {
      const started = Date.now();
      maskSecrets(run);
      assert.ok(Date.now() - started < 1500, `masking ${run.slice(0, 6)}... took ${Date.now() - started} ms`);
    }
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

  test('an idle prompt opens no second card for a question the session card already holds', async () => {
    const board = await startFakeBoard(replyOk);
    const root = trackedTemp('board-wait-root-');
    writeGoal('sess-9', { key: 'demo-app/session-sess-9', title: 'Ship', needsYou: 'Should I merge Slice 4 now?' }, root);
    const input = { session_id: 'sess-9', cwd: process.cwd(), notification_type: 'idle_prompt', message: 'm', transcript_path: transcript([say(QUESTION)]) };
    const outcome = await runWaiting(input, envFor(board.url, root));
    board.server.close();
    assert.deepEqual(outcome, { skipped: 'the session card holds the question' });
    assert.deepEqual(callsOf(board), []);
  });

  test('an idle prompt with no question closes the session\'s older open waiting card', async () => {
    const board = await startFakeBoard(replyOk);
    const root = trackedTemp('board-wait-root-');
    const env = envFor(board.url, root);
    const base = { session_id: 'sess-9', cwd: process.cwd(), message: 'm' };
    await runWaiting({ ...base, notification_type: 'idle_prompt', transcript_path: transcript([say(QUESTION)]) }, env);
    const outcome = await runWaiting({ ...base, notification_type: 'idle_prompt', transcript_path: transcript([say(STATUS_LINE)]) }, env);
    board.server.close();
    assert.deepEqual(outcome, { skipped: 'nothing is asked' });
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress', 'mark_done']);
  });

  test('an idle prompt never closes an open permission card', async () => {
    const board = await startFakeBoard(replyOk);
    const root = trackedTemp('board-wait-root-');
    const env = envFor(board.url, root);
    const base = { session_id: 'sess-9', cwd: process.cwd(), message: 'm' };
    await runWaiting({ ...base, notification_type: 'permission_prompt', transcript_path: transcript([say('Running.', [bash('npm test')])]) }, env);
    const outcome = await runWaiting({ ...base, notification_type: 'idle_prompt', transcript_path: transcript([say(STATUS_LINE)]) }, env);
    board.server.close();
    assert.equal(typeof outcome.skipped, 'string');
    assert.deepEqual(callsOf(board).map((call) => call.tool), ['report_progress']);
  });

  test('the question, what follows and the notification message are masked before they are sent', async () => {
    const { calls } = await notify({ notification_type: 'idle_prompt', message: 'm' }, [say('Once you confirm, I will deploy with token=hunter22. Should I use API_KEY=abc123xyz in the build?')]);
    const { needs_you: needsYou, after_answer: after } = calls[0].args;
    assert.doesNotMatch(needsYou, /abc123xyz/);
    assert.doesNotMatch(after, /hunter22/);
    const sent = await notify({ notification_type: 'permission_prompt', message: 'Allow PASSWORD=swordfish?' });
    assert.doesNotMatch(sent.calls[0].args.needs_you, /swordfish/);
  });

  test('a tool call that already has its result is not the one the prompt asks about', () => {
    const answered = transcript([say('Running.', [bash('git status')]), { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }]);
    assert.equal(lastAssistant(answered).tool, null);
    const sidechain = transcript([{ ...say('Sub.', [bash('ls')]), isSidechain: true }]);
    assert.equal(lastAssistant(sidechain).tool, null);
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
