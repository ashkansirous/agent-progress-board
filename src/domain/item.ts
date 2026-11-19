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
