import { type CostRef, type ModelTokens, type Step, type StepCost, type StepCostInput, StepState, TimeSource } from "./stepTypes";

/** How long a finished step's measured row is kept before the cron deletes it (owner, 2026-11-21; Slice 54). */
export const STEP_RUN_KEEP_DAYS = 180;

/** Models one step's cost may list; a report with more is cut at the front (the first ones win). */
export const MAX_COST_MODELS = 20;
export const MAX_COST_MODEL_NAME = 120;
const MAX_AGENT_ID = 80;
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;

/** The measured facts of one finished step for one agent, as stored in `step_runs` (Slice 54): nothing derived. */
export interface StepRun {
  item_key: string;
  step_id: string;
  /** '' for the main thread. */
  agent_id: string;
  /** The process the step belongs to (Slice 55); null until then. */
  process_key: string | null;
  models: ModelTokens[];
  started_at: string;
  ended_at: string;
  started_source: TimeSource;
  ended_source: TimeSource;
  peak_context: number;
  compactions: number;
  /** The session id of the plugin that computed the row: part of the row's key (Decision 10). */
  writer: string;
  /** The writer's counter; a report replaces the row only when its seq is greater (Decision 10). */
  seq: number;
  reported_at: string;
}

const MAX_WRITER = 120;

const clean = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The row a sent cost is stored as, by its agent and writer (the one normalisation the stored row and the step's reference share). */
export function costRefOf(cost: unknown): CostRef {
  const { writer, agent_id } = (typeof cost === "object" && cost !== null ? cost : {}) as Partial<StepCostInput>;
  return { writer: clean(writer, MAX_WRITER), agent_id: clean(agent_id, MAX_AGENT_ID) };
}

/** Whether an optional id of a cost is absent or a string within its limit (an invalid one drops the whole cost, never the report). */
function isIdWithin(value: unknown, max: number): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length <= max);
}

/** A stored or carried reference when it has the right shape, else null. */
export function validCostRef(value: unknown): CostRef | null {
  if (typeof value !== "object" || value === null) return null;
  const { writer, agent_id } = value as Record<string, unknown>;
  return typeof writer === "string" && typeof agent_id === "string" ? { writer, agent_id } : null;
}

