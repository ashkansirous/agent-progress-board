import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { askHuman, type Clock, getItem, listOpen, markDone, reportProgress, syncSnapshot } from "../application/board";
import type { ItemRepository } from "../application/ports";
import { parseConfig } from "../config";
import { DomainError } from "../domain/upsert";
import { Scope } from "../domain/scope";
import {
  askHumanShape,
  getItemShape,
  listOpenShape,
  markDoneShape,
  reportProgressShape,
  syncSnapshotShape,
} from "./schemas";

const INTERNAL_ERROR = "internal error: the board could not complete the request";

export interface ToolContext {
  scope: Scope;
  repo: ItemRepository;
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
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerReportProgress(server, ctx);
  registerMarkDone(server, ctx);
  registerAskHuman(server, ctx);
  registerListOpen(server, ctx);
  registerGetItem(server, ctx);
  registerSyncSnapshot(server, ctx);
}

function registerSyncSnapshot(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.SyncSnapshot,
    {
      description:
        "Send one project's full doc-sync set (idempotent, atomic). Doc-sync items missing from it become done; live-only items are never touched. An empty list closes them all.",
      inputSchema: syncSnapshotShape,
    },
    (args) => run(ctx, Scope.Write, () => syncSnapshot(ctx.repo, args, ctx.clock)),
  );
}

function registerReportProgress(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.ReportProgress,
    {
      description:
        "Create or update one item by its stable key (idempotent). project, type and title are required for a new key.",
      inputSchema: reportProgressShape,
    },
    (args) => run(ctx, Scope.Write, () => reportProgress(ctx.repo, args, ctx.clock)),
  );
}

function registerMarkDone(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.MarkDone,
    { description: "Set an existing item done.", inputSchema: markDoneShape },
    (args) => run(ctx, Scope.Write, () => markDone(ctx.repo, args, ctx.clock)),
  );
}

function registerAskHuman(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.AskHuman,
    {
      description: "Create or update a waiting_for_me item: a step only the human can do.",
      inputSchema: askHumanShape,
    },
    (args) => run(ctx, Scope.Write, () => askHuman(ctx.repo, args, ctx.clock)),
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
    (args) => run(ctx, Scope.Read, () => listOpen(ctx.repo, args, parseConfig(ctx.rawConfig).window, ctx.clock)),
  );
}

function registerGetItem(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    ToolName.GetItem,
    { description: "One item with its full event history.", inputSchema: getItemShape },
    (args) => run(ctx, Scope.Read, () => getItem(ctx.repo, args.key)),
  );
}

async function run(ctx: ToolContext, needed: Scope, work: () => Promise<unknown>): Promise<CallToolResult> {
  if (needed === Scope.Write && ctx.scope !== Scope.Write) {
    return failure("forbidden: this token is read-only, a write token is required");
  }
  try {
    return success(await work());
  } catch (error) {
    if (error instanceof DomainError) return failure(error.message);
    console.error("tool failed", error);
    return failure(INTERNAL_ERROR);
  }
}

function success(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
