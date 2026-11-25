import { ItemStatus } from "./item";
import { DomainError } from "./errors";
import { type ExpiryRow, isHeartbeatExpired } from "./stale";
import { costRefOf, validCostRef } from "./stepRuns";
import { type CostRef, leavesOf, ownerBlockedSteps, type Step, type StepInput, type StepProgress, StepState, TimeSource, WaitsOn } from "./stepTypes";

/** Steps in the whole tree, parents and leaves together (Slice 39). */
export const MAX_STEPS = 200;
/** Levels of the tree: a flat list is depth 1. */
export const MAX_STEP_DEPTH = 4;
export const MAX_STEP_LABEL = 80;
export const MAX_STEP_NOTE = 120;
export const MAX_STEP_ID = 80;
export const MAX_STEP_LINK = 500;
/** Largest compaction count a step may carry. */
export const MAX_STEP_COMPACTIONS = 1000;
const HTTP_PROTOCOLS = ["http:", "https:"];
/** How far ahead of the server's clock a reported time may be (clock skew between the reporter and the Worker). */
export const REPORTED_TIME_SKEW_MS = 60_000;
const PERCENT = 100;
/** A card with an open check never reads 100%. */
const MAX_PERCENT_WITH_OPEN_CHECK = 99;
const ID_SEPARATOR = "/";

function fail(message: string): never {
  throw new DomainError("steps", `field steps: ${message}`);
}

function checkStep(step: StepInput, at: string): void {
  if (step.label.trim().length < 1 || step.label.trim().length > MAX_STEP_LABEL) {
    fail(`${at} label needs 1 to ${MAX_STEP_LABEL} characters`);
  }
  if ((step.note ?? "").trim().length > MAX_STEP_NOTE) fail(`${at} note needs at most ${MAX_STEP_NOTE} characters`);
  if (!Object.values(StepState).includes(step.state)) fail(`${at} state must be done, active, pending or blocked`);
  if (step.id !== undefined && (step.id.trim().length < 1 || step.id.trim().length > MAX_STEP_ID)) {
    fail(`${at} id needs 1 to ${MAX_STEP_ID} characters`);
  }
  checkBlocked(step, at);
}

/** A blocked step says what it waits on (its note). A bad `waits_on` or `link` never refuses the report: `buildStep` drops it. */
function checkBlocked(step: StepInput, at: string): void {
  if (step.state === StepState.Blocked && (step.note ?? "").trim().length < 1) fail(`${at} is blocked: its note must say what it waits on`);
}

function validWaitsOn(value: string | null | undefined): WaitsOn | null {
  return Object.values(WaitsOn).find((known) => known === value) ?? null;
}

/** A blocked step's link as stored: a well-formed http(s) URL within the length limit, else none (dropped, never refused). */
function validLink(value: string | null | undefined): string | null {
  const link = value?.trim() ?? "";
  return link.length > 0 && link.length <= MAX_STEP_LINK && isHttpUrl(link) ? link : null;
}

