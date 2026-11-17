import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectConfig } from "../../src/config";
import { ItemStatus, ItemType, Priority } from "../../src/domain/item";
import { isQuestion, isStaleSession, isWorkingCard } from "./cards";

export interface ProjectGroup {
  id: string;
  label: string;
  /** Items holding a question for the owner (`needs_you`), whatever their type; oldest question first (Slice 13). */
  needs: BoardItemDto[];
  /** Session cards an agent works on now, with no open question. */
  working: BoardItemDto[];
  /** Session cards that stopped without a question: dashed rows in the Done section. */
  staleSessions: BoardItemDto[];
  /** Open waiting_for_me items (the old shape, and steps only the owner can do). */
  waiting: BoardItemDto[];
  /** Everything not done and not waiting for the owner. */
  inFlight: BoardItemDto[];
  done: BoardItemDto[];
}

/** The order the legend lists the types in. */
export const TYPE_ORDER: ItemType[] = [
  ItemType.WaitingForMe,
  ItemType.Slice,
  ItemType.Problem,
  ItemType.Bug,
  ItemType.Unplanned,
];

const PRIORITY_RANK: Record<Priority, number> = {
  [Priority.P0]: 0,
  [Priority.P1]: 1,
  [Priority.P2]: 2,
  [Priority.P3]: 3,
};

export function isWaiting(item: BoardItemDto): boolean {
  return item.type === ItemType.WaitingForMe && item.status !== ItemStatus.Done;
}

function byPriorityThen(tiebreak: (a: BoardItemDto, b: BoardItemDto) => number) {
  return (a: BoardItemDto, b: BoardItemDto) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || tiebreak(a, b);
}

/** Oldest question first: the one that has waited longest leads. */
const waitingOrder = byPriorityThen((a, b) => a.created_at.localeCompare(b.created_at));
const flightOrder = byPriorityThen((a, b) => b.heartbeat_at.localeCompare(a.heartbeat_at));
const doneOrder = (a: BoardItemDto, b: BoardItemDto) => (b.done_at ?? "").localeCompare(a.done_at ?? "");

/** Sorts after every ISO time: a question with no asked time goes last. */
const LAST_TIME = "￿";

/** Oldest question first: the one that has waited longest leads; one with no time goes last. */
const questionOrder = (a: BoardItemDto, b: BoardItemDto) =>
  (a.needs_you_at ?? LAST_TIME).localeCompare(b.needs_you_at ?? LAST_TIME);

/** Every open waiting item across projects, for the strip at the top (an item with a question is a question card, not here). */
export function waitingItems(items: BoardItemDto[]): BoardItemDto[] {
  return items.filter((item) => isWaiting(item) && !isQuestion(item)).sort(waitingOrder);
}

/** Every question across projects, oldest first: the phone lists them above the projects. */
export function questionItems(items: BoardItemDto[]): BoardItemDto[] {
  return items.filter((item) => item.type !== ItemType.Part && isQuestion(item)).sort(questionOrder);
}

function groupOf(id: string, label: string, mine: BoardItemDto[]): ProjectGroup {
  const needs = mine.filter(isQuestion).sort(questionOrder);
  const rest = mine.filter((i) => !isQuestion(i));
  const staleSessions = rest.filter(isStaleSession).sort(flightOrder);
  const working = rest.filter(isWorkingCard).sort(flightOrder);
  const carded = new Set([...staleSessions, ...working]);
  const plain = rest.filter((i) => !carded.has(i));
  return {
    id,
    label,
    needs,
    working,
    staleSessions,
    waiting: plain.filter(isWaiting).sort(waitingOrder),
    inFlight: plain.filter((i) => !isWaiting(i) && i.status !== ItemStatus.Done).sort(flightOrder),
    done: plain.filter((i) => i.status === ItemStatus.Done).sort(doneOrder),
  };
}

/** How many cards and tiles a project has, for leaving out an empty one. */
export function groupSize(group: ProjectGroup): number {
  return group.needs.length + group.working.length + group.staleSessions.length + group.waiting.length + group.inFlight.length + group.done.length;
}

/** Config order first, then any other project by id; a project with no items is left out. */
export function groupByProject(items: BoardItemDto[], projects: ProjectConfig[]): ProjectGroup[] {
  const known = new Set(projects.map((p) => p.id));
  const extra = [...new Set(items.map((i) => i.project))].filter((id) => !known.has(id)).sort();
  const order = [...projects, ...extra.map((id) => ({ id, label: id }))];
  return order
    .map((p) => groupOf(p.id, p.label, items.filter((i) => i.project === p.id && i.type !== ItemType.Part)))
    .filter((g) => groupSize(g) > 0);
}

export function projectLabel(id: string, projects: ProjectConfig[]): string {
  return projects.find((p) => p.id === id)?.label ?? id;
}

/** The tasks an agent is working on now, the newest report first (the Active work page's list). */
export function activeTasks(items: BoardItemDto[]): BoardItemDto[] {
  return items.filter((item) => item.working).sort((a, b) => b.heartbeat_at.localeCompare(a.heartbeat_at));
}

export function distinctProjects(items: BoardItemDto[]): number {
  return new Set(items.map((i) => i.project)).size;
}
