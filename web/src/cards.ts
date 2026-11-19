import type { BoardEventDto, BoardItemDto } from "../../src/api/boardDto";
import { ANSWERED_NOTE, HEARTBEAT_NOTE, ItemStatus, ItemType, NEEDS_YOU_NOTE_PREFIX, NOTE_SEPARATOR } from "../../src/domain/item";
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

/** "Your step" for an owner step, else "Question" (the label on a "Needs you" card). */
export function cardLabel(item: BoardItemDto, t: Translate): string {
  return t(isOwnerStep(item) ? "yourStepLabel" : "questionLabel");
}

/** The placeholder the plan writes for the board's own host name, which the public repo cannot hold. */
const BOARD_ADDRESS = "<board address>";
const BOARD_ADDRESS_LINK = /<board address>(?:\/#\/[A-Za-z0-9._~/-]*[A-Za-z0-9_~/-])?/g;

/** Card text for a place that holds no link (an aria-label, Markdown): every `<board address>` becomes the origin. */
export function fillBoardAddress(text: string, origin: string): string {
  return text.replaceAll(BOARD_ADDRESS, origin);
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

/**
 * The text with its first letter lower case. The word stays as written when it is "I" or when its second letter is not
 * a lower-case letter (an acronym such as "API" or "CI", a brand such as "iOS" is lower already).
 */
function lowerFirst(text: string): string {
  const word = text.split(/\s/, 1)[0] ?? "";
  const second = word.charAt(1);
  const secondIsLower = second !== "" && second === second.toLowerCase() && second !== second.toUpperCase();
  if (word === "I" || (word.length > 1 && !secondIsLower)) return text;
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
 * counter, so a refresh that adds a row at the top keeps the other rows' keys.
 */
export function eventKeys(events: BoardEventDto[]): string[] {
  const seen = new Map<string, number>();
  return events.map((event) => {
    const base = `${event.at}|${event.status}|${event.note ?? ""}`;
    const nth = (seen.get(base) ?? 0) + 1;
    seen.set(base, nth);
    return `${base}|${nth}`;
  });
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
  if (note?.startsWith(NEEDS_YOU_NOTE_PREFIX)) {
    const [question, own] = splitMarker(note.slice(NEEDS_YOU_NOTE_PREFIX.length));
    return withOwnNote(t("historyNeedsYou", { question: questionStart(question) }), own);
  }
  if (note === ANSWERED_NOTE || note?.startsWith(ANSWERED_NOTE + NOTE_SEPARATOR)) {
    return withOwnNote(t("historyAnswered"), splitMarker(note)[1]);
  }
  if (event.status === ItemStatus.Stale) return t("historyStale", { n: SESSION_STALE_AFTER_MINUTES });
  if (event.status === ItemStatus.Done) return note ?? t("historyFinished");
  if (!note) return t("historyStarted");
  return note === HEARTBEAT_NOTE ? t("historyLastActivity") : note;
}
