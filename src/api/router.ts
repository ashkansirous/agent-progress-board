import type { Clock } from "../application/board";
import type { ItemRepository } from "../application/ports";
import { parseConfig } from "../config";
import { handleMcp } from "../mcp/handler";
import { type AccessEnv, type AccessKeys, hasAccess, remoteAccessKeys } from "./access";
import { authenticate, type TokenSecrets } from "./auth";
import { boardResponse } from "./board";

export const MCP_PATH = "/mcp";
export const BOARD_PATH = "/api/board";
const MCP_METHOD = "POST";
const READ_METHODS = ["GET", "HEAD"];

export interface RouterEnv extends TokenSecrets, AccessEnv {
  BOARD_CONFIG?: string;
  /** The built page (Workers static assets); the Worker runs first and hands files over after the Access check. */
  ASSETS?: Fetcher;
}

export interface RouterDeps {
  repo: ItemRepository;
  clock: Clock;
  /** Defaults to the team's remote key set; tests pass a local one. */
  accessKeys?: AccessKeys;
}

export async function route(request: Request, env: RouterEnv, deps: RouterDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === MCP_PATH) return routeMcp(request, env, deps);
  if (!READ_METHODS.includes(request.method)) return methodNotAllowed(READ_METHODS.join(", "));
  if (!(await hasAccess(request, env, deps.accessKeys ?? remoteAccessKeys))) return forbidden();
  if (url.pathname === BOARD_PATH) return boardResponse(deps.repo, parseConfig(env.BOARD_CONFIG), deps.clock);
  return env.ASSETS ? env.ASSETS.fetch(request) : notFound();
}

async function routeMcp(request: Request, env: RouterEnv, deps: RouterDeps): Promise<Response> {
  if (request.method !== MCP_METHOD) return methodNotAllowed(MCP_METHOD);
  const scope = await authenticate(request, env);
  if (!scope) return unauthorized();
  return handleMcp(request, { scope, rawConfig: env.BOARD_CONFIG, repo: deps.repo, clock: deps.clock });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: allow } });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}