function isHttpUrl(value: string): boolean {
  try {
    return HTTP_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Counts the steps of the sent tree and refuses one over the step or depth limits, one pass that stops at the
 * first step past a limit, before any text check or id is built (id building is quadratic in same-label siblings).
 */
function checkSize(steps: readonly StepInput[]): void {
  let count = 0;
  let total = 0;
  // Mirrored task rows are fitted after the merge (`fitMirroredRows`), so they count only against a cost bound here.
  const walk = (level: readonly StepInput[], depth: number, inTask: boolean): void => {
    if (depth > MAX_STEP_DEPTH && !inTask) fail(`at most ${MAX_STEP_DEPTH} levels of sub-steps`);
    total += level.length;
    if (total > MAX_STEPS * 2) fail(`at most ${MAX_STEPS} steps in all`);
    level.forEach((step) => {
      const task = inTask || isTaskRow(step.id);
      if (!task) count += 1;
      if (count > MAX_STEPS) fail(`at most ${MAX_STEPS} steps in all`);
      if (step.children && step.children.length > 0) walk(step.children, depth + 1, task);
    });
  };
  walk(steps, 1, false);
}

/** Checks every step of the given tree (texts, states, ids) before anything is built; `path` is "3.2" style. */
function checkInputs(steps: readonly StepInput[], path: string): void {
  steps.forEach((step, index) => {
    const at = `step ${path}${index + 1}`;
    checkStep(step, at);
    if (step.children) checkInputs(step.children, `${path}${index + 1}.`);
  });
}

/** What a report may carry over from the stored list: the stored tree and the time of this report. */
export interface StampContext {
  previous?: readonly Step[] | null;
  now?: string | null;
  /** Filled while building: the `cost` each sent step carried, by the step's resolved id (a step sent without an id included; Slice 54). */
  costs?: Map<string, unknown>;
}

interface BuildContext {
  /** Where the costs the sent steps carry are collected, by resolved id. */
  costs?: Map<string, unknown>;
  /** The ids the report gives explicitly, anywhere in its tree. */
  explicit: ReadonlySet<string>;
  stamp: (input: StepInput, id: string, state: StepState) => TimeFields;
  kept: (id: string) => Step | undefined;
}

function flatten(steps: readonly Step[]): Step[] {
  return steps.flatMap((step) => [step, ...flatten(step.children)]);
}

const HASH_RADIX = 36;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HASH_MARK = "~";

/** A short stable hash (FNV-1a, base 36) of the text, to keep a long generated id inside the id limit. */
function shortHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  return hash.toString(HASH_RADIX);
}

/** The id itself when it fits `MAX_STEP_ID`, else its head plus "~" and a hash of the whole, so the id stays sendable. */
function withinLimit(id: string): string {
  if (id.length <= MAX_STEP_ID) return id;
  const tail = `${HASH_MARK}${shortHash(id)}`;
  return `${id.slice(0, MAX_STEP_ID - tail.length)}${tail}`;
}

/**
 * The step id prefix of a task the plugin's hooks mirror (Slice 53). Only a hook report writes rows with it
 * (`keepMirroredRows`, `hookStepsInput`), and `generatedId` never makes an id that starts with it. The plugin holds
 * the same text (`TASK_ID_PREFIX` in background-agents.mjs); `test/taskSteps.test.ts` holds the two equal.
 */
export const TASK_ROW_PREFIX = "mirror-task:";

function isTaskRow(id: string | undefined): boolean {
  return id !== undefined && id.trim().startsWith(TASK_ROW_PREFIX);
}

/** An id made from the label path (at most `MAX_STEP_ID` characters), made unique with "#2", "#3" ... when taken. */
function generatedId(parentId: string | null, label: string, used: Set<string>): string {
  const path = parentId === null ? label : `${parentId}${ID_SEPARATOR}${label}`;
  const base = path.startsWith(TASK_ROW_PREFIX) ? `#${path}` : path;
  let id = withinLimit(base);
  for (let n = 2; used.has(id); n += 1) id = withinLimit(`${base}#${n}`);
  return id;
}

/** Every step of the tree finished; a level whose `children` are left out stays left out (its stored ones are finished when built). */
function asDone(steps: readonly StepInput[]): StepInput[] {
  // A mirrored task row keeps its own state: only a hook report changes it (Slice 53 rule 9).
  return steps.map((step) => (isTaskRow(step.id) ? step : { ...step, state: StepState.Done, children: step.children === undefined ? undefined : asDone(step.children) }));
}

/** The stored children a step whose report left `children` out keeps: the stored ones the report does not place by id. */
function storedKept(previous: Step | undefined, explicit: ReadonlySet<string>): Step[] {
  return previous ? withoutExplicit(previous.children, explicit) : [];
}

/**
 * The stored children of a step whose report left `children` out. A parent reported done finishes them
 * too, like children it sent itself, so no leaf is left running under a done parent (progress counts leaves).
 */
function keptChildren(previous: Step | undefined, state: StepState, ctx: BuildContext): Step[] {
  const kept = storedKept(previous, ctx.explicit);
  return state === StepState.Done ? buildSteps(asDone(kept), ctx) : kept;
}

/** Stored steps the report names itself by id are the report's to place (a flat resend moved them), so the kept copy is dropped. */
function withoutExplicit(steps: readonly Step[], explicit: ReadonlySet<string>): Step[] {
  return steps.filter((step) => !explicit.has(step.id)).map((step) => ({ ...step, children: withoutExplicit(step.children, explicit) }));
}

/** Builds one step whose id is already settled by `resolveIds`. A done parent finishes every descendant, sent or kept. */
function buildStep(input: StepInput, ctx: BuildContext): Step {
  const id = input.id!.trim();
  if (input.cost && ctx.costs) ctx.costs.set(id, input.cost);
  const sent = input.children !== undefined && input.state === StepState.Done ? asDone(input.children) : input.children;
  const children = sent === undefined ? keptChildren(ctx.kept(id), input.state, ctx) : buildSteps(sent, ctx);
  const blocked = input.state === StepState.Blocked;
  const waitsOn = blocked ? (validWaitsOn(input.waits_on) ?? WaitsOn.Work) : null;
  const link = blocked ? validLink(input.link) : null;
  const compactions = keptCompactions(input.compactions, ctx.kept(id)?.compactions);
  const costRef = costRefOfStep(input, ctx.kept(id));
  return { id, label: input.label.trim(), state: input.state, note: input.note?.trim() || null, ...ctx.stamp(input, id, input.state), waits_on: waitsOn, link, compactions, ...(costRef ? { cost_ref: costRef } : {}), children };
}

/**
 * The cost row a step shows after a report (Slice 54 Decision 7b): none unless it is done; a done step sent with a cost shows that
 * cost's row; else it keeps the reference it already had while it stays done (the stored step, or the one a server merge carried on
 * the input), so a step reopened and finished again shows nothing until a new cost arrives.
 */
function costRefOfStep(input: StepInput, stored: Step | undefined): CostRef | null {
  if (input.state !== StepState.Done) return null;
  if (input.cost) return costRefOf(input.cost);
  const carried = validCostRef(input.cost_ref);
  if (carried) return carried;
  return stored?.state === StepState.Done ? validCostRef(stored.cost_ref) : null;
}

/** The compaction count after a report: the larger of the sent and stored counts (a count only grows), clamped to a whole number in range. */
function keptCompactions(given: number | null | undefined, stored: number | undefined): number {
  const whole = (value: number | null | undefined): number => (Number.isFinite(value) ? Math.min(MAX_STEP_COMPACTIONS, Math.max(0, Math.trunc(value as number))) : 0);
  return Math.max(whole(given), whole(stored));
}

function buildSteps(inputs: readonly StepInput[], ctx: BuildContext): Step[] {
  return inputs.map((input) => buildStep(input, ctx));
}

/** The tree with an id on every step: the explicit one, else one made from the label path that no id in `taken` has. Walks in order. */
function placeIds(inputs: readonly StepInput[], parentId: string | null, taken: Set<string>): StepInput[] {
  return inputs.map((input) => {
    const given = input.id?.trim();
    const id = given || generatedId(parentId, input.label.trim(), taken);
    taken.add(id);
    return { ...input, id, children: input.children === undefined ? undefined : placeIds(input.children, id, taken) };
  });
}

/** The ids of the stored children the placed tree keeps (steps that leave `children` out). */
function keptIds(placed: readonly StepInput[], ctx: BuildContext): string[] {
  return placed.flatMap((input) =>
    input.children === undefined
      ? flatten(storedKept(ctx.kept(input.id!), ctx.explicit)).map((step) => step.id)
      : keptIds(input.children, ctx),
  );
}

/**
 * Ids in two passes, so the result never depends on sibling order. Pass 1 collects every explicit id in the
 * whole tree and the ids of every stored child that is kept (not moved by an explicit id). Pass 2 generates
 * ids for the rest, avoiding all of those. A kept id is only known once its parent's id is, so pass 2 repeats
 * with the kept ids found so far reserved until no new one appears (each round only adds, so it ends).
 */
function resolveIds(inputs: readonly StepInput[], ctx: BuildContext): StepInput[] {
  const reserved = new Set(ctx.explicit);
  for (;;) {
    const placed = placeIds(inputs, null, new Set(reserved));
    const fresh = keptIds(placed, ctx).filter((id) => !reserved.has(id));
    if (fresh.length === 0) return placed;
    fresh.forEach((id) => reserved.add(id));
  }
}

function explicitIds(steps: readonly StepInput[]): string[] {
  return steps.flatMap((step) => [...(step.id?.trim() ? [step.id.trim()] : []), ...explicitIds(step.children ?? [])]);
}

function deepest(level: readonly Step[], depth: number): number {
  return Math.max(depth, ...level.map((step) => deepest(step.children, depth + 1)));
}

function checkTree(steps: readonly Step[]): void {
  const all = flatten(steps);
  if (all.length > MAX_STEPS) fail(`at most ${MAX_STEPS} steps in all, got ${all.length}`);
  if (new Set(all.map((step) => step.id)).size !== all.length) fail("step ids must be unique in the whole list");
  if (deepest(steps, 0) > MAX_STEP_DEPTH) fail(`at most ${MAX_STEP_DEPTH} levels of sub-steps`);
}

function fitsLimits(steps: readonly Step[]): boolean {
  return flatten(steps).length <= MAX_STEPS && deepest(steps, 0) <= MAX_STEP_DEPTH;
}

/** When finished, a task row's done time; a row not finished sorts after every finished one. */
function finishedAt(row: Step): number {
  return row.state === StepState.Done ? Date.parse(row.done_at ?? "") || 0 : Number.MAX_SAFE_INTEGER;
}

/**
 * Slice 53 rule 8, the one place the mirrored task rows are cut to fit: only when the final tree (every kept row in it)
 * is over the step or depth limit, drops mirrored task rows, finished ones first and oldest first, in place, until it
 * fits. A tree still over with none left is the report's own rows, which `checkTree` refuses.
 */
function fitMirroredRows(tree: Step[]): void {
  if (fitsLimits(tree)) return;
  const rows: { level: Step[]; row: Step }[] = [];
  const gather = (level: Step[]): void => {
    level.forEach((step) => {
      if (isTaskRow(step.id)) rows.push({ level, row: step });
      else gather(step.children);
    });
  };
  gather(tree);
  rows.sort((left, right) => finishedAt(left.row) - finishedAt(right.row));
  for (const { level, row } of rows) {
    if (fitsLimits(tree)) return;
    level.splice(level.indexOf(row), 1);
  }
}

/** The four time fields of a stored step. */
type TimeFields = Pick<Step, "started_at" | "done_at" | "started_source" | "done_source">;

interface TimeValue {
  at: string;
  source: TimeSource;
}

const SOURCE_RANK: Record<TimeSource, number> = { [TimeSource.Observed]: 3, [TimeSource.Reported]: 2, [TimeSource.Stamped]: 1 };

/**
 * The one precedence rule for a step time (Slice 51): a later report replaces the stored time only with one from a
 * source at least as good (observed, then reported, then stamped); an observed time is never replaced by a reported or
 * stamped one. The same time again keeps the stored source (a client echoing what it read back must not upgrade a guess),
 * except that an explicit `observed` upgrades it.
 */
export function betterTime(stored: TimeValue | null, given: TimeValue | null): TimeValue | null {
  if (!given) return stored;
  if (!stored) return given;
  if (given.at === stored.at) return given.source === TimeSource.Observed ? given : stored;
  return SOURCE_RANK[given.source] >= SOURCE_RANK[stored.source] ? given : stored;
}

function storedTime(at: string | null | undefined, source: TimeSource | null | undefined): TimeValue | null {
  return at ? { at, source: source ?? TimeSource.Stamped } : null;
}

/** An ISO-8601 date and time with a zone ("Z" or an offset); anything else (a bare number, a date without a zone) is not a reported time. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * A time a report sent, as ISO. A source of `stamped` (an echo of a guess) is no report; one that is unparsable or
 * ahead of the server's clock (by more than `REPORTED_TIME_SKEW_MS`) is dropped, so that end is stamped by the server
 * and the rest of the report is kept (a bad time never refuses a steps report).
 */
function givenTime(at: string | null | undefined, source: TimeSource | null | undefined, now: string | null): TimeValue | null {
  if (!at || source === TimeSource.Stamped) return null;
  const ms = ISO_WITH_ZONE.test(at) ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(ms) || (now !== null && ms > Date.parse(now) + REPORTED_TIME_SKEW_MS)) return null;
  return { at: new Date(ms).toISOString(), source: source === TimeSource.Observed ? TimeSource.Observed : TimeSource.Reported };
}

