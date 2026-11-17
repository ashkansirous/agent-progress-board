// Tests for usage-report.mjs on fixture session records written to a temp folder.
// Run: node --test skills/report-progress/usage-report.test.mjs
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { listRecordFiles, parseUsageLine, scanFile } from './usage-report.mjs';

const OPUS = 'claude-opus-test';
const SONNET = 'claude-sonnet-test';

export function recordLine(model, usage, at, cwd = '/work/demo', id = undefined) {
  const full = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, ...usage };
  return `${JSON.stringify({ type: 'assistant', timestamp: at, cwd, message: { id, model, usage: full } })}\n`;
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'usage-report-'));
}

describe('parseUsageLine', () => {
  test('reads model, time and usage of an assistant record', () => {
    const parsed = parseUsageLine(recordLine(OPUS, { input_tokens: 4 }, '2026-11-16T10:00:00Z'));
    assert.equal(parsed.model, OPUS);
    assert.equal(parsed.at, '2026-11-16T10:00:00Z');
    assert.equal(parsed.usage.input_tokens, 4);
  });

  test('ignores user records, broken JSON and synthetic models', () => {
    assert.equal(parseUsageLine('{"type":"user","message":{"content":"hi"}}'), null);
    assert.equal(parseUsageLine('{"type":"assistant","mess'), null);
    assert.equal(parseUsageLine(recordLine('<synthetic>', {}, '2026-11-16T10:00:00Z')), null);
  });
});

describe('scanFile', () => {
  test('adds the four token kinds per model and keeps the newest record time', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, recordLine(OPUS, { input_tokens: 4, cache_creation_input_tokens: 1025, cache_read_input_tokens: 94256, output_tokens: 56 }, '2026-11-16T10:00:00Z')
      + recordLine(OPUS, { input_tokens: 1, output_tokens: 10 }, '2026-11-16T10:05:00Z')
      + recordLine(SONNET, { output_tokens: 7 }, '2026-11-16T10:02:00Z'));
    const state = scanFile(file);
    assert.deepEqual([state.models[OPUS].input, state.models[OPUS].cacheWrite, state.models[OPUS].cacheRead, state.models[OPUS].output], [5, 1025, 94256, 66]);
    assert.equal(state.models[OPUS].recordAt, '2026-11-16T10:05:00Z');
    assert.equal(state.models[SONNET].output, 7);
    assert.equal(state.cwd, '/work/demo');
  });

  test('reads a large file in chunks, refreshes the lock between them and counts every line once', () => {
    const file = join(tempRoot(), 's1.jsonl');
    const line = recordLine(OPUS, { output_tokens: 1 }, '2026-11-16T10:00:00Z', '/work/' + 'x'.repeat(500));
    const lines = Math.ceil((3 * 1024 * 1024) / line.length);
    writeFileSync(file, line.repeat(lines) + '{"half');
    let touches = 0;
    const state = scanFile(file, undefined, { touch: () => { touches += 1; } });
    assert.equal(state.models[OPUS].output, lines);
    assert.equal(touches >= 3, true, `touched ${touches} times`);
    assert.equal(state.offset, line.length * lines, 'the half-written last line is left');
  });

  test('resumes from the byte offset and counts only new lines', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T10:00:00Z'));
    const first = scanFile(file);
    appendFileSync(file, recordLine(OPUS, { output_tokens: 5 }, '2026-11-16T10:01:00Z'));
    const second = scanFile(file, first);
    assert.equal(second.models[OPUS].output, 15);
    assert.equal(first.models[OPUS].output, 10, 'the given state is not changed');
    assert.equal(scanFile(file, second).models[OPUS].output, 15, 'a rescan adds nothing');
  });

  test('leaves a half-written last line for the next scan', () => {
    const file = join(tempRoot(), 's1.jsonl');
    const second = recordLine(OPUS, { output_tokens: 5 }, '2026-11-16T10:01:00Z');
    writeFileSync(file, recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T10:00:00Z') + second.slice(0, 30));
    const half = scanFile(file);
    assert.equal(half.models[OPUS].output, 10);
    appendFileSync(file, second.slice(30));
    assert.equal(scanFile(file, half).models[OPUS].output, 15);
  });

  test('a file that shrank is counted again from zero', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T10:00:00Z') + recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T10:01:00Z'));
    const before = scanFile(file);
    writeFileSync(file, recordLine(OPUS, { output_tokens: 3 }, '2026-11-16T11:00:00Z'));
    assert.equal(scanFile(file, before).models[OPUS].output, 3);
  });
});

