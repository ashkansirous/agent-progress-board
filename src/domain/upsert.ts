import {
  ANSWERED_NOTE,
  DEFAULT_PRIORITY,
  MAX_NEEDS_YOU_NOTE,
  NEEDS_YOU_NOTE_PREFIX,
  NOTE_SEPARATOR,
  type Item,
  type ItemLink,
  ItemStatus,
  type ItemType,
  type Priority,
} from "./item";
import { DomainError } from "./errors";
import { blankToNull, normalizeSteps, replaceChildren } from "./steps";
import type { StepInput } from "./stepTypes";

export { DomainError };

/**
 * What a reporter sent. A field left out keeps the stored value; `null` clears the optional
 * fields (parent, why, details_md, links, source). The upsert itself is decided in SQL.
 */
export interface ReportInput {
  key: string;
  project?: string;
  parent?: string | null;
  /** The key of the item this one belongs to (a part names its slice); null clears it (Slice 11). */
  parent_key?: string | null;
  type?: ItemType;
  priority?: Priority;
  status?: ItemStatus;
  title?: string;
  why?: string | null;
  details_md?: string | null;
  links?: ItemLink[] | null;
  source?: string | null;
  environment?: string | null;
  /** The whole list, newest wins; null or an empty list clears it. */
  steps?: StepInput[] | null;
  /** The id of a step: `steps` then replaces only that step's children, not the whole list (Slice 39). */
  under_step?: string;
  agent?: string | null;
  model?: string | null;
  /** The agent's question for the owner; null clears it (and `after_answer`). Slice 13. */
  needs_you?: string | null;
  /** What the agent does after the answer. */
  after_answer?: string | null;
  /** When the question was first asked; set by the application layer, never by a reporter. */
  needs_you_at?: string | null;
  /** What the task delivers, one line; null clears it. Slice 41. */
  outcome?: string | null;
  note?: string;
}

export const MAX_NEEDS_YOU = 2000;
export const MAX_AFTER_ANSWER = 500;
export const MAX_OUTCOME = 200;

const CREATE_REQUIRED = ["project", "title", "type"] as const;

function checkLength(field: "needs_you" | "after_answer" | "outcome", value: string | null | undefined, max: number): void {
  if ((value?.trim().length ?? 0) > max) throw new DomainError(field, `field ${field}: at most ${max} characters`);
}

/** The steps to store: the whole list, or the stored list with one step's children replaced (`under_step`), stamped from the stored tree. */
function checkedSteps(input: ReportInput, existing: Pick<Item, "steps"> | null, now: string | null) {
  if (input.under_step === undefined) return normalizeSteps(input.steps, { previous: existing?.steps, now });
  if (input.steps === undefined) throw new DomainError("under_step", "field under_step: send steps with it, the list for that step's children");
  const merged = replaceChildren(existing?.steps, input.under_step, input.steps);
  return normalizeSteps(merged, { previous: existing?.steps, now });
}

/** The report with its steps validated and stamped and a whitespace-only agent or model made absent (null); fields not sent stay unsent. */
export function checkReport(input: ReportInput, existing: Pick<Item, "steps"> | null = null, now: string | null = null): ReportInput {
  const checked = { ...input };
  if (input.parent_key === input.key) throw new DomainError("parent_key", "field parent_key: an item cannot be its own parent");
  if (input.steps !== undefined || input.under_step !== undefined) checked.steps = checkedSteps(input, existing, now);
  delete checked.under_step;
  if (input.agent !== undefined) checked.agent = blankToNull(input.agent);
  if (input.model !== undefined) checked.model = blankToNull(input.model);
  checkLength("needs_you", input.needs_you, MAX_NEEDS_YOU);
  checkLength("after_answer", input.after_answer, MAX_AFTER_ANSWER);
  if (input.needs_you !== undefined) checked.needs_you = blankToNull(input.needs_you);
  if (input.after_answer !== undefined) checked.after_answer = blankToNull(input.after_answer);
  checkLength("outcome", input.outcome, MAX_OUTCOME);
  if (input.outcome !== undefined) checked.outcome = blankToNull(input.outcome);
  delete checked.needs_you_at;
  return checked;
}

