import { createProvider, issuerOrigin } from "./api/oauth/provider";
import { markStaleItems } from "./application/board";
import { parseConfig } from "./config";
import type { Env } from "./env";
import { D1ItemRepository } from "./infrastructure/d1Repository";

export type { Env } from "./env";

const clock = { now: () => new Date() };
const MCP_PATH = "/mcp";
const MCP_METHOD = "POST";

/** The provider treats /mcp and everything under it as the API route; only the exact path may reach the handler. */
function isBelowMcpPath(pathname: string): boolean {
  return pathname.startsWith(`${MCP_PATH}/`);
}

/** The cron job: turns live items whose heartbeat expired stale. A failed run changes nothing; the next one retries. */
async function runStaleCheck(env: Env): Promise<number> {
  const { staleAfterMinutes } = parseConfig(env.BOARD_CONFIG);
  const turned = await markStaleItems(new D1ItemRepository(env.DB), staleAfterMinutes, clock);
  console.log(`stale check: ${turned} item(s) turned stale (expiry ${staleAfterMinutes} min)`);
  return turned;
}

/**
 * A plain object, not the provider itself, so `scheduled` stays on the default export. The OAuth
 * provider answers the metadata documents, registration and the token endpoint, checks every
 * token on /mcp (OAuth or the static bearer tokens) and hands everything else to the router.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (isBelowMcpPath(url.pathname)) return new Response("Not found", { status: 404 });
    if (url.pathname === MCP_PATH && request.method !== MCP_METHOD) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: MCP_METHOD } });
    }
    // The provider stores its helpers on the env it is given and keeps them for good, tied to
    // the origin it was built with. One copy per request goes to the provider (token check and
    // origin) and so to every handler: no request shares those helpers, and nothing sees a
    // different env from the token check. (A prototype layer instead of a copy breaks the
    // provider's consent cookies: it reads the env's own keys.)
    const requestEnv: Env = { ...env };
    return createProvider(issuerOrigin(url, requestEnv), requestEnv, clock).fetch(request, requestEnv, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runStaleCheck(env);
  },
} satisfies ExportedHandler<Env>;
