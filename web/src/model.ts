import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectConfig } from "../../src/config";
import { ItemStatus, ItemType, Priority } from "../../src/domain/item";

export interface ProjectGroup {
  id: string;
  label: string;
  /** Open waiting_for_me items. */
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

/** Every open waiting item across projects, for the strip at the top. */
export function waitingItems(items: BoardItemDto[]): BoardItemDto[] {
  return items.filter(isWaiting).sort(waitingOrder);
}

function groupOf(id: string, label: string, mine: BoardItemDto[]): ProjectGroup {
  return {
    id,
    label,
    waiting: mine.filter(isWaiting).sort(waitingOrder),
    inFlight: mine.filter((i) => !isWaiting(i) && i.status !== ItemStatus.Done).sort(flightOrder),
    done: mine.filter((i) => i.status === ItemStatus.Done).sort(doneOrder),
  };
}

/** Config order first, then any other project by id; a project with no items is left out. */
export function groupByProject(items: BoardItemDto[], projects: ProjectConfig[]): ProjectGroup[] {
  const known = new Set(projects.map((p) => p.id));
  const extra = [...new Set(items.map((i) => i.project))].filter((id) => !known.has(id)).sort();
  const order = [...projects, ...extra.map((id) => ({ id, label: id }))];
  return order
    .map((p) => groupOf(p.id, p.label, items.filter((i) => i.project === p.id)))
    .filter((g) => g.waiting.length + g.inFlight.length + g.done.length > 0);
}

export function projectLabel(id: string, projects: ProjectConfig[]): string {
  return projects.find((p) => p.id === id)?.label ?? id;
}

export function distinctProjects(items: BoardItemDto[]): number {
  return new Set(items.map((i) => i.project)).size;
}
