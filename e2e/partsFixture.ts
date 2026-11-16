import type { BoardItemDto, BoardPartDto, BoardResponse } from "../src/api/boardDto";
import { ItemStatus, ItemType } from "../src/domain/item";
import { partsProgress, PartState } from "../src/domain/parts";
import { normalizeSteps, stepProgress } from "../src/domain/steps";
import { StepState } from "../src/domain/stepTypes";
import { demoBoard, demoItem } from "./fixture";

/** The mock's samples (Main.dc.html): a five-part slice with B active, one with a stale part, one with all parts done, one with no parts. */
export const SLICE_FIVE = "recipe-box/slice-4";
export const PART_B = `${SLICE_FIVE}/part-B`;
export const SLICE_STALE = "garden-planner/slice-9";
export const SLICE_ALL_DONE = "home-lab/slice-2";
export const SLICE_NONE = "recipe-box/slice-3";

const STEP_COUNT = 5;

function part(slice: string, letter: string, title: string, state: PartState, step: string | null = null, done: number | null = null): BoardPartDto {
  return {
    key: `${slice}/part-${letter}`,
    letter,
    title,
    state,
    step,
    steps_done: done,
    steps_total: step === null ? null : STEP_COUNT,
  };
}

const FIVE: BoardPartDto[] = [
  part(SLICE_FIVE, "A", "Server", PartState.Done),
  part(SLICE_FIVE, "B", "Search box", PartState.Active, "Reviewing", 1),
  part(SLICE_FIVE, "C", "Tag chips", PartState.Pending),
  part(SLICE_FIVE, "D", "Join table", PartState.Pending),
  part(SLICE_FIVE, "E", "Release", PartState.Pending),
];

const STALE_PARTS: BoardPartDto[] = [
  part(SLICE_STALE, "A", "Forecast fetch", PartState.Done),
  part(SLICE_STALE, "B", "Notification channel", PartState.Stale, "Implementing", 1),
  part(SLICE_STALE, "C", "Quiet hours", PartState.Pending),
];

const ALL_DONE: BoardPartDto[] = [
  part(SLICE_ALL_DONE, "A", "Rotation rules", PartState.Done),
  part(SLICE_ALL_DONE, "B", "Restore test", PartState.Done),
];

function withParts(item: BoardItemDto, parts: BoardPartDto[], active: string | null = null): BoardItemDto {
  return { ...item, parts, parts_progress: partsProgress(parts.map((p) => p.state)), active_part_key: active };
}

/** The Active work card of part B: a part item with its steps, its slice as the parent text. */
function partBItem(): BoardItemDto {
  const steps = normalizeSteps([
    { label: "Implementation", state: StepState.Done },
    { label: "Reviewing", state: StepState.Active, note: "Two helper agents count under this step" },
    { label: "Fixing", state: StepState.Pending },
    { label: "Review 2", state: StepState.Pending },
    { label: "Merging", state: StepState.Pending },
  ]);
  return {
    ...demoItem(SLICE_FIVE),
    key: PART_B,
    type: ItemType.Part,
    title: "Search box",
    why: null,
    parent: null,
    parent_slice: { key: SLICE_FIVE, number: 4, title: "Tag search" },
    parent_key: SLICE_FIVE,
    status: ItemStatus.InProgress,
    agent: "Implementer",
    model: "model-mid",
    environment: "laptop",
    environment_label: "Laptop",
    steps,
    progress: stepProgress(steps, ItemStatus.InProgress),
    working: true,
    parts: null,
    parts_progress: null,
    active_part_key: null,
    events: [],
  };
}

function itemsWithParts(): BoardItemDto[] {
  const base = demoBoard().items.filter((item) => item.type !== ItemType.Part);
  const marked = base.map((item) => {
    if (item.key === SLICE_FIVE) return withParts({ ...item, status: ItemStatus.InProgress }, FIVE, PART_B);
    if (item.key === SLICE_STALE) return withParts(item, STALE_PARTS);
    if (item.key === SLICE_ALL_DONE) return withParts(item, ALL_DONE);
    return item;
  });
  return [...marked, partBItem()];
}

/** The faked /api/board for the parts checks. */
export function partsBoard(): BoardResponse {
  return demoBoard(itemsWithParts());
}
