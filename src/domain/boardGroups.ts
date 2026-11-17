import { type CheckRow, type CheckView, checksBySlice } from "./checks";
import type { SliceName } from "./docSync";
import { ItemStatus, ItemType, Priority } from "./item";
import { SESSION_AGENT } from "./stale";

/** How many finished items the board lists before its "Show all". */
export const RECENT_DONE_COUNT = 5;
const LAST_TIME = "￿";

/** What the page draws a planned slice as: a slice an agent holds, one waiting its turn, or one parked on a block. */
export enum SliceState {
  InProgress = "in_progress",
  Planned = "planned",
  Parked = "parked",
}

/** What the grouping reads of an item, as the board's own item DTO carries it (the shown status already worked out). */
export interface GroupItem {
  key: string;
  project: string;
  type: ItemType;
  priority: Priority;
  status: ItemStatus;
  title: string;
  /** The free text label the client sent ("session 7b3d"), shown with a stopped session's title. */
  parent: string | null;
  created_at: string;
  heartbeat_at: string;
  done_at: string | null;
  agent: string | null;
  /** The open question, null when none waits (the board DTO already hides an expired or answered one). */
  needs_you: string | null;
  needs_you_at: string | null;
  working: boolean;
  /** For a slice: its number and title as two values; null for any other type. */
  slice: SliceName | null;
  /** For a part, bug or problem whose slice is on the board: that slice. */
  parent_slice: { key: string; number: number | null } | null;
}

export interface PlannedSlice {
  key: string;
  number: number | null;
  title: string;
  state: SliceState;
  /** The slice's checks not tried on a device. */
  checks: CheckView[];
}

export interface ProblemEntry {
  key: string;
  /** `bug` or `problem`. */
  kind: ItemType;
  /** The slice planned for it; null reads "No slice yet". */
  slice: { key: string; number: number | null } | null;
}

export interface DoneRow {
  key: string;
  title: string;
  /** The item's free text parent, for a stopped session's "session 7b3d · title"; null otherwise. */
  parent: string | null;
  /** When it finished, or for a stopped session card its last report. */
  at: string;
  stale: boolean;
}

export interface DoneGroup {
  /** Items finished or stopped inside the board's window, whatever the lists below hold. */
  count: number;
  /** The newest few, newest first. */
  recent: DoneRow[];
  /** The rest of the window's rows, newest first, for "Show all". */
  more: DoneRow[];
}

/** The numbers of a project's summary line, in its order. */
export interface ProjectSummary {
  needs_you: number;
  working: number;
  planned: number;
  problems: number;
  checks_not_tried: number;
}

export interface ProjectGroups {
  id: string;
  /** Keys of the items holding a question, oldest first, then old-shape waiting items by priority. */
  needs_you: string[];
  /** Keys of the items an agent works on now with no question open (a slice with a live agent is here and in `planned`). */
  working_now: string[];
  planned: PlannedSlice[];
  /** Checks whose slice is not an open one: never a card, a dashed entry under Planned. */
  loose_checks: CheckView[];
  problems: ProblemEntry[];
  /** Open items that are none of the above (an unplanned item nobody holds); the page lists them plainly. */
  other: string[];
  done: DoneGroup;
  summary: ProjectSummary;
}

const PRIORITY_RANK: Record<Priority, number> = {
  [Priority.P0]: 0,
  [Priority.P1]: 1,
  [Priority.P2]: 2,
  [Priority.P3]: 3,
};

const STATE_RANK: Record<SliceState, number> = {
  [SliceState.InProgress]: 0,
  [SliceState.Planned]: 1,
  [SliceState.Parked]: 2,
};

type Order = (a: GroupItem, b: GroupItem) => number;

