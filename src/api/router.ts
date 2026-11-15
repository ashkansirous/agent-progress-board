import type { Clock } from "../application/board";
import type { ItemRepository } from "../application/ports";
import { handleMcp } from "../mcp/handler";
import { authenticate, type TokenSecrets } from "./auth";

export const MCP_PATH = "/mcp";
const MCP_METHOD = "POST";

export interface RouterEnv extends TokenSecrets {
  BOARD_CONFIG?: string;
}

export interface RouterDeps {
  repo: ItemRepository;
  clock: Clock;
}

export async function route(request: Request, env: RouterEnv, deps: RouterDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== MCP_PATH) return new Response("Not found", { status: 404 });
  if (request.method !== MCP_METHOD) return methodNotAllowed();
  const scope = await authenticate(request, env);
  if (!scope) return unauthorized();
  return handleMcp(request, { scope, rawConfig: env.BOARD_CONFIG, ...deps });
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: MCP_METHOD } });
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}
