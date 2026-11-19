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

// CPU time of the work, not wall time: another process busy beside the suite stretches the wall clock, not the CPU the
// work itself uses (Slice 45).
function cpuMsOf(work) {
  const before = process.cpuUsage();
  work();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
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
    assert.equal(maskSecrets('git clone https://user:hunter2@host.test/r.git'), 'git clone https://user:***@host.test/r.git');
    assert.equal(maskSecrets(`echo ${'gh' + 'p_'}abcdefghijklmnopqrstuvwxyz0123`),'echo ***');
    assert.equal(maskSecrets('git status'), 'git status');
    assert.equal(maskSecrets('curl -u admin:hunter2 https://x.test'), 'curl -u *** https://x.test');
    assert.equal(maskSecrets('git clone https://ghp-Token_9@host.test/r.git'), 'git clone https://***@host.test/r.git');
    const text = toolText({ name: 'Bash', input: { command: `echo ${'x '.repeat(100)}` } });
    assert.equal(text.length, 'Bash: '.length + 120);
    assert.equal(toolText({ name: 'Bash', input: { command: 'PASSWORD=hunter2 ./run' } }), 'Bash: PASSWORD=***');
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

  test('check 3 #4: a 1.5M-character "a-" line is cut to its bounded tail and finishes well under 200 ms', () => {
    const huge = 'a-'.repeat(1500000);
    const used = cpuMsOf(() => {
      cardText('idle_prompt', '', { text: `${huge}\nShould I go on?`, tool: null });
      toolText({ name: 'Bash', input: { command: huge } });
      cardText('permission_prompt', huge, { text: '', tool: null });
    });
    assert.ok(used < 200, `used ${used} ms of CPU`);
    assert.equal(maskSecrets(huge).length, huge.length);
  });

  test('masking a long word, dot or hyphen run is linear (well under the hook timeout)', () => {
    for (const run of ['a.'.repeat(50000), 'a-'.repeat(50000), 'a-1'.repeat(40000), 'a.key'.repeat(20000)]) {
      const used = cpuMsOf(() => maskSecrets(run));
      assert.ok(used < 1500, `masking ${run.slice(0, 6)}... used ${used} ms of CPU`);
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
    const { calls } = await notify({ notification_type: 'idle_prompt', message: 'm' }, [say('Once you confirm, I will deploy.\nexport API_KEY=abc123xyz token=hunter22\n\nShould I go ahead?')]);
    const { needs_you: needsYou, after_answer: after } = calls[0].args;
    assert.equal(needsYou, 'Should I go ahead?');
    assert.equal(after, 'Once you confirm, I will deploy.');
    assert.doesNotMatch(JSON.stringify(calls[0].args), /abc123xyz|hunter22/);
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

describe('Slice 31: the secret mask, sentences and the transcript window', () => {
  test('an idle prompt whose question holds a secret name still opens a card, with its text masked', () => {
    const card = cardText('idle_prompt', '', { text: 'Session: expired, retry?', tool: null });
    assert.deepEqual(card, { needsYou: 'Session: ***', afterAnswer: '' });
  });

  // One rule (Slice 31, review round 4): a word whose letters hold password, passwd, pass, pwd, secret, token, apikey, key,
  // auth, cookie, session, credential or privatekey, followed by = : is was (or a space after a --flag), masks the
  // rest of the line. Over-masking is the accepted side, e.g. "Session: expired, retry?" loses everything after the colon.
  const MASK_SHAPES = [
    ['a flag with a space value masks to the line end', 'deploy --token abc123 --env prod', 'deploy --token ***'],
    ['a name word with no separator is left', 'cat my-token-file x y', 'cat my-token-file x y'],
    ['a plain word with no secret part is left', 'animal: banana, name=bob, fast=yes', 'animal: banana, name=bob, fast=yes'],
    ['check 2 #1: key names are secret', 'ENCRYPTION_KEY=abc123xyz\nSIGNING_KEY: s3cr3t\nexport ACCESS_KEY=zzz\nrun --key hunter2extra', 'ENCRYPTION_KEY=***\nSIGNING_KEY: ***\nexport ACCESS_KEY=***\nrun --key ***'],
    ['a name that only contains a secret part is masked too', 'author: bob', 'author: ***'],
    ['prose is masked after the colon (accepted cost)', 'Session: expired, retry?', 'Session: ***'],
    ['a name that ends in a secret part is', 'MYTOKEN=abc GITHUB_TOKEN=abc apiKey: abc', 'MYTOKEN=***'],
    ['finding 1: pass names', 'PASS=abc DB_PASS=abc\nrun --pass abc', 'PASS=***\nrun --pass ***'],
    ['finding 1: plural and other names', 'passwords=a,b secrets: x tokens=y creds: z', 'passwords=***'],
    ['finding 2: a cookie header', 'Cookie: sid=abc; other=def', 'Cookie: ***'],
    ['finding 2: a password of words', 'Password: correct horse battery', 'Password: ***'],
    ['finding 3: a very long name', `${'x'.repeat(90)}_token=abc`, `${'x'.repeat(90)}_token=***`],
    ['finding 3: a long flag name', `--${'x'.repeat(70)}-token abc`, `--${'x'.repeat(70)}-token ***`],
    ['finding 10: said in words', 'the password is horse', 'the password is ***'],
    ['finding 10: was', 'the token was abc', 'the token was ***'],
    ['a dotted or hyphenated name', 'config.db-password = abc def', 'config.db-password = ***'],
    ['check 2 #2: an empty value masks the next non-empty line whole', 'Password:\n\n  hunter2 two\nlast line stays', 'Password:\n\n***\nlast line stays'],
    ['check 2 #2: a name with no value and no next line is left', 'Password:', 'Password:'],
    ['Authorization header masks to the line end', 'curl -H "Authorization: Bearer abc123def" https://x.test', 'curl -H "Authorization: ***'],
    ['a secret in a URL query is reached', 'curl https://x.test/?token=abc&user=bob', 'curl https://x.test/?token=***'],
    ['a quoted JSON name', `curl -d '{"password":"hunter2"}' x`, `curl -d '{"password":***`],
    ['a secret name after another name on the line is reached', 'FOO=bar API_KEY=abc run', 'FOO=bar API_KEY=***'],
    ['CRLF stays outside the mask', 'token=abc\r\nnext', 'token=***\r\nnext'],
    ['a vendor prefix needs its separator', 'skeletonconfigurationfile pkgmanagerconfiguration', 'skeletonconfigurationfile pkgmanagerconfiguration'],
    ['a vendor token is masked', `echo ${'s' + 'k-'}abcdefghijklmnop ${'gh' + 'p_'}abcdefghijklmnopqrstu ${'AK' + 'IA'}ABCDEFGHIJKLMNOP`,'echo *** *** ***'],
    ['a JWT is masked', ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijk'].join('.'),'***'],
    ['a long mixed token is masked', ['Ab3dEf6hIj9kLm2n', 'Op5qRs8tUv1wXy4z', 'Ab3dEf6h'].join(''),'***'],
    ['a long branch name is masked too (check 3 #3)', 'git push origin fix-the-long-running-review-findings-for-slice-31-text', 'git push origin ***'],
    ['check 3 #1: escaped JSON', 'curl -d "{\\"password\\":\\"hunter2\\"}" x', 'curl -d "{\\"password\\":***'],
    ['check 3 #2: -p with a value', 'docker login -u me -p hunter2', 'docker login -u me -p ***'],
    ['check 3 #2: glued -p', 'mysql -phunter2 db', 'mysql -p***'],
    ['check 3 #2: -k and -t', 'run -k abc123 and more', 'run -k ***'],
    ['check 3 #2: a flag with no value is left', 'git diff -p', 'git diff -p'],
    ['check 3 #5: a colon on the next line', '{"token"\n:"abc"}', '{"token"\n***'],
    ['check 3 #5: a next line without a separator is left', 'the token\nis fine here', 'the token\nis fine here'],
    ['check 3 #6: a PEM block after a name line', 'private_key:\n-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----\nafter', 'private_key:\n***\nafter'],
    ['check 3 #6: a PEM block with no end masks to the end', 'x -----BEGIN RSA PRIVATE KEY-----\nabc\ndef', 'x ***'],
    ['a digit stuck to a secret word is still secret', 'export TOKEN1=abcdef123 password1=hunter2', 'export TOKEN1=***'],
    ['a quote with no end is masked to the end of the line', 'API_KEY="abc def\nnext', 'API_KEY=***\nnext'],
    ['a single quote with no end', "token='abc", 'token=***'],
    ['an escaped space stays in an unquoted value', 'TOKEN=abc\\ def run', 'TOKEN=***'],
    ['a flag with a quote with no end', 'deploy --password "abc def', 'deploy --password ***'],
    ['a passphrase of words is masked outside a branch context', 'phrase correct-horse-battery-staple-correct-horse-x9', 'phrase ***'],
    ['a branch prefix no longer keeps a branch name (check 3 #3)', 'https://x.io/fix/correct-horse-battery-staple-extra-words-then-7', 'https://x.io/fix/***'],
    ['an escaped double quote stays inside the value', 'password="ab\\"cdSECRETTAIL" next', 'password=***'],
    ['an escaped single quote stays inside a flag value', "login --token 'it\\'s-secret' now", 'login --token ***'],
    ['oauth, auth suffix, cookie and session names are secret', 'OAUTH=abc123def\nMYAUTH=abc\ncookie=abc\nsession=abc', 'OAUTH=***\nMYAUTH=***\ncookie=***\nsession=***'],
    ['a long hyphenated phrase after "git" text is still masked', 'git credential passphrase is correct-horse-battery-staple-correct-horse-x9', 'git credential passphrase is ***'],
    ['a word after "token is" is masked too (accepted cost)', 'the token is expired', 'the token is ***'],
    ['a quoted JSON value', `{"password":"hunter2"}`, '{"password":***'],
    ['a sentence stop is masked with the rest of the line', 'set token=abc.', 'set token=***'],
    ['a plain command is left alone', 'git log -1 --format=%H', 'git log -1 --format=%H'],
    ['Slice 45 #12: double-escaped JSON', String.raw`echo "{\\"password\\":\\"hunter2\\"}" x`, String.raw`echo "{\\"password\\":***`],
    ['Slice 45 #12: a short flag leading a continuation line', 'docker login -u me \\\n-p hunter2', 'docker login -u me \\\n-p ***'],
    ['Slice 45 #12: psql -W with a value', 'psql -W hunter2 db', 'psql -W ***'],
    ['Slice 45 #12: "The password is" with the value on the next line', 'The password is\nhunter2\nnext', 'The password is\n***\nnext'],
    ['Slice 45 #12: "the token was" at the line end', 'the token was\n\nabc123', 'the token was\n\n***'],
  ];

  test('the mask table: what is masked and what is left alone', () => {
    for (const [name, input, expected] of MASK_SHAPES) assert.equal(maskSecrets(input), expected, name);
  });

  test('Slice 45 #12: a PEM block whose header lies before the 4096-character window is masked', () => {
    const pem = ['-----BEGIN ' + 'PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', ...Array.from({ length: 200 }, (_, row) => `bodyline${row}abcdefghijklmnopqrstuvwxyz`), '-----END ' + 'PRIVATE KEY-----'].join('\n');
    const card = cardText('idle_prompt', '', { text: `${pem}\nShould I go on?`, tool: null });
    assert.deepEqual(card, { needsYou: 'Should I go on?', afterAnswer: '' });
    const elicit = cardText('elicitation_dialog', '', { text: `${pem}\nWhat now?`, tool: null });
    assert.ok(!JSON.stringify(elicit).includes('bodyline'), JSON.stringify(elicit));
    const open = cardText('idle_prompt', '', { text: `Is this the key?\n${pem.slice(0, -26)}\n${'x'.repeat(5000)}?`, tool: null });
    assert.ok(!JSON.stringify(open).includes('bodyline'), JSON.stringify(open));
  });

  test('check 2 #3: an 80,000-word single line is masked in well under 200 ms', () => {
    const line = 'word '.repeat(80000);
    let masked;
    const used = cpuMsOf(() => { masked = maskSecrets(line); });
    assert.equal(masked, line);
    assert.ok(used < 200, `used ${used} ms of CPU`);
    const secret = `${line}token=abc`;
    assert.equal(maskSecrets(secret), `${line}token=***`);
  });

  test('check 2 #4: a secret value that holds ". " or "? " is never sent in part', () => {
    const said = 'The password: Correct horse. Battery staple? Yes. Is that right?';
    assert.deepEqual(cardText('idle_prompt', '', { text: said, tool: null }), { needsYou: '***', afterAnswer: '' });
    const lines = 'token=abc. def\nNothing more. Is that right?';
    assert.equal(questionOf(lines, true), 'Is that right?');
    const wrapped = 'Setting PASSWORD=alpha. beta\ngamma. Should I go on?';
    assert.equal(questionOf(wrapped, true), 'Should I go on?');
    assert.equal(afterAnswerOf('API_KEY=a. Once you confirm, I will run it. Ok?', true), '***');
    const next = cardText('idle_prompt', '', { text: 'password:\nCorrect horse. Battery staple. Is that right?', tool: null });
    assert.ok(!JSON.stringify(next).match(/horse|Battery|staple/), JSON.stringify(next));
  });

  test('a sentence does not end at "e.g.", "i.e." or a list number; the curly apostrophe counts', () => {
    assert.equal(questionOf('Use e.g. the S21 or the emulator. Should I go?'), 'Should I go?');
    assert.equal(questionOf('Pick one, e.g. the S21. Which one?'), 'Which one?');
    assert.equal(questionOf('1. Pick A or B?'), 'Pick A or B?');
    assert.equal(afterAnswerOf('Once you confirm, I’ll merge.'), 'Once you confirm, I’ll merge.');
    assert.equal(afterAnswerOf('When you say go, I’d run it.'), 'When you say go, I’d run it.');
  });

  test('a sentence ends after a short number or "etc." before a capital, not at a line-start numeral or a lower-case word', () => {
    assert.equal(questionOf('It costs 5. Is that fine?'), 'Is that fine?');
    assert.equal(questionOf('I need Node 22. Should I install?'), 'Should I install?');
    assert.equal(questionOf('Done etc. Next one?'), 'Next one?');
    assert.equal(questionOf('Use tea, coffee etc. or water. Which one?'), 'Which one?');
    assert.equal(questionOf('Notes:\n2. Pick A or B?'), 'Pick A or B?');
  });

  const user = { type: 'user', message: { role: 'user', content: 'hi' } };
  const filler = (count) => Array.from({ length: count }, (_, index) => say(`filler ${index} ${'x'.repeat(200)}`));

  test('the transcript is read back only as far as the last turn needs, and an entry the window cuts is not half read', () => {
    const big = 'q'.repeat(40 * 1024);
    const file = transcript([...filler(10), user, say(`${big} Should I go?`), { ...say('', [bash('ls')]), message: { role: 'assistant', content: [bash('ls')] } }]);
    const read = lastAssistant(file);
    assert.equal(read.text, `${big} Should I go?`);
    assert.equal(read.tool.name, 'Bash');
  });

  test('a transcript whose last turn starts in the first window is read from that window', () => {
    const file = transcript([...filler(2000), user, say('Should I go?')]);
    assert.equal(lastAssistant(file).text, 'Should I go?');
  });

  test('a stdin cwd that is not an absolute existing folder is ignored: the hook still raises its card', async () => {
    for (const cwd of ['relative/path', '/no/such/folder/anywhere', 42, undefined]) {
      const { outcome, calls } = await notify({ cwd, notification_type: 'permission_prompt', message: 'm' });
      assert.equal(outcome.ok, true, String(cwd));
      assert.ok(calls[0].args.title.length > 0, String(cwd));
    }
  });
});
