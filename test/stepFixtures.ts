import { type Step, StepState } from "../src/domain/stepTypes";

/** A stored step for a test: the label is also its id; times are null unless given. */
export function storedStep(label: string, state: StepState, extra: Partial<Step> = {}): Step {
  return { id: label, label, state, note: null, started_at: null, done_at: null, started_source: null, done_source: null, waits_on: null, link: null, compactions: 0, children: [], ...extra };
}
