import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ArchiveRepository, archiveItem, getItemWithArchive } from "../application/archive";
import { applyBatch, askHuman, type Clock, listOpen, listSynced, markDone, reportProgress, syncSnapshot, upsertItem, withStepCosts } from "../application/board";
import type { ItemRepository, UsageRepository } from "../application/ports";
import { processStats, queryRuns } from "../application/processRuns";
import { reportCap, reportUsage } from "../application/usage";
import { parseConfig } from "../config";
import { badFieldSteps, MAX_PROCESS_KEY, MAX_STEP_COUNTS } from "../domain/steps";
import { DomainError } from "../domain/upsert";
import { allows, Need, Scope } from "../domain/scope";
import {
  applyBatchShape,
  archiveItemShape,
  askHumanShape,
  getItemShape,
  listOpenShape,
  listSyncedShape,
  markDoneShape,
  processStatsShape,
  queryRunsShape,
  reportCapShape,
  reportProgressShape,
  reportUsageShape,
  syncSnapshotShape,
  upsertItemShape,
} from "./schemas";

const INTERNAL_ERROR = "internal error: the board could not complete the request";

/**
 * The most JSON characters list_open and get_item return; what does not fit is left out and said so in a
 * second text block (Slice 32). Claude Code saves a text result over 50,000 characters to a file instead of
 * showing it (https://code.claude.com/docs/en/mcp, "MCP output limits and warnings"), so the whole reply,
 * note included, stays under that.
 */
export const MAX_RESULT_CHARS = 50_000;

/** Room kept for the second text block that says what was left out. */
const NOTE_RESERVE = 500;

/** The longest a string field may be, tried in turn, when the first entry alone is over the limit. */
const STRING_CLIPS = [2000, 500, 100, 20];

/** A result that was cut to the size limit: the data that fits and the sentence that says what is missing. */
class Truncated {
  constructor(
    readonly data: unknown,
    readonly note: string,
  ) {}
}

/** Identity, link and time fields a clip never touches: cutting one makes a key that names no item, a URL that goes nowhere or a time that is no time. */
const UNCLIPPED_FIELDS = new Set(["key", "item_key", "step_id", "process", "process_source", "parent_key", "project", "type", "status", "at", "url"]);

function isUnclipped(name: string): boolean {
  return UNCLIPPED_FIELDS.has(name) || name.endsWith("_at");
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Free text cut to `max` characters; key, parent_key, project, type, status, every time field and every link url stay
 * whole. With `dropLinks` (the last resort) every `links` list is emptied instead: a cut url goes nowhere.
 */
function clipStrings(value: unknown, max: number, dropLinks = false): unknown {
  if (typeof value === "string") return clipText(value, max);
  if (Array.isArray(value)) return value.map((entry) => clipStrings(entry, max, dropLinks));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, field]) => [
        name,
        dropLinks && name === "links" && Array.isArray(field) ? [] : isUnclipped(name) ? field : clipStrings(field, max, dropLinks),
      ]),
    );
  }
  return value;
}

/** How a reply is cut: its JSON size parts, how to build the reply for `shown` entries (long strings cut to `clip` when given), and the tiny reply of last resort. */
interface CutPlan {
  /** JSON length of each droppable entry, in order. */
  sizes: number[];
  /** JSON length of everything that is not an entry (the brackets, or the item without its events). */
  fixed: number;
  /** The fewest entries shown before long strings are cut instead. */
  minShown: number;
  build: (shown: number, clip: number | null, dropLongLinks?: boolean) => Truncated;
  /** Whether any entry holds a non-empty `links` list: with none, the drop-links pass would only rebuild the same reply. */
  hasLinks: boolean;
  fallback: Truncated;
}

/** True when `value` holds a non-empty `links` list at any depth. */
function holdsLinks(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsLinks);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([name, field]) => (name === "links" && Array.isArray(field) ? field.length > 0 : holdsLinks(field)));
}

/** The length of the reply as the client receives it: the data block plus the note block. */
function replyLength(reply: Truncated): number {
  return JSON.stringify(reply.data).length + reply.note.length;
}

