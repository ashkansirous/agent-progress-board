// What a waiting card says (Slice 27): the question the session asked, what follows the answer, and the tool a
// permission prompt names. Pure text helpers plus a bounded read of the transcript's tail; every read fails open.
import { Buffer } from 'node:buffer';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { clip } from './hook-input.mjs';

export const QUESTION_LIMIT = 300;
export const AFTER_LIMIT = 300;
export const TAIL_BYTES = 128 * 1024;
export const NOTIFICATION = { permission: 'permission_prompt', elicitation: 'elicitation_dialog', idle: 'idle_prompt' };
export const COMMAND_LIMIT = 120;
const MASK = '***';
// A line break ends a sentence only at a blank line or before a list item; a wrapped sentence stays whole.
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n\s*\n|\n(?=\s*(?:[-*>#]+|\d+[.)])\s)/;
const LIST_MARKER = /^\s*(?:[-*>#]+|\d+[.)])\s+/;
// Bounded runs either side of the word keep the match linear on a long word/dot/hyphen run (a path, a blob).
const SECRET_NAME = '[\\w.-]{0,40}(?:key|token|secret|passw(?:or)?d|passwd|pwd|auth|credential|bearer)[\\w.-]{0,40}';
const SECRET_PATTERNS = [
  [/(\bAuthorization\s*[:=]\s*)(?:(?:Bearer|Basic|Token|Digest)\s+)?[^\s'"]+/gi, `$1${MASK}`],
  [/(\bBearer\s+)[^\s'"]+/gi, `$1${MASK}`],
  [new RegExp(`(\\b${SECRET_NAME}["']?\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|[^\\s'";&|]*[^\\s'";&|.,!?)])`, 'gi'), `$1${MASK}`],
  [/((?:^|\s)(?:-u|--user)[= ]\s*)(?:"[^":\s]*:[^"]*"|'[^':\s]*:[^']*'|[^\s'":]+:[^\s'"]*)/g, `$1${MASK}`],
  [new RegExp(`(--?${SECRET_NAME}[= ]\\s*)(?:"[^"]*"|'[^']*'|[^\\s'";&|-][^\\s'";&|]*)`, 'gi'), `$1${MASK}`],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${MASK}@`],
  [/(:\/\/)[^\s/:@]+@/g, `$1${MASK}@`],
  [/\b(?:sk|pk|ghp|gho|ghs|github_pat|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g, MASK],
  [/\b[A-Fa-f0-9]{32,}\b/g, MASK],
  [/\b(?=[A-Za-z0-9_-]{0,200}\d)(?=[A-Za-z0-9_-]{0,200}[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, MASK],
];
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
  let answered = false;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const role = entry && (entry.type || (entry.message && entry.message.role));
    if (role === 'user') answered = true; // a user entry after the tool call: its result or a new prompt came in
    if (role !== 'assistant') continue;
    const blocks = blocksOf(entry);
    const text = textOf(blocks);
    const uses = blocks.filter((block) => block.type === 'tool_use');
    const last = uses[uses.length - 1];
    if (!text && !last) continue; // a thinking-only entry: look at the one before
    const pending = last && !answered && entry.isSidechain !== true;
    return { text: joinTurnText(lines, index, entry, text), tool: pending ? { name: String(last.name || ''), input: last.input && typeof last.input === 'object' ? last.input : {} } : null };
  }
  return none;
}

function textOf(blocks) {
  return blocks.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').trim();
}

// Claude Code writes one transcript entry per content block, so the text before a tool call sits in an earlier
// entry of the same turn: the text of the assistant entries before `index` back to the previous user entry (or
// an entry of another message id), then `text`.
function joinTurnText(lines, index, entry, text) {
  const parts = [text];
  const id = entry.message && entry.message.id;
  for (let before = index - 1; before >= 0; before -= 1) {
    let earlier;
    try {
      earlier = JSON.parse(lines[before]);
    } catch {
      continue;
    }
    const role = earlier && (earlier.type || (earlier.message && earlier.message.role));
    if (role === 'user') break;
    if (role !== 'assistant') continue;
    const earlierId = earlier.message && earlier.message.id;
    if (id && earlierId && id !== earlierId) break;
    const earlierText = textOf(blocksOf(earlier));
    if (earlierText) parts.unshift(earlierText);
  }
  return parts.filter(Boolean).join('\n');
}

// True when the message's last line ends with a question mark (closing quotes, brackets and markup ignored).
export function endsWithQuestion(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines[lines.length - 1].replace(CLOSERS, '').endsWith('?');
}

function sentencesOf(text) {
  return String(text || '').split(SENTENCE_BREAK).map((sentence) => sentence.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
}

// The text with secret-looking values replaced by ***: bearer strings, Authorization values, NAME=value for names
// that hold a key, token, secret or password, such flags, passwords inside URLs and well-known token shapes.
export function maskSecrets(text) {
  return SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), String(text || ''));
}

// The last sentence that ends with a question mark, at most QUESTION_LIMIT characters; '' when there is none.
export function questionOf(text) {
  const sentences = sentencesOf(text);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    if (sentences[index].replace(CLOSERS, '').endsWith('?')) return clip(sentences[index].replace(LIST_MARKER, ''), QUESTION_LIMIT);
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
  return detail ? `${tool.name}: ${clip(maskSecrets(detail).replace(/\s+/g, ' ').trim(), COMMAND_LIMIT)}` : tool.name;
}

// The card text for a Notification, or null when nothing is asked: { needsYou, afterAnswer }.
// A permission prompt or an elicitation always asks (it names the tool and its command when the transcript
// has one, else the notification's own message); an idle prompt asks only when the session's last message ends
// with a question; a notification of no known type keeps the old behaviour (it asks).
// Every text that reaches the board is masked first (before it is cut, so a cut never leaves half a secret).
export function cardText(type, rawMessage, rawAssistant) {
  const assistant = { ...rawAssistant, text: maskSecrets(rawAssistant.text) };
  const idle = type === NOTIFICATION.idle;
  if (idle) {
    if (!endsWithQuestion(assistant.text)) return null;
    const question = questionOf(assistant.text);
    return question ? { needsYou: question, afterAnswer: afterAnswerOf(assistant.text) } : null;
  }
  const tool = toolText(assistant.tool);
  const said = clip(maskSecrets(rawMessage), QUESTION_LIMIT) || 'Claude needs your attention';
  if (type === NOTIFICATION.permission && tool) return { needsYou: `Allow ${tool}?`, afterAnswer: '' };
  const question = type === NOTIFICATION.elicitation && endsWithQuestion(assistant.text) ? questionOf(assistant.text) : '';
  return { needsYou: question || said, afterAnswer: question ? afterAnswerOf(assistant.text) : '' };
}
