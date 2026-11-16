/** The step types and the state enum. A leaf module: it imports nothing, so the web page can use it without pulling in server code. */
export enum StepState {
  Done = "done",
  Active = "active",
  Pending = "pending",
}

/** One step of a task as the client sent it: free text, shown as sent. */
export interface Step {
  label: string;
  state: StepState;
  note: string | null;
}

/** A step as a report gives it: the note may be left out. */
export interface StepInput {
  label: string;
  state: StepState;
  note?: string | null;
}

export interface StepProgress {
  done: number;
  total: number;
  /** Done over total, rounded; 100 for a task marked done whatever its list says. */
  percent: number;
  /** The label of the active step; null when no step is active (the page reads "Starting"). */
  current: string | null;
}
