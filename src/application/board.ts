import {
  assertSameProject,
  closeTargets,
  planItem,
  type SnapshotItem,
  validateSnapshot,
} from "../domain/docSync";
import { type Item, ItemStatus, ItemType, type ItemWithEvents } from "../domain/item";
import { DomainError, newItem, type ReportInput } from "../domain/upsert";
import { resolveWindowHours, type WindowConfig, windowCutoff } from "../domain/window";
import { type ItemRepository, LIST_EVENT_LIMIT } from "./ports";

export type AskHumanInput = Omit<ReportInput, "type" | "status">;

export interface MarkDoneInput {
  key: string;
  source?: string | null;
  note?: string;
}

export interface ListOpenInput {
  project?: string;
  type?: ItemType;
  window_hours?: number;
}

export interface Clock {
  now(): Date;
}

export async function reportProgress(
  repo: ItemRepository,
  input: ReportInput,
  clock: Clock,
): Promise<Item> {
  const existing = await repo.find(input.key);
  const now = clock.now().toISOString();
  return repo.save({ insert: existing ?? newItem(input, now), input, now });
}

export async function markDone(
  repo: ItemRepository,
  input: MarkDoneInput,
  clock: Clock,
): Promise<Item> {
  const existing = await repo.find(input.key);
  if (!existing) throw new DomainError("key", `field key: no item ${input.key}`);
  return reportProgress(repo, { ...input, status: ItemStatus.Done }, clock);
}

export async function askHuman(
  repo: ItemRepository,
  input: AskHumanInput,
  clock: Clock,
): Promise<Item> {
  const existing = await repo.find(input.key);
  if (existing && existing.type !== ItemType.WaitingForMe) {
    throw new DomainError("key", `field key: ${input.key} is a ${existing.type} item, not waiting_for_me`);
  }
  const report: ReportInput = { ...input, type: ItemType.WaitingForMe, status: ItemStatus.Open };
  return reportProgress(repo, report, clock);
}

export interface SyncSnapshotInput {
  project: string;
  items: SnapshotItem[];
}

export interface SyncSummary {
  project: string;
  created: number;
  updated: number;
  closed: number;
  unchanged: number;
}

/** One project's full doc-sync set: merge each item, close the ones that left, one batch. */
export async function syncSnapshot(
  repo: ItemRepository,
  input: SyncSnapshotInput,
  clock: Clock,
): Promise<SyncSummary> {
  validateSnapshot(input.project, input.items);
  const now = clock.now().toISOString();
  const stored = await repo.loadForSync(input.project, input.items.map((item) => item.key));
  const byKey = new Map(stored.map((item) => [item.key, item]));
  const merges = input.items.map((snap) => {
    assertSameProject(byKey.get(snap.key), input.project);
    return { existed: byKey.has(snap.key), write: planItem(byKey.get(snap.key), snap, input.project, now) };
  });
  const listed = new Set(input.items.map((item) => item.key));
  const closes = closeTargets(stored, input.project, listed);
  const changed = merges.flatMap((m) => (m.write ? [m.write] : []));
  if (changed.length > 0 || closes.length > 0) await repo.applySync(changed, closes, now);
  const created = merges.filter((m) => !m.existed).length;
  return {
    project: input.project,
    created,
    updated: changed.length - created,
    closed: closes.length,
    unchanged: merges.length - changed.length,
  };
}

export async function listOpen(
  repo: ItemRepository,
  input: ListOpenInput,
  window: WindowConfig,
  clock: Clock,
): Promise<ItemWithEvents[]> {
  const hours = resolveWindowHours(input.window_hours, window);
  return repo.listBoard({
    project: input.project,
    type: input.type,
    cutoff: windowCutoff(clock.now(), hours),
    eventLimit: LIST_EVENT_LIMIT,
  });
}

export async function getItem(repo: ItemRepository, key: string): Promise<ItemWithEvents> {
  const item = await repo.find(key);
  if (!item) throw new DomainError("key", `field key: no item ${key}`);
  return { ...item, events: await repo.eventsFor(key) };
}