function stampedNow(now: string | null): TimeValue | null {
  return now === null ? null : { at: now, source: TimeSource.Stamped };
}

/**
 * The start must not be after the end, and a report is never refused for it: a guessed start moves back to the end;
 * otherwise the end is the offending time and is stamped by the server (the report's time, no earlier than the start).
 */
function orderedTimes(start: TimeValue | null, end: TimeValue | null, now: string | null): { start: TimeValue | null; end: TimeValue | null } {
  if (!start || !end || start.at <= end.at) return { start, end };
  if (start.source === TimeSource.Stamped) return { start: { at: end.at, source: TimeSource.Stamped }, end };
  const stampedAt = now !== null && now >= start.at ? now : start.at;
  return { start, end: { at: stampedAt, source: TimeSource.Stamped } };
}

/**
 * The times of a step after a report. Start: kept while the step stays started, else a reported one, else the
 * report's time. End: only for a done step; kept while it stays done. A given time wins by `betterTime`.
 */
function resolveTimes(input: StepInput, id: string, state: StepState, before: Step | undefined, now: string | null): TimeFields {
  const none: TimeFields = { started_at: null, done_at: null, started_source: null, done_source: null };
  if (state === StepState.Pending) return none;
  const start = betterTime(storedTime(before?.started_at, before?.started_source), givenTime(input.started_at, input.started_source, now)) ?? stampedNow(now);
  const keptEnd = before?.state === StepState.Done ? storedTime(before.done_at, before.done_source) : null;
  const end = state === StepState.Done ? (betterTime(keptEnd, givenTime(input.done_at, input.done_source, now)) ?? stampedNow(now)) : null;
  const ordered = orderedTimes(start, end, now);
  return {
    started_at: ordered.start?.at ?? null,
    done_at: ordered.end?.at ?? null,
    started_source: ordered.start?.source ?? null,
    done_source: ordered.end?.source ?? null,
  };
}

