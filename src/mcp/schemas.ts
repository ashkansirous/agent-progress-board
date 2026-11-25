import { z } from "zod";
import { MAX_CHECKS, MAX_KEY_LENGTH, PART_SUFFIX_LENGTH } from "../domain/checks";
import { MAX_EXPANDED_ITEMS, MAX_SNAPSHOT_ITEMS } from "../domain/docSync";
import { ItemStatus, ItemType, Priority } from "../domain/item";
import { MAX_PARTS } from "../domain/parts";
import { MAX_AFTER_ANSWER, MAX_NEEDS_YOU, MAX_OUTCOME } from "../domain/upsert";
import { MAX_STEP_DEPTH, MAX_STEP_ID, MAX_STEP_LABEL, MAX_STEP_LINK, MAX_STEP_NOTE, MAX_STEPS } from "../domain/steps";
import { type StepInput, StepState, TimeSource, WaitsOn } from "../domain/stepTypes";

const MAX_KEY = MAX_KEY_LENGTH;
const MAX_LABEL = 300;
const MAX_TEXT = 20_000;
const MAX_LINKS = 20;
const MAX_ENVIRONMENT = 40;
const MAX_MODEL = 100;
const MAX_CAP_WINDOWS = 20;
const TIME_TEXT_MAX = 40;

const key = z.string().min(1).max(MAX_KEY).describe("Stable item key, e.g. demo-app/slice-58");
const label = z.string().min(1).max(MAX_LABEL);
const text = z.string().min(1).max(MAX_TEXT);
const SAFE_LINK_PROTOCOLS = ["http:", "https:"];
const url = z
  .string()
  .max(MAX_TEXT)
  .refine((value) => isSafeUrl(value), "url must be a valid http or https URL");
const link = z.object({ label, url });

