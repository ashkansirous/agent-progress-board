import type { Step } from "./stepTypes";

export enum ItemType {
  Slice = "slice",
  Problem = "problem",
  WaitingForMe = "waiting_for_me",
  Bug = "bug",
  Unplanned = "unplanned",
  /** One lettered part of a slice (Slice 11); it has no tile, and its `parent_key` names the slice. */
  Part = "part",
  /**
   * One "not yet tried on a device" line of a slice (Slice 14); it has no card, and its `parent_key`
   * names the slice it belongs to (always required).
   */
  Check = "check",
  /** One finding of the process optimiser (Slice 57): evidence runs, numbers, estimated saving and the proposed change, in `details_md`. It is a card. */
  Finding = "finding",
}

export enum ItemStatus {
  Open = "open",
  InProgress = "in_progress",
  Blocked = "blocked",
  Done = "done",
  Stale = "stale",
}

export enum Priority {
  P0 = "P0",
  P1 = "P1",
  P2 = "P2",
  P3 = "P3",
}

export const DEFAULT_PRIORITY = Priority.P2;
export const HEARTBEAT_NOTE = "Heartbeat";
/** The history note of a report whose status was older than the one stored, so the stored one stayed (Slice 34 follow-up #9). */
export const STATUS_DROPPED_NOTE = "Older status report ignored";
export const DOC_SYNC_SOURCE = "doc-sync";
/**
 * Notes the server writes on the history row of a question (Slice 13), as data the page turns into
 * words: `needs_you: <first line of the question>` when it is asked, `answered` when it is cleared.
 */
export const NEEDS_YOU_NOTE_PREFIX = "needs_you: ";
export const ANSWERED_NOTE = "answered";
/** Between the server's marker and the caller's own note when both are on one history row. */
export const NOTE_SEPARATOR = "\n";
export const MAX_NEEDS_YOU_NOTE = 120;

/** The marker a history row carries, as the data the page reads (Slice 47 1q); derived from the note at read, never stored. */
export enum EventMarker {
  NeedsYou = "needs_you",
  Answered = "answered",
}

/** Which server marker a stored note starts with, or null for an ordinary note. */
export function eventMarkerOf(note: string | null): EventMarker | null {
  if (note === null) return null;
  if (note.startsWith(NEEDS_YOU_NOTE_PREFIX)) return EventMarker.NeedsYou;
  if (note === ANSWERED_NOTE || note.startsWith(ANSWERED_NOTE + NOTE_SEPARATOR)) return EventMarker.Answered;
  return null;
}

/** What a caller's own note gets before it is stored: one that starts like a server marker is given a lead-in, so it never reads as a question or an answer. */
export function neutralizeMarker(note: string | undefined): string | undefined {
  return note !== undefined && eventMarkerOf(note) !== null ? `note: ${note}` : note;
}

export interface ItemLink {
  label: string;
  url: string;
}

export interface Item {
  key: string;
  project: string;
  parent: string | null;
  /** The key of the item this one belongs to (a part names its slice); optional like environment (Slice 11). */
  parent_key?: string | null;
  type: ItemType;
  priority: Priority;
  status: ItemStatus;
  title: string;
  why: string | null;
  details_md: string | null;
  links: ItemLink[];
  source: string | null;
  /** Where the work ran, as the client sent it (free text, Slice 8). Optional so the doc sync, which never sets it, stays untouched. */
  environment?: string | null;
  /** The task's own steps list, whole as the newest report sent it (Slice 10); optional like environment. */
  steps?: Step[] | null;
  /** The kind of agent holding the task, and its model: free text from the client (Slice 10). */
  agent?: string | null;
  model?: string | null;
  /** The agent's own open question for the owner, what it does after the answer, and when it asked (Slice 13); optional like environment. */
  needs_you?: string | null;
  after_answer?: string | null;
  needs_you_at?: string | null;
  /** What the task delivers, one line (Slice 41); optional like environment, null for older reports. */
  outcome?: string | null;
  heartbeat_at: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface ItemEvent {
  at: string;
  status: ItemStatus;
  source: string | null;
  note: string | null;
}

export interface ItemWithEvents extends Item {
  events: ItemEvent[];
}