/** The times of a step after a report, from the stored tree by id and the report's own times (`resolveTimes`). */
function stampFrom(context: StampContext): BuildContext["stamp"] {
  const stored = new Map(flatten(context.previous ?? []).map((step) => [step.id, step]));
  const now = context.now ?? null;
  return (input, id, state) => resolveTimes(input, id, state, stored.get(id), now);
}

/**
 * The tree to store: validated (at most 200 steps in all, 4 levels, labels 1 to 80 characters, notes
 * 0 to 120) with notes, ids and stamps made explicit. Empty or null is no list. The whole list is the
 * newest report's; a step that leaves `children` out keeps the stored children of the step with its id.
 * `started_at` and `done_at` are kept by id from `previous` and stamped with `now` on a change of state.
 */
export function normalizeSteps(steps: StepInput[] | null | undefined, context: StampContext = {}): Step[] | null {
  if (steps === null || steps === undefined || steps.length === 0) return null;
  checkSize(steps);
  checkInputs(steps, "");
  const stored = new Map(flatten(context.previous ?? []).map((step) => [step.id, step]));
  const explicit = new Set(explicitIds(steps));
  const ctx: BuildContext = { explicit, stamp: stampFrom(context), kept: (id) => stored.get(id), costs: context.costs };
  const built = buildSteps(resolveIds(steps, ctx), ctx);
  fitMirroredRows(built);
  checkTree(built);
  return built;
}

