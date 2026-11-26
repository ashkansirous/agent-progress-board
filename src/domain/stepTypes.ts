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

/** One model's tokens by kind in a step's cost (Slice 54). */
export interface ModelTokens {
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
}

/**
 * The measured cost of a finished step as a report sends it (Slice 54): never stored on the step itself; the server keeps it
 * as a `step_runs` row (one per step and agent) in the same write. The step's times and their sources are the row's.
 */
export interface StepCostInput {
  /** The agent that owned the step; left out for the main thread. */
  agent_id?: string | null;
  /** The models the step used with their tokens by kind (a step's cost holds one entry per model). */
  models: ModelTokens[];
  /** The largest single request's input + cache read + cache creation tokens. */
  peak_context: number;
  /** Context compactions seen while the step ran. */
  compactions: number;
  /** The session id of the plugin that computed this cost: with the step and agent it is the row's key (Slice 54 Decision 10). Absent reads as ''. */
  writer?: string | null;
  /** The writer's counter for this cost, raised only when its numbers change; the server replaces the row only when it is greater. Absent reads as 0. */
  seq?: number;
}

/** Which stored row a done step shows (Slice 54 Decision 7b): set when the step is saved done with a cost, cleared when it leaves done. */
export interface CostRef {
  writer: string;
  agent_id: string;
}

/** A step's cost as read (Slice 54): the stored facts of every agent that ran it, with the sums worked out at read. */
export interface StepCost {
  models: ModelTokens[];
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  /** All four kinds together. */
  total_tokens: number;
  peak_context: number;
  compactions: number;
  /** Seconds from the run's start to its end. */
  duration_seconds: number;
  /** Where the times came from; a cost with a stamped time is stored but the page shows none. */
  started_source: TimeSource;
  ended_source: TimeSource;
}

/** What a step went over its budget on (Slice 56). */
export enum BreachKind {
  /** A running step has run longer than its minutes. */
  Time = "time",
  /** A finished step's cost row holds more tokens than its budget. */
  Tokens = "tokens",
  /** A finished step's largest request is bigger than its peak-context budget. */
  Context = "context",
}

/**
 * A step over its budget, worked out at read and never stored (Slice 56): `used` and `budget` are minutes for a time breach
 * (`used` rounded up) and tokens otherwise; `compacted` says the step's context was compacted at least once.
 */
export interface Breach {
  kind: BreachKind;
  used: number;
  budget: number;
  compacted: boolean;
}

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
  /** Times a context compaction happened while the step ran (Slice 53); only ever grows. Always set when built; optional in the type so a hand-made step (a page fixture) may leave it out, read as 0. */
  compactions?: number;
  /** The stored cost row this done step shows (Decision 7b); absent when it has none. Stored in the steps text. */
  cost_ref?: CostRef;
  /** The kind of step as a key of lower-case words joined by `/` (Slice 55); absent when the step has none. Stored in the steps text. */
  process?: string;
  /** Named whole numbers the step reports (for example findings, fixed; Slice 55); absent when none. Stored in the steps text. */
  counts?: Record<string, number>;
  /** The step's measured cost, attached at read from `step_runs` (Slice 54); never part of the stored steps text. */
  cost?: StepCost | null;
  /** Set at read when the step is over its budget (Slice 56); never part of the stored steps text. */
  breach?: Breach | null;
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
  waits_on?: string | null;
  link?: string | null;
  /** Times the reporter knows; kept when valid (not in the future, start before end). A late or batched report sends them so no duration is guessed. */
  started_at?: string | null;
  done_at?: string | null;
  /** `observed` only from a plugin hook that saw the change; default `reported`. */
  started_source?: ReportedSource | TimeSource | null;
  done_source?: ReportedSource | TimeSource | null;
  /** Compactions seen during the step (a hook counts them); the stored count is kept when it is larger. */
  compactions?: number | null;
  /** The measured cost of a finished step, from a plugin hook (Slice 54); needs an explicit `id`, else it is ignored. */
  cost?: unknown;
  /** The step's process key (Slice 55); left out keeps the stored one, null clears it. */
  process?: unknown;
  /** The step's named counts (Slice 55); left out keeps the stored ones, null clears them. */
  counts?: unknown;
  /** Carried from a stored step by the server's own merges; a client's value is dropped by the schema. */
  cost_ref?: CostRef;
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
