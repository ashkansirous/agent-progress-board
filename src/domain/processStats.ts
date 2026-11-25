import { isShownCost } from "./stepRuns";
import { type Step, type StepCost, StepState, TimeSource } from "./stepTypes";

/** The default and the largest stats window; the measured rows are kept 180 days (`STEP_RUN_KEEP_DAYS`), so a longer one would read thin data. */
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 180;
export const MS_PER_DAY = 86_400_000;
/** The longest `process` filter: a derived key is an agent type (at most 100 characters), "/" and a label (at most 80), which is longer than a reported key. */
export const MAX_PROCESS_FILTER = 200;
/** Rows `query_runs` returns by default and at most. */
export const DEFAULT_RUN_LIMIT = 200;
export const MAX_RUN_LIMIT = 1000;
const MS_PER_SECOND = 1000;
const P90 = 0.9;
/** Joins the agent type and the label of a step with no process key. */
const GROUP_SEPARATOR = "/";
const UNKNOWN_AGENT = "unknown";

/** Where a run's key came from: the step reported it, or the server grouped the step by its agent type and label (Slice 55 Decision 1). */
export enum ProcessSource {
  Reported = "reported",
  Derived = "derived",
}

/** The steps of one item as the stats read them: the stored tree with each done step's cost attached. */
export interface RunSource {
  key: string;
  project: string;
  /** The item's agent type (a session card's agent), null when it has none. */
  agent: string | null;
  steps: Step[];
}

/** One finished step as `query_runs` returns it. */
export interface RunRow {
  item_key: string;
  project: string;
  step_id: string;
  label: string;
  process: string;
  process_source: ProcessSource;
  started_at: string | null;
  done_at: string;
  /** Seconds the step took; null when no time of it came from a hook or the reporter (a stamped time is a guess). */
  duration_seconds: number | null;
  counts: Record<string, number> | null;
  cost: StepCost | null;
}

/** A time window, ISO bounds both inclusive. */
export interface RunRange {
  from: string;
  to: string;
}

/** The statistics of one process key over a window. A figure with no run to take it from is null, never 0. */
export interface ProcessStat {
  process: string;
  process_source: ProcessSource;
  runs: number;
  /** Runs that have a duration; the time figures are over these. */
  timed_runs: number;
  median_seconds: number | null;
  p90_seconds: number | null;
  /** Runs that have a measured cost; the token and context figures are over these. */
  costed_runs: number;
  median_tokens: number | null;
  p90_tokens: number | null;
  median_peak_context: number | null;
  p90_peak_context: number | null;
  /** Each named count summed over the runs that sent it. */
  counts: Record<string, number>;
}

/** The key a step is grouped under: its own process key, else its item's agent type and its label (Slice 55 Decision 1). */
export function processKeyOf(step: Step, agent: string | null): { process: string; source: ProcessSource } {
  if (step.process) return { process: step.process, source: ProcessSource.Reported };
  const type = agent?.trim() || UNKNOWN_AGENT;
  return { process: `${type.toLowerCase()}${GROUP_SEPARATOR}${step.label.trim().toLowerCase()}`, source: ProcessSource.Derived };
}

/**
 * The finished steps that count as runs, in tree order. The one rule: a done step with a time is a run when it carries a
 * process key, or when it has no sub-steps and no ancestor carries a key (a parent without a key only repeats its
 * children's time; the children of a keyed parent are inside the parent's run, so they are not counted again). A keyed
 * child under a keyed parent is a run of its own kind. Mirrored task and agent rows follow the same rule.
 */
export function runStepsOf(level: readonly Step[], underKey = false): Step[] {
  return level.flatMap((step) => {
    const counts = step.state === StepState.Done && Boolean(step.done_at) && (Boolean(step.process) || (step.children.length === 0 && !underKey));
    return [...(counts ? [step] : []), ...runStepsOf(step.children, underKey || Boolean(step.process))];
  });
}

