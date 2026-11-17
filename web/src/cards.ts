import type { BoardEventDto, BoardItemDto } from "../../src/api/boardDto";
import { ANSWERED_NOTE, HEARTBEAT_NOTE, ItemStatus, ItemType, NEEDS_YOU_NOTE_PREFIX, NOTE_SEPARATOR } from "../../src/domain/item";
import { SESSION_AGENT, SESSION_STALE_AFTER_MINUTES } from "../../src/domain/stale";
import type { Translate } from "./strings";
import { minutesSince } from "./time";

const MINUTES_PER_HOUR = 60;
/** How many characters of a question a history row shows before its ellipsis. */
const HISTORY_QUESTION_CHARS = 45;
const BULLET_PREFIX = /^\s*[-*•]\s+/;

/** A session's own card: the clients mark it with the agent value `session` (Slice 13). */
export function isSessionItem(item: BoardItemDto): boolean {
  return item.agent === SESSION_AGENT && item.type !== ItemType.Part;
}

/** The item holds a question for the owner; the Worker sends `needs_you` only while it waits (not done, not expired). */
export function isQuestion(item: BoardItemDto): boolean {
  return item.needs_you != null;
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
  return isQuestion(item) || isSessionItem(item);
}

/**
 * A card with no goal yet: no purpose, no steps, and the client's fallback title
 * ("<branch> · <project>", docs/clients.md); a real one-line title is a goal.
 */
export function hasNoGoal(item: BoardItemDto): boolean {
  const fallbackTitle = item.title.endsWith(` · ${item.project}`);
  return !item.why && (item.steps?.length ?? 0) === 0 && fallbackTitle;
}

/** "{parent} · {environment label}" ("session 9c1e · Laptop"); the raw value when no label is set; the key when nothing is. */
export function sessionLabel(item: BoardItemDto): string {
  const parts = [item.parent, item.environment_label ?? item.environment].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : item.key;
}

/** "waiting 6 min" or "waiting 10 h"; null when the question has no first-asked time (an old-shape row), never the heartbeat. */
export function waitingText(item: BoardItemDto, nowMs: number, t: Translate): string | null {
  if (!item.needs_you_at) return null;
  const minutes = minutesSince(item.needs_you_at, nowMs);
  if (minutes < MINUTES_PER_HOUR) return t("waitingMin", { n: minutes });
  return t("waitingHour", { n: Math.floor(minutes / MINUTES_PER_HOUR) });
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
