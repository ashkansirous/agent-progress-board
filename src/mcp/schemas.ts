import { z } from "zod";
import { MAX_SNAPSHOT_ITEMS } from "../domain/docSync";
import { ItemStatus, ItemType, Priority } from "../domain/item";
import { MAX_STEP_LABEL, MAX_STEP_NOTE, MAX_STEPS } from "../domain/steps";
import { StepState } from "../domain/stepTypes";

const MAX_KEY = 200;
const MAX_LABEL = 300;
const MAX_TEXT = 20_000;
const MAX_LINKS = 20;
const MAX_ENVIRONMENT = 40;
const MAX_MODEL = 100;
const MAX_CAP_WINDOWS = 20;

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
  .describe("Where the work ran, free text as the client names it (for example laptop or cloud-vm)");

const step = z.object({
  label: z.string().min(1).max(MAX_STEP_LABEL),
  state: z.enum(StepState),
  note: z.string().max(MAX_STEP_NOTE).nullable().optional().describe("Short text shown under the label"),
});

const stepsField = z
  .array(step)
  .max(MAX_STEPS)
  .nullable()
  .optional()
  .describe("The task's whole steps list in order, at most one active; the newest list wins; null or empty clears it");

export const reportProgressShape = {
  key,
  project: label.optional().describe("Required when the key is new"),
  type: z.enum(ItemType).optional().describe("Required when the key is new"),
  title: label.optional().describe("Required when the key is new"),
  status: z.enum(ItemStatus).optional(),
  environment: environment.nullable().optional().describe("Where the work ran; null clears it"),
  steps: stepsField,
  agent: z.string().min(1).max(MAX_MODEL).nullable().optional().describe("Kind of agent holding the task; null clears it"),
  model: z.string().min(1).max(MAX_MODEL).nullable().optional().describe("The agent's model; null clears it"),
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
  ...detailShape,
};

export const listOpenShape = {
  project: label.optional(),
  type: z.enum(ItemType).optional(),
  window_hours: z.number().positive().optional().describe("Hours a done item stays; capped by config"),
};

export const getItemShape = { key };

const snapshotItem = z.object({
  key,
  project: label.describe("Must equal the call's project"),
  type: z.enum(ItemType).describe("Used only when the key is new; the docs never change it later"),
  title: label,
  status: z.enum(ItemStatus).describe("The status the docs give"),
  priority: z.enum(Priority).optional().describe("Used only when the key is new; the docs never change it later"),
  parent: detailShape.parent,
  why: detailShape.why,
  links: z.array(link).max(MAX_LINKS).optional(),
});

export const syncSnapshotShape = {
  project: label.describe("The project whose doc-sync set this is"),
  items: z.array(snapshotItem).max(MAX_SNAPSHOT_ITEMS).describe("The project's full doc-sync set; missing ones close"),
};
