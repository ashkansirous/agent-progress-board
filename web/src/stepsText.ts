import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus } from "../../src/domain/item";
import { leavesOf, type Step, StepState } from "../../src/domain/stepTypes";
import type { StringKey, Translate } from "./strings";
import { clockTime } from "./time";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTE_DIGITS = 2;

/** "Done" for a finished task; "N running" for several running leaves; the running leaf's label; "Waiting for the next step" once something is done; else "Starting". */
export function currentStepText(item: BoardItemDto, t: Translate): string {
  if (item.status === ItemStatus.Done) return t("stepDone");
  const progress = item.progress;
  if (progress && progress.running > 1) return t("stepsRunning", { n: progress.running });
  if (progress?.current) return progress.current;
  return progress && progress.done > 0 ? t("stepsWaiting") : t("stepStarting");
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

/** "8 min" or "1 h 02 min": whole minutes, at least 1. */
export function durationText(ms: number, t: Translate): string {
  const minutes = Math.max(1, Math.floor(ms / MS_PER_MINUTE));
  if (minutes < MINUTES_PER_HOUR) return t("durMin", { n: minutes });
  const rest = String(minutes % MINUTES_PER_HOUR).padStart(MINUTE_DIGITS, "0");
  return t("durHourMin", { h: Math.floor(minutes / MINUTES_PER_HOUR), m: rest });
}

/** What a step reads as: done for every step of a finished task; a parent with a running leaf below it reads running; else its own state. */
export function shownState(step: Step, finished: boolean): StepState {
  if (finished) return StepState.Done;
  const runningBelow = step.children.length > 0 && leavesOf(step.children).some((leaf) => leaf.state === StepState.Active);
  return runningBelow ? StepState.Active : step.state;
}

export interface LeafCounts {
  done: number;
  total: number;
  running: number;
}

/** The leaves of one step's whole subtree: done, all, and running (a leaf step counts itself). */
export function leafCounts(step: Step, finished: boolean): LeafCounts {
  const leaves = leavesOf([step]);
  const states = leaves.map((leaf) => shownState(leaf, finished));
  return {
    done: states.filter((state) => state === StepState.Done).length,
    total: leaves.length,
    running: states.filter((state) => state === StepState.Active).length,
  };
}

/** A parent's second line: "X of Y sub-steps done · N running · note"; a leaf's is its note (null when none). */
export function secondLine(step: Step, finished: boolean, t: Translate): string | null {
  if (step.children.length === 0) return step.note;
  const counts = leafCounts(step, finished);
  const parts = [t("stepSubsDone", { done: counts.done, total: counts.total })];
  if (counts.running > 0) parts.push(t("stepsRunning", { n: counts.running }));
  if (step.note) parts.push(step.note);
  return parts.join(" · ");
}

export interface StepClock {
  finished: boolean;
  nowMs: number;
}

const since = (iso: string | null, endMs: number): number | null => (iso === null ? null : endMs - Date.parse(iso));

/** The right-hand state text: "Done · 8 min", "Running · 1 h 02 min", "Next" or "Later". `isNext` marks the first waiting step among its siblings. */
export function stateText(step: Step, clock: StepClock, isNext: boolean, t: Translate): string {
  const state = shownState(step, clock.finished);
  if (state === StepState.Pending) return t(isNext ? "stepNext" : "stepLater");
  if (state === StepState.Active) {
    const ran = since(step.started_at, clock.nowMs);
    return ran === null ? t("stepNow") : t("stepStateRunning", { dur: durationText(ran, t) });
  }
  const took = step.started_at && step.done_at ? Date.parse(step.done_at) - Date.parse(step.started_at) : null;
  return took === null ? t("stepDone") : t("stepStateDone", { dur: durationText(took, t) });
}

/** The open box's times line, as the mock words it. */
export function timesText(step: Step, clock: StepClock, t: Translate): string {
  const state = shownState(step, clock.finished);
  if (state === StepState.Pending) return t("stepNotStarted");
  if (!step.started_at) return t(state === StepState.Done ? "stepDone" : "stepNow");
  const start = clockTime(step.started_at);
  if (state === StepState.Active) {
    return t("stepTimesRunning", { start, dur: durationText(clock.nowMs - Date.parse(step.started_at), t) });
  }
  if (!step.done_at) return t("stepDone");
  const took = durationText(Date.parse(step.done_at) - Date.parse(step.started_at), t);
  return t("stepTimesDone", { start, end: clockTime(step.done_at), dur: took });
}