const byPriorityThen =
  (tiebreak: Order): Order =>
  (a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || tiebreak(a, b);

const newestHeartbeat: Order = (a, b) => b.heartbeat_at.localeCompare(a.heartbeat_at);
const oldestQuestion: Order = (a, b) => (a.needs_you_at ?? LAST_TIME).localeCompare(b.needs_you_at ?? LAST_TIME);
const oldestFirst: Order = (a, b) => a.created_at.localeCompare(b.created_at);
const bySlice = (a: PlannedSlice, b: PlannedSlice) =>
  STATE_RANK[a.state] - STATE_RANK[b.state] || (a.number ?? Infinity) - (b.number ?? Infinity) || a.key.localeCompare(b.key);

/** A session card that stopped with no question: it counts as finished work, shown dashed. */
function isStoppedSession(item: GroupItem): boolean {
  const live = item.status === ItemStatus.InProgress || item.status === ItemStatus.Stale;
  return item.agent === SESSION_AGENT && item.needs_you === null && live && !item.working;
}

function sliceStateOf(status: ItemStatus): SliceState {
  if (status === ItemStatus.InProgress) return SliceState.InProgress;
  return status === ItemStatus.Blocked ? SliceState.Parked : SliceState.Planned;
}

function plannedOf(item: GroupItem, checks: Map<string, CheckView[]>): PlannedSlice {
  const name = item.slice ?? { number: null, title: item.title };
  return { key: item.key, number: name.number, title: name.title, state: sliceStateOf(item.status), checks: checks.get(item.key) ?? [] };
}

function problemOf(item: GroupItem): ProblemEntry {
  return { key: item.key, kind: item.type, slice: item.parent_slice };
}

function doneRowOf(item: GroupItem): DoneRow {
  const stale = item.status !== ItemStatus.Done;
  return { key: item.key, title: item.title, parent: stale ? item.parent : null, at: stale ? item.heartbeat_at : (item.done_at ?? item.heartbeat_at), stale };
}

function doneGroupOf(items: GroupItem[]): DoneGroup {
  const rows = items.map(doneRowOf).sort((a, b) => b.at.localeCompare(a.at));
  return { count: rows.length, recent: rows.slice(0, RECENT_DONE_COUNT), more: rows.slice(RECENT_DONE_COUNT) };
}

const NO_CARD_TYPES: readonly ItemType[] = [ItemType.Part, ItemType.Check];

function isProblemType(type: ItemType): boolean {
  return type === ItemType.Bug || type === ItemType.Problem;
}

/** Parts and checks are never cards, but one holding an open question still needs the owner, so it goes in Needs you. */
function openUncarded(items: GroupItem[]): GroupItem[] {
  return items.filter((item) => NO_CARD_TYPES.includes(item.type) && item.status !== ItemStatus.Done);
}

/** One project: every item lands in the lists by the rules below; a slice is always in `planned`. */
function groupProject(id: string, items: GroupItem[], checkRows: CheckRow[]): ProjectGroups {
  const cards = items.filter((item) => !NO_CARD_TYPES.includes(item.type));
  const finished = cards.filter((item) => item.status === ItemStatus.Done || isStoppedSession(item));
  const finishedSet = new Set(finished);
  const open = cards.filter((item) => !finishedSet.has(item));
  const checks = checksBySlice(checkRows);
  const slices = open.filter((item) => item.type === ItemType.Slice);
  const planned = slices.map((item) => plannedOf(item, checks)).sort(bySlice);
  const plannedKeys = new Set(planned.map((slice) => slice.key));
  const loose = [...checks].filter(([slice]) => !plannedKeys.has(slice)).flatMap(([, list]) => list);
  const questions = [...open, ...openUncarded(items)].filter((item) => item.needs_you !== null).sort(oldestQuestion);
  const waiting = open
    .filter((item) => item.needs_you === null && item.type === ItemType.WaitingForMe)
    .sort(byPriorityThen(oldestFirst));
  const waitingSet = new Set(waiting);
  const problems = open.filter((item) => isProblemType(item.type) && item.needs_you === null);
  const working = open.filter(
    (item) => item.working && item.needs_you === null && !isProblemType(item.type) && !waitingSet.has(item),
  );
  const placed = new Set([...questions, ...waiting, ...problems, ...working, ...slices]);
  const other = open.filter((item) => !placed.has(item)).sort(byPriorityThen(newestHeartbeat));
  const needsYou = [...questions, ...waiting].map((item) => item.key);
  const group: ProjectGroups = {
    id,
    needs_you: needsYou,
    working_now: working.sort(newestHeartbeat).map((item) => item.key),
    planned,
    loose_checks: loose,
    problems: problems.sort(byPriorityThen(newestHeartbeat)).map(problemOf),
    other: other.map((item) => item.key),
    done: doneGroupOf(finished),
    summary: { needs_you: needsYou.length, working: working.length, planned: planned.length, problems: problems.length, checks_not_tried: 0 },
  };
  group.summary.checks_not_tried = planned.reduce((sum, slice) => sum + slice.checks.length, 0) + loose.length;
  return group;
}

function hasAnything(group: ProjectGroups): boolean {
  const { summary } = group;
  const lists = summary.needs_you + summary.working + summary.planned + summary.problems + summary.checks_not_tried;
  return lists + group.other.length + group.done.count > 0;
}

/**
 * The board's groups, one per project that has anything to show: the configured projects first, in
 * their order, then any other project by id. This is the only place items are sorted into Needs you,
 * Working now, Planned, Problems and Done; the page draws what it is given and never regroups.
 */
export function groupBoard(items: GroupItem[], checks: CheckRow[], configured: string[]): ProjectGroups[] {
  const known = new Set(configured);
  const found = [...new Set([...items.map((item) => item.project), ...checks.map((check) => check.project)])];
  const extra = found.filter((id) => !known.has(id)).sort();
  return [...configured, ...extra]
    .map((id) =>
      groupProject(
        id,
        items.filter((item) => item.project === id),
        checks.filter((check) => check.project === id),
      ),
    )
    .filter(hasAnything);
}
