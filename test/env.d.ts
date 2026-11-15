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
      BOARD_CONFIG?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
