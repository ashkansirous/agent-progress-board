import {
  DEFAULT_PRIORITY,
  type Item,
  type ItemLink,
  ItemStatus,
  type ItemType,
  type Priority,
} from "./item";

export class DomainError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

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
  note?: string;
}

const CREATE_REQUIRED = ["project", "title", "type"] as const;

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
    heartbeat_at: now,
    created_at: now,
    updated_at: now,
    done_at: status === ItemStatus.Done ? now : null,
  };
}
