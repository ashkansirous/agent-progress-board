import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectConfig } from "../../src/config";
import type { ProjectGroups } from "../../src/domain/boardGroups";

/** The numbers in the count row by the page title: totals over every project's summary line. */
export function boardTotals(groups: ProjectGroups[]): { needsYou: number; working: number; problems: number } {
  const sum = (pick: (summary: ProjectGroups["summary"]) => number) => groups.reduce((total, g) => total + pick(g.summary), 0);
  return { needsYou: sum((s) => s.needs_you), working: sum((s) => s.working), problems: sum((s) => s.problems) };
}

/** The items by key, for the groups the server returns (they name items by key; the page never regroups). */
export function itemsByKey(items: BoardItemDto[]): Map<string, BoardItemDto> {
  return new Map(items.map((item) => [item.key, item]));
}

export function projectLabel(id: string, projects: ProjectConfig[]): string {
  return projects.find((p) => p.id === id)?.label ?? id;
}

/**
 * The tasks an agent is working on now: the server's `working` flag decides, never the heartbeat; the newest
 * report first is only the order of the Active work page's list.
 */
export function activeTasks(items: BoardItemDto[]): BoardItemDto[] {
  return items.filter((item) => item.working).sort((a, b) => b.heartbeat_at.localeCompare(a.heartbeat_at));
}

/**
 * The cards of the phone's top "Needs you" list: exactly the keys each group's `needs_you` names (the Worker's
 * rule, so the top count matches the project lines), in the server's order: the page never re-sorts them.
 */
export function needsYouItems(groups: ProjectGroups[], byKey: Map<string, BoardItemDto>): BoardItemDto[] {
  return groups.flatMap((group) => group.needs_you).flatMap((key) => byKey.get(key) ?? []);
}
