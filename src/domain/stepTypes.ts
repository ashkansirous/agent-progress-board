/** The step types and the state enum. A leaf module: it imports nothing, so the web page can use it without pulling in server code. */
export enum StepState {
  Done = "done",
  Active = "active",
  Pending = "pending",
}

/**
 * One step of a task as stored: free text, shown as sent. Steps form a tree (Slice 39): a step with
 * children is a parent, one with none is a leaf. The server stamps `started_at` and `done_at`.
 */
export interface Step {
  /** Stable across reports: the reporter's, else made from the label path. Unique in the whole tree. */
  id: string;
  label: string;
  state: StepState;
  note: string | null;
  /** UTC ISO time the step first became active or done; null while pending. */
  started_at: string | null;
  /** UTC ISO time the step became done; null otherwise. */
  done_at: string | null;
  children: Step[];
}

/**
 * A step as a report gives it: the note, id and children may be left out. Children left out keep the
 * stored ones of the step with the same id; an empty list clears them.
 */
export interface StepInput {
  id?: string;
  label: string;
  state: StepState;
  note?: string | null;
  children?: StepInput[];
}

export interface StepProgress {
  /** Leaves done. */
  done: number;
  /** Leaves in the tree. */
  total: number;
  /** Done over total, rounded; 100 for a task marked done whatever its list says. */
  percent: number;
  /** Leaves running now (a finished task: 0). */
  running: number;
  /** The label of the running leaf when exactly one runs; null otherwise (the page reads "N running" or "Starting"). */
  current: string | null;
}

/** The leaves of a tree in order: steps with no children. */
export function leavesOf(steps: readonly Step[]): Step[] {
  return steps.flatMap((step) => (step.children.length === 0 ? [step] : leavesOf(step.children)));
}
