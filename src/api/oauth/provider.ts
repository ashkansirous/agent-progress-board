import OAuthProvider, { type ClientRegistrationCallbackOptions } from "@cloudflare/workers-oauth-provider";
import type { Clock } from "../../application/board";
import { parseConfig } from "../../config";
import { isAllowedRedirect } from "../../domain/redirect";
import { Scope } from "../../domain/scope";
import type { Env } from "../../env";
import { D1ItemRepository } from "../../infrastructure/d1Repository";
import { handleMcp } from "../../mcp/handler";
import { scopeForToken } from "../auth";
import { route } from "../router";
import { handleAuthorize, OWNER_KIND, READ_SCOPE, WRITE_SCOPE } from "./authorize";

const MCP_PATH = "/mcp";
const AUTHORIZE_PATH = "/authorize";
const TOKEN_PATH = "/oauth/token";
const REGISTER_PATH = "/oauth/register";
/** Registered clients expire on their own (the library default is 90 days; stated here so it stays). */
export const CLIENT_REGISTRATION_TTL_SECONDS = 90 * 24 * 60 * 60;
const LOOPBACK_HOSTS =["localhost", "127.0.0.1", "[::1]"];

/** What the API handler learns about the caller: static bearer tokens carry their scope; an OAuth-issued token carries none. */
interface CallerProps {
  scope?: Scope;
  /** Set by the authorize step on every provider-issued token. */
  kind?: typeof OWNER_KIND;
}

/**
 * The origin the provider publishes: the request's own, as https (the provider refuses plain http
 * except on a loopback host, and Workers only serve the public name over https). No host is
 * written in the repo, so the same code runs on any deployment name.
 */
export function publicOrigin(url: URL): string {
  const loopback = LOOPBACK_HOSTS.includes(url.hostname);
  return loopback ? url.origin : `https://${url.host}`;
}

/** The issuer and resource origin: `public_origin` from the board config when set, else the request's own. */
export function issuerOrigin(url: URL, env: Env): string {
  return parseConfig(env.BOARD_CONFIG).publicOrigin ?? publicOrigin(url);
}

/**
 * Builds the provider for one request. Cheap: it only validates its options. `env` is the one
 * object of this request: the same one is handed to `fetch`, so the token check here and the
 * handlers see the same bindings.
 */
export function createProvider(origin: string, env: Env, clock: Clock): OAuthProvider<Env> {
  const extraRedirects = parseConfig(env.BOARD_CONFIG).oauthRedirectUris;
  const resource = `${origin}${MCP_PATH}`;
  return new OAuthProvider<Env>({
    apiRoute: MCP_PATH,
    apiHandler: { fetch: (request, handlerEnv, ctx) => serveMcp(request, handlerEnv, ctx.props as CallerProps, clock) },
    defaultHandler: { fetch: (request, handlerEnv) => serveOther(request, handlerEnv, clock) },
    authorizeEndpoint: `${origin}${AUTHORIZE_PATH}`,
    tokenEndpoint: `${origin}${TOKEN_PATH}`,
    clientRegistrationEndpoint: `${origin}${REGISTER_PATH}`,
    clientRegistrationTTL: CLIENT_REGISTRATION_TTL_SECONDS,
    scopesSupported: [READ_SCOPE, WRITE_SCOPE, "offline_access"],
    requiredScopes: [READ_SCOPE],
    resourceMetadata: { resource, authorization_servers: [origin] },
    resolveExternalToken: async ({ token }) => {
      const scope = await scopeForToken(token, env);
      return scope ? { props: { scope } satisfies CallerProps, audience: resource } : null;
    },
    clientRegistrationCallback: (options) => checkRegistration(options, extraRedirects),
  });
}

/** Open registration is limited to Claude's own redirect addresses. */
function checkRegistration(options: ClientRegistrationCallbackOptions, extra: string[]) {
  const uris = options.clientMetadata.redirect_uris;
  const allowed = Array.isArray(uris) && uris.length > 0 && uris.every((uri) => typeof uri === "string" && isAllowedRedirect(uri, extra));
  if (allowed) return undefined;
  console.log("oauth: registration refused (redirect address not allowed)");
  return { code: "invalid_redirect_uri", description: "Redirect address not allowed", status: 400 };
}

/**
 * The one mapping from a verified caller to a scope (Slice 16): a static token keeps its own; every
 * token the provider issued (a claude.ai sign-in, whatever scope string its grant stored, so old
 * grants need no reconnect) is the owner's: the write tools except sync_snapshot. Only the
 * positive owner marker earns Owner; missing or unknown props read.
 */
export function scopeOfCaller(props: CallerProps | undefined): Scope {
  if (props?.scope === Scope.Write || props?.scope === Scope.Read) return props.scope;
  return props?.kind === OWNER_KIND ? Scope.Owner : Scope.Read;
}

/** The MCP endpoint once a token passed. */
async function serveMcp(request: Request, env: Env, props: CallerProps, clock: Clock): Promise<Response> {
  const scope = scopeOfCaller(props);
  const repo = new D1ItemRepository(env.DB);
  return handleMcp(request, { scope, rawConfig: env.BOARD_CONFIG, repo, clock });
}

/** Everything the provider does not own: the authorize page, then the unchanged router. */
async function serveOther(request: Request, env: Env, clock: Clock): Promise<Response> {
  if (new URL(request.url).pathname === AUTHORIZE_PATH) return handleAuthorize(request, env);
  return route(request, env, { repo: new D1ItemRepository(env.DB), clock });
}
