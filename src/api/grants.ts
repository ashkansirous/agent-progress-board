import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { BoardConfig } from "../config";

export const GRANTS_PATH = "/api/grants";
/** The one user every grant belongs to; the authorize step stores it, this file lists and ends by it. */
export const OWNER_USER_ID = "owner";
const REVOKE_PATTERN = /^\/api\/grants\/([^/]+)\/revoke$/;
const MS_PER_SECOND = 1000;
const NO_CONTENT = 204;
const FORBIDDEN = 403;
const BAD_REQUEST = 400;
const UNAVAILABLE = 503;
const SAME_ORIGIN = "same-origin";
/** The list is read in pages of the provider's default size; this bounds the loop for a runaway cursor. */
const MAX_PAGES = 20;
/** Shown when the client registered no name. */
const UNNAMED_CLIENT = "";

/** The part of the provider's helpers this file uses; tests pass a fake. */
export type GrantHelpers = Pick<OAuthHelpers, "listUserGrants" | "revokeGrant" | "lookupClient">;

/** One app the owner signed in from. The page builds the text; no scope is shown (Slice 37). */
export interface GrantDto {
  id: string;
  client_name: string;
  connected_at: string;
}

export interface GrantsResponse {
  grants: GrantDto[];
  /** True when more grants exist than were read; the page says so. */
  truncated: boolean;
}

export function isRevokePath(pathname: string): boolean {
  return REVOKE_PATTERN.test(pathname);
}

/** The grant id of a `/api/grants/<id>/revoke` path, or null. */
function grantIdOf(pathname: string): string | null {
  const raw = REVOKE_PATTERN.exec(pathname)?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The origin the page is served from: `public_origin` from the board config when set (as for the OAuth issuer),
 * else the request's own.
 */
function expectedOrigin(url: URL, config: BoardConfig): string {
  return config.publicOrigin ?? url.origin;
}

/** A browser tells the Worker where a POST came from: `Origin` must be its own, or (no `Origin`) `Sec-Fetch-Site` must say same-origin. */
function isSameOrigin(request: Request, expected: string): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === expected;
  return request.headers.get("Sec-Fetch-Site") === SAME_ORIGIN;
}

/** Only the kind of failure is logged, never a grant id or a message that could hold one. */
function unavailable(action: string, error: unknown): Response {
  console.error(`grants: ${action} failed (${error instanceof Error ? error.name : typeof error})`);
  return new Response("Unavailable", { status: UNAVAILABLE, headers: { "Cache-Control": "no-store" } });
}

async function clientNameOf(helpers: GrantHelpers, clientId: string): Promise<string> {
  try {
    return (await helpers.lookupClient(clientId))?.clientName ?? UNNAMED_CLIENT;
  } catch {
    return UNNAMED_CLIENT;
  }
}

/** Reads up to MAX_PAGES pages; `truncated` is true when the provider still had a cursor after the last one. */
async function allGrants(helpers: GrantHelpers) {
  const grants = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await helpers.listUserGrants(OWNER_USER_ID, cursor ? { cursor } : undefined);
    grants.push(...result.items);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return { grants, truncated: cursor !== undefined };
}

/** The owner's grants, newest first. Behind the same Access check as the page (the router calls this after it). */
export async function listGrantsResponse(helpers: GrantHelpers): Promise<Response> {
  let listed;
  try {
    listed = await allGrants(helpers);
  } catch (error) {
    return unavailable("list", error);
  }
  const { grants, truncated } = listed;
  if (truncated) console.error(`grants: list cut after ${MAX_PAGES} pages, more grants exist`);
  const names = new Map<string, Promise<string>>();
  const nameOf = (clientId: string): Promise<string> => {
    let name = names.get(clientId);
    if (!name) {
      name = clientNameOf(helpers, clientId);
      names.set(clientId, name);
    }
    return name;
  };
  const dtos: GrantDto[] = await Promise.all(
    grants.map(async (grant) => ({
      id: grant.id,
      client_name: await nameOf(grant.clientId),
      connected_at: new Date(grant.createdAt * MS_PER_SECOND).toISOString(),
    })),
  );
  dtos.sort((a, b) => b.connected_at.localeCompare(a.connected_at));
  const body: GrantsResponse = { grants: dtos, truncated };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Ends one grant: the provider deletes its tokens and the grant record. A browser page on another origin
 * cannot send this (an `Origin` that is not the Worker's own is refused), so the Access cookie alone is not enough.
 */
export async function revokeGrantResponse(request: Request, helpers: GrantHelpers, config: BoardConfig): Promise<Response> {
  const url = new URL(request.url);
  if (!isSameOrigin(request, expectedOrigin(url, config)))return new Response("Forbidden", { status: FORBIDDEN });
  const grantId = grantIdOf(url.pathname);
  if (!grantId) return new Response("Bad grant id", { status: BAD_REQUEST });
  try {
    await helpers.revokeGrant(grantId, OWNER_USER_ID);
  } catch (error) {
    return unavailable("revoke", error);
  }
  console.log("grants: owner ended a grant");
  return new Response(null, { status: NO_CONTENT, headers: { "Cache-Control": "no-store" } });
}