function isSafeUrl(value: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const detailShape = {
  parent: label
    .nullable()
    .optional()
    .describe("Free text parent label shown on the tile, e.g. Wave 3; null clears it"),
  priority: z.enum(Priority).optional(),
  why: text.nullable().optional().describe("null clears it"),
  details_md: text.nullable().optional().describe("null clears it"),
  links: z.array(link).max(MAX_LINKS).nullable().optional().describe("null clears them"),
  source: label.nullable().optional().describe("Who reported: hook, agent, human; null clears it"),
  note: text.optional().describe("History note for this report"),
};

const environment = z
  .string()
  .min(1)
  .max(MAX_ENVIRONMENT)
  .describe("Where the work ran, free text as the client names it (for example laptop, cloud-vm, Claude chat or Claude Design)");

const stepBase = {
  id: z.string().trim().min(1).max(MAX_STEP_ID).optional().describe("Stable id of the step, kept across reports; made from the label path when left out"),
  label: z.string().trim().min(1).max(MAX_STEP_LABEL),
  state: z.enum(StepState),
  note: z.string().trim().max(MAX_STEP_NOTE).nullable().optional().describe("Short text shown under the label; a blocked step needs it, saying what it waits on"),
  waits_on: z.enum(WaitsOn).nullable().optional().describe("For a blocked step: work (default, orange) or owner (red, listed under Needs you)"),
  link: z.string().max(MAX_STEP_LINK).refine((value) => isSafeUrl(value), "url must be a valid http or https URL").nullable().optional().describe("For a blocked step: an optional http or https link to what it waits on"),
  started_at: z.string().max(TIME_TEXT_MAX).nullable().optional().describe("When the step really started (ISO time), when you know it: kept as sent if not in the future; leave out to let the board stamp it (a stamped time shows no duration)"),
  done_at: z.string().max(TIME_TEXT_MAX).nullable().optional().describe("When the step really finished (ISO time), when you know it; same rules as started_at"),
  started_source: z.enum(TimeSource).nullable().optional().describe("Where started_at came from: reported (default) or observed (only a hook that saw it happen)"),
  done_source: z.enum(TimeSource).nullable().optional().describe("Where done_at came from: reported (default) or observed (only a hook that saw it happen)"),
};

/** A step with `levels` more levels of children allowed below it; the schema is unrolled, not recursive, so every client reads it as plain JSON Schema. */
function stepSchema(levels: number): z.ZodType<StepInput> {
  // The deepest level still takes a list of plain steps: a non-empty one is a fifth level, refused by checkTree with its "at most 4 levels" message; an empty one (as get_item echoes it) is fine.
  if (levels === 0) return z.object({ ...stepBase, children: z.array(z.object(stepBase)).max(MAX_STEPS).optional() });
  return z.object({
    ...stepBase,
    children: z.array(stepSchema(levels - 1)).max(MAX_STEPS).optional().describe("Sub-steps; left out keeps the stored ones, an empty list clears them"),
  });
}

const stepsField = z
  .array(stepSchema(MAX_STEP_DEPTH - 1))
  .max(MAX_STEPS)
  .nullable()
  .optional()
  .describe(
    `The task's steps as a tree in order (at most ${MAX_STEPS} steps in all, ${MAX_STEP_DEPTH} levels); several may be active; the newest list wins; null or empty clears it. With under_step it is only that step's children`,
  );

const underStepField = z
  .string()
  .trim()
  .min(1)
  .max(MAX_STEP_ID)
  .optional()
  .describe("The id of a step: steps then replaces only that step's children, so a helper writes its own subtree");

export const reportProgressShape = {
  key,
  project: label.optional().describe("Required when the key is new"),
  type: z.enum(ItemType).optional().describe("Required when the key is new"),
  title: label.optional().describe("Required when the key is new"),
  status: z.enum(ItemStatus).optional(),
  environment: environment.nullable().optional().describe("Where the work ran; null clears it"),
  steps: stepsField,
  under_step: underStepField,
  parent_key: key
    .nullable()
    .optional()
    .describe("Key of the item this one belongs to; a part's key is <slice key>/part-<letter> and names its slice; a check always names its slice; a bug or problem may name the slice planned for it; null clears it (not on a check)"),
  agent: z.string().min(1).max(MAX_MODEL).nullable().optional().describe("Kind of agent holding the task; null clears it"),
  model: z.string().min(1).max(MAX_MODEL).nullable().optional().describe("The agent's model; null clears it"),
  needs_you: z
    .string()
    .max(MAX_NEEDS_YOU)
    .refine((text) => text.trim() !== "", "needs_you: blank text is not a question; send null to clear it")
    .nullable()
    .optional()
    .describe(
      "The agent's own question for the owner; the item shows under Needs you until it is cleared. null clears it, and so does a report that sets in_progress or done without one",
    ),
  after_answer: z.string().max(MAX_AFTER_ANSWER).nullable().optional().describe("What the agent does after the answer; null clears it"),
  outcome: z
    .string()
    .max(MAX_OUTCOME)
    .nullable()
    .optional()
    .describe("What the task delivers, one line (for example \"Code merged to main\"); the card shows it under the title. null clears it"),
  ...detailShape,
};

const isoTime = z.iso.datetime({ offset: true }).describe("ISO 8601 time, for example 2026-11-16T14:05:00Z");
const tokenCount = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .describe("A running total so far, not a difference");

export const reportUsageShape = {
  agent_key: key.describe("<project>/session-<id>, or <project>/session-<id>/agent-<id> for a helper"),
  model: z.string().min(1).max(MAX_MODEL),
  record_at: isoTime.describe("Time of the newest record these totals counted"),
  input_tokens: tokenCount.describe("Fresh input tokens, running total"),
  cache_write_tokens: tokenCount.describe("Tokens written to the cache, running total"),
  cache_read_tokens: tokenCount.describe("Tokens read from the cache, running total"),
  output_tokens: tokenCount.describe("Output tokens, running total"),
  task_key: key.optional().describe("Item key of the task (a slice or a slice part) the tokens were for"),
  agent_kind: z.string().min(1).max(MAX_MODEL).optional().describe("Kind of agent, for example reviewer"),
  step: label.optional().describe("The step the agent was on, when known"),
  environment: environment.optional(),
};

const capWindow = z.object({
  kind: z
    .string()
    .min(1)
    .max(MAX_MODEL)
    .describe("weekly, short (any shorter window) or another name such as a per-model window"),
  percent: z.number().min(0).max(100).describe("Percent used, decimals allowed"),
  reset_at: isoTime.optional().describe("When this window resets, when known"),
});

export const reportCapShape = {
  taken_at: isoTime.describe("When the client took the reading"),
  plan: z.string().min(1).max(MAX_MODEL).describe("The subscription plan's name, as the client reads it"),
  windows: z.array(capWindow).min(1).max(MAX_CAP_WINDOWS),
  source: label.optional().describe("What took the reading, for example status-line"),
};

export const markDoneShape = {
  key,
  source: detailShape.source,
  note: detailShape.note,
};

export const askHumanShape = {
  key,
  project: label.describe("Project the question belongs to"),
  title: label,
  needs_you: reportProgressShape.needs_you.describe(
    "The question for the owner; on a waiting_for_me item it shows under Needs you until it is cleared. On another type the question is this, else why, else the title",
  ),
  after_answer: z
    .string()
    .max(MAX_AFTER_ANSWER)
    .nullable()
    .optional()
    .describe("What the agent does after the answer; shown on the question card"),
  ...detailShape,
};

export const listOpenShape = {
  project: label.optional(),
  type: z.enum(ItemType).optional(),
  window_hours: z.number().positive().optional().describe("Hours a done item stays; capped by config"),
};

export const getItemShape = { key };

const snapshotPart = z.object({
  letter: z.string().regex(/^[A-Z]$/, "one capital letter A to Z"),
  title: label.describe("The group's title as the document gives it"),
  done: z.boolean().describe("True when all the group's checkboxes are ticked"),
});

const snapshotCheck = z.object({
  key: key.describe("Stable key of the check line, e.g. demo-app/slice-58/check-2"),
  title: label.describe("The check line as the document gives it"),
});

/** The fields of one snapshot item, declared once; `type` and `priority` are what the docs may set. */
const snapshotFields = {
  key,
  project: label.describe("Must equal the call's project"),
  type: z
    .enum(ItemType)
    .describe("The type of a new key, and of an item the docs already own; a stored item the docs do not own with another type is skipped, never retyped"),
  title: label,
  status: z.enum(ItemStatus).describe("The status the docs give"),
  priority: z.enum(Priority).optional().describe("Used only when the key is new; the docs never change it later"),
  parent: detailShape.parent,
  why: detailShape.why,
  details_md: detailShape.details_md.describe("The rest of a clipped title. A new key stores it; a stored item takes it only while its own details are empty, except an owner step in the documents, whose details follow the document line, and null clears them; for any other item null or left out keeps what is stored"),
  links: z.array(link).max(MAX_LINKS).optional(),
};

const snapshotItem = z.object({
  ...snapshotFields,
  parts: z
    .array(snapshotPart)
    .max(MAX_PARTS)
    .optional()
    .describe(`The slice's lettered work groups; each becomes the item <key>/part-<letter>, so the slice key must be at most ${MAX_KEY_LENGTH - PART_SUFFIX_LENGTH} characters; a part left out is closed`),
  checks: z
    .array(snapshotCheck)
    .max(MAX_CHECKS)
    .optional()
    .describe("The slice's checks not yet tried on a device; each becomes a check item under the slice; one left out is closed; omit the field to leave them as they are"),
  parent_key: key
    .nullable()
    .optional()
    .describe("The slice a top-level check, bug or problem belongs to (it need not be in the snapshot; a check needs one); left out keeps the stored value; null clears it (not on a check)"),
});

export const syncSnapshotShape = {
  project: label.describe("The project whose doc-sync set this is"),
  items: z
    .array(snapshotItem)
    .max(MAX_SNAPSHOT_ITEMS)
    .describe(`The project's full doc-sync set; missing ones close. At most ${MAX_SNAPSHOT_ITEMS} items, and at most ${MAX_EXPANDED_ITEMS} together with their parts and checks`),
};