/** The most leading entries that fit with the note's reserve, estimated from the sizes already measured. */
function estimateShown(plan: CutPlan): number {
  let used = plan.fixed + NOTE_RESERVE;
  let shown = 0;
  for (const size of plan.sizes) {
    used += size + (shown > 0 ? 1 : 0);
    if (used > MAX_RESULT_CHARS) break;
    shown++;
  }
  return shown;
}

/**
 * The reply cut to the limit by construction: it drops the last entry while the measured reply is over,
 * then, with the fewest entries left, cuts long strings to shorter and shorter lengths; only a reply whose
 * measured length is within MAX_RESULT_CHARS is returned, the fixed small fallback when nothing else is.
 */
function cutReply(plan: CutPlan): Truncated {
  const start = Math.max(estimateShown(plan), plan.minShown);
  for (let shown = start; shown >= plan.minShown; shown--) {
    const reply = plan.build(shown, null);
    if (replyLength(reply) <= MAX_RESULT_CHARS) return reply;
  }
  for (const clip of STRING_CLIPS) {
    const reply = plan.build(plan.minShown, clip);
    if (replyLength(reply) <= MAX_RESULT_CHARS) return reply;
  }
  // Still over: urls are never cut, so the kept entries lose every link (the note says so); the item stays listed.
  // With no link anywhere there is nothing to drop and the passes would rebuild the same replies.
  for (const clip of plan.hasLinks ? STRING_CLIPS : []) {
    const reply = plan.build(plan.minShown, clip, true);
    if (replyLength(reply) <= MAX_RESULT_CHARS) return reply;
  }
  return plan.fallback;
}

/** The note: how many were shown and dropped, the first dropped entry when it can be named, and whether text was cut. */
function cutNote(shown: number, total: number, clip: number | null, what: string, advice: string, firstDropped: string | null = null, droppedLinks = false): string {
  const dropped = total - shown;
  const first = firstDropped === null ? "" : `, first dropped ${firstDropped}`;
  const droppedText = dropped > 0 ? ` (${dropped} dropped${first})` : "";
  return `truncated: ${shown} of ${total} ${what} shown${droppedText}${advice}${clip === null ? "" : "; long text is cut"}${droppedLinks ? "; links were dropped" : ""}`;
}

