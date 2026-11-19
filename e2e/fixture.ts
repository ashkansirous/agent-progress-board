import type { BoardItemDto, BoardPartDto, BoardResponse } from "../src/api/boardDto";
import { configFromRecord } from "../src/config";
import type { ItemStatus, Priority } from "../src/domain/item";
import { groupBoard } from "../src/domain/boardGroups";
import { type CheckRow, checksBySlice } from "../src/domain/checks";
import { splitSliceTitle } from "../src/domain/docSync";
import { eventMarkerOf, ItemType } from "../src/domain/item";
import { partLetterOf, PartState, partsProgress, partStateOf, shownStatusOf } from "../src/domain/parts";
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
function seedParts(slice: SeedItem, all: SeedItem[]): BoardPartDto[] | null {
  const mine = all.filter((seed) => seed.parentKey === slice.key && partLetterOf(seed.key) !== null);
  if (slice.type !== SLICE_TYPE || mine.length === 0) return null;
  return mine
    .map((seed) => partOf(seed, all))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}

function partOf(seed: SeedItem, all: SeedItem[]): BoardPartDto {
  const item = itemOfIn(seed, all);
  const row = { ...item, doc_status_at: null, live_status_at: item.heartbeat_at };
  return {
    key: seed.key,
    letter: partLetterOf(seed.key)!,
    title: seed.title,
    state: partStateOf(row, example.staleAfterMinutes, new Date(SERVER_TIME)),
    step: item.progress?.current ?? null,
    steps_done: item.progress?.done ?? null,
    steps_total: item.progress?.total ?? null,
  };
}

/** The checks of the seed set as the grouping reads them (never items of the board). */
export function checkRowsOf(all: SeedItem[]): CheckRow[] {
  return all
    .filter((seed) => seed.type === ItemType.Check)
    .map((seed) => ({ key: seed.key, title: seed.title, project: seed.project, status: seed.status as ItemStatus, parent_key: seed.parentKey }));
}

function heartbeatOf(seed: SeedItem): string {
  if (seed.heartbeatMinutesAgo) return minutesBeforeNow(seed.heartbeatMinutesAgo);
  if (seed.heartbeatHoursAgo) return new Date(Date.parse(SERVER_TIME) - seed.heartbeatHoursAgo * MS_PER_HOUR).toISOString();
  return atClock(seed.events[0]?.at ?? "08:00");
}

/** The slice a part, bug or problem seed names, as the server's `parent_slice`. */
function parentSliceOf(seed: SeedItem, all: SeedItem[]): BoardItemDto["parent_slice"] {
  const slice = seed.parentKey && SLICE_CHILDREN.includes(seed.type) ? all.find((s) => s.key === seed.parentKey && s.type === SLICE_TYPE) : undefined;
  return slice ? { key: slice.key, number: splitSliceTitle(slice.key, slice.title).number, title: slice.title } : null;
}

const SLICE_CHILDREN = ["part", "bug", "problem"];

export function itemOf(seed: SeedItem): BoardItemDto {
  return itemOfIn(seed, SEED_ITEMS);
}

/** One seed as the server's DTO, reading its parts, checks and slice from the seed set it belongs to. */
export function itemOfIn(seed: SeedItem, all: SeedItem[]): BoardItemDto {
  const parts = seedParts(seed, all);
  const active = parts?.find((part) => part.state === PartState.Active) ?? null;
  const isSlice = seed.type === SLICE_TYPE;
  const oldest = seed.events.at(-1)?.at ?? "08:00";
  const steps = stepsOf(seed);
  const environment = seed.environment ?? null;
  const heartbeat_at = heartbeatOf(seed);
  const askedMinutes = seed.createdMinutesAgo ?? seed.askedMinutesAgo;
  return {
    key: seed.key,
    project: seed.project,
    parent: seed.parent,
    parent_slice: parentSliceOf(seed, all),
    parent_key: seed.parentKey ?? null,
    slice: isSlice ? splitSliceTitle(seed.key, seed.title) : null,
    checks: isSlice ? (checksBySlice(checkRowsOf(all)).get(seed.key) ?? []) : null,
    type: seed.type as ItemType,
    priority: seed.priority as Priority,
    status: shownStatusOf(seed.status as ItemStatus, active !== null),
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
    active_part_key: active?.key ?? null,
    events: seed.events.map((e) => ({ at: atClock(e.at), status: e.status as ItemStatus, note: e.note, marker: eventMarkerOf(e.note) })),
  };
}

/** What GET /api/board answers for the demo board: 15 items, the example config's colours. */
export function demoBoard(items: BoardItemDto[] = SEED_ITEMS.map(itemOf), checks: CheckRow[] = []): BoardResponse {
  const { projects, types, statuses, priorities, palettes } = example;
  const config = { projects, types, statuses, priorities, palettes };
  const working_count = items.filter((item) => item.working).length;
  const groups = groupBoard(items, checks, projects.map((project) => project.id));
  return { server_time: SERVER_TIME, window_hours: WINDOW_HOURS, config, working_count, items, groups };
}

/** The faked /api/board for a seed set: check seeds are counted, not listed, as the Worker does. */
export function boardOfSeeds(seeds: SeedItem[]): BoardResponse {
  const items = seeds.filter((seed) => seed.type !== ItemType.Check).map((seed) => itemOfIn(seed, seeds));
  return demoBoard(items, checkRowsOf(seeds));
}

export function demoItem(key: string): BoardItemDto {
  const found = demoBoard().items.find((item) => item.key === key);
  if (!found) throw new Error(`no demo item ${key}`);
  return found;
}
