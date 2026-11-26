import type { BudgetsConfig, ProcessBudget } from "../config";
import { isShownCost } from "./stepRuns";
import { type Breach, BreachKind, type Step, type StepCost, StepState, TimeSource } from "./stepTypes";

const MS_PER_MINUTE = 60_000;

/** The limits that apply to a step: its process's own, when it has a process key the config names. */
function budgetOf(step: Step, budgets: BudgetsConfig): ProcessBudget {
  return step.process ? (budgets.processes[step.process] ?? {}) : {};
}

/**
 * How long a step ran, in ms: a running step from its start to the read time, but only on a live card (a crashed or stale
 * card's active step is not still running); a done step by its cost row's duration, else done_at minus started_at.
 */
function ranMsOf(step: Step, now: Date, live: boolean): number | null {
  if (step.state === StepState.Active) {
    if (!live || step.started_at === null) return null;
    return now.getTime() - Date.parse(step.started_at);
  }
  if (step.state !== StepState.Done) return null;
  const cost = shownCostOf(step);
  if (cost) return cost.duration_seconds * 1000;
  if (step.started_at === null || step.done_at === null) return null;
  if (step.started_source === TimeSource.Stamped || step.done_source === TimeSource.Stamped) return null;
  return Date.parse(step.done_at) - Date.parse(step.started_at);
}

/** The step's cost row only when its times are trusted (`isShownCost`); an untrusted row drives no breach. */
function shownCostOf(step: Step): StepCost | null {
  return step.cost && isShownCost(step.cost) ? step.cost : null;
}

/** A step's time breach: it has a minutes budget and ran longer than it (`used` is rounded up to whole minutes); a finished step keeps it. */
function timeBreach(step: Step, minutes: number | undefined, now: Date, live: boolean): Breach | null {
  if (minutes === undefined) return null;
  const ranMs = ranMsOf(step, now, live);
  if (ranMs === null || !(ranMs > minutes * MS_PER_MINUTE)) return null;
  const compacted = (shownCostOf(step)?.compactions ?? step.compactions ?? 0) > 0;
  return { kind: BreachKind.Time, used: Math.ceil(ranMs / MS_PER_MINUTE), budget: minutes, compacted };
}

/** A step with a cost row: over its peak-context budget (the process's, else the default), else over its tokens budget. */
function costBreach(step: Step, budget: ProcessBudget, budgets: BudgetsConfig): Breach | null {
  const cost = shownCostOf(step);
  if (!cost) return null;
  const compacted = cost.compactions > 0;
  const contextBudget = budget.peakContext ?? budgets.defaultPeakContext;
  if (cost.peak_context > contextBudget) return { kind: BreachKind.Context, used: cost.peak_context, budget: contextBudget, compacted };
  if (budget.tokens !== undefined && cost.total_tokens > budget.tokens) {
    return { kind: BreachKind.Tokens, used: cost.total_tokens, budget: budget.tokens, compacted };
  }
  return null;
}

/**
 * Whether one step is over its budget now (Slice 56), worked out at read from the step and the read time; never stored.
 * A running step is checked for time only on a live card (its cost is recorded when it finishes); a finished step keeps its
 * time breach (shown cost row's duration, else done_at minus started_at when neither time is stamped); a step with a shown
 * cost row is checked for peak context and tokens. One line per step: peak context, then tokens, then time (a running step
 * has only time). null when it is within its budgets.
 */
export function breachOf(step: Step, budgets: BudgetsConfig, now: Date, live = true): Breach | null {
  const budget = budgetOf(step, budgets);
  return costBreach(step, budget, budgets) ?? timeBreach(step, budget.minutes, now, live);
}

/** The steps with each one's breach set (a copy; the stored tree is not touched); a step within its budgets keeps no `breach` key. */
export function withBreaches(steps: Step[] | null | undefined, budgets: BudgetsConfig, now: Date, live: boolean): Step[] | null {
  if (!steps) return null;
  return steps.map((step) => {
    const breach = breachOf(step, budgets, now, live);
    const children = withBreaches(step.children, budgets, now, live) ?? [];
    return breach ? { ...step, children, breach } : { ...step, children };
  });
}