function stringField(entry: unknown, name: string): string | null {
  const value = (entry as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : null;
}

/** An item entry is named by its key, with the hint to read it with get_item. */
function itemDropped(entry: unknown): string | null {
  const key = stringField(entry, "key");
  return key === null ? null : `key ${key}; ask for it with get_item`;
}

/** A run row is named by its item key and step id, which `get_item` takes; a stat row by its process key. */
export function runDropped(entry: unknown): string | null {
  const item = stringField(entry, "item_key");
  const step = stringField(entry, "step_id");
  if (item !== null && step !== null) return `run ${item} step ${step}`;
  const process = stringField(entry, "process");
  return process === null ? null : `process key ${process}`;
}

/** How a list reply is worded: what the entries are, how to narrow the call, how a dropped entry is named, and a notice the reader must see even when everything fits. */
export interface ListOptions {
  what?: string;
  advice?: string;
  dropped?: (entry: unknown) => string | null;
  notice?: string;
}

/**
 * The entries as they are when they fit the limit, else a `Truncated` whose measured reply fits it. A `notice`
 * (a partial read) always comes as the note block.
 */
export function fitList<T>(entries: T[], options: ListOptions = {}): unknown {
  const { what = "items", advice = "; narrow the call with project, type or window_hours", dropped = itemDropped, notice = "" } = options;
  const withNotice = (note: string): string => (notice ? `${note}; ${notice}` : note);
  const sizes = entries.map((entry) => JSON.stringify(entry).length);
  const whole = 2 + sizes.reduce((sum, size) => sum + size, 0) + Math.max(entries.length - 1, 0);
  if (whole <= MAX_RESULT_CHARS) return notice ? new Truncated(entries, notice) : entries;
  return cutReply({
    sizes,
    fixed: 2,
    minShown: 1,
    hasLinks: entries.some(holdsLinks),
    build: (shown, clip, dropLongLinks = false) => {
      const kept = entries.slice(0, shown);
      const data = clip === null ? kept : kept.map((entry) => clipStrings(entry, clip, dropLongLinks));
      return new Truncated(data, withNotice(cutNote(shown, entries.length, clip, what, advice, dropped(entries[shown]), dropLongLinks)));
    },
    fallback: new Truncated([], withNotice(cutNote(0, entries.length, null, what, `; the first entry alone is over the size limit${advice}`, dropped(entries[0])))),
  });
}

/** What the last-resort reply of an item keeps: its key, and its title, project, type and status cut short. */
function identityOf(item: { key: string }): Record<string, unknown> {
  const fields = item as unknown as Record<string, unknown>;
  const kept: Record<string, unknown> = { key: item.key };
  for (const name of ["project", "type", "status"]) if (typeof fields[name] === "string") kept[name] = fields[name];
  if (typeof fields.title === "string") kept.title = clipText(fields.title, STRING_CLIPS[0]!);
  return kept;
}

/** The item as it is when it fits the limit, else a `Truncated` (newest events kept) whose measured reply fits it. */
export function fitItem<T extends { key: string; events: unknown[] }>(item: T): unknown {
  const bareLength = JSON.stringify({ ...item, events: [] }).length;
  const sizes = item.events.map((event) => JSON.stringify(event).length);
  const whole = bareLength + sizes.reduce((sum, size) => sum + size, 0) + Math.max(sizes.length - 1, 0);
  if (whole <= MAX_RESULT_CHARS) return item;
  const advice = " (newest first)";
  return cutReply({
    sizes,
    fixed: bareLength,
    minShown: 0,
    hasLinks: holdsLinks(item),
    build: (shown, clip, dropLongLinks = false) => {
      const kept = item.events.slice(0, shown);
      const data = { ...item, events: kept };
      return new Truncated(clip === null ? data : clipStrings(data, clip, dropLongLinks), cutNote(shown, item.events.length, clip, "events", advice, null, dropLongLinks));
    },
    fallback: new Truncated(
      identityOf(item),
      `truncated: 0 of ${item.events.length} events shown; the item alone is over the size limit, so only its key, title and status are shown; ask for the rest with list_open${advice}`,
    ),
  });
}

export interface ToolContext {
  scope: Scope;
  repo: ItemRepository & UsageRepository & ArchiveRepository;
  /** Raw BOARD_CONFIG, parsed only by list_open. */
  rawConfig: string | undefined;
  clock: Clock;
}

export enum ToolName {
  ReportProgress = "report_progress",
  MarkDone = "mark_done",
  AskHuman = "ask_human",
  ListOpen = "list_open",
  GetItem = "get_item",
  SyncSnapshot = "sync_snapshot",
  UpsertItem = "upsert_item",
  ArchiveItem = "archive_item",
  ApplyBatch = "apply_batch",
  ListSynced = "list_synced",
  ReportUsage = "report_usage",
  ReportCap = "report_cap",
  QueryRuns = "query_runs",
  ProcessStats = "process_stats",
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerReportProgress(server, ctx);
  registerMarkDone(server, ctx);
  registerAskHuman(server, ctx);
  registerListOpen(server, ctx);
  registerGetItem(server, ctx);
  registerSyncSnapshot(server, ctx);
  registerUpsertItem(server, ctx);
  registerArchiveItem(server, ctx);
  registerApplyBatch(server, ctx);
  registerListSynced(server, ctx);
  registerReportUsage(server, ctx);
  registerReportCap(server, ctx);
  registerQueryRuns(server, ctx);
  registerProcessStats(server, ctx);
}

function registerReportUsage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ReportUsage,
    {
      description:
        "Report the running token totals of one agent on one model (idempotent). Send totals so far, never differences; the same report twice stores one sample. Only when the client can read its own token numbers; a chat usually cannot, and reports its work window with report_progress instead.",
      inputSchema: reportUsageShape,
    },
    (args) => run(ctx, Need.Write, () => reportUsage(ctx.repo, args, ctx.clock)),
  );
}

