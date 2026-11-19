import defaultConfigFile from "../../config/board.example.json";
import { type Clock, listBoardRows } from "../application/board";
import type { BoardRow, ItemRepository } from "../application/ports";
import { type BoardConfig, configFromRecord } from "../config";
import { groupBoard } from "../domain/boardGroups";
import { type CheckRow, type CheckView, checksBySlice } from "../domain/checks";
import { splitSliceTitle } from "../domain/docSync";
import { eventMarkerOf, type Item, type ItemStatus, ItemType } from "../domain/item";
import { hasOpenQuestion } from "../domain/stale";
import { activePartOf, partLetterOf, partsProgress, partStateOf, shownStatusOf } from "../domain/parts";
import { isWorkingNow, stepProgress } from "../domain/steps";
import { resolveWindowHours } from "../domain/window";
import type { BoardItemDto, BoardPageConfig, BoardPartDto, BoardResponse, ParentSliceDto } from "./boardDto";

const DEFAULTS = configFromRecord(defaultConfigFile);

/** Entries from `over` win key by key; an entry that sets one colour scheme keeps the other from `base`. */
function mergeEntries<T extends object>(base: Partial<Record<string, T>>, over: Partial<Record<string, T>>) {
  const merged: Record<string, T> = {};
  for (const name of new Set([...Object.keys(base), ...Object.keys(over)])) {
    merged[name] = { ...base[name], ...over[name] } as T;
  }
  return merged as Partial<Record<string, T>>;
}

const PART_LABEL = "Part";

/**
 * The type colours. A private config written before Slice 11 has no `part` type: its parts then wear
 * the slice type's colour pairs (that config's own) under the label "Part".
 */
function typesOf(config: BoardConfig): BoardPageConfig["types"] {
  const merged = mergeEntries(DEFAULTS.types, config.types);
  if (config.types[ItemType.Part] || !merged[ItemType.Slice]) return merged;
  return { ...merged, [ItemType.Part]: { ...merged[ItemType.Slice], label: PART_LABEL } };
}

export function pageConfigOf(config: BoardConfig): BoardPageConfig {
  return {
    projects: config.projects,
    types: typesOf(config),
    statuses: mergeEntries(DEFAULTS.statuses, config.statuses),
    priorities: mergeEntries(DEFAULTS.priorities, config.priorities),
    palettes: {
      light: { ...DEFAULTS.palettes.light, ...config.palettes.light },
      dark: { ...DEFAULTS.palettes.dark, ...config.palettes.dark },
    },
  };
}

/** What the DTO of one item needs besides its own row: the parts of a slice and the slice of a part. */
interface PartsContext {
  config: BoardConfig;
  now: Date;
  partsOf: Map<string, BoardPartDto[]>;
  checksOf: Map<string, CheckView[]>;
  sliceByKey: Map<string, BoardRow>;
}

function partDto(row: BoardRow, config: BoardConfig, now: Date): BoardPartDto {
  const { expiry, ...item } = row;
  const progress = stepProgress(item.steps, item.status);
  return {
    key: item.key,
    letter: partLetterOf(item.key) ?? "",
    title: item.title,
    state: partStateOf({ ...item, ...expiry }, config.staleAfterMinutes, now),
    step: progress?.current ?? null,
    steps_done: progress?.done ?? null,
    steps_total: progress?.total ?? null,
  };
}

/**
 * A part is in its slice's list, total and progress only when the plan documents list it (the
 * documents say which parts exist). A part only a live report named is never in them; it still
 * shows on the Active work page while it works. A part the documents dropped was closed on the way out.
 */
function isListedPart(row: BoardRow): boolean {
  return row.type === ItemType.Part && row.parent_key != null && partLetterOf(row.key) !== null &&
    row.docSync.in_doc_sync;
}

