import defaultConfigFile from "../../config/board.example.json";
import { type Clock, listOpen } from "../application/board";
import type { ItemRepository } from "../application/ports";
import { type BoardConfig, configFromRecord } from "../config";
import type { ItemWithEvents } from "../domain/item";
import { resolveWindowHours } from "../domain/window";
import type { BoardItemDto, BoardPageConfig, BoardResponse } from "./boardDto";

const DEFAULTS = configFromRecord(defaultConfigFile);

/** Entries from `over` win key by key; an entry that sets one colour scheme keeps the other from `base`. */
function mergeEntries<T extends object>(base: Partial<Record<string, T>>, over: Partial<Record<string, T>>) {
  const merged: Record<string, T> = {};
  for (const name of new Set([...Object.keys(base), ...Object.keys(over)])) {
    merged[name] = { ...base[name], ...over[name] } as T;
  }
  return merged as Partial<Record<string, T>>;
}

export function pageConfigOf(config: BoardConfig): BoardPageConfig {
  return {
    projects: config.projects,
    types: mergeEntries(DEFAULTS.types, config.types),
    statuses: mergeEntries(DEFAULTS.statuses, config.statuses),
    priorities: mergeEntries(DEFAULTS.priorities, config.priorities),
    palettes: {
      light: { ...DEFAULTS.palettes.light, ...config.palettes.light },
      dark: { ...DEFAULTS.palettes.dark, ...config.palettes.dark },
    },
  };
}

function itemDto(item: ItemWithEvents): BoardItemDto {
  return {
    key: item.key,
    project: item.project,
    parent: item.parent,
    type: item.type,
    priority: item.priority,
    status: item.status,
    title: item.title,
    why: item.why,
    details_md: item.details_md,
    links: item.links,
    heartbeat_at: item.heartbeat_at,
    created_at: item.created_at,
    done_at: item.done_at,
    events: item.events.map(({ at, status, note }) => ({ at, status, note })),
  };
}

/** Open items plus those done inside the window, with the config the page draws them with. */
export async function boardResponse(
  repo: ItemRepository,
  config: BoardConfig,
  clock: Clock,
): Promise<Response> {
  const items = await listOpen(repo, {}, config.window, clock);
  const body: BoardResponse = {
    server_time: clock.now().toISOString(),
    window_hours: resolveWindowHours(undefined, config.window),
    config: pageConfigOf(config),
    items: items.map(itemDto),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