/** Seconds from a step's start to its end, only when both times were seen or reported; the measured cost's own duration when it has one. */
function durationOf(step: Step): number | null {
  if (step.cost && isShownCost(step.cost)) return step.cost.duration_seconds;
  if (!step.started_at || !step.done_at) return null;
  if (step.started_source === TimeSource.Stamped || step.done_source === TimeSource.Stamped) return null;
  return Math.max(0, Math.round((Date.parse(step.done_at) - Date.parse(step.started_at)) / MS_PER_SECOND));
}

function inRange(at: string, range: RunRange): boolean {
  return at >= range.from && at <= range.to;
}

/** The finished steps of the items that ended inside the range, newest first. */
export function runRowsOf(sources: readonly RunSource[], range: RunRange): RunRow[] {
  const rows = sources.flatMap((source) =>
    runStepsOf(source.steps)
      .filter((step) => inRange(step.done_at!, range))
      .map((step): RunRow => {
        const { process, source: processSource } = processKeyOf(step, source.agent);
        return {
          item_key: source.key,
          project: source.project,
          step_id: step.id,
          label: step.label,
          process,
          process_source: processSource,
          started_at: step.started_at,
          done_at: step.done_at!,
          duration_seconds: durationOf(step),
          counts: step.counts ?? null,
          cost: step.cost ?? null,
        };
      }),
  );
  return rows.sort((left, right) => right.done_at.localeCompare(left.done_at) || left.item_key.localeCompare(right.item_key) || left.step_id.localeCompare(right.step_id));
}

/** The middle of the values (the mean of the two middle ones when their number is even); null for none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The 90th percentile by nearest rank (the smallest value with at least 90% of the values at or below it); null for none. */
export function p90Of(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(P90 * sorted.length) - 1]!;
}

function numbersOf(rows: readonly RunRow[], pick: (row: RunRow) => number | null | undefined): number[] {
  return rows.flatMap((row) => {
    const value = pick(row);
    return value === null || value === undefined ? [] : [value];
  });
}

function summedCounts(rows: readonly RunRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) for (const [name, value] of Object.entries(row.counts ?? {})) totals[name] = (totals[name] ?? 0) + value;
  return totals;
}

function statOf(process: string, rows: readonly RunRow[]): ProcessStat {
  const seconds = numbersOf(rows, (row) => row.duration_seconds);
  const tokens = numbersOf(rows, (row) => row.cost?.total_tokens);
  const context = numbersOf(rows, (row) => row.cost?.peak_context);
  return {
    process,
    process_source: rows[0]!.process_source,
    runs: rows.length,
    timed_runs: seconds.length,
    median_seconds: medianOf(seconds),
    p90_seconds: p90Of(seconds),
    costed_runs: tokens.length,
    median_tokens: medianOf(tokens),
    p90_tokens: p90Of(tokens),
    median_peak_context: medianOf(context),
    p90_peak_context: p90Of(context),
    counts: summedCounts(rows),
  };
}

/** The statistics per process key and key source (a reported key and a derived one with the same text stay apart), the most runs first (ties by key, then source). */
export function processStatsOf(rows: readonly RunRow[]): ProcessStat[] {
  const groups = new Map<string, RunRow[]>();
  for (const row of rows) {
    const id = `${row.process_source}:${row.process}`;
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.values()]
    .map((group) => statOf(group[0]!.process, group))
    .sort((left, right) => right.runs - left.runs || left.process.localeCompare(right.process) || left.process_source.localeCompare(right.process_source));
}

/** Keeps only the sources that have a run in the range and a step with a cost reference to look up. */
export function costedSourcesOf<T extends RunSource>(sources: readonly T[], range: RunRange): T[] {
  return sources.filter((source) => runStepsOf(source.steps).some((step) => Boolean(step.cost_ref) && inRange(step.done_at!, range)));
}