/** The ids in the tree, in order, for a refusal that lists them. */
export function stepIds(steps: readonly Step[] | null | undefined): string[] {
  return flatten(steps ?? []).map((step) => step.id);
}

/**
 * The stored list with the children of step `id` replaced by `given` (an empty list or null clears them),
 * as input for `normalizeSteps`. An unknown id is refused with the ids that exist.
 */
export function replaceChildren(stored: readonly Step[] | null | undefined, id: string, given: StepInput[] | null): StepInput[] {
  const known = stepIds(stored);
  if (!known.includes(id)) {
    const list = known.length ? known.join(", ") : "none (the task has no steps)";
    throw new DomainError("under_step", `field under_step: "${id}" is not a step of this task; known ids: ${list}`);
  }
  const walk = (level: readonly Step[]): StepInput[] =>
    level.map((step) => ({ ...step, children: step.id === id ? (given ?? []) : walk(step.children) }));
  return walk(stored ?? []);
}

/** The step id prefix of an agent's row; the plugin's hooks own only rows with it (`agentRowId` in the plugin). */
export const AGENT_ROW_PREFIX = "agent-";
/** The report `source` of the plugin's hooks. */
export const HOOK_SOURCE = "hook";

function isAgentRow(id: string | undefined): boolean {
  return id !== undefined && id.trim().startsWith(AGENT_ROW_PREFIX);
}

