import type { BoardEventDto, BoardItemDto } from "../../src/api/boardDto";
import { EventMarker, HEARTBEAT_NOTE, ItemStatus, ItemType, NEEDS_YOU_NOTE_PREFIX, NOTE_SEPARATOR, STATUS_DROPPED_NOTE } from "../../src/domain/item";
import { SESSION_AGENT, SESSION_STALE_AFTER_MINUTES } from "../../src/domain/stale";
import type { Translate } from "./strings";
import { isTime, minutesSince } from "./time";

const MINUTES_PER_HOUR = 60;
/** How many characters of a question a history row shows before its ellipsis. */
const HISTORY_QUESTION_CHARS = 45;
const BULLET_PREFIX = /^\s*[-*•]\s+/;

/**
 * A working card: a session's own card (the agent value `session`, Slice 13) or a live item that has an outcome (a
 * slice card that reports one carries no agent, Slice 41). A planned, blocked or done slice with an outcome is a
 * slice row, not a working card.
 */
export function isSessionItem(item: BoardItemDto): boolean {
  if (item.type === ItemType.Part) return false;
  const live = item.status === ItemStatus.InProgress || item.status === ItemStatus.Stale;
  return item.agent === SESSION_AGENT || (Boolean(item.outcome) && live);
}

/** The item holds a question for the owner; the Worker sends `needs_you` only while it waits (not done, not expired). */
export function isQuestion(item: BoardItemDto): boolean {
  return item.needs_you != null;
}

const OWNER_STEP_KEY = /\/slice-[^/]+\/check-[^/]+$/;

/**
 * A step the doc sync made from a `**You:**` line (Slice 43): a waiting item keyed `<project>/slice-<N>/check-<hash>`.
 * It is the owner's own step, not a question an agent asked, so its card says "Your step".
 */
export function isOwnerStep(item: BoardItemDto): boolean {
  return item.type === ItemType.WaitingForMe && item.needs_you == null && OWNER_STEP_KEY.test(item.key);
}

/** The question an owner step asks when it has none of its own: its title. Another card asks its title only with a why; with neither, nothing. */
export function ownerStepFallback(item: BoardItemDto): string | null {
  if (isOwnerStep(item)) return item.title;
  return item.why ? item.title : null;
}

/** What a card asks: its own question, else (an owner step, or a card with a why) its title; null when it asks nothing. The one reading for the card and its drawer heading. */
export function cardQuestion(item: BoardItemDto): string | null {
  return item.needs_you ?? ownerStepFallback(item);
}

/** The steps under an owner step's title (the doc sync's `details_md`, Slice 44), or null when it has none or is not an owner step. */
export function ownerStepDetails(item: BoardItemDto): string | null {
  return isOwnerStep(item) && item.details_md ? item.details_md : null;
}

