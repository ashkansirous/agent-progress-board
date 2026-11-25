import {
  costedSourcesOf,
  DEFAULT_RUN_LIMIT,
  DEFAULT_WINDOW_DAYS,
  MAX_RUN_LIMIT,
  MAX_WINDOW_DAYS,
  MS_PER_DAY,
  type ProcessStat,
  processStatsOf,
  type RunRange,
  type RunRow,
  runRowsOf,
} from "../domain/processStats";
import { ISO_WITH_ZONE } from "../domain/steps";
import { DomainError } from "../domain/upsert";
import { withStepCosts, type Clock } from "./board";
import { type ItemRepository, PROCESS_COST_ITEM_LIMIT, PROCESS_ITEM_LIMIT } from "./ports";

export interface QueryRunsInput {
  project?: string;
  process?: string;
  /** ISO times with a zone; the window defaults to the last 30 days. */
  from?: string;
  to?: string;
  limit?: number;
}

export interface ProcessStatsInput {
  project?: string;
  window_days?: number;
}

/** What a process read returns: the rows, and a sentence (empty when the read was whole) saying what part of the data the rows leave out. */
export interface ProcessRead<T> {
  rows: T[];
  notice: string;
}

function parsedTime(field: string, text: string): number {
  const ms = ISO_WITH_ZONE.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(ms)) throw new DomainError(field, `field ${field}: needs an ISO date and time with a zone (for example 2026-11-25T12:00:00Z), got "${text}"`);
  return ms;
}

/** The window of a read: `from` and `to` as ISO UTC, `to` defaulting to now and `from` to 30 days before `to`. */
function rangeOf(input: Pick<QueryRunsInput, "from" | "to">, now: Date): RunRange {
  const to = input.to === undefined ? now.getTime() : parsedTime("to", input.to);
  const from = input.from === undefined ? to - DEFAULT_WINDOW_DAYS * MS_PER_DAY : parsedTime("from", input.from);
  if (from > to) throw new DomainError("from", "field from: is after to");
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/**
 * The finished steps in the range with their costs attached, newest first. The items come from the stored steps (at most
 * `PROCESS_ITEM_LIMIT`, the most recently updated first) and the costs are read only for the items that have a costed
 * step in the range (at most `PROCESS_COST_ITEM_LIMIT` of them); each limit that cuts the read is said in the notice.
 */
async function runsIn(repo: ItemRepository, range: RunRange, project: string | undefined): Promise<ProcessRead<RunRow>> {
  const page = await repo.stepListsSince({ project, since: range.from, limit: PROCESS_ITEM_LIMIT });
  const costed = costedSourcesOf(page.rows, range);
  await withStepCosts(repo, costed.slice(0, PROCESS_COST_ITEM_LIMIT));
  const notices = [
    page.cutAt === null ? "" : `partial: only the ${PROCESS_ITEM_LIMIT} most recently updated items were read, down to updates at ${page.cutAt}; steps of older items are missing (use a later from)`,
    costed.length > PROCESS_COST_ITEM_LIMIT ? `costs were read for the ${PROCESS_COST_ITEM_LIMIT} most recently updated of ${costed.length} items with a cost; the other runs show no cost` : "",
  ];
  return { rows: runRowsOf(page.rows, range), notice: notices.filter(Boolean).join("; ") };
}

/** `query_runs`: the finished steps in a window with their cost and counts, optionally one project's and one process key's (any case), newest first. */
export async function queryRuns(repo: ItemRepository, input: QueryRunsInput, clock: Clock): Promise<ProcessRead<RunRow>> {
  const read = await runsIn(repo, rangeOf(input, clock.now()), input.project);
  const wanted = input.process?.trim().toLowerCase();
  const limit = Math.min(input.limit ?? DEFAULT_RUN_LIMIT, MAX_RUN_LIMIT);
  return { rows: (wanted ? read.rows.filter((row) => row.process === wanted) : read.rows).slice(0, limit), notice: read.notice };
}

/** `process_stats`: per process key the runs, the median and p90 time, tokens and peak context over the last `window_days` (default 30). */
export async function processStats(repo: ItemRepository, input: ProcessStatsInput, clock: Clock): Promise<ProcessRead<ProcessStat>> {
  const now = clock.now();
  const days = Math.min(input.window_days ?? DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS);
  const range = { from: new Date(now.getTime() - days * MS_PER_DAY).toISOString(), to: now.toISOString() };
  const read = await runsIn(repo, range, input.project);
  return { rows: processStatsOf(read.rows), notice: read.notice };
}
