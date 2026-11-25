import { createProvider, issuerOrigin } from "./api/oauth/provider";
import { purgeArchive } from "./application/archive";
import { markStaleItems } from "./application/board";
import { thinOldUsage } from "./application/usage";
import { parseConfig } from "./config";
import { ARCHIVE_KEEP_DAYS } from "./domain/archive";
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
  const { stale, waitingClosed } = await markStaleItems(new D1ItemRepository(env.DB), staleAfterMinutes, clock);
  console.log(`stale check: ${stale} item(s) turned stale (expiry ${staleAfterMinutes} min), ${waitingClosed} waiting card(s) closed`);
  return stale;
}

/** The cron's second job: thins old usage samples. A failure is logged (it never stops the stale check, nor the other way round). */
async function runUsageThinning(env: Env): Promise<void> {
  try {
    const { usage } = parseConfig(env.BOARD_CONFIG);
    const deleted = await thinOldUsage(new D1ItemRepository(env.DB), usage.keepDays, clock);
    console.log(`usage thinning: ${deleted} sample(s) deleted (keep ${usage.keepDays} days)`);
  } catch (error) {
    console.error("usage thinning failed", error);
  }
}

/** The cron's third job: removes items archived more than 30 days ago (Slice 50). A failure is logged and never stops the other jobs. */
async function runArchivePurge(env: Env): Promise<void> {
  try {
    const { removed, unlinked } = await purgeArchive(new D1ItemRepository(env.DB), clock);
    console.log(
      `archive purge: ${removed} item(s) removed for good (archived more than ${ARCHIVE_KEEP_DAYS} days ago), ${unlinked} other row(s) unlinked from them`,
    );
  } catch (error) {
    console.error("archive purge failed", error);
  }
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
    // Each job runs even when the other throws; a failed stale check is still raised after both ran.
    const results = await Promise.allSettled([runStaleCheck(env), runUsageThinning(env), runArchivePurge(env)]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  },
} satisfies ExportedHandler<Env>;