function sameStep(sent: StepInput, stored: Step): boolean {
  const id = sent.id?.trim();
  return id ? id === stored.id : sent.label.trim() === stored.label;
}

function isHookOwned(id: string | undefined): boolean {
  return isAgentRow(id) || isTaskRow(id);
}

/** One step a hook sent: its session-owned children are the ones sent, else the stored ones as stored; its agent and task rows are the ones sent. */
function hookStep(sent: StepInput, match: Step | undefined): StepInput {
  const given = sent.children ?? [];
  const givenOwn = given.filter((child) => !isHookOwned(child.id));
  const own: StepInput[] = givenOwn.length > 0 ? hookLevel(match?.children ?? [], givenOwn) : (match?.children ?? []).filter((child) => !isHookOwned(child.id));
  const rows = given.filter((child) => isAgentRow(child.id)).map((row) => hookAgentRow(row, (match?.children ?? []).find((candidate) => sameStep(row, candidate))));
  return { ...sent, children: [...own, ...rows, ...given.filter((child) => isTaskRow(child.id))] };
}

/** One level of a hook report: only the steps sent, the session's own first in order, then the agent rows and the task rows sent. */
function hookLevel(stored: readonly Step[], sent: readonly StepInput[]): StepInput[] {
  const own = sent.filter((step) => !isHookOwned(step.id)).map((step) => hookStep(step, stored.find((candidate) => sameStep(step, candidate))));
  const rows = sent.filter((step) => isAgentRow(step.id)).map((row) => hookAgentRow(row, stored.find((candidate) => sameStep(row, candidate))));
  return [...own, ...rows, ...sent.filter((step) => isTaskRow(step.id))];
}

