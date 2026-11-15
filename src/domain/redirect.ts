/** The one callback of claude.ai (web, desktop, mobile). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const LOOPBACK_CALLBACK_PATH = "/callback";

/**
 * True for an address an OAuth client may register as its redirect: Claude's callback, Claude Code's
 * loopback callback (any port) or an exact address the owner added in config.
 */
export function isAllowedRedirect(uri: string, extra: readonly string[] = []): boolean {
  if (uri === CLAUDE_CALLBACK || extra.includes(uri)) return true;
  return isLoopbackCallback(uri);
}

function isLoopbackCallback(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.includes(url.hostname) &&
    url.pathname === LOOPBACK_CALLBACK_PATH &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}