/** What the stored item says of its question; the rules below compare the report with it. */
type QuestionState = Pick<Item, "needs_you" | "needs_you_at" | "status"> | null;

/** The history note: the server's marker first, the caller's own note kept beside it. */
function withMarker(marker: string, note: string | undefined): string {
  return note ? `${marker}${NOTE_SEPARATOR}${note}` : marker;
}

/**
 * A report that moves the item to in progress from any other status, stale included, is the
 * owner's answer; done also answers; a repeated in-progress report is a heartbeat and keeps the
 * question. Why stale counts: a session that asked is idle until the owner answers, so it sends
 * nothing and goes stale, and its next report follows the answer. A session that keeps working
 * while asking keeps heartbeating, stays in progress and never passes through stale. An answer
 * inside the 15 minutes is a same-status report, so the client sends `needs_you: null` then.
 */
function answersQuestion(input: ReportInput, existing: QuestionState): boolean {
  if (input.status === ItemStatus.Done) return true;
  return input.status === ItemStatus.InProgress && existing?.status !== ItemStatus.InProgress;
}

/**
 * The question fields a report leaves in storage (Slice 13). A question given is stored and keeps
 * its first-asked time while the text is unchanged (so "waiting N min" does not restart on a
 * resend); `needs_you: null` clears the question, its after-text and its time; a report that moves
 * the item to in progress from any other status, stale included (the owner answered), or to done,
 * and sends no question, clears them too (see `answersQuestion`). Anything else, a repeated
 * in-progress heartbeat included, leaves them as stored.
 */
export function withQuestion(input: ReportInput, existing: QuestionState, now: string): ReportInput {
  const done = input.status === ItemStatus.Done;
  if (input.needs_you && !done) return withAsked(input, existing, now);
  const clears = done || input.needs_you === null || (input.needs_you === undefined && answersQuestion(input, existing));
  if (!clears) return input;
  const answered = existing?.needs_you ? { note: withMarker(ANSWERED_NOTE, input.note) } : {};
  return { ...input, ...answered, needs_you: null, after_answer: null, needs_you_at: null };
}

/** A question given: kept as first asked when the text is unchanged, else stamped now with a history note. */
function withAsked(input: ReportInput, existing: QuestionState, now: string): ReportInput {
  const firstAsked = existing?.needs_you === input.needs_you ? existing?.needs_you_at : null;
  if (firstAsked) return { ...input, needs_you_at: firstAsked };
  const firstLine = input.needs_you!.split("\n")[0]!.slice(0, MAX_NEEDS_YOU_NOTE);
  return { ...input, needs_you_at: now, note: withMarker(`${NEEDS_YOU_NOTE_PREFIX}${firstLine}`, input.note) };
}

/** The row to insert when the key is new; unused when the key already exists. Normalizes steps, agent, model and the question text itself, so a direct caller cannot store untrimmed values. */
export function newItem(input: ReportInput, now: string): Item {
  for (const field of CREATE_REQUIRED) {
    if (input[field] === undefined) {
      throw new DomainError(field, `field ${field}: required when creating item ${input.key}`);
    }
  }
  const status = input.status ?? ItemStatus.Open;
  return {
    key: input.key,
    project: input.project!,
    parent: input.parent ?? null,
    parent_key: input.parent_key ?? null,
    type: input.type!,
    priority: input.priority ?? DEFAULT_PRIORITY,
    status,
    title: input.title!,
    why: input.why ?? null,
    details_md: input.details_md ?? null,
    links: input.links ?? [],
    source: input.source ?? null,
    environment: input.environment ?? null,
    steps: normalizeSteps(input.steps, { now }),
    agent: blankToNull(input.agent),
    model: blankToNull(input.model),
    needs_you: blankToNull(input.needs_you),
    after_answer: blankToNull(input.after_answer),
    needs_you_at: input.needs_you_at ?? null,
    outcome: blankToNull(input.outcome),
    heartbeat_at: now,
    created_at: now,
    updated_at: now,
    done_at: status === ItemStatus.Done ? now : null,
  };
}
