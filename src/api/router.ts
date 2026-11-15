import type { Clock } from "../application/board";
import type { ItemRepository } from "../application/ports";
import { parseConfig } from "../config";
import { type AccessEnv, AccessDecision, type AccessKeys, checkAccess, remoteAccessKeys } from "./access";
import type { TokenSecrets } from "./auth";
import { boardResponse } from "./board";

export const BOARD_PATH = "/api/board";
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
  if (!READ_METHODS.includes(request.method)) return methodNotAllowed(READ_METHODS.join(", "));
  const access = await checkAccess(request, env, deps.accessKeys ?? remoteAccessKeys);
  if (access === AccessDecision.Denied) return forbidden();
  if (access === AccessDecision.Unavailable) return unavailable();
  if (url.pathname === BOARD_PATH) return boardResponse(deps.repo, parseConfig(env.BOARD_CONFIG), deps.clock);
  return env.ASSETS ? env.ASSETS.fetch(request) : notFound();
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

function unavailable(): Response {
  return new Response("Access check unavailable", { status: 503 });
}