/** The ISO time before which a step run is deleted: `now` less the keep period. */
export function stepRunCutoff(now: Date): string {
  return new Date(now.getTime() - STEP_RUN_KEEP_DAYS * MS_PER_DAY).toISOString();
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validModel(value: unknown): ModelTokens | null {
  if (typeof value !== "object" || value === null) return null;
  const { model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens } = value as Record<string, unknown>;
  const name = typeof model === "string" ? model.trim() : "";
  if (name.length < 1 || name.length > MAX_COST_MODEL_NAME) return null;
  if (![input_tokens, cache_read_tokens, cache_write_tokens, output_tokens].every(isCount)) return null;
  return { model: name, input_tokens: input_tokens as number, cache_read_tokens: cache_read_tokens as number, cache_write_tokens: cache_write_tokens as number, output_tokens: output_tokens as number };
}

/** The models of a cost with each model once (a repeat adds its tokens); null when none is valid. */
function validModels(value: unknown): ModelTokens[] | null {
  if (!Array.isArray(value)) return null;
  const byName = new Map<string, ModelTokens>();
  for (const entry of value.slice(0, MAX_COST_MODELS)) {
    const model = validModel(entry);
    if (model) byName.set(model.model, addModel(byName.get(model.model), model));
  }
  return byName.size > 0 ? [...byName.values()] : null;
}

function addModel(left: ModelTokens | undefined, right: ModelTokens): ModelTokens {
  if (!left) return right;
  return {
    model: right.model,
    input_tokens: left.input_tokens + right.input_tokens,
    cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
    cache_write_tokens: left.cache_write_tokens + right.cache_write_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
  };
}

/** Every step of a tree with its id, in order (stored steps have ids). */
function allSteps(steps: readonly Step[]): Step[] {
  return steps.flatMap((step) => [step, ...allSteps(step.children)]);
}

/**
 * The rows to store from a report: for each sent `cost` (`costs`: by the step's resolved id, collected by `normalizeSteps`,
 * so a step sent with a label only is included), the facts joined with the step as it was built (`built`, with its times
 * and their sources). A step that is not done, or has no times, or a cost that is malformed, stores nothing and never
 * refuses the report (like a bad time). One row per step, agent and writer.
 */
export function stepRunsOf(
  itemKey: string,
  costs: ReadonlyMap<string, unknown>,
  built: readonly Step[] | null | undefined,
  now: string,
): StepRun[] {
  if (costs.size === 0 || !built) return [];
  const byId = new Map(allSteps(built).map((step) => [step.id, step]));
  const runs = new Map<string, StepRun>();
  for (const [id, cost] of costs) {
    const run = runOf(itemKey, cost, byId.get(id), now);
    if (run) runs.set(`${run.step_id}\n${run.agent_id}\n${run.writer}`, run);
  }
  return [...runs.values()];
}

function runOf(itemKey: string, sent: unknown, step: Step | undefined, now: string): StepRun | null {
  if (!sent || typeof sent !== "object" || !step) return null;
  const cost = sent as StepCostInput;
  if (!isIdWithin(cost.writer, MAX_WRITER) || !isIdWithin(cost.agent_id, MAX_AGENT_ID)) return null;
  if (step.state !== StepState.Done || !step.started_at || !step.done_at || !step.started_source || !step.done_source) return null;
  const models = validModels(cost.models);
  if (!models || !isCount(cost.peak_context) || !isCount(cost.compactions)) return null;
  const seq = isCount(cost.seq) ? cost.seq : 0;
  const { writer, agent_id } = costRefOf(cost);
  return {
    item_key: itemKey,
    step_id: step.id,
    agent_id,
    writer,
    process_key: null,
    models,
    started_at: step.started_at,
    ended_at: step.done_at,
    started_source: step.started_source,
    ended_source: step.done_source,
    peak_context: cost.peak_context,
    compactions: cost.compactions,
    seq,
    reported_at: now,
  };
}

function sumModels(runs: readonly StepRun[]): ModelTokens[] {
  const byName = new Map<string, ModelTokens>();
  for (const run of runs) for (const model of run.models) byName.set(model.model, addModel(byName.get(model.model), model));
  return [...byName.values()];
}

/**
 * One step's cost from its stored rows (one per agent that ran it), worked out at read (Slice 54): models merged, tokens
 * summed by kind, the peak the largest of the rows, compactions summed, the time the earliest start to the latest end.
 */
export function costOfRuns(runs: readonly StepRun[]): StepCost | null {
  const first = runs[0];
  if (!first) return null;
  const models = sumModels(runs);
  const sum = (pick: (model: ModelTokens) => number): number => models.reduce((total, model) => total + pick(model), 0);
  const starts = [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const ends = [...runs].sort((a, b) => b.ended_at.localeCompare(a.ended_at));
  const started = starts[0]!;
  const ended = ends[0]!;
  const input = sum((model) => model.input_tokens);
  const read = sum((model) => model.cache_read_tokens);
  const write = sum((model) => model.cache_write_tokens);
  const output = sum((model) => model.output_tokens);
  return {
    models,
    input_tokens: input,
    cache_read_tokens: read,
    cache_write_tokens: write,
    output_tokens: output,
    total_tokens: input + read + write + output,
    peak_context: Math.max(...runs.map((run) => run.peak_context)),
    compactions: runs.reduce((total, run) => total + run.compactions, 0),
    duration_seconds: Math.max(0, Math.round((Date.parse(ended.ended_at) - Date.parse(started.started_at)) / MS_PER_SECOND)),
    started_source: started.started_source,
    ended_source: ended.ended_source,
  };
}

const rowKey = (stepId: string, ref: CostRef): string => `${stepId}\n${ref.agent_id}\n${ref.writer}`;

/**
 * Puts each done step's cost from `runs` (the rows of this item) on the steps of the tree, in place: exactly the row the step's
 * `cost_ref` names (Decision 7b), never one picked by time. A step that is not done, has no reference, or whose row is gone shows none.
 */
export function attachStepCosts(steps: Step[] | null | undefined, runs: readonly StepRun[]): void {
  if (!steps || runs.length === 0) return;
  const byKey = new Map(runs.map((run) => [rowKey(run.step_id, run), run]));
  for (const step of allSteps(steps)) {
    const ref = step.state === StepState.Done ? validCostRef(step.cost_ref) : null;
    const run = ref ? byKey.get(rowKey(step.id, ref)) : undefined;
    const cost = run ? costOfRuns([run]) : null;
    if (cost) step.cost = cost;
  }
}

/** Whether a cost is worth showing: both times came from a hook or the reporter, never the server's own clock (Slice 51 rule). */
export function isShownCost(cost: Pick<StepCost, "started_source" | "ended_source"> | null | undefined): boolean {
  return Boolean(cost) && cost!.started_source !== TimeSource.Stamped && cost!.ended_source !== TimeSource.Stamped;
}
