import { z } from "zod";
import { MAX_SNAPSHOT_ITEMS } from "../domain/docSync";
import { ItemStatus, ItemType, Priority } from "../domain/item";

const MAX_KEY = 200;
const MAX_LABEL = 300;
const MAX_TEXT = 20_000;
const MAX_LINKS = 20;

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

export const reportProgressShape = {
  key,
  project: label.optional().describe("Required when the key is new"),
  type: z.enum(ItemType).optional().describe("Required when the key is new"),
  title: label.optional().describe("Required when the key is new"),
  status: z.enum(ItemStatus).optional(),
  ...detailShape,
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