function registerReportCap(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ReportCap,
    {
      description:
        "Report one cap reading: the time taken, the plan name and the percent used (with the reset time when known) of each window the client can read.",
      inputSchema: reportCapShape,
    },
    (args) => run(ctx, Need.Write, () => reportCap(ctx.repo, args)),
  );
}

function registerSyncSnapshot(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.SyncSnapshot,
    {
      description:
        "Send one project's full doc-sync set (idempotent, atomic). Doc-sync items missing from it become done; live-only items are never touched. An empty list closes them all.",
      inputSchema: syncSnapshotShape,
    },
    (args) => run(ctx, Need.Snapshot, () => syncSnapshot(ctx.repo, args, ctx.clock)),
  );
}

function registerUpsertItem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.UpsertItem,
    {
      description:
        "Add or update one doc-sync item (idempotent), with its parts and checks, without touching any other item: the one-by-one form of sync_snapshot, and nothing is closed. A key that was archived comes back. Needs the static write token, since only a repo has plan documents.",
      inputSchema: upsertItemShape,
    },
    (args) => run(ctx, Need.Snapshot, () => upsertItem(ctx.repo, args, ctx.clock), ToolName.UpsertItem),
  );
}

function registerArchiveItem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ArchiveItem,
    {
      description:
        "Delete an item the safe way: archive it with everything under it. It leaves the board, list_open and every count, but is kept unchanged for 30 days (read it with get_item and include_archived), then removed for good. It takes the item's parts and checks and any other item from the plan documents under it, never a live bug, problem, waiting or session card. Upserting the key brings back what was archived with it; a report on it is refused. An item from the plan documents needs the static write token; any other item needs a write token.",
      inputSchema: archiveItemShape,
    },
    (args) => run(ctx, Need.Write, () => archiveItem(ctx.repo, args, ctx.clock, allows(ctx.scope, Need.Snapshot))),
  );
}

function registerApplyBatch(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ApplyBatch,
    {
      description:
        "Add, update, close and archive many items in one atomic call: a list of operations, each upsert (the item), close (a doc-sync item that left the documents; it and its parts and checks become done) or archive (as archive_item), each key once. At most 200 items together after a slice's parts and checks are counted; a bad operation refuses the whole call and names its key; one result line per operation. Nothing relies on absence, so send only what changed, in as many calls as needed. Upsert and close need the static write token.",
      inputSchema: applyBatchShape,
    },
    (args) => run(ctx, Need.Write, () => applyBatch(ctx.repo, args, ctx.clock, allows(ctx.scope, Need.Snapshot))),
  );
}

function registerListSynced(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ListSynced,
    {
      description:
        "One project's doc-sync items by key, one page at a time: key, status and a hash of what the documents last said about the item (its parts and checks included); an archived item carries archived true. A client that compares the hashes with its own documents sends only what changed. Ask for the next page with after_key = the last key shown; an empty page is the end.",
      inputSchema: listSyncedShape,
    },
    (args) => run(ctx, Need.Read, async () => fitList(await listSynced(ctx.repo, args))),
  );
}

function registerReportProgress(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ReportProgress,
    {
      description:
        "Create or update one item by its stable key (idempotent). project, type and title are required for a new key. A chat or Claude Design session reports itself here: at the start of a piece of work send key <project>/session-<id>, type unplanned, agent session, environment \"Claude chat\" or \"Claude Design\", the goal as title and its steps; report again when the work changes; the last report ends the work window the board uses to place usage it cannot read.",
      inputSchema: reportProgressShape,
    },
    (args) => run(ctx, Need.Write, () => reportWithNotice(ctx, args)),
  );
}

/** The saved item; a step whose `process` or `counts` was invalid keeps its stored value, and a second text part names those steps. */
async function reportWithNotice(ctx: ToolContext, args: Parameters<typeof reportProgress>[1]): Promise<unknown> {
  const item = await reportProgress(ctx.repo, args, ctx.clock);
  const bad = badFieldSteps(args.steps ?? undefined);
  if (bad.length === 0) return item;
  return new Truncated(item, `process or counts dropped: ${bad.map((label) => `"${label}"`).join(", ")} sent a process that is not a key (lower-case words joined by "/", at most ${MAX_PROCESS_KEY} characters) or counts that do not fit (at most ${MAX_STEP_COUNTS} lower-case names with whole numbers); the stored values were kept (null clears them)`);
}

