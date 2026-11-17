import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectConfig } from "../../src/config";
import { ItemStatus, ItemType, Priority } from "../../src/domain/item";
import { isQuestion } from "./cards";

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

/** The items by key, for the groups the server returns (they name items by key; the page never regroups). */
export function itemsByKey(items: BoardItemDto[]): Map<string, BoardItemDto> {
  return new Map(items.map((item) => [item.key, item]));
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
