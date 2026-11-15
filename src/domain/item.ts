export enum ItemType {
  Slice = "slice",
  Problem = "problem",
  WaitingForMe = "waiting_for_me",
  Bug = "bug",
  Unplanned = "unplanned",
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

export interface ItemLink {
  label: string;
  url: string;
}

export interface Item {
  key: string;
  project: string;
  parent: string | null;
  type: ItemType;
  priority: Priority;
  status: ItemStatus;
  title: string;
  why: string | null;
  details_md: string | null;
  links: ItemLink[];
  source: string | null;
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
