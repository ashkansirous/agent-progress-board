import {
  DEFAULT_PRIORITY,
  type Item,
  type ItemLink,
  ItemStatus,
  type ItemType,
  type Priority,
} from "./item";
import { DomainError } from "./errors";
import { blankToNull, normalizeSteps } from "./steps";
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
  agent?: string | null;
  model?: string | null;
  note?: string;
}

const CREATE_REQUIRED = ["project", "title", "type"] as const;

/** The report with its steps validated and a whitespace-only agent or model made absent (null); fields not sent stay unsent. */
export function checkReport(input: ReportInput): ReportInput {
  const checked = { ...input };
  if (input.steps !== undefined) checked.steps = normalizeSteps(input.steps);
  if (input.agent !== undefined) checked.agent = blankToNull(input.agent);
  if (input.model !== undefined) checked.model = blankToNull(input.model);
  return checked;
}

/** The row to insert when the key is new; unused when the key already exists. */
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
    type: input.type!,
    priority: input.priority ?? DEFAULT_PRIORITY,
    status,
    title: input.title!,
    why: input.why ?? null,
    details_md: input.details_md ?? null,
    links: input.links ?? [],
    source: input.source ?? null,
    environment: input.environment ?? null,
    steps: normalizeSteps(input.steps),
    agent: blankToNull(input.agent),
    model: blankToNull(input.model),
    heartbeat_at: now,
    created_at: now,
    updated_at: now,
    done_at: status === ItemStatus.Done ? now : null,
  };
}
