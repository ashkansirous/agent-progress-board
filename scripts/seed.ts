/**
 * Puts the made-up demo board on a running Worker through its MCP endpoint.
 *
 *   BOARD_URL=https://<worker>/mcp BOARD_WRITE_TOKEN=<token> node scripts/seed.ts [--dry-run]
 *
 * --dry-run prints the calls and sends nothing. Like every board client it fails open: a short
 * timeout per call, errors reported on stderr, exit code 0.
 */
import { seedCalls, type ToolCall } from "./seed-data.ts";

const CALL_TIMEOUT_MS = 10_000;
const DRY_RUN_FLAG = "--dry-run";

function rpcBody(call: ToolCall, id: number): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: call });
}

async function send(url: string, token: string, call: ToolCall, id: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: rpcBody(call, id),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const reply = (await response.json()) as { error?: unknown; result?: { isError?: boolean } };
    return response.ok && !reply.error && !reply.result?.isError;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const calls = seedCalls();
  if (process.argv.includes(DRY_RUN_FLAG)) {
    for (const call of calls) console.log(rpcBody(call, 0));
    return;
  }
  const url = process.env.BOARD_URL;
  const token = process.env.BOARD_WRITE_TOKEN;
  if (!url || !token) {
    console.error("Set BOARD_URL (the /mcp endpoint) and BOARD_WRITE_TOKEN, or pass --dry-run.");
    return;
  }
  let failed = 0;
  for (const [index, call] of calls.entries()) {
    if (!(await send(url, token, call, index + 1))) {
      failed += 1;
      console.error(`seed: ${String(call.arguments.key)} was not written`);
    }
  }
  console.log(`seed: ${calls.length - failed} of ${calls.length} items written`);
}

await main().catch((error: unknown) => console.error("seed:", error instanceof Error ? error.message : error));