function partsByParent(rows: BoardRow[], config: BoardConfig, now: Date): Map<string, BoardPartDto[]> {
  const byParent = new Map<string, BoardPartDto[]>();
  for (const row of rows.filter(isListedPart)) {
    const list = byParent.get(row.parent_key!) ?? [];
    byParent.set(row.parent_key!, [...list, partDto(row, config, now)]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.letter.localeCompare(b.letter));
  return byParent;
}

/** The types that name a slice in `parent_key`: a part or check belongs to it, a bug or problem is planned into it (Slice 14). */
const SLICE_NAMING_TYPES: readonly ItemType[] = [ItemType.Part, ItemType.Check, ItemType.Bug, ItemType.Problem];

/** The slice a part, check, bug or problem names, as data (key, number, title); the page words it. Null when it names no slice on the board. */
function parentSliceOf(row: BoardRow, ctx: PartsContext): ParentSliceDto | null {
  const slice =
    SLICE_NAMING_TYPES.includes(row.type) && row.parent_key ? (ctx.sliceByKey.get(row.parent_key) ?? row.parentSlice ?? undefined) : undefined;
  if (!slice) return null;
  return { key: slice.key, number: splitSliceTitle(slice.key, slice.title).number, title: slice.title };
}

function partsFields(row: BoardRow, ctx: PartsContext) {
  const parts = row.type === ItemType.Slice ? (ctx.partsOf.get(row.key) ?? null) : null;
  const active = parts ? activePartOf(parts) : null;
  return {
    parts,
    parts_progress: parts ? partsProgress(parts.map((part) => part.state)) : null,
    active_part_key: active?.key ?? null,
  };
}

/** The question an item holds, only while it still waits for the owner (`hasOpenQuestion`); else all three null. */
function questionFields(item: Item, shownStatus: ItemStatus, config: BoardConfig, now: Date) {
  const open = hasOpenQuestion({ ...item, status: shownStatus }, config.staleAfterMinutes, now);
  return {
    needs_you: open ? (item.needs_you ?? null) : null,
    after_answer: open ? (item.after_answer ?? null) : null,
    needs_you_at: open ? (item.needs_you_at ?? null) : null,
  };
}

function itemDto(row: BoardRow, ctx: PartsContext): BoardItemDto {
  const { config, now } = ctx;
  const { expiry, ...item } = row;
  const environment = item.environment ?? null;
  const partsInfo = partsFields(row, ctx);
  const shownStatus = shownStatusOf(item.status, partsInfo.active_part_key !== null);
  return {
    key: item.key,
    project: item.project,
    parent: item.parent,
    parent_slice: parentSliceOf(row, ctx),
    parent_key: item.parent_key ?? null,
    slice: item.type === ItemType.Slice ? splitSliceTitle(item.key, item.title) : null,
    checks: item.type === ItemType.Slice ? (ctx.checksOf.get(item.key) ?? []) : null,
    type: item.type,
    priority: item.priority,
    status: shownStatus,
    title: item.title,
    why: item.why,
    details_md: item.details_md,
    links: item.links,
    heartbeat_at: item.heartbeat_at,
    created_at: item.created_at,
    done_at: item.done_at,
    environment,
    environment_label: environment === null ? null : (config.usage.environmentLabels[environment] ?? environment),
    agent: item.agent ?? null,
    model: item.model ?? null,
    outcome: item.outcome ?? null,
    ...questionFields(item, shownStatus, config, now),
    steps: item.steps ?? null,
    progress: stepProgress(item.steps, item.status),
    working: item.type !== ItemType.Check && isWorkingNow({ ...item, ...expiry }, config.staleAfterMinutes, now),
    ...partsInfo,
    events: item.events.map(({ at, status, note }) => ({ at, status, note, marker: eventMarkerOf(note) })),
  };
}

function checkRowOf(row: BoardRow): CheckRow {
  return { key: row.key, title: row.title, project: row.project, status: row.status, parent_key: row.parent_key };
}

/** Open items plus those done inside the window, with the config the page draws them with and the groups it lists them in. */
export async function boardResponse(
  repo: ItemRepository,
  config: BoardConfig,
  clock: Clock,
): Promise<Response> {
  const all = await listBoardRows(repo, {}, config.window, clock);
  const rows = all.filter((row) => row.type !== ItemType.Check);
  const checkAll = all.filter((row) => row.type === ItemType.Check);
  const checkRows: CheckRow[] = checkAll.map(checkRowOf);
  const now = clock.now();
  const ctx: PartsContext = {
    config,
    now,
    partsOf: partsByParent(rows, config, now),
    checksOf: checksBySlice(checkRows),
    sliceByKey: new Map(rows.filter((row) => row.type === ItemType.Slice).map((row) => [row.key, row])),
  };
  const questionChecks = checkAll.map((row) => itemDto(row, ctx)).filter((item) => item.needs_you !== null);
  const items = [...rows.map((row) => itemDto(row, ctx)), ...questionChecks];
  const body: BoardResponse = {
    server_time: now.toISOString(),
    window_hours: resolveWindowHours(undefined, config.window),
    config: pageConfigOf(config),
    working_count: items.filter((item) => item.working).length,
    items,
    groups: groupBoard(items, checkRows, config.projects.map((project) => project.id)),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
