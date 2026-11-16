import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus } from "../../src/domain/item";
import { type Step, StepState } from "../../src/domain/stepTypes";
import type { StringKey, Translate } from "./strings";

/** "Starting" while no step is active, "Done" for a finished task, else the active step's label. */
export function currentStepText(item: BoardItemDto, t: Translate): string {
  if (item.status === ItemStatus.Done) return t("stepDone");
  return item.progress?.current ?? t("stepStarting");
}

export function progressText(item: BoardItemDto, t: Translate): string {
  const progress = item.progress;
  if (!progress) return "";
  return t("stepsProgress", { done: progress.done, total: progress.total, pct: progress.percent });
}

const WORD_KEYS: Record<StepState, StringKey> = {
  [StepState.Done]: "stepDone",
  [StepState.Active]: "stepNow",
  [StepState.Pending]: "stepLater",
};

export interface StepWord {
  state: StepState;
  key: StringKey;
}

/** The state word of each step: Done, Now, Next (the first pending one) or Later. */
export function stepWords(steps: Step[], finished: boolean): StepWord[] {
  let seenNext = false;
  return steps.map((step) => {
    const state = finished ? StepState.Done : step.state;
    if (state === StepState.Pending && !seenNext) {
      seenNext = true;
      return { state, key: "stepNext" };
    }
    return { state, key: WORD_KEYS[state] };
  });
}