/** An agent row from a hook: the helper's own stored children stay, whatever their ids; its task rows are exactly the ones sent (none clears them). */
function hookAgentRow(row: StepInput, match: Step | undefined): StepInput {
  const helperOwn = (match?.children ?? []).filter((child) => !isTaskRow(child.id));
  return { ...row, children: [...helperOwn, ...(row.children ?? []).filter((child) => isTaskRow(child.id))] };
}

/** The stored task rows of a level, in their order. */
function storedTaskRows(stored: readonly Step[]): StepInput[] {
  return stored.filter((step) => isTaskRow(step.id));
}

/** One step of a report that is not a hook's: its task rows are dropped, and the stored ones of the same step follow the rows it sends. */
function keepMirroredStep(sent: StepInput, match: Step | undefined): StepInput {
  if (sent.children === undefined) return sent; // the stored children, task rows with them, are kept as stored
  return { ...sent, children: keepMirroredLevel(match?.children ?? [], sent.children) };
}

function keepMirroredLevel(stored: readonly Step[], sent: readonly StepInput[]): StepInput[] {
  const own = sent.filter((step) => !isTaskRow(step.id)).map((step) => keepMirroredStep(step, stored.find((candidate) => sameStep(step, candidate))));
  return [...own, ...storedTaskRows(stored)];
}

/**
 * The list a report that is not a hook's stands for (Slice 53 rule 2): it cannot add, change or drop the mirrored task rows.
 * Rows it sends with their prefix are dropped, and the stored ones stay under the same parent after the rows it sends.
 */
export function keepMirroredRows(stored: readonly Step[] | null | undefined, sent: StepInput[]): StepInput[] {
  return keepMirroredLevel(stored ?? [], sent);
}

/**
 * The list a report from the plugin's hooks stands for (Slice 51 G): the whole list, so a stored step it does not
 * send is dropped. For each step it sends, the non-agent children are the ones it sent if any, else the stored ones;
 * its agent rows are exactly the ones it sent.
 */
export function hookStepsInput(stored: readonly Step[] | null | undefined, sent: StepInput[]): StepInput[] {
  return hookLevel(stored ?? [], sent);
}

/** An optional free-text field: whitespace-only reads as absent. */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A stored step as written by any version: the id, stamps and children may be missing (a flat list from before Slice 39). */
interface StoredStep extends StepInput {
  started_at?: string | null;
  done_at?: string | null;
  children?: StoredStep[];
}

function isStoredStep(value: unknown): value is StoredStep {
  if (typeof value !== "object" || value === null) return false;
  const { label, state, note, id, children, started_at, done_at } = value as Record<string, unknown>;
  const stateOk = Object.values(StepState).includes(state as StepState);
  const timeOk = (time: unknown): boolean => time === undefined || time === null || typeof time === "string";
  const childrenOk = children === undefined || (Array.isArray(children) && children.every(isStoredStep));
  const idOk = id === undefined || typeof id === "string";
  const { waits_on, link } = value as Record<string, unknown>;
  const waitsOk = waits_on === undefined || waits_on === null || Object.values(WaitsOn).includes(waits_on as WaitsOn);
  const linkOk = link === undefined || link === null || typeof link === "string";
  const { compactions } = value as Record<string, unknown>;
  const compactionsOk = compactions === undefined || compactions === null || typeof compactions === "number";
  return compactionsOk && typeof label === "string" && stateOk && (note === undefined || note === null || typeof note === "string") && idOk && timeOk(started_at) && timeOk(done_at) && waitsOk && linkOk && childrenOk;
}

/** A stored list this much over the write limit is not read: a legacy row cannot make every board read build thousands of steps (Slice 47 2b). */
export const STORED_STEPS_READ_MAX = MAX_STEPS * 5;

function countStored(steps: readonly StoredStep[]): number {
  return steps.reduce((sum, step) => sum + 1 + countStored(step.children ?? []), 0);
}

