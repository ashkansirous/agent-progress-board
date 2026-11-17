import type { BoardItemDto, BoardPartDto, BoardResponse } from "../src/api/boardDto";
import { configFromRecord } from "../src/config";
import type { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { partLetterOf, PartState, partsProgress } from "../src/domain/parts";
import { isWorkingNow, normalizeSteps, stepProgress } from "../src/domain/steps";
import type { Step, StepState } from "../src/domain/stepTypes";
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

const example = configFromRecord(exampleConfig);

function stepsOf(seed: SeedItem): Step[] | null {
  return normalizeSteps(seed.steps?.map((s) => ({ ...s, state: s.state as StepState })));
}

const SLICE_TYPE = "slice";

/** The seed parts of a slice as the server would list them: letter order, state read with the same rule. */
function seedParts(slice: SeedItem): BoardPartDto[] | null {
  const mine = SEED_ITEMS.filter((seed) => seed.parentKey === slice.key && partLetterOf(seed.key) !== null);
  if (slice.type !== SLICE_TYPE || mine.length === 0) return null;
  return mine
    .map((seed) => ({
      key: seed.key,
      letter: partLetterOf(seed.key)!,
      title: seed.title,
      state: seed.status === "done" ? PartState.Done : PartState.Pending,
      step: null,
      steps_done: null,
      steps_total: null,
    }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}

function heartbeatOf(seed: SeedItem): string {
  if (seed.heartbeatMinutesAgo) return minutesBeforeNow(seed.heartbeatMinutesAgo);
  if (seed.heartbeatHoursAgo) return new Date(Date.parse(SERVER_TIME) - seed.heartbeatHoursAgo * MS_PER_HOUR).toISOString();
  return atClock(seed.events[0]?.at ?? "08:00");
}

export function itemOf(seed: SeedItem): BoardItemDto {
  const parts = seedParts(seed);
  const oldest = seed.events.at(-1)?.at ?? "08:00";
  const steps = stepsOf(seed);
  const environment = seed.environment ?? null;
  const heartbeat_at = heartbeatOf(seed);
  const askedMinutes = seed.createdMinutesAgo ?? seed.askedMinutesAgo;
  return {
    key: seed.key,
    project: seed.project,
    parent: seed.parent,
    parent_slice: null,
    parent_key: seed.parentKey ?? null,
    type: seed.type as ItemType,
    priority: seed.priority as Priority,
    status: seed.status as ItemStatus,
    title: seed.title,
    why: seed.why,
    details_md: seed.details.join("\n\n"),
    links: seed.links,
    heartbeat_at,
    created_at: askedMinutes ? minutesBeforeNow(askedMinutes) : atClock(oldest),
    done_at: seed.doneMinutesAgo ? minutesBeforeNow(seed.doneMinutesAgo) : null,
    environment,
    environment_label: environment === null ? null : (example.usage.environmentLabels[environment] ?? environment),
    agent: seed.agent ?? null,
    model: seed.model ?? null,
    needs_you: seed.needsYou ?? null,
    after_answer: seed.afterAnswer ?? null,
    needs_you_at: seed.needsYou ? minutesBeforeNow(seed.askedMinutesAgo ?? 1) : null,
    steps,
    progress: stepProgress(steps, seed.status as ItemStatus),
    working: isWorkingNow(
      { status: seed.status as ItemStatus, heartbeat_at, doc_status_at: null, live_status_at: heartbeat_at, steps, agent: seed.agent },
      example.staleAfterMinutes,
      new Date(SERVER_TIME),
    ),
    parts,
    parts_progress: parts ? partsProgress(parts.map((part) => part.state)) : null,
    active_part_key: null,
    events: seed.events.map((e) => ({ at: atClock(e.at), status: e.status as ItemStatus, note: e.note })),
  };
}

/** What GET /api/board answers for the demo board: 15 items, the example config's colours. */
export function demoBoard(items: BoardItemDto[] = SEED_ITEMS.map(itemOf)): BoardResponse {
  const { projects, types, statuses, priorities, palettes } = example;
  const config = { projects, types, statuses, priorities, palettes };
  const working_count = items.filter((item) => item.working).length;
  return { server_time: SERVER_TIME, window_hours: WINDOW_HOURS, config, working_count, items };
}

export function demoItem(key: string): BoardItemDto {
  const found = demoBoard().items.find((item) => item.key === key);
  if (!found) throw new Error(`no demo item ${key}`);
  return found;
}
