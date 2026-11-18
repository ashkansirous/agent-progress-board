#!/usr/bin/env node
/* global process */
// Notification hook: the session needs the person. Reports a `waiting_for_me` item
// `<project>/waiting-<id>` to the board (not the session card's key), only when something is asked (Slice 27):
// the card carries the question. Fails open: never blocks, always exit 0.
// The marker it leaves (state folder, named by the session id, holding the item's key) lets session-done.mjs
// close the item when the session continues or stops, and close it for a session that died.
// Input (stdin JSON): session_id, cwd, message, notification_type, transcript_path. Env as in report-progress.mjs.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'; // statSync: the stdin cwd check
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool, resolveEnvironment } from '../report-progress.mjs';
import {
  HOOK_SOURCE, HOOK_TIMEOUT_MS, clip, parseInput, readGoal, readMarkerKind, readStdinText, sessionContext, stateRoot, touchSeen, writeMarker,
} from './hook-input.mjs';
import { markWaitingDone } from './session-done.mjs';
import { NOTIFICATION, cardText, lastAssistant, maskSecrets } from './waiting-card.mjs';

const TITLE_LIMIT = 200;
const HARD_KINDS = new Set([NOTIFICATION.permission, NOTIFICATION.elicitation]);
const HEAD_REF = /^ref:\s*refs\/heads\/(.+?)\s*$/;
const GITDIR_POINTER = /^gitdir:\s*(.+?)\s*$/;

function repoRootOf(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The branch named by the repo's HEAD file under `cwd` (`.git/HEAD`, or the gitdir a `.git` file points to in a
// worktree); null when HEAD is detached or unreadable. No process runs, so no repo config can run a program.
// The search starts in `cwd` and walks up to the first folder that holds `.git`, stopping at the filesystem root.
export function branchOf(cwd) {
  try {
    const root = repoRootOf(cwd);
    if (!root) return null;
    let gitDir = join(root, '.git');
    if (statSync(gitDir).isFile()) {
      const pointer = GITDIR_POINTER.exec(readFileSync(gitDir, 'utf8').split(/\r?\n/)[0]);
      if (!pointer) return null;
      gitDir = resolve(root, pointer[1]);
    }
    const head = HEAD_REF.exec(readFileSync(join(gitDir, 'HEAD'), 'utf8').split(/\r?\n/)[0]);
    return head ? head[1] : null;
  } catch {
    return null;
  }
}

// The session's reported goal; with none, the project and the branch of the working folder (the project alone
// when there is no branch to read).
// A closed goal is finished work, so its title is not the title of a new waiting card.
export function titleOf(input, context, goal) {
  if (goal && goal.title && !goal.closed) return clip(goal.title, TITLE_LIMIT);
  const branch = branchOf(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  return branch ? clip(`${context.project} · ${branch}`, TITLE_LIMIT) : context.project;
}

// The stdin cwd, only when it is an absolute path to a folder that exists (git runs there to name the branch);
// anything else is left out, so git runs in the hook's own folder.
export function usableCwd(cwd) {
  try {
    return typeof cwd === 'string' && isAbsolute(cwd) && statSync(cwd).isDirectory() ? cwd : undefined;
  } catch {
    return undefined;
  }
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
    title: maskSecrets(titleOf({ ...input, cwd: usableCwd(input.cwd) }, context, goal)),
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
