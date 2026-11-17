import { ItemStatus } from "./item";
import { DomainError } from "./errors";
import { type ExpiryRow, isHeartbeatExpired } from "./stale";
import { type Step, type StepInput, type StepProgress, StepState } from "./stepTypes";

export const MAX_STEPS = 30;
export const MAX_STEP_LABEL = 80;
export const MAX_STEP_NOTE = 120;
const PERCENT = 100;

function fail(message: string): never {
  throw new DomainError("steps", `field steps: ${message}`);
}

function checkStep(step: StepInput, index: number): void {
  const at = `step ${index + 1}`;
  if (step.label.trim().length < 1 || step.label.length > MAX_STEP_LABEL) {
    fail(`${at} label needs 1 to ${MAX_STEP_LABEL} characters`);
  }
  if ((step.note ?? "").length > MAX_STEP_NOTE) fail(`${at} note needs at most ${MAX_STEP_NOTE} characters`);
  if (!Object.values(StepState).includes(step.state)) fail(`${at} state must be done, active or pending`);
}

/**
 * The list to store: validated (at most 30 steps, labels 1 to 80 characters, notes 0 to 120, one
 * active step at most) with notes made explicit. Empty or null is no list. The whole list is the
 * newest report's, so nothing is merged with the stored one.
 */
export function normalizeSteps(steps: StepInput[] | null | undefined): Step[] | null {
  if (steps === null || steps === undefined || steps.length === 0) return null;
  if (steps.length > MAX_STEPS) fail(`at most ${MAX_STEPS} steps, got ${steps.length}`);
  steps.forEach(checkStep);
  if (steps.filter((step) => step.state === StepState.Active).length > 1) fail("at most one step can be active");
  return steps.map(({ label, state, note }) => ({ label: label.trim(), state, note: note?.trim() || null }));
}

/** An optional free-text field: whitespace-only reads as absent. */
export function blankToNull(value: string | null | undefined): string | null {
  return value?.trim() ? value : null;
}

function isStoredStep(value: unknown): value is Step {
  if (typeof value !== "object" || value === null) return false;
  const { label, state, note } = value as Record<string, unknown>;
  const stateOk = Object.values(StepState).includes(state as StepState);
  return typeof label === "string" && stateOk && (note === null || typeof note === "string");
}

/** Reads the stored steps column; text that does not parse or is not a valid list reads as no steps. */
export function parseStoredSteps(raw: string | null): Step[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isStoredStep) ? parsed : null;
  } catch {
    return null;
  }
}

/** null when the item has no list. A done item reads 100% whatever its list says; the list is kept. */
export function stepProgress(steps: Step[] | null | undefined, status: ItemStatus): StepProgress | null {
  if (!steps || steps.length === 0) return null;
  const total = steps.length;
  const finished = status === ItemStatus.Done;
  const done = finished ? total : steps.filter((step) => step.state === StepState.Done).length;
  const active = steps.find((step) => step.state === StepState.Active);
  return {
    done,
    total,
    percent: finished ? PERCENT : Math.round((done / total) * PERCENT),
    current: finished ? null : (active?.label ?? null),
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
