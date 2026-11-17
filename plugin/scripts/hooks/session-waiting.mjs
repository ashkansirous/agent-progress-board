#!/usr/bin/env node
/* global process */
// Notification hook: the session needs the person. Reports a `waiting_for_me` item
// `<project>/waiting-<id>` to the board (not the session card's key). Fails open: never blocks, always exit 0.
// The marker it leaves (state folder, named by the session id, holding the item's key) lets session-done.mjs
// close the item when the session continues or stops, and close it for a session that died.
// Input (stdin JSON): session_id, cwd, message. Env as in report-progress.mjs.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from '../report-progress.mjs';
import {
  HOOK_SOURCE, HOOK_TIMEOUT_MS, clip, parseInput, readStdinText, sessionContext, stateRoot, touchSeen, writeMarker,
} from './hook-input.mjs';

const TITLE_LIMIT = 200;
const WHY_LIMIT = 2000;
const DEFAULT_MESSAGE = 'Claude needs your attention';

export async function run(input, env = process.env, options = {}) {
  const context = sessionContext(input, env);
  if (!context) return { skipped: 'no session or token' };
  const root = stateRoot(env);
  touchSeen(context.id, root);
  const message = clip(input.message, WHY_LIMIT) || DEFAULT_MESSAGE;
  const args = {
    key: context.key,
    project: context.project,
    title: `${context.project} session needs you: ${clip(message, TITLE_LIMIT)}`,
    why: message,
    source: HOOK_SOURCE,
  };
  const outcome = await callTool(context.config, 'ask_human', args, { timeoutMs: HOOK_TIMEOUT_MS, ...options });
  if (outcome.ok) writeMarker(input, context.key, root);
  else process.stderr.write(`report-progress hook: skipped (${outcome.error})\n`);
  return outcome;
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  run(parseInput(readStdinText()))
    .catch(() => {})
    .finally(() => process.exit(0));
}
