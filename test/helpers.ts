import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import worker, { type Env } from "../src/index";

export const WRITE_TOKEN = "test-write-token";
export const READ_TOKEN = "test-read-token";
const MCP_URL = "https://example.com/mcp";
const MCP_ACCEPT = "application/json, text/event-stream";

export interface ToolReply {
  status: number;
  isError: boolean;
  text: string;
  data: unknown;
}

/** Sends a request through the Worker's own entry point (the path production uses) with some env values replaced. */
export async function fetchWithEnv(request: Request, overrides: Record<string, unknown>): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, ...overrides } as Env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function postMcp(body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: MCP_ACCEPT };
  if (token) headers.Authorization = `Bearer ${token}`;
  return exports.default.fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

/** A bare tools/call with no initialize first (stateless). */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  token: string = WRITE_TOKEN,
): Promise<ToolReply> {
  const response = await postMcp(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    token,
  );
  const json = (await response.json()) as {
    result?: { isError?: boolean; content: { text: string }[] };
    error?: { message: string };
  };
  const text = json.result?.content[0]?.text ?? json.error?.message ?? "";
  const isError = Boolean(json.result?.isError) || json.error !== undefined;
  return { status: response.status, isError, text, data: isError ? null : JSON.parse(text) };
}

export async function resetBoard(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM usage_samples"),
    env.DB.prepare("DELETE FROM cap_readings"),
    env.DB.prepare("DELETE FROM usage_series"),
  ]);
}

export async function countRows(table: "items" | "events" | "usage_samples" | "cap_readings" | "usage_series"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}
