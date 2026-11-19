import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { splitSliceTitle } from "../src/domain/docSync";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { normalizeSteps, stepProgress } from "../src/domain/steps";
import { type Step, type StepInput, StepState } from "../src/domain/stepTypes";
import { demoBoard, SERVER_TIME } from "./fixture";

const MS_PER_MINUTE = 60_000;

const minutesAgo = (minutes: number): string => new Date(Date.parse(SERVER_TIME) - minutes * MS_PER_MINUTE).toISOString();

/** Steps from "state:Label" or "state:Label|note" shorthand, in order. */
function stepsFrom(...specs: string[]): StepInput[] {
  return specs.map((spec) => {
    const [head = "", note] = spec.split("|");
    const [state = "", label = ""] = head.split(":");
    return { label, state: state as StepState, note };
  });
}

/** A stored step with its stamps, for the tree fixtures (Slice 39): minutes are before SERVER_TIME; the id is the label. */
function treeStep(label: string, state: StepState, opts: { start?: number; end?: number; note?: string; children?: Step[] } = {}): Step {
  return {
    id: label,
    label,
    state,
    note: opts.note ?? null,
    started_at: opts.start === undefined ? null : minutesAgo(opts.start),
    done_at: opts.end === undefined ? null : minutesAgo(opts.end),
    children: opts.children ?? [],
  };
}

interface TaskSpec {
  key: string;
  project: string;
  type: ItemType;
  title: string;
  parent: string;
  agent: string;
  model: string;
  environment: string | null;
  environment_label: string | null;
  beat: number;
  steps: StepInput[];
  /** A ready-made tree (with stamps); used instead of `steps` when given. */
  tree?: Step[];
  status?: ItemStatus;
  working?: boolean;
  /** What the task delivers (Slice 41); left out for an older report. */
  outcome?: string;
  /** An open question for the owner; the page then counts it under "questions are waiting". */
  needsYou?: string;
}

function taskOf(spec: TaskSpec): BoardItemDto {
  const steps = spec.tree ?? normalizeSteps(spec.steps);
  const status = spec.status ?? ItemStatus.InProgress;
  return {
    key: spec.key,
    project: spec.project,
    parent: spec.parent,
    parent_slice: null,
    parent_key: null,
    slice: spec.type === ItemType.Slice ? splitSliceTitle(spec.key, spec.title) : null,
    checks: spec.type === ItemType.Slice ? [] : null,
    type: spec.type,
    priority: Priority.P2,
    status,
    title: spec.title,
    why: null,
    details_md: null,
    links: [],
    heartbeat_at: minutesAgo(spec.beat),
    created_at: minutesAgo(300),
    done_at: null,
    environment: spec.environment,
    environment_label: spec.environment_label,
    agent: spec.agent,
    model: spec.model,
    outcome: spec.outcome ?? null,
    needs_you: spec.needsYou ?? null,
    after_answer: null,
    needs_you_at: spec.needsYou ? minutesAgo(5) : null,
    steps,
    progress: stepProgress(steps, status),
    working: spec.working ?? status === ItemStatus.InProgress,
    parts: null,
    parts_progress: null,
    active_part_key: null,
    events: [],
  };
}

export const PART_C = "garden-planner/slice-9/part-c";
export const PART_B = "recipe-box/slice-4/part-b";
export const CRASH = "garden-planner/crash-bed";
export const STALE = "garden-planner/slice-10";

