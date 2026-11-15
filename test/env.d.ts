import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
    interface Env {
      DB: D1Database;
      BOARD_WRITE_TOKEN: string;
      BOARD_READ_TOKEN: string;
      OAUTH_KV: KVNamespace;
      /** Set by the provider per request; typed so tests can pass `env` to the Worker's own handlers. */
      OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
      OWNER_PASSPHRASE?: string;
      BOARD_CONFIG?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
