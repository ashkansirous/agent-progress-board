#!/usr/bin/env node
/* global process */
// Notification hook: the session needs the person. Reports a `waiting_for_me` item
// `<project>/waiting-<id>` to the board (not the session card's key), only when something is asked (Slice 27):
// the card carries the question. Fails open: never blocks, always exit 0.
// The marker it leaves (state folder, named by the session id, holding the item's key) lets session-done.mjs
// close the item when the session continues or stops, and close it for a session that died.
// Input (stdin JSON): session_id, cwd, message, notification_type, transcript_path. Env as in report-progress.mjs.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool, resolveEnvironment } from '../report-progress.mjs';
import {
  HOOK_SOURCE, HOOK_TIMEOUT_MS, clip, parseInput, readGoal, readMarkerKind, readStdinText, sessionContext, stateRoot, touchSeen, writeMarker,
} from './hook-input.mjs';
import { markWaitingDone } from './session-done.mjs';
import { NOTIFICATION, cardText, lastAssistant, maskSecrets } from './waiting-card.mjs';

const TITLE_LIMIT = 200;
const HARD_KINDS = new Set([NOTIFICATION.permission, NOTIFICATION.elicitation]);
const BRANCH_TIMEOUT_MS = 500;

// The session's reported goal; with none, the project and the branch of the working folder (the project alone
// when git does not answer).
function titleOf(input, context, goal) {
  if (goal && goal.title) return clip(goal.title, TITLE_LIMIT);
  try {
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: BRANCH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (branch) return clip(`${context.project} · ${branch}`, TITLE_LIMIT);
  } catch { /* no git here */ }
  return context.project;
}

// No card for this notification: an older open waiting card of the session no longer says what is asked, so it is closed (a no-op when none was raised).
async function closeStale(input, env, root, options, reason) {
  await markWaitingDone(input, env, root, options);
  return { skipped: reason };
}

export async function run(input, env = process.env, options = {}) {
  const context = sessionContext(input, env);
  if (!context) return { skipped: 'no session or token' };
  const root = stateRoot(env);
  touchSeen(context.id, root);
  const card = cardText(input.notification_type, input.message, lastAssistant(input.transcript_path));
  const goal = readGoal(context.id, root);
  const idle = input.notification_type === NOTIFICATION.idle;
  // An idle prompt never closes an open permission or elicitation card: that prompt still waits for the person.
  if (idle && HARD_KINDS.has(readMarkerKind(input, root))) return { skipped: 'a permission or elicitation card is still open' };
  if (!card) return closeStale(input, env, root, options, 'nothing is asked');
  if (idle && goal?.needsYou) return closeStale(input, env, root, options, 'the session card holds the question');
  const environment = resolveEnvironment(env);
  const args = {
    key: context.key,
    project: context.project,
    type: 'waiting_for_me',
    status: 'open',
    title: titleOf(input, context, goal),
    needs_you: maskSecrets(card.needsYou),
    after_answer: card.afterAnswer ? maskSecrets(card.afterAnswer) : null,
    source: HOOK_SOURCE,
    ...(environment ? { environment } : {}),
  };
  const outcome = await callTool(context.config, 'report_progress', args, { timeoutMs: HOOK_TIMEOUT_MS, ...options });
  if (outcome.ok) writeMarker(input, context.key, root, input.notification_type || '');
  else process.stderr.write(`report-progress hook: skipped (${outcome.error})\n`);
  return outcome;
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  run(parseInput(readStdinText()))
    .catch(() => {})
    .finally(() => process.exit(0));
}
