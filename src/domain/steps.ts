import { ItemStatus } from "./item";
import { DomainError } from "./errors";
import { type ExpiryRow, isHeartbeatExpired } from "./stale";
import { leavesOf, type Step, type StepInput, type StepProgress, StepState } from "./stepTypes";

/** Steps in the whole tree, parents and leaves together (Slice 39). */
export const MAX_STEPS = 200;
/** Levels of the tree: a flat list is depth 1. */
export const MAX_STEP_DEPTH = 4;
export const MAX_STEP_LABEL = 80;
export const MAX_STEP_NOTE = 120;
export const MAX_STEP_ID = 80;
const PERCENT = 100;
const ID_SEPARATOR = "/";

function fail(message: string): never {
  throw new DomainError("steps", `field steps: ${message}`);
}

function checkStep(step: StepInput, at: string): void {
  if (step.label.trim().length < 1 || step.label.trim().length > MAX_STEP_LABEL) {
    fail(`${at} label needs 1 to ${MAX_STEP_LABEL} characters`);
  }
  if ((step.note ?? "").trim().length > MAX_STEP_NOTE) fail(`${at} note needs at most ${MAX_STEP_NOTE} characters`);
  if (!Object.values(StepState).includes(step.state)) fail(`${at} state must be done, active or pending`);
  if (step.id !== undefined && (step.id.trim().length < 1 || step.id.trim().length > MAX_STEP_ID)) {
    fail(`${at} id needs 1 to ${MAX_STEP_ID} characters`);
  }
}

/**
 * Counts the steps of the sent tree and refuses one over the step or depth limits, one pass that stops at the
 * first step past a limit, before any text check or id is built (id building is quadratic in same-label siblings).
 */
function checkSize(steps: readonly StepInput[]): void {
  let count = 0;
  const walk = (level: readonly StepInput[], depth: number): void => {
    if (depth > MAX_STEP_DEPTH) fail(`at most ${MAX_STEP_DEPTH} levels of sub-steps`);
    count += level.length;
    if (count > MAX_STEPS) fail(`at most ${MAX_STEPS} steps in all`);
    level.forEach((step) => {
      if (step.children && step.children.length > 0) walk(step.children, depth + 1);
    });
  };
  walk(steps, 1);
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
}

interface BuildContext {
  /** The ids the report gives explicitly, anywhere in its tree. */
  explicit: ReadonlySet<string>;
  stamp: (input: StepInput, id: string, state: StepState) => Pick<Step, "started_at" | "done_at">;
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

/** An id made from the label path (at most `MAX_STEP_ID` characters), made unique with "#2", "#3" ... when taken. */
function generatedId(parentId: string | null, label: string, used: Set<string>): string {
  const base = parentId === null ? label : `${parentId}${ID_SEPARATOR}${label}`;
  let id = withinLimit(base);
  for (let n = 2; used.has(id); n += 1) id = withinLimit(`${base}#${n}`);
  return id;
}

/** Every step of the tree finished; a level whose `children` are left out stays left out (its stored ones are finished when built). */
function asDone(steps: readonly StepInput[]): StepInput[] {
  return steps.map((step) => ({ ...step, state: StepState.Done, children: step.children === undefined ? undefined : asDone(step.children) }));
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
  const sent = input.children !== undefined && input.state === StepState.Done ? asDone(input.children) : input.children;
  const children = sent === undefined ? keptChildren(ctx.kept(id), input.state, ctx) : buildSteps(sent, ctx);
  return { id, label: input.label.trim(), state: input.state, note: input.note?.trim() || null, ...ctx.stamp(input, id, input.state), children };
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

function checkTree(steps: readonly Step[]): void {
  const all = flatten(steps);
  if (all.length > MAX_STEPS) fail(`at most ${MAX_STEPS} steps in all, got ${all.length}`);
  if (new Set(all.map((step) => step.id)).size !== all.length) fail("step ids must be unique in the whole list");
  const deepest = (level: Step[], depth: number): number =>
    Math.max(depth, ...level.map((step) => deepest(step.children, depth + 1)));
  if (deepest(steps as Step[], 0) > MAX_STEP_DEPTH) fail(`at most ${MAX_STEP_DEPTH} levels of sub-steps`);
}

/** The stamps of a step after a report: kept by id while the step stays started or done, else this report's time. */
function stampFrom(context: StampContext): BuildContext["stamp"] {
  const stored = new Map(flatten(context.previous ?? []).map((step) => [step.id, step]));
  const now = context.now ?? null;
  return (_input, id, state) => {
    const before = stored.get(id);
    const started = state === StepState.Pending ? null : (before?.started_at ?? now);
    const finished = state === StepState.Done ? (before?.state === StepState.Done ? (before.done_at ?? now) : now) : null;
    return { started_at: started, done_at: finished };
  };
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
  const ctx: BuildContext = { explicit, stamp: stampFrom(context), kept: (id) => stored.get(id) };
  const built = buildSteps(resolveIds(steps, ctx), ctx);
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
  return typeof label === "string" && stateOk && (note === undefined || note === null || typeof note === "string") && idOk && timeOk(started_at) && timeOk(done_at) && childrenOk;
}

/** Reads the stored steps column; text that does not parse or is not a valid list reads as no steps. An old flat list reads as a tree of depth 1. */
export function parseStoredSteps(raw: string | null): Step[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isStoredStep)) return null;
    const stamp: BuildContext["stamp"] = (input) => {
      const stored = input as StoredStep;
      return { started_at: stored.started_at ?? null, done_at: stored.done_at ?? null };
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

/**
 * null when the item has no list. Progress counts leaves (steps with no children). A done item reads
 * 100% whatever its list says; the list is kept. `current` is the running leaf's label when one runs.
 */
export function stepProgress(steps: Step[] | null | undefined, status: ItemStatus): StepProgress | null {
  if (!steps || steps.length === 0) return null;
  const leaves = leavesOf(steps);
  const total = leaves.length;
  const finished = status === ItemStatus.Done;
  const done = finished ? total : leaves.filter((step) => step.state === StepState.Done).length;
  const running = finished ? [] : runningLeaves(steps);
  return {
    done,
    total,
    percent: finished ? PERCENT : Math.round((done / total) * PERCENT),
    running: running.length,
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
