import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { normalizeSteps, stepProgress } from "../src/domain/steps";
import { type StepInput, StepState } from "../src/domain/stepTypes";
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
  status?: ItemStatus;
  working?: boolean;
}

function taskOf(spec: TaskSpec): BoardItemDto {
  const steps = normalizeSteps(spec.steps);
  const status = spec.status ?? ItemStatus.InProgress;
  return {
    key: spec.key,
    project: spec.project,
    parent: spec.parent,
    parent_slice: null,
    parent_key: null,
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
      agent: "Fixer", model: "model-small", environment: "laptop", environment_label: "Laptop", beat: 4,
      steps: stepsFrom("done:Reproduce", "active:Fix", "pending:Phone test|No tablet test: no tablet code changed", "pending:Merging"),
    }),
    taskOf({
      key: PART_C, project: "garden-planner", type: ItemType.Slice, title: "Part C · Notification channel", parent: "Slice 9 · Frost alerts",
      agent: "Implementer", model: "model-mid", environment: "cloud-vm", environment_label: "Cloud VM", beat: 1,
      steps: stepsFrom(
        "done:Implementation", "done:Review 1", "done:Fixing", "active:Review 2|Two helper agents count under this step",
        "pending:Phone test", "pending:Tablet test", "pending:Merging",
      ),
    }),
    taskOf({
      key: PART_B, project: "recipe-box", type: ItemType.Slice, title: "Part B · Search box", parent: "Slice 4 · Tag search",
      agent: "Reviewer", model: "model-large", environment: "laptop", environment_label: "Laptop", beat: 2,
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