const STEP_URL = /https?:\/\/(?:[^\s<>()[\]`]|\([^\s<>()[\]`]*\)|\[[^\s<>()[\]`]*\])+/g;

/** The http(s) addresses a step's text names, without the sentence punctuation after them. */
export function stepUrls(text: string): string[] {
  return [...new Set((text.match(STEP_URL) ?? []).map((url) => url.replace(/[.,;:!?'"]+$/, "")))];
}

/** "Your step" for an owner step, else "Question" (the label on a "Needs you" card). */
export function cardLabel(item: BoardItemDto, t: Translate): string {
  return t(isOwnerStep(item) ? "yourStepLabel" : "questionLabel");
}

/** The placeholder the plan writes for the board's own host name, which the public repo cannot hold. */
const BOARD_ADDRESS = "<board address>";
const BOARD_ADDRESS_LINK = /<board address>(?:\/#\/[A-Za-z0-9._~/-]*[A-Za-z0-9_~/-])?/g;

const BOARD_PAGE = /<board address>\/#\/[A-Za-z0-9._~/-]*[A-Za-z0-9_~/-]/g;

/** The text without its `<board address>/#/page` links: the row of links under a card builds those once, from the card's text, so a step's own link scan skips them. */
export function withoutBoardPages(text: string): string {
  return text.replace(BOARD_PAGE, " ");
}

/** Card text for a place that holds no link (an aria-label, Markdown): every `<board address>` becomes the origin. */
export function fillBoardAddress(text: string, origin: string): string {
  return text.replaceAll(BOARD_ADDRESS, origin);
}

/**
 * A code span, or a whole inline link `[label](target)` (the label may hold one level of `[...]`, the target one of
 * `(...)`, as in a Wikipedia address), or a `<board address>` with an optional page.
 */
const LINK_LABEL = "(?:[^\\[\\]\\n]|\\[[^\\]\\n]*\\])*";
const LINK_TARGET = "(?:[^()\\n]|\\([^)\\n]*\\))*";
// A code span opens with a run of backticks and closes at the next run of exactly as many (`` a ` b `` is one span), the
// way `sync-docs.mjs` reads it (Slice 47 8d); group 2 is the opening run, matched again by the back-reference. The scan
// for the closing run stops after CODE_SPAN_MAX characters: each opening run costs at most that many steps, so a long line
// of unmatched runs costs time linear in its length (times that fixed bound), and a span longer than the bound is not
// read as a span (Slice 47; Slice 48 5).
const CODE_SPAN_MAX = 2000;
const CODE_SPAN = `((?<!\`)(\`+)(?!\`)[^\\n]{0,${CODE_SPAN_MAX}}?(?<!\`)\\2(?!\`))`;
const MARKDOWN_ADDRESS = new RegExp(`${CODE_SPAN}|(\\[${LINK_LABEL}\\]\\(${LINK_TARGET}\\))|(${BOARD_ADDRESS_LINK.source})`, "g");

/**
 * Markdown text with each `<board address>/#/page` as a link to that page of the board and a bare `<board address>` as
 * the origin (Slice 45). One inside a code span or already inside a link (its text or its target) gets the origin but no
 * second link around it, so the Markdown never nests.
 */
export function linkBoardAddress(text: string, origin: string): string {
  return text.replace(MARKDOWN_ADDRESS, (_match, code: string | undefined, _run: string | undefined, link: string | undefined, address: string) => {
    if (code !== undefined) return fillBoardAddress(code, origin);
    if (link !== undefined) return fillBoardAddress(link, origin);
    const resolved = origin + address.slice(BOARD_ADDRESS.length);
    return address === BOARD_ADDRESS ? resolved : `[${resolved}](${resolved})`;
  });
}

/** A piece of card text: plain text, or a link to a page of the board itself. */
export type AddressPart = { text: string; href?: string };

/**
 * Splits card text so `<board address>` reads as the page's own origin (the host name never enters the repo or the stored
 * item, the page knows it at read time) and `<board address>/#/page` becomes a link to that page (Slice 43).
 */
export function resolveBoardAddress(text: string, origin: string): AddressPart[] {
  const parts: AddressPart[] = [];
  let last = 0;
  for (const match of text.matchAll(BOARD_ADDRESS_LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const address = origin + match[0].slice(BOARD_ADDRESS.length);
    parts.push(match[0] === BOARD_ADDRESS ? { text: address } : { text: address, href: address });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A session card an agent works on now, with no question open: it sits under "Working now". */
export function isWorkingCard(item: BoardItemDto): boolean {
  return isSessionItem(item) && !isQuestion(item) && item.working;
}

/** A session card that stopped (the cron turned it stale, or its heartbeat ran out) and has no question: a dashed row in Done. */
export function isStaleSession(item: BoardItemDto): boolean {
  const live = item.status === ItemStatus.InProgress || item.status === ItemStatus.Stale;
  return isSessionItem(item) && !isQuestion(item) && live && !item.working;
}

/** Cards that open the card drawer; every other item opens the item detail. */
export function opensCardDrawer(item: BoardItemDto): boolean {
  return isQuestion(item) || isOwnerStep(item) || isSessionItem(item);
}

/** Brand and product names that start a sentence capitalised and stay so after a label; a word that is none of these is a plain word. */
const KEPT_CAPITALS = new Set([
  "Android", "Anthropic", "Apple", "Chrome", "Claude", "Cloudflare", "Docker", "Firefox", "Git", "GitHub", "Google", "Linux",
  "Node", "Playwright", "Safari", "Slack", "Vitest", "Windows", "Wrangler", "Xcode",
]);

/**
 * The text with its first letter lower case. The word stays as written when it is "I", when its second letter is not
 * a lower-case letter (an acronym such as "API" or "CI", a brand such as "iOS" is lower already), when it has a capital
 * inside it ("GitHub") or when it is one of the brand names in `KEPT_CAPITALS` ("Cloudflare").
 */
function lowerFirst(text: string): string {
  const word = (text.split(/\s/, 1)[0] ?? "").replace(/[^\p{L}\p{N}].*$/u, "");
  const second = word.charAt(1);
  const secondIsLower = second !== "" && second === second.toLowerCase() && second !== second.toUpperCase();
  if (word === "I" || (word.length > 1 && !secondIsLower) || /\p{Lu}/u.test(word.slice(1)) || KEPT_CAPITALS.has(word)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The drawer's purpose line of a session card: "Outcome: {outcome} · {why}" with each part's first letter lower case
 * after the label (BoardV2Dark `DRAWERS.w1`); just the purpose when there is no outcome; null when neither.
 */
export function purposeText(item: BoardItemDto, t: Translate): string | null {
  if (!item.outcome) return item.why;
  const outcome = t("outcomeLine", { outcome: lowerFirst(item.outcome) });
  return item.why ? `${outcome} · ${lowerFirst(item.why)}` : outcome;
}

const SESSION_KEY = /\/(?:waiting|session)-([^/]+)$/;
const SESSION_ID_CHARS = 4;
const SLICE_KEY = /\/slice-\d+$/;

/** "session 9c1e" from a hook card's key (`<project>/waiting-<id>`), which carries no parent; null for any other key. */
function sessionNameOf(key: string): string | null {
  const id = SESSION_KEY.exec(key)?.[1];
  return id ? `session ${id.slice(0, SESSION_ID_CHARS)}` : null;
}

/** What a card with an outcome is: "slice card" for a slice (its type or its `slice-<N>` key), else "task" (BoardV2 `DEMO` working cards). */
function cardKind(item: BoardItemDto, t: Translate): string {
  return item.type === ItemType.Slice || SLICE_KEY.test(item.key) ? t("cardKindSlice") : t("cardKindTask");
}

/**
 * "{what the card is} · {environment label}" ("task · laptop") for a card with an outcome (the mocks' label); for
 * any other card "{parent} · {environment label}" ("session 9c1e · Laptop"). The raw environment when no label is
 * set; the key when nothing is.
 */
export function sessionLabel(item: BoardItemDto, t: Translate): string {
  const parent = item.outcome ? cardKind(item, t) : (item.parent ?? sessionNameOf(item.key));
  const parts = [parent, item.environment_label ?? item.environment].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : item.key;
}

/** "waiting 6 min" or "waiting 10 h"; null when the question has no first-asked time (an old-shape row) or an unreadable one, never the heartbeat. */
export function waitingText(item: BoardItemDto, nowMs: number, t: Translate): string | null {
  if (!item.needs_you_at || !isTime(item.needs_you_at)) return null;
  const minutes = minutesSince(item.needs_you_at, nowMs);
  if (minutes < MINUTES_PER_HOUR) return t("waitingMin", { n: minutes });
  return t("waitingHour", { n: Math.floor(minutes / MINUTES_PER_HOUR) });
}

/**
 * A key for each history row from its own content, kept in the server's order; rows that read the same get a
 * counter counted from the oldest row (the end of the list), so a refresh that adds a row at the top, even one
 * that reads the same as an older row, keeps every older row's key (Slice 47 1g).
 */
export function eventKeys(events: BoardEventDto[]): string[] {
  const seen = new Map<string, number>();
  const keys: string[] = new Array<string>(events.length);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const base = `${event.at}|${event.status}|${event.note ?? ""}`;
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    keys[index] = `${base}|${nth}`;
  }
  return keys;
}

/** The lines of details_md as plain bullets ("Done so far"); a leading list marker is dropped. */
export function doneSoFar(item: BoardItemDto): string[] {
  return (item.details_md ?? "")
    .split("\n")
    .map((line) => line.replace(BULLET_PREFIX, "").trim())
    .filter((line) => line.length > 0);
}

/** The first words of a question for a history row: cut at a word boundary, "…" when cut. */
export function questionStart(question: string): string {
  const line = question.split("\n")[0]!.trim();
  if (line.length <= HISTORY_QUESTION_CHARS) return line;
  const cut = line.slice(0, HISTORY_QUESTION_CHARS + 1);
  const end = cut.lastIndexOf(" ");
  return `${cut.slice(0, end > 0 ? end : HISTORY_QUESTION_CHARS)}…`;
}

/** The server's words with the caller's own note beside them, when it sent one. */
function withOwnNote(words: string, own: string): string {
  return own.length > 0 ? `${words} · ${own}` : words;
}

/** The server's marker text and the caller's own note: cut at the first separator, which a marker's one-line text never holds. */
function splitMarker(text: string): [string, string] {
  const at = text.indexOf(NOTE_SEPARATOR);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + NOTE_SEPARATOR.length)];
}

/**
 * The words of one history row as the owner reads it (the mock's DRAWERS lists): "Needs you: which…",
 * "Answered", "Finished turn", "Stale: no activity for 15 min", "Last activity", "Started", or the
 * agent's own progress note. The server writes the question and answer rows as data (item.ts).
 */
export function historyWords(event: BoardEventDto, t: Translate): string {
  const note = event.note;
  if (note && event.marker === EventMarker.NeedsYou) {
    const [question, own] = splitMarker(note.slice(NEEDS_YOU_NOTE_PREFIX.length));
    return withOwnNote(t("historyNeedsYou", { question: questionStart(question) }), own);
  }
  if (note && event.marker === EventMarker.Answered) {
    return withOwnNote(t("historyAnswered"), splitMarker(note)[1]);
  }
  if (event.status === ItemStatus.Stale) return t("historyStale", { n: SESSION_STALE_AFTER_MINUTES });
  if (event.status === ItemStatus.Done) return note ?? t("historyFinished");
  if (!note) return t("historyStarted");
  if (note === STATUS_DROPPED_NOTE) return t("historyStatusDropped");
  return note === HEARTBEAT_NOTE ? t("historyLastActivity") : note;
}