/** The mock's three working tasks (Active.dc.html) plus one stale task, which the page leaves out. */
export function activeTasks(): BoardItemDto[] {
  return [
    taskOf({
      key: CRASH, project: "garden-planner", type: ItemType.Bug, title: "Crash opening an empty bed", parent: "Release 1.4.1",
      agent: "Fixer", model: "model-small", environment: "laptop", environment_label: "Laptop", beat: 4, outcome: "Build passes on main",
      steps: stepsFrom("done:Reproduce", "active:Fix", "pending:Phone test|No tablet test: no tablet code changed", "pending:Merging"),
    }),
    taskOf({
      key: PART_C, project: "garden-planner", type: ItemType.Slice, title: "Part C · Notification channel", parent: "Slice 9 · Frost alerts",
      agent: "Implementer", model: "model-mid", environment: "cloud-vm", environment_label: "Cloud VM", beat: 1, outcome: "Code merged to main",
      steps: stepsFrom(
        "done:Implementation", "done:Review 1", "done:Fixing", "active:Review 2|Two helper agents count under this step",
        "pending:Phone test", "pending:Tablet test", "pending:Merging",
      ),
    }),
    taskOf({
      key: PART_B, project: "recipe-box", type: ItemType.Slice, title: "Part B · Search box", parent: "Slice 4 · Tag search",
      agent: "Reviewer", model: "model-large", environment: "laptop", environment_label: "Laptop", beat: 2, outcome: "A plan with slices",
      steps: stepsFrom("done:Implementation", "active:Review 1", "pending:Fixing", "pending:Review 2", "pending:Merging"),
    }),
    taskOf({
      key: STALE, project: "garden-planner", type: ItemType.Slice, title: "Slice 10 · Seed inventory", parent: "Plan · Inventory",
      agent: "Implementer", model: "model-mid", environment: null, environment_label: null, beat: 180,
      steps: stepsFrom("done:Implementation", "active:Review 1", "pending:Merging"), status: ItemStatus.Stale,
    }),
  ];
}

/** The faked /api/board for the Active work page: the tasks above and the count the server would send. */
export function activeBoard(items: BoardItemDto[] = activeTasks()): BoardResponse {
  return demoBoard(items);
}

export const BOOK = "example-app/slice-7";
export const WAVE = "example-app/wave-3";

const LANGUAGES = [
  treeStep("English", StepState.Done, { start: 62, end: 54 }),
  treeStep("French", StepState.Active, {
    start: 54,
    note: "Retrying line 31 after a timeout",
    children: [
      treeStep("Generate the lines", StepState.Done, { start: 54, end: 16 }),
      treeStep("Check pronunciation", StepState.Active, { start: 16, note: "Line 31 of 42" }),
      treeStep("Save the file", StepState.Pending),
    ],
  }),
  treeStep("German", StepState.Active, { start: 53 }),
  treeStep("Spanish", StepState.Active, { start: 52 }),
  treeStep("Italian", StepState.Done, { start: 54, end: 43 }),
  treeStep("Portuguese", StepState.Pending),
];

/** The owner's two examples: a book whose audio step holds a helper's running language steps, and a 30-step wave with 26 done and none running. */
export function treeTasks(): BoardItemDto[] {
  const wave = Array.from({ length: 30 }, (_, i) =>
    i < 26
      ? treeStep(`Wave step ${i + 1}`, StepState.Done, { start: 200 - i * 6, end: 194 - i * 6 })
      : treeStep(`Wave step ${i + 1}`, StepState.Pending),
  );
  return [
    taskOf({
      key: BOOK, project: "example-app", type: ItemType.Slice, title: "Implement Slice 7: audio in every language", parent: "Slice 7",
      agent: "Implementer", model: "model-large", environment: "cloud-vm", environment_label: "Cloud VM", beat: 1, steps: [],
      tree: [
        treeStep("Read the slice", StepState.Done, { start: 75, end: 73 }),
        treeStep("Write the script text", StepState.Done, { start: 73, end: 65, note: "Text for 15 languages, 42 lines each" }),
        treeStep("Record audio, 15 languages", StepState.Active, {
          start: 62,
          children: [
            treeStep("Record the audio, three languages at a time", StepState.Active, { start: 61, note: "Helper agent · model-small", children: LANGUAGES }),
          ],
        }),
        treeStep("Review the diff", StepState.Pending, { note: "Helper agent: reviewer" }),
        treeStep("Merge", StepState.Pending),
      ],
    }),
    taskOf({
      key: WAVE, project: "example-app", type: ItemType.Slice, title: "Wave 3: thirty small steps", parent: "Wave 3",
      agent: "Implementer", model: "model-mid", environment: "laptop", environment_label: "Laptop", beat: 3, steps: [], tree: wave,
    }),
  ];
}
