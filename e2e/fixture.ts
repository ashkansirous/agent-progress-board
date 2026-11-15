import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { configFromRecord } from "../src/config";
import type { ItemStatus, ItemType, Priority } from "../src/domain/item";
import exampleConfig from "../config/board.example.json" with { type: "json" };
import { SEED_ITEMS, type SeedItem } from "../scripts/seed-data";

/** The demo day, in UTC; the E2E config pins the browser to UTC so clock times match. */
export const DEMO_DAY = "2026-11-15";
export const SERVER_TIME = `${DEMO_DAY}T13:48:00.000Z`;
export const WINDOW_HOURS = 12;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

function atClock(clock: string): string {
  return `${DEMO_DAY}T${clock}:00.000Z`;
}

function minutesBeforeNow(minutes: number): string {
  return new Date(Date.parse(SERVER_TIME) - minutes * MS_PER_MINUTE).toISOString();
}

function itemOf(seed: SeedItem): BoardItemDto {
  const oldest = seed.events.at(-1)?.at ?? "08:00";
  return {
    key: seed.key,
    project: seed.project,
    parent: seed.parent,
    type: seed.type as ItemType,
    priority: seed.priority as Priority,
    status: seed.status as ItemStatus,
    title: seed.title,
    why: seed.why,
    details_md: seed.details.join("\n\n"),
    links: seed.links,
    heartbeat_at: seed.heartbeatHoursAgo
      ? new Date(Date.parse(SERVER_TIME) - seed.heartbeatHoursAgo * MS_PER_HOUR).toISOString()
      : atClock(seed.events[0]?.at ?? "08:00"),
    created_at: seed.askedMinutesAgo ? minutesBeforeNow(seed.askedMinutesAgo) : atClock(oldest),
    done_at: seed.doneMinutesAgo ? minutesBeforeNow(seed.doneMinutesAgo) : null,
    events: seed.events.map((e) => ({ at: atClock(e.at), status: e.status as ItemStatus, note: e.note })),
  };
}

const example = configFromRecord(exampleConfig);

/** What GET /api/board answers for the demo board: 14 items, the example config's colours. */
export function demoBoard(items: BoardItemDto[] = SEED_ITEMS.map(itemOf)): BoardResponse {
  const { projects, types, statuses, priorities, palettes } = example;
  const config = { projects, types, statuses, priorities, palettes };
  return { server_time: SERVER_TIME, window_hours: WINDOW_HOURS, config, items };
}

export function demoItem(key: string): BoardItemDto {
  const found = demoBoard().items.find((item) => item.key === key);
  if (!found) throw new Error(`no demo item ${key}`);
  return found;
}