function registerMarkDone(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.MarkDone,
    { description: "Set an existing item done. A chat or Claude Design session calls it when its piece of work ends.", inputSchema: markDoneShape },
    (args) => run(ctx, Need.Write, () => markDone(ctx.repo, args, ctx.clock)),
  );
}

function registerAskHuman(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.AskHuman,
    {
      description:
        "Create or update a waiting_for_me item: a step only the human can do. Set needs_you to put the question under Needs you on a waiting_for_me item (links say where to act). On a key of another type it sets needs_you (from needs_you, else why, else the title) on that item instead; a part or plan-document item is refused.",
      inputSchema: askHumanShape,
    },
    (args) => run(ctx, Need.Write, () => askHuman(ctx.repo, args, ctx.clock, () => parseConfig(ctx.rawConfig).staleAfterMinutes)),
  );
}

function registerListOpen(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ListOpen,
    {
      description:
        "The board window: open items plus items done inside the window, with their latest events.",
      inputSchema: listOpenShape,
    },
    (args) => run(ctx, Need.Read, async () => fitList(await listOpen(ctx.repo, args, parseConfig(ctx.rawConfig).window, ctx.clock))),
  );
}

function registerGetItem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.GetItem,
    { description: "One item with its full event history. An archived item reads only with include_archived true.", inputSchema: getItemShape },
    (args) => run(ctx, Need.Read, async () => fitItem(await itemWithCosts(ctx, args.key, args.include_archived === true))),
  );
}

const RUNS_ADVICE = "; narrow the call with process, project, limit or a shorter from/to range";
const STATS_ADVICE = "; narrow the call with project or a shorter window_days";

function registerQueryRuns(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.QueryRuns,
    {
      description:
        "Finished steps in a date range (default the last 30 days), newest first, each with its process key, time, counts and measured cost; for analysis. A step with no process key is grouped as <agent type>/<label> (process_source derived).",
      inputSchema: queryRunsShape,
    },
    (args) =>
      run(ctx, Need.Read, async () => {
        const read = await queryRuns(ctx.repo, args, ctx.clock);
        return fitList(read.rows, { what: "runs", advice: RUNS_ADVICE, dropped: runDropped, notice: read.notice });
      }),
  );
}

function registerProcessStats(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ProcessStats,
    {
      description:
        "Per process key over the last window_days (default 30): runs, median and p90 time, total tokens and peak context, and the named counts summed. A figure with no run to take it from is null.",
      inputSchema: processStatsShape,
    },
    (args) =>
      run(ctx, Need.Read, async () => {
        const read = await processStats(ctx.repo, args, ctx.clock);
        return fitList(read.rows, { what: "process keys", advice: STATS_ADVICE, dropped: runDropped, notice: read.notice });
      }),
  );
}

/** The item as `get_item` returns it, each finished step carrying its measured cost (Slice 54). */
async function itemWithCosts(ctx: ToolContext, key: string, includeArchived: boolean): ReturnType<typeof getItemWithArchive> {
  const item = await getItemWithArchive(ctx.repo, key, includeArchived);
  await withStepCosts(ctx.repo, [item]);
  return item;
}

async function run(ctx: ToolContext, needed: Need, work: () => Promise<unknown>, tool: ToolName = ToolName.SyncSnapshot): Promise<CallToolResult> {
  if (!allows(ctx.scope, needed)) return failure(refusal(ctx.scope, needed, tool));
  try {
    return success(await work());
  } catch (error) {
    if (error instanceof DomainError) return failure(error.message);
    console.error("tool failed", error);
    return failure(INTERNAL_ERROR);
  }
}

function refusal(held: Scope, needed: Need, tool: ToolName): string {
  if (needed === Need.Snapshot && held === Scope.Owner) return `forbidden: ${tool} needs the static write token`;
  return "forbidden: this token is read-only, a write token is required";
}

function success(data: unknown): CallToolResult {
  if (data instanceof Truncated) {
    return { content: [{ type: "text", text: JSON.stringify(data.data) }, { type: "text", text: data.note }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
