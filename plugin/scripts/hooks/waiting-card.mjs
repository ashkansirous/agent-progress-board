// What a waiting card says (Slice 27): the question the session asked, what follows the answer, and the tool a
// permission prompt names. Pure text helpers plus a bounded read of the transcript's tail; every read fails open.
import { Buffer } from 'node:buffer';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { clip } from './hook-input.mjs';

export const QUESTION_LIMIT = 300;
export const AFTER_LIMIT = 300;
export const TAIL_BYTES = 128 * 1024;
export const NOTIFICATION = { permission: 'permission_prompt', elicitation: 'elicitation_dialog', idle: 'idle_prompt' };
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n+/;
const AFTER_SENTENCE = /\b(once|after|when|as soon as)\b.*\b(i'll|i will|i can|i'd|then i)\b|\bthen i\b|\bif you (say|confirm|approve|agree)\b/i;
const CLOSERS = /[\s)\]}"'’”*_`]+$/;

// The last `limit` bytes of a file as text ('' when unreadable). A cut first line is dropped by the caller.
function readTail(file, limit = TAIL_BYTES) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, limit);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return size > limit ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function blocksOf(entry) {
  const content = entry && entry.message ? entry.message.content : null;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter((block) => block && typeof block === 'object') : [];
}

// { text, tool } of the transcript's last assistant message: its text blocks joined, and its last tool_use
// ({ name, input }) or null. Empty text and no tool when the transcript is missing or holds no assistant message.
export function lastAssistant(transcriptPath) {
  const none = { text: '', tool: null };
  if (typeof transcriptPath !== 'string' || !transcriptPath) return none;
  const lines = readTail(transcriptPath).split('\n').filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const role = entry && (entry.type || (entry.message && entry.message.role));
    if (role !== 'assistant') continue;
    const blocks = blocksOf(entry);
    const text = blocks.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').trim();
    const uses = blocks.filter((block) => block.type === 'tool_use');
    const last = uses[uses.length - 1];
    if (!text && !last) continue; // a thinking-only entry: look at the one before
    return { text, tool: last ? { name: String(last.name || ''), input: last.input && typeof last.input === 'object' ? last.input : {} } : null };
  }
  return none;
}

// True when the message's last line ends with a question mark (closing quotes, brackets and markup ignored).
export function endsWithQuestion(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines[lines.length - 1].replace(CLOSERS, '').endsWith('?');
}

function sentencesOf(text) {
  return String(text || '').split(SENTENCE_BREAK).map((sentence) => sentence.trim()).filter(Boolean);
}

// The last sentence that ends with a question mark, at most QUESTION_LIMIT characters; '' when there is none.
export function questionOf(text) {
  const sentences = sentencesOf(text);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    if (sentences[index].replace(CLOSERS, '').endsWith('?')) return clip(sentences[index].replace(/^[-*>#\d.)\s]+/, ''), QUESTION_LIMIT);
  }
  return '';
}

// What happens once the person answers, when the message says it ("Once you confirm, I'll merge."); else ''.
export function afterAnswerOf(text) {
  const found = sentencesOf(text).filter((sentence) => !sentence.replace(CLOSERS, '').endsWith('?')).find((sentence) => AFTER_SENTENCE.test(sentence));
  return found ? clip(found, AFTER_LIMIT) : '';
}

// "Bash: npm test" for a tool and its command (or file, pattern or description); the bare tool name when its
// input has none of those.
export function toolText(tool) {
  if (!tool || !tool.name) return '';
  const input = tool.input || {};
  const detail = [input.command, input.file_path, input.path, input.pattern, input.url, input.description].find((value) => typeof value === 'string' && value.trim());
  return clip(detail ? `${tool.name}: ${detail}` : tool.name, QUESTION_LIMIT);
}

// The card text for a Notification, or null when nothing is asked: { needsYou, afterAnswer }.
// A permission prompt or an elicitation always asks (it names the tool and its command when the transcript
// has one, else the notification's own message); an idle prompt asks only when the session's last message ends
// with a question; a notification of no known type keeps the old behaviour (it asks).
export function cardText(type, message, assistant) {
  const idle = type === NOTIFICATION.idle;
  if (idle) {
    if (!endsWithQuestion(assistant.text)) return null;
    const question = questionOf(assistant.text);
    return question ? { needsYou: question, afterAnswer: afterAnswerOf(assistant.text) } : null;
  }
  const tool = toolText(assistant.tool);
  const said = clip(message, QUESTION_LIMIT) || 'Claude needs your attention';
  if (type === NOTIFICATION.permission && tool) return { needsYou: `Allow ${tool}?`, afterAnswer: '' };
  const question = type === NOTIFICATION.elicitation && endsWithQuestion(assistant.text) ? questionOf(assistant.text) : '';
  return { needsYou: question || said, afterAnswer: question ? afterAnswerOf(assistant.text) : '' };
}
