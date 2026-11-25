/** The step types and the state enum. A leaf module: it imports nothing, so the web page can use it without pulling in server code. */
export enum StepState {
  Done = "done",
  Active = "active",
  Pending = "pending",
  /** Waiting on other work or on the owner (Slice 51): its note says what it waits on. */
  Blocked = "blocked",
}

/** What a blocked step waits on: other work (default, orange) or the owner (red, listed under Needs you). */
export enum WaitsOn {
  Work = "work",
  Owner = "owner",
}

/** Where a stored step time came from, best first: a hook saw it as it happened, the agent sent it, or the server used its own clock (Slice 51). */
export enum TimeSource {
  Observed = "observed",
  Reported = "reported",
  Stamped = "stamped",
}

/** The sources a report may name for a time it sends; `stamped` is the server's alone. */
export type ReportedSource = TimeSource.Observed | TimeSource.Reported;

/**
 * One step of a task as stored: free text, shown as sent. Steps form a tree (Slice 39): a step with
 * children is a parent, one with none is a leaf. `started_at` and `done_at` are the reporter's when it sent
 * them, else the server's own clock; `started_source` and `done_source` say which (Slice 51).
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
  /** Where `started_at` came from; null while it is null. */
  started_source: TimeSource | null;
  /** Where `done_at` came from; null while it is null. */
  done_source: TimeSource | null;
  /** For a blocked step: what it waits on; null for any other state. */
  waits_on: WaitsOn | null;
  /** For a blocked step: an optional http(s) link to what it waits on; null otherwise. */
  link: string | null;
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
  /** A blocked step's target (default work) and link; ignored for other states. */
  waits_on?: WaitsOn | null;
  link?: string | null;
  /** Times the reporter knows; kept when valid (not in the future, start before end). A late or batched report sends them so no duration is guessed. */
  started_at?: string | null;
  done_at?: string | null;
  /** `observed` only from a plugin hook that saw the change; default `reported`. */
  started_source?: ReportedSource | TimeSource | null;
  done_source?: ReportedSource | TimeSource | null;
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
  /** Leaves blocked now (a finished task: 0). */
  blocked: number;
  /** The slice's checks not yet done, counted in `total` (0 for any other item). */
  open_checks: number;
  /** The label of the running leaf when exactly one runs; null otherwise (the page reads "N running" or "Starting"). */
  current: string | null;
}

/**
 * The one rule for "a step is blocked on the owner" (Slice 51): the steps of the tree, in order, that are blocked with
 * `waits_on` owner. The Needs you listing, the red styling and the question text all read this, never their own copy.
 */
export function ownerBlockedSteps(steps: readonly Step[] | null | undefined): Step[] {
  return (steps ?? []).flatMap((step) => [
    ...(step.state === StepState.Blocked && step.waits_on === WaitsOn.Owner ? [step] : []),
    ...ownerBlockedSteps(step.children),
  ]);
}

/** The leaves of a tree in order: steps with no children. */
export function leavesOf(steps: readonly Step[]): Step[] {
  return steps.flatMap((step) => (step.children.length === 0 ? [step] : leavesOf(step.children)));
}
