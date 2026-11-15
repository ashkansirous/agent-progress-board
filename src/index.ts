import { route, type RouterEnv } from "./api/router";
import { markStaleItems } from "./application/board";
import { parseConfig } from "./config";
import { D1ItemRepository } from "./infrastructure/d1Repository";

export interface Env extends RouterEnv {
  DB: D1Database;
}

const clock = { now: () => new Date() };

/** The cron job: turns live items whose heartbeat expired stale. A failed run changes nothing; the next one retries. */
async function runStaleCheck(env: Env): Promise<number> {
  const { staleAfterMinutes } = parseConfig(env.BOARD_CONFIG);
  const turned = await markStaleItems(new D1ItemRepository(env.DB), staleAfterMinutes, clock);
  console.log(`stale check: ${turned} item(s) turned stale (expiry ${staleAfterMinutes} min)`);
  return turned;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const deps = { repo: new D1ItemRepository(env.DB), clock };
    return route(request, env, deps);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runStaleCheck(env);
  },
} satisfies ExportedHandler<Env>;
