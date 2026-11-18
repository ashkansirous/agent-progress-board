import type { Clock } from "../application/board";
import type { ItemRepository, UsageRepository } from "../application/ports";
import { parseUsageQuery, readUsage } from "../application/usage";
import { type BoardConfig, parseConfig } from "../config";
import { DomainError } from "../domain/upsert";
import { type AccessEnv, AccessDecision, type AccessKeys, checkAccess, KEY_RETRY_SECONDS, remoteAccessKeys } from "./access";
import type { TokenSecrets } from "./auth";
import { boardResponse, pageConfigOf } from "./board";
import { CHAT_TEXT_PATH, chatTextResponse } from "./chatText";
import { type GrantHelpers, GRANTS_PATH, isRevokePath, listGrantsResponse, revokeGrantResponse } from "./grants";
import type { UsagePageResponse } from "./usageDto";

export const BOARD_PATH = "/api/board";
export const USAGE_PATH = "/api/usage";
const READ_METHODS = ["GET", "HEAD"];
const WRITE_METHODS = ["POST"];

export interface RouterEnv extends TokenSecrets, AccessEnv {
  BOARD_CONFIG?: string;
  /** The built page (Workers static assets); the Worker runs first and hands files over after the Access check. */
  ASSETS?: Fetcher;
  /** The OAuth provider's helpers, set on every request it passes on; the grants routes use them. */
  OAUTH_PROVIDER?: GrantHelpers;
}

export interface RouterDeps {
  repo: ItemRepository & UsageRepository;
  clock: Clock;
  /** Defaults to the team's remote key set; tests pass a local one. */
  accessKeys?: AccessKeys;
}

export async function route(request: Request, env: RouterEnv, deps: RouterDeps): Promise<Response> {
  const url = new URL(request.url);
  const allowed = isRevokePath(url.pathname) ? WRITE_METHODS : READ_METHODS;
  if (!allowed.includes(request.method)) return methodNotAllowed(allowed.join(", "));
  const access = await checkAccess(request, env, deps.accessKeys ?? remoteAccessKeys);
  if (access === AccessDecision.Denied) return forbidden();
  if (access === AccessDecision.Unavailable) return unavailable();
  if (url.pathname === BOARD_PATH) return boardResponse(deps.repo, parseConfig(env.BOARD_CONFIG), deps.clock);
  if (url.pathname === CHAT_TEXT_PATH) return chatTextResponse();
  if (url.pathname === GRANTS_PATH || isRevokePath(url.pathname)) return grantsRoute(request, url, env);
  if (url.pathname === USAGE_PATH) return usageResponse(deps, url, parseConfig(env.BOARD_CONFIG));
  return env.ASSETS ? env.ASSETS.fetch(request) : notFound();
}

/** Same Access check as the board (done above); a bad query answers 400 naming the field, nothing else changes. */
async function usageResponse(deps: RouterDeps, url: URL, config: BoardConfig): Promise<Response> {
  try {
    const usage = await readUsage(deps.repo, parseUsageQuery(url.searchParams), config.usage, deps.clock);
    const body: UsagePageResponse = { ...usage, palettes: pageConfigOf(config).palettes };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError) return new Response(error.message, { status: 400 });
    throw error;
  }
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

/** 503 must not be cached (the check may work a moment later); Retry-After matches the key set's cool-down. */
function unavailable(): Response {
  return new Response("Access check unavailable", {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": String(KEY_RETRY_SECONDS) },
  });
}

/** The grants list and the revoke action, past the Access check above; without the provider's helpers they answer 503. */
async function grantsRoute(request: Request, url: URL, env: RouterEnv): Promise<Response> {
  if (!env.OAUTH_PROVIDER) return new Response("Grants unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  return isRevokePath(url.pathname) ? revokeGrantResponse(request, env.OAUTH_PROVIDER, parseConfig(env.BOARD_CONFIG)) : listGrantsResponse(env.OAUTH_PROVIDER);
}