describe('scanFile rewrite and first-seen rules', () => {
  test('a rewrite of the same length is found by the last 64 bytes and read from zero', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T10:00:00Z'));
    const before = scanFile(file);
    writeFileSync(file, recordLine(OPUS, { output_tokens: 77 }, '2026-11-16T10:00:00Z'));
    const after = scanFile(file, before);
    assert.equal(after.models[OPUS].output, 77);
  });

  test('a file read from zero counts only lines after the since time', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T09:00:00Z') + recordLine(OPUS, { output_tokens: 4 }, '2026-11-16T11:00:00Z'));
    const state = scanFile(file, undefined, { sinceMs: Date.parse('2026-11-16T10:00:00Z') });
    assert.equal(state.models[OPUS].output, 4);
  });

  test('a file already read ignores the since time for its new lines', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, recordLine(OPUS, { output_tokens: 10 }, '2026-11-16T11:00:00Z'));
    const first = scanFile(file);
    appendFileSync(file, recordLine(OPUS, { output_tokens: 4 }, '2026-11-16T09:00:00Z'));
    assert.equal(scanFile(file, first, { sinceMs: Date.parse('2026-11-16T10:00:00Z') }).models[OPUS].output, 14);
  });
});

describe('scanFile with one message on several lines', () => {
  const at = '2026-11-16T10:00:00Z';
  const line = (id, usage) => recordLine(OPUS, usage, at, '/work/demo', id);
  const totalOf = (state) => [state.models[OPUS].input, state.models[OPUS].cacheWrite, state.models[OPUS].cacheRead, state.models[OPUS].output];

  test('counts a message once however many lines carry its id', () => {
    const file = join(tempRoot(), 's1.jsonl');
    const first = { input_tokens: 4, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 };
    writeFileSync(file, line('m1', first) + line('m1', first) + line('m1', first) + line('m2', first) + line('m2', first));
    assert.deepEqual(totalOf(scanFile(file)), [8, 20, 200, 10]);
  });

  test('a run that stops between two lines of one message does not double it', () => {
    const file = join(tempRoot(), 's1.jsonl');
    const usage = { input_tokens: 4, output_tokens: 5 };
    writeFileSync(file, line('m1', usage));
    const before = scanFile(file);
    appendFileSync(file, line('m1', usage) + line('m2', usage));
    assert.deepEqual(totalOf(scanFile(file, JSON.parse(JSON.stringify(before)))), [8, 0, 0, 10]);
  });

  test('the same id with different usage counts the larger numbers once', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, line('m1', { input_tokens: 4, output_tokens: 9 }) + line('m1', { input_tokens: 6, output_tokens: 2 }));
    assert.deepEqual(totalOf(scanFile(file)), [6, 0, 0, 9]);
  });

  test('a line without an id still counts every time', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, line(undefined, { output_tokens: 3 }) + line(undefined, { output_tokens: 3 }));
    assert.equal(scanFile(file).models[OPUS].output, 6);
  });

  test('keeps only the most recent ids and reads an old state without the list', () => {
    const file = join(tempRoot(), 's1.jsonl');
    writeFileSync(file, Array.from({ length: 60 }, (_, index) => line(`m${index}`, { output_tokens: 1 })).join(''));
    const state = scanFile(file);
    assert.equal(state.recent.length, 50);
    assert.equal(state.models[OPUS].output, 60);
    const { recent, ...old } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
    assert.deepEqual(scanFile(file, old).recent, []);
  });
});

describe('listRecordFiles', () => {
  test('finds the main session and each helper with its kind', () => {
    const root = tempRoot();
    const helpers = join(root, 'proj', 's1', 'subagents');
    mkdirSync(helpers, { recursive: true });
    writeFileSync(join(root, 'proj', 's1.jsonl'), '');
    writeFileSync(join(helpers, 'agent-a1.jsonl'), '');
    writeFileSync(join(helpers, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'code-review-pass' }));
    writeFileSync(join(helpers, 'agent-a2.jsonl'), '');
    const found = listRecordFiles(root).map((file) => [file.sessionId, file.helperId, file.kind]).sort();
    assert.deepEqual(found, [['s1', '', 'main'], ['s1', 'a1', 'code-review-pass'], ['s1', 'a2', 'agent']].sort());
  });

  test('a missing folder lists nothing', () => {
    assert.deepEqual(listRecordFiles(join(tempRoot(), 'nope')), []);
  });
});
