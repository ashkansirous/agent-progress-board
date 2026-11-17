import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { askHuman, type Clock, getItem, listOpen, markDone, reportProgress, syncSnapshot } from "../application/board";
import type { ItemRepository, UsageRepository } from "../application/ports";
import { reportCap, reportUsage } from "../application/usage";
import { parseConfig } from "../config";
import { DomainError } from "../domain/upsert";
import { allows, Need, Scope } from "../domain/scope";
import {
  askHumanShape,
  getItemShape,
  listOpenShape,
  markDoneShape,
  reportCapShape,
  reportProgressShape,
  reportUsageShape,
  syncSnapshotShape,
} from "./schemas";

const INTERNAL_ERROR = "internal error: the board could not complete the request";

export interface ToolContext {
  scope: Scope;
  repo: ItemRepository & UsageRepository;
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
  ReportUsage = "report_usage",
  ReportCap = "report_cap",
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerReportProgress(server, ctx);
  registerMarkDone(server, ctx);
  registerAskHuman(server, ctx);
  registerListOpen(server, ctx);
  registerGetItem(server, ctx);
  registerSyncSnapshot(server, ctx);
  registerReportUsage(server, ctx);
  registerReportCap(server, ctx);
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

function registerReportProgress(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ReportProgress,
    {
      description:
        "Create or update one item by its stable key (idempotent). project, type and title are required for a new key. A chat or Claude Design session reports itself here: at the start of a piece of work send key <project>/session-<id>, type unplanned, agent session, environment \"Claude chat\" or \"Claude Design\", the goal as title and its steps; report again when the work changes; the last report ends the work window the board uses to place usage it cannot read.",
      inputSchema: reportProgressShape,
    },
    (args) => run(ctx, Need.Write, () => reportProgress(ctx.repo, args, ctx.clock)),
  );
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
        "Create or update a waiting_for_me item: a step only the human can do. On a key of another type it sets needs_you (from why, else the title) on that item instead.",
      inputSchema: askHumanShape,
    },
    (args) => run(ctx, Need.Write, () => askHuman(ctx.repo, args, ctx.clock)),
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
    (args) => run(ctx, Need.Read, () => listOpen(ctx.repo, args, parseConfig(ctx.rawConfig).window, ctx.clock)),
  );
}

function registerGetItem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.GetItem,
    { description: "One item with its full event history.", inputSchema: getItemShape },
    (args) => run(ctx, Need.Read, () => getItem(ctx.repo, args.key)),
  );
}

async function run(ctx: ToolContext, needed: Need, work: () => Promise<unknown>): Promise<CallToolResult> {
  if (!allows(ctx.scope, needed)) return failure(refusal(ctx.scope, needed));
  try {
    return success(await work());
  } catch (error) {
    if (error instanceof DomainError) return failure(error.message);
    console.error("tool failed", error);
    return failure(INTERNAL_ERROR);
  }
}

function refusal(held: Scope, needed: Need): string {
  if (needed === Need.Snapshot && held === Scope.Owner) return "forbidden: sync_snapshot needs the static write token";
  return "forbidden: this token is read-only, a write token is required";
}

function success(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
