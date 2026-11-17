import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { SERVER_INSTRUCTIONS } from "./instructions";
import { registerTools, type ToolContext } from "./tools";

const SERVER_NAME = "agent-progress-board";
const SERVER_VERSION = "0.1.0";

/**
 * Stateless MCP: a fresh server and transport per request, no sessions, no Durable Objects.
 * The SDK transport skips session checks when sessionIdGenerator is undefined, so a lone
 * tools/call (no initialize) is served too, and enableJsonResponse returns plain JSON.
 */
export async function handleMcp(request: Request, ctx: ToolContext): Promise<Response> {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
