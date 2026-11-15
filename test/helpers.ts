import { env, exports } from "cloudflare:workers";

export const WRITE_TOKEN = "test-write-token";
export const READ_TOKEN = "test-read-token";
const MCP_URL = "http://example.com/mcp";
const MCP_ACCEPT = "application/json, text/event-stream";

export interface ToolReply {
  status: number;
  isError: boolean;
  text: string;
  data: unknown;
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
  await env.DB.batch([env.DB.prepare("DELETE FROM events"), env.DB.prepare("DELETE FROM items")]);
}

export async function countRows(table: "items" | "events"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}
