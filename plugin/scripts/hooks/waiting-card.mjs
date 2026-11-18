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
// Not after an abbreviation ("e.g. ", "i.e. ", "etc. ", "vs. ") or a short list numeral ("1. ").
// "etc." breaks only before a capital; a numeral blocks only at the start of a line ("It costs 5. Is that fine?" breaks).
const SENTENCE_BREAK = /(?<=[.!?])(?<!\b(?:[Ee]\.[Gg]|[Ii]\.[Ee]|[Vv]s|[Cc]f|[Aa]pprox|[Ii]ncl|[Rr]esp)\.)(?:(?<!\b[Ee]tc\.)|(?=\s+[A-Z]))(?<!^[ \t]*\d{1,2}\.)\s+|\n\s*\n|\n(?=\s*(?:[-*>#]+|\d+[.)])\s)/m;
const LIST_MARKER = /^\s*(?:[-*>#]+|\d+[.)])\s+/;
// The one name rule (Slice 31). A secret name is any word whose letters, lowercased and with every other character
// dropped, contain one of these ("api_key" is "apikey"; "author" and "tokenizer" match too: over-masking is the
// accepted side, the text leaves the machine).
const SECRET_PARTS = ['password', 'passwd', 'pass', 'pwd', 'secret', 'token', 'apikey', 'key', 'auth', 'cookie', 'session', 'credential', 'privatekey'];
// One word of a line: a maximal run of word characters, dots and hyphens. The text after it is read from the word's
// end only for a secret name: an optional closing quote, then a separator: `=` or `:` (spaces allowed around), the
// word is/was, or (for a `--flag`) a space; the rest of the line is the value. Both patterns are scanned once, left
// to right, so a long line costs time in proportion to its length.
const NAME_WORD = /[\w.-]+/g;
const SEPARATOR = /(["']?)(?:([ \t]*[=:][ \t]*)|([ \t]+(?:is|was)[ \t]+)|([ \t]+))/y;
const LINE_BREAK = /(\r\n|\r|\n)/;
// A short flag whose letter starts a secret name (-p password, -k key, -t token, -s secret, -a auth), after a command
// word: `-p hunter2` or glued `-phunter2` masks the rest of the line from the value. Over-masking is accepted
// (`tar -tf x` masks "f x").
const SHORT_FLAG = /[ \t]-[pktsaPKTSA](?:[ \t]+|(?=[^\s-]))/g;
const ESCAPED_QUOTE = /\\(["'])/g;
// Only this much of a text is masked and read: a card keeps the tail of the assistant text (the last sentence) and
// the head of a command or message (clipped to 120 to 300 characters), so the rest is never scanned.
export const MASK_WINDOW = 4096;

function isSecretName(name) {
  const letters = name.toLowerCase().replace(/[^a-z]/g, '');
  return SECRET_PARTS.some((part) => letters.includes(part));
}

// The line with each escaped quote read as a plain one (the backslash dropped), so escaped JSON scans like plain JSON,
// and a function from an index of that copy back to the index in the line.
function unescapedCopy(line) {
  const drops = [];
  const scan = line.replace(ESCAPED_QUOTE, (match, quote, offset) => {
    drops.push(offset - drops.length);
    return quote;
  });
  return { scan, toLine: (index) => index + drops.filter((at) => at < index).length };
}

// Where a short flag's value starts in the line, or null (see SHORT_FLAG); the flag needs a command word before it
// and a value after it.
function shortFlagPoint(line) {
  SHORT_FLAG.lastIndex = 0;
  for (let found = SHORT_FLAG.exec(line); found; found = SHORT_FLAG.exec(line)) {
    const point = found.index + found[0].length;
    if (line.slice(0, found.index).trim() !== '' && line.slice(point).trim() !== '') return point;
  }
  return null;
}

// { line, point, dangling, ends } for one line: the first secret name with a separator and a value masks the line
// from the separator to its end (`point` is the index where the mask starts, else null). A secret name and separator
// with no value after them leave the line as it is and set `dangling`: the value is on a later line. A secret name
// that ends the line with no separator sets `ends`: a next line that starts with `:` or `=` is its separator.
function maskLine(line) {
  const { scan, toLine } = unescapedCopy(line);
  let dangling = false;
  let ends = false;
  NAME_WORD.lastIndex = 0;
  for (let word = NAME_WORD.exec(scan); word; word = NAME_WORD.exec(scan)) {
    const name = word[0];
    if (!isSecretName(name)) continue;
    const end = word.index + name.length;
    if (/^["']?[ \t]*$/.test(scan.slice(end))) ends = true;
    SEPARATOR.lastIndex = end;
    const sep = SEPARATOR.exec(scan);
    if (!sep || (sep[4] && !name.startsWith('--'))) continue;
    const point = end + sep[0].length;
    if (scan.slice(point).trim() === '') {
      dangling = true;
      continue;
    }
    return withFlag(line, { line: `${line.slice(0, toLine(point))}${MASK}`, point: toLine(point), dangling: false, ends: false });
  }
  return withFlag(line, { line, point: null, dangling, ends });
}

// `named` (the result of the name rule) unless a short flag's value starts earlier on the line.
function withFlag(line, named) {
  const flag = shortFlagPoint(line);
  if (flag === null || (named.point !== null && named.point <= flag)) return named;
  return { line: `${line.slice(0, flag)}${MASK}`, point: flag, dangling: false, ends: false };
}

// The text with each secret line masked (see maskLine), and `pieces`: for every run of the text (a line, a line
// break) where it starts in the text, where it starts in the output, and where its mask starts (null for none), so
// an offset in the text can be found in the output. A line after a dangling name is masked whole (the next
// non-empty one; blank lines pass).
function maskLines(text) {
  const parts = text.split(LINE_BREAK);
  const pieces = [];
  let out = '';
  let from = 0;
  let waiting = false;
  let ends = false;
  parts.forEach((part, index) => {
    const isLine = index % 2 === 0;
    let result = { line: part, point: null, dangling: false, ends: false };
    if (isLine && part.trim() !== '') {
      const whole = waiting || (ends && /^\s*[=:]/.test(part));
      result = whole ? { line: MASK, point: 0, dangling: false, ends: false } : maskLine(part);
      waiting = result.dangling;
      ends = result.ends;
    }
    pieces.push({ from, to: from + part.length, at: out.length, point: result.point });
    out += result.line;
    from += part.length;
  });
  return { text: out, pieces };
}

function maskNameValue(text) {
  return maskLines(text).text;
}

// Where an offset of the unmasked text falls in the masked one: before a line's mask point it is the same offset
// into the line, past it the end of the mask. `pieces` come from maskLines; offsets are asked in rising order.
function offsetMapper(pieces) {
  let at = 0;
  return (offset) => {
    while (at < pieces.length - 1 && offset > pieces[at].to) at += 1;
    const piece = pieces[at];
    const inside = Math.min(offset, piece.to) - piece.from;
    return piece.point !== null && inside > piece.point ? piece.at + piece.point + MASK.length : piece.at + inside;
  };
}

// A run of 40 or more letters, digits, hyphens and underscores with both a letter and a digit is masked, a
// hyphenated branch name included (branch names come from .git/HEAD, never from masked text). The run is matched
// once and tested after, so the cost stays linear.
function maskLongToken(token) {
  return /\d/.test(token) && /[A-Za-z]/.test(token) ? MASK : token;
}

// Each rule is [pattern, replacement] or a function from text to text. Order matters: header and flag forms first.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g, MASK],
  [/(\bBearer\s+)[^\s'"]+/gi, `$1${MASK}`],
  maskNameValue,
  [/((?:^|\s)(?:-u|--user)[= ]\s*)(?:"[^":\s]*:[^"]*"|'[^':\s]*:[^']*'|[^\s'":]+:[^\s'"]*)/g, `$1${MASK}`],
  [/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${MASK}@`],
  [/(:\/\/)[^\s/:@]+@/g, `$1${MASK}@`],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, MASK],
  [/\b(?:(?:sk|pk|rk)[-_]|gh[opsur]_|github_pat_|xox[abprs]-)[A-Za-z0-9_-]{12,}/g, MASK],
  [/\bAKIA[A-Z0-9]{16}\b/g, MASK],
  [/\bAIza[-_A-Za-z0-9]{35}\b/g, MASK],
  [/\b[A-Fa-f0-9]{32,}\b/g, MASK],
  [/\b[A-Za-z0-9_-]{40,}\b/g, maskLongToken],
];
const AFTER_SENTENCE = /\b(once|after|when|as soon as)\b.*\b(i['’]ll|i will|i can|i['’]d|then i)\b|\bthen i\b|\bif you (say|confirm|approve|agree)\b/i;
const CLOSERS = /[\s)\]}"'’”*_`]+$/;
// The tail is read in growing windows (first, then up to) until the last assistant turn is whole; a transcript
// entry bigger than the last window is read as not there.
const TAIL_WINDOWS = [16 * 1024, TAIL_BYTES, 1024 * 1024, 4 * 1024 * 1024];

// The last `limit` bytes of a file as text ('' when unreadable) and whether that is the whole file. A first line
// the window cut in half is dropped; one the window starts exactly at is kept.
function readTail(file, limit = TAIL_BYTES) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, limit);
    const start = size - length;
    const lead = start > 0 ? 1 : 0; // one byte before the window says whether its first line starts there
    const buffer = Buffer.alloc(length + lead);
    readSync(fd, buffer, 0, length + lead, start - lead);
    const text = buffer.subarray(lead).toString('utf8');
    if (!lead || buffer[0] === 0x0a) return { text, whole: start === 0 };
    const cut = text.indexOf('\n');
    return { text: cut < 0 ? '' : text.slice(cut + 1), whole: false };
  } catch {
    return { text: '', whole: true };
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
// The file is read only as far back as that turn needs: a small window first, a bigger one only while the turn's
// start is not in the window yet (an entry cut by the window is never half-read).
export function lastAssistant(transcriptPath) {
  const none = { text: '', tool: null };
  if (typeof transcriptPath !== 'string' || !transcriptPath) return none;
  let found = none;
  for (const limit of TAIL_WINDOWS) {
    const tail = readTail(transcriptPath, limit);
    const read = assistantIn(tail.text.split('\n').filter(Boolean));
    found = read.found || none;
    if (read.settled || tail.whole) break;
  }
  return found;
}

// { found, settled } for the lines of one window: `settled` is true when the turn's start (a user entry or another
// message) is in the window, so a bigger window would not change `found`.
function assistantIn(lines) {
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
    const turn = joinTurnText(lines, index, entry, text);
    return { found: { text: turn.text, tool: pending ? { name: String(last.name || ''), input: last.input && typeof last.input === 'object' ? last.input : {} } : null }, settled: turn.settled };
  }
  return { found: null, settled: false };
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
  let settled = false;
  for (let before = index - 1; before >= 0; before -= 1) {
    let earlier;
    try {
      earlier = JSON.parse(lines[before]);
    } catch {
      continue;
    }
    const role = earlier && (earlier.type || (earlier.message && earlier.message.role));
    if (role === 'user') { settled = true; break; }
    if (role !== 'assistant') continue;
    const earlierId = earlier.message && earlier.message.id;
    if (id && earlierId && id !== earlierId) { settled = true; break; }
    const earlierText = textOf(blocksOf(earlier));
    if (earlierText) parts.unshift(earlierText);
  }
  return { text: parts.filter(Boolean).join('\n'), settled };
}

// True when the message's last line ends with a question mark (closing quotes, brackets and markup ignored).
export function endsWithQuestion(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines[lines.length - 1].replace(CLOSERS, '').endsWith('?');
}

const SENTENCE_BREAKS = new RegExp(SENTENCE_BREAK.source, 'gm');

function plainSentence(sentence) {
  return sentence.replace(/\s*\n\s*/g, ' ').trim();
}

// [{ raw, masked }] for each sentence: `raw` is the unmasked sentence (the question and after-answer rules read it,
// because masking eats a line's tail, question mark included); `masked` is the same stretch of the text with every
// secret line masked whole before any split. The bounds come from splitting the unmasked text and are carried over
// by offset: a sentence that crosses a mask point ends with the mask, so no part of a secret value is ever sent.
function sentencesOf(text) {
  const raw = String(text || '');
  const lines = maskLines(raw);
  const toMasked = offsetMapper(lines.pieces);
  const bounds = [];
  let start = 0;
  for (const match of raw.matchAll(SENTENCE_BREAKS)) {
    bounds.push([start, match.index]);
    start = match.index + match[0].length;
  }
  bounds.push([start, raw.length]);
  return bounds
    .map(([from, to]) => ({ raw: plainSentence(raw.slice(from, to)), masked: plainSentence(lines.text.slice(toMasked(from), toMasked(to))) }))
    .filter((sentence) => sentence.raw);
}

// The text of a sentence without its list marker: the raw one, or (`masked`) its masked stretch run through
// maskSecrets again (the shape maskers), or the mask alone when the whole sentence sits inside a masked tail.
function sentText(sentence, masked) {
  if (!masked) return sentence.raw.replace(LIST_MARKER, '');
  return maskSecrets(sentence.masked.replace(LIST_MARKER, '')) || MASK;
}

// The text with secret-looking values replaced by ***: bearer strings, the rest of any line after a secret name and
// its separator (see SECRET_PARTS), passwords inside URLs and well-known token shapes.
export function maskSecrets(text) {
  return SECRET_PATTERNS.reduce((masked, rule) => (typeof rule === 'function' ? rule(masked) : masked.replace(rule[0], rule[1])), String(text || ''));
}

// The last sentence that ends with a question mark, at most QUESTION_LIMIT characters; '' when there is none.
// The sentence is chosen on the unmasked text; with `masked` true what is returned is the masked stretch (see sentencesOf).
export function questionOf(text, masked = false) {
  const sentences = sentencesOf(text);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    if (sentences[index].raw.replace(CLOSERS, '').endsWith('?')) return clip(sentText(sentences[index], masked), QUESTION_LIMIT);
  }
  return '';
}

// What happens once the person answers, when the message says it ("Once you confirm, I'll merge."); else ''.
export function afterAnswerOf(text, masked = false) {
  const found = sentencesOf(text).filter((sentence) => !sentence.raw.replace(CLOSERS, '').endsWith('?')).find((sentence) => AFTER_SENTENCE.test(sentence.raw));
  return found ? clip(masked ? maskSecrets(found.masked) || MASK : found.raw, AFTER_LIMIT) : '';
}

// "Bash: npm test" for a tool and its command (or file, pattern or description); the bare tool name when its
// input has none of those.
export function toolText(tool) {
  if (!tool || !tool.name) return '';
  const input = tool.input || {};
  const detail = [input.command, input.file_path, input.path, input.pattern, input.url, input.description].find((value) => typeof value === 'string' && value.trim());
  return detail ? `${tool.name}: ${clip(maskSecrets(detail.slice(0, MASK_WINDOW)).replace(/\s+/g, ' ').trim(), COMMAND_LIMIT)}` : tool.name;
}

// The last MASK_WINDOW characters of a text, from a line start when the cut falls inside a line that has one after it.
function tailOf(text) {
  const whole = String(text || '');
  if (whole.length <= MASK_WINDOW) return whole;
  const cut = whole.slice(-MASK_WINDOW);
  const lineStart = cut.indexOf('\n');
  return lineStart < 0 || lineStart === cut.length - 1 ? cut : cut.slice(lineStart + 1);
}

// The card text for a Notification, or null when nothing is asked: { needsYou, afterAnswer }.
// A permission prompt or an elicitation always asks (it names the tool and its command when the transcript
// has one, else the notification's own message); an idle prompt asks only when the session's last message ends
// with a question; a notification of no known type keeps the old behaviour (it asks).
// Whether a card opens and which sentence is the question are decided on the unmasked text (masking eats the rest of
// a line, question mark included); every text that reaches the board is masked before it is cut, so a cut never
// leaves half a secret.
export function cardText(type, rawMessage, rawAssistant) {
  const assistant = { ...rawAssistant, text: tailOf(rawAssistant.text) };
  const idle = type === NOTIFICATION.idle;
  if (idle) {
    if (!endsWithQuestion(assistant.text)) return null;
    const question = questionOf(assistant.text, true);
    return question ? { needsYou: question, afterAnswer: afterAnswerOf(assistant.text, true) } : null;
  }
  const tool = toolText(assistant.tool);
  const said = clip(maskSecrets(String(rawMessage || '').slice(0, MASK_WINDOW)), QUESTION_LIMIT) || 'Claude needs your attention';
  if (type === NOTIFICATION.permission && tool) return { needsYou: `Allow ${tool}?`, afterAnswer: '' };
  const question = type === NOTIFICATION.elicitation && endsWithQuestion(assistant.text) ? questionOf(assistant.text, true) : '';
  return { needsYou: question || said, afterAnswer: question ? afterAnswerOf(assistant.text, true) : '' };
}
