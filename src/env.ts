import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { RouterEnv } from "./api/router";

export interface Env extends RouterEnv {
  DB: D1Database;
  /** Storage of the OAuth provider (clients, grants, tokens, consent handles). */
  OAUTH_KV: KVNamespace;
  /** Worker secret: the owner's passphrase for the authorize page. Unset means the page refuses everyone. */
  OWNER_PASSPHRASE?: string;
  /** Set by the OAuth provider on every request it passes on. */
  OAUTH_PROVIDER: OAuthHelpers;
}
