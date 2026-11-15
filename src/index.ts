import { route, type RouterEnv } from "./api/router";
import { D1ItemRepository } from "./infrastructure/d1Repository";

export interface Env extends RouterEnv {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const deps = { repo: new D1ItemRepository(env.DB), clock: { now: () => new Date() } };
    return route(request, env, deps);
  },
} satisfies ExportedHandler<Env>;