/** Reads the stored steps column; text that does not parse or is not a valid list reads as no steps. An old flat list reads as a tree of depth 1. */
export function parseStoredSteps(raw: string | null): Step[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isStoredStep)) return null;
    if (countStored(parsed) > STORED_STEPS_READ_MAX) return null;
    const stamp: BuildContext["stamp"] = (input) => {
      const stored = input as StoredStep;
      const started = stored.started_at ?? null;
      const done = stored.done_at ?? null;
      const sourceOf = (at: string | null, source: unknown): TimeSource | null =>
        at === null ? null : Object.values(TimeSource).includes(source as TimeSource) ? (source as TimeSource) : TimeSource.Stamped;
      return { started_at: started, done_at: done, started_source: sourceOf(started, stored.started_source), done_source: sourceOf(done, stored.done_source) };
    };
    const ctx: BuildContext = { explicit: new Set(explicitIds(parsed)), stamp, kept: () => undefined };
    return buildSteps(resolveIds(parsed, ctx), ctx);
  } catch {
    return null;
  }
}

function runningLeaves(steps: readonly Step[]): Step[] {
  return leavesOf(steps).filter((step) => step.state === StepState.Active);
}

/** Whether a step of the list is blocked on the owner (red, listed under Needs you). */
export function isBlockedOnOwner(steps: readonly Step[] | null | undefined): boolean {
  return ownerBlockedSteps(steps).length > 0;
}

/** When the owner-blocked steps started waiting: the earliest `started_at` among them (the step's report time), or null when none has one. */
export function ownerBlockedSince(steps: readonly Step[] | null | undefined): string | null {
  const times = ownerBlockedSteps(steps).flatMap((step) => (step.started_at ? [step.started_at] : []));
  return times.length > 0 ? times.reduce((a, b) => (a <= b ? a : b)) : null;
}

/**
 * null when the item has no list. Progress counts leaves (steps with no children) and the slice's open checks
 * (`openChecks`, not yet done, Slice 51). A done item reads every step done, and 100% only with no open check; the
 * list is kept. `current` is the running leaf's label when one runs.
 */
export function stepProgress(steps: Step[] | null | undefined, status: ItemStatus, openChecks = 0): StepProgress | null {
  if (!steps || steps.length === 0) return null;
  const leaves = leavesOf(steps);
  const total = leaves.length + openChecks;
  const finished = status === ItemStatus.Done;
  const done = finished ? leaves.length : leaves.filter((step) => step.state === StepState.Done).length;
  const running = finished ? [] : runningLeaves(steps);
  const percent = Math.round((done / total) * PERCENT);
  return {
    done,
    total,
    percent: openChecks > 0 ? Math.min(percent, MAX_PERCENT_WITH_OPEN_CHECK) : finished ? PERCENT : percent,
    running: running.length,
    blocked: finished ? 0 : leaves.filter((step) => step.state === StepState.Blocked).length,
    open_checks: openChecks,
    current: running.length === 1 ? running[0]!.label : null,
  };
}

/** What the working-now rule reads of an item. */
export interface WorkingRow extends ExpiryRow {
  steps?: Step[] | null;
  agent?: string | null;
}

/**
 * Whether an agent is working on the item now: in progress, a steps list or an agent set, and a
 * heartbeat that has not expired. Expiry is decided at read by `isHeartbeatExpired`, because the
 * cron only sweeps every 15 minutes and never sweeps a doc-sourced status (Slice 10).
 */
export function isWorkingNow(row: WorkingRow, staleAfterMinutes: number, now: Date): boolean {
  if (row.status !== ItemStatus.InProgress) return false;
  const hasWork = (row.steps?.length ?? 0) > 0 || Boolean(row.agent);
  return hasWork && !isHeartbeatExpired(row.heartbeat_at, staleAfterMinutes, now, row.agent);
}
