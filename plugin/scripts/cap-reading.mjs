/* global process, fetch, AbortSignal */
// Send one subscription cap reading to the Agent Progress Board (Slice 11 part B): one `report_cap`
// with the time taken, the plan name, each window's percent and reset time, and the source.
//
// The account usage address is asked first; when it refuses, times out or the token is expired,
// the status line file `usage-latest.json` (written by a status line script of the person's own, in the
// Claude folder; absent when they have none) is sent instead with its own time, never as "now". After a
// failed ask the address is not tried again for fifteen minutes.
// Its own state (`cap-reading-state.json`) is kept in `stateDir` (the plugin's state folder), not in the Claude folder.
//
// The sign-in token is read from `<claude dir>/.credentials.json` in memory only, sent only to
// the usage address, never printed, logged, stored, refreshed or sent to the board; the
// credentials file is never written. Fails open: every error ends as "nothing sent".
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TIMEOUT_MS, callTool } from './report-progress.mjs';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const BETA_HEADER = 'anthropic-beta';
export const BETA_VALUE = 'oauth-2025-04-20';
export const RETRY_GAP_MS = 15 * 60 * 1000;
export const CREDENTIALS_FILE = '.credentials.json';
export const LATEST_FILE = 'usage-latest.json';
export const CAP_STATE_FILE = 'cap-reading-state.json';
export const CAP_TOOL = 'report_cap';
export const SOURCE_API = 'usage-address';
export const SOURCE_STATUSLINE = 'status-line-file';
export const KIND_WEEKLY = 'weekly';
export const KIND_SHORT = 'short';
export const SCOPED_PREFIX = 'weekly:';
export const OK_GAP_MS = 4 * 60 * 1000;
export const REFUSED_GAP_MS = 60 * 1000; // after a board refusal: no repeat call to the address within a minute
const LIMIT_WEEKLY_ALL = 'weekly_all';
const LIMIT_WEEKLY_SCOPED = 'weekly_scoped';
const OAUTH_KEY = 'claudeAiOauth';
const PLAN_MAX_LENGTH = 100;
const MAX_WINDOWS = 20;
const KIND_MAX_LENGTH = 60; // the client guide gives no limit for a kind
const MINUTE_MS = 60 * 1000;
const STATUS_LINE_KINDS = { seven_day: KIND_WEEKLY, five_hour: KIND_SHORT };

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // no-fallback: a missing or broken file is "no reading"
  }
}

function isPercent(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function toIso(value) {
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

// A reset time to the nearest whole minute, as "...:00Z": the address gives a different fraction
// on every call and the board compares the strings, so both sources are cut to the same form.
function resetIso(value) {
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) return undefined; // an epoch of 0 or below is no reset time
  return new Date(Math.round(ms / MINUTE_MS) * MINUTE_MS).toISOString().replace('.000Z', 'Z');
}

function makeWindow(kind, percent, resetAt) {
  const window = { kind: String(kind).slice(0, KIND_MAX_LENGTH), percent: clampPercent(percent) };
  const iso = resetAt === undefined || resetAt === null ? undefined : resetIso(resetAt);
  return iso ? { ...window, reset_at: iso } : window;
}

// At most MAX_WINDOWS windows and one per kind (the first); the board rejects a whole report otherwise.
function uniqueWindows(windows) {
  const seen = new Set();
  return windows
    .filter((window) => (seen.has(window.kind) ? false : seen.add(window.kind)))
    .slice(0, MAX_WINDOWS);
}

// "<subscriptionType> (<rateLimitTier>)", or the first alone; '' when neither is there.
export function planOf(credentials) {
  const oauth = (credentials && credentials[OAUTH_KEY]) || {};
  const type = String(oauth.subscriptionType || '').trim();
  const tier = String(oauth.rateLimitTier || '').trim();
  const plan = type && tier ? `${type} (${tier})` : type;
  return plan.slice(0, PLAN_MAX_LENGTH);
}

export function isExpired(credentials, now) {
  const expiresAt = credentials && credentials[OAUTH_KEY] && credentials[OAUTH_KEY].expiresAt;
  return typeof expiresAt === 'number' && expiresAt <= now;
}

function scopedKind(limit) {
  const name = limit.scope && limit.scope.model && limit.scope.model.display_name;
  const slug = String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
  return slug ? `${SCOPED_PREFIX}${slug}` : '';
}

function limitWindow(limit) {
  if (!limit || !isPercent(limit.percent)) return null; // a null percent is "no reading", not 0
  if (limit.kind === LIMIT_WEEKLY_ALL) return makeWindow(KIND_WEEKLY, limit.percent, limit.resets_at);
  const kind = limit.kind === LIMIT_WEEKLY_SCOPED ? scopedKind(limit) : '';
  return kind ? makeWindow(kind, limit.percent, limit.resets_at) : null;
}

function plainWindow(kind, entry) {
  if (!entry || !isPercent(entry.utilization)) return null; // a null window is "no reading"
  return makeWindow(kind, entry.utilization, entry.resets_at);
}

function weeklyWindows(body) {
  const fromLimits = Array.isArray(body.limits) ? body.limits.map(limitWindow).filter(Boolean) : [];
  if (fromLimits.some((window) => window.kind === KIND_WEEKLY)) return fromLimits;
  return [plainWindow(KIND_WEEKLY, body.seven_day), ...fromLimits].filter(Boolean);
}

// `seven_day_breakdown` (the share per surface) is read by nobody and not sent: a share can fall
// and the board drops a falling reading as stale (Slice 11 part B, review 2026-11-16).
export function windowsFromApi(body) {
  if (!body || typeof body !== 'object') return [];
  const short = plainWindow(KIND_SHORT, body.five_hour);
  return uniqueWindows([...weeklyWindows(body), ...(short ? [short] : [])]);
}

// With `now` given, a window whose reset time is already past is dropped: its percent belongs to a
// window that has finished (review pass 2, 2026-11-16).
export function windowsFromStatusLine(limits, now) {
  if (!limits || typeof limits !== 'object') return [];
  const windows = Object.entries(limits)
    .filter(([, entry]) => entry && isPercent(entry.used_percentage))
    .map(([name, entry]) => makeWindow(Object.hasOwn(STATUS_LINE_KINDS, name) ? STATUS_LINE_KINDS[name] : name,entry.used_percentage, entry.resets_at))
    .filter((window) => now === undefined || !window.reset_at || Date.parse(window.reset_at) > now);
  return uniqueWindows(windows);
}

export async function askAddress(token, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const response = await fetchImpl(USAGE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, [BETA_HEADER]: BETA_VALUE },
      redirect: 'error', // the token goes to this address only
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null; // no-fallback: a refusal, timeout or bad body all mean "use the file"
  }
}

function readCapState(path) {
  const state = readJson(path);
  return state && typeof state === 'object' ? state : {};
}

function saveCapState(path, state) {
  try {
    const temp = `${path}.${process.pid}.tmp`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, path);
  } catch { /* the next reading tries again */ }
}

// A gap time kept in the state counts only while it lies at most `gapMs` ahead (a clock set back
// would otherwise block the address for far longer).
function inGap(until, now, gapMs) {
  return typeof until === 'number' && now < until && until - now <= gapMs;
}

// The reading from the address, or null (no usable token, in the retry gap, refused, no weekly figure).
// The token expiry is checked at the time just before the call; taken_at is when the answer arrived.
export async function readFromAddress({ credentials, clock, statePath, touch, options }) {
  const oauth = credentials && credentials[OAUTH_KEY];
  const token = oauth && oauth.accessToken;
  const startedAt = clock();
  if (!token || isExpired(credentials, startedAt)) return null;
  const state = readCapState(statePath);
  if (inGap(state.retryAfter, startedAt, RETRY_GAP_MS)) return null;
  touch();
  const body = await askAddress(token, options);
  touch();
  const arrivedAt = clock();
  const windows = windowsFromApi(body);
  const hasWeekly = windows.some((window) => window.kind === KIND_WEEKLY);
  // A usable reading saves nothing here; retryAfter 0 and the accepted plan are written by markSent once the
  // board accepted it.
  if (!hasWeekly) saveCapState(statePath, { ...state, retryAfter: arrivedAt + RETRY_GAP_MS });
  return hasWeekly ? { taken_at: new Date(arrivedAt).toISOString(), windows, source: SOURCE_API } : null;
}

// The plan the plugin last saw and since when: the same label keeps its time, a new label (or none saved)
// starts now. A status line file written before `since` holds the previous plan's percentages.
export function planSince(saved, plan, now) {
  const same = saved && typeof saved === 'object' && saved.plan === plan && typeof saved.since === 'number';
  return same ? { plan: saved.plan, since: saved.since } : { plan, since: now };
}

// Remembers the plan seen on every run, before any read, whatever the board answers.
function recordPlanSeen(statePath, plan, now) {
  const state = readCapState(statePath);
  const planSeen = planSince(state.planSeen, plan, now);
  if (!state.planSeen || state.planSeen.plan !== planSeen.plan || state.planSeen.since !== planSeen.since) {
    saveCapState(statePath, { ...state, planSeen });
  }
}

// The status line file's windows with the file's own time; an old file is still sent, never as "now".
// Not sent when it was written before the plan was first seen as current, when it is older than the last
// address reading the board accepted, or when no weekly window of it is still running.
export function readFromStatusLine({ claudeDir, statePath, clock }) {
  const saved = readJson(join(claudeDir, LATEST_FILE));
  const takenAt = saved && toIso(saved.at);
  const windows = windowsFromStatusLine(saved && saved.rate_limits, clock());
  if (!takenAt || !windows.some((window) => window.kind === KIND_WEEKLY)) return null;
  const state = readCapState(statePath);
  if (state.lastFileAt === takenAt) return null; // already sent this one
  const since = state.planSeen && state.planSeen.since;
  if (typeof since !== 'number' || Date.parse(takenAt) < since) return null; // written under another plan, or before the first run
  if (typeof state.lastAddressAt === 'number' && Date.parse(takenAt) < state.lastAddressAt) return null;
  return { taken_at: takenAt, windows, source: SOURCE_STATUSLINE };
}

export async function readCap({ claudeDir, stateDir = claudeDir, clock = Date.now, touch = () => {}, options = {} }) {
  const credentials = readJson(join(claudeDir, CREDENTIALS_FILE));
  const plan = planOf(credentials);
  if (!plan) return null; // 1% of one plan is not 1% of another: no plan, no reading
  const statePath = join(stateDir, CAP_STATE_FILE);
  recordPlanSeen(statePath, plan, clock());
  if (inGap(readCapState(statePath).okUntil, clock(), OK_GAP_MS)) return null; // read a moment ago
  const reading = (await readFromAddress({ credentials, clock, statePath, touch, options }))
    || readFromStatusLine({ claudeDir, statePath, clock });
  return reading ? { ...reading, plan } : null;
}

// What the board accepted: a file reading is not sent again; an address reading starts the
// four-minute gap and is the newest time a later file reading must not be older than.
function markSent(stateDir, reading, clock) {
  const statePath = join(stateDir, CAP_STATE_FILE);
  const state = readCapState(statePath);
  saveCapState(statePath, reading.source === SOURCE_STATUSLINE
    ? { ...state, lastFileAt: reading.taken_at }
    : { ...state, retryAfter: 0, okUntil: clock() + OK_GAP_MS, lastAddressAt: Date.parse(reading.taken_at) });
}

// The board refused an address reading: wait a short gap before asking the address again.
function markRefused(stateDir, clock) {
  const statePath = join(stateDir, CAP_STATE_FILE);
  saveCapState(statePath, { ...readCapState(statePath), retryAfter: clock() + REFUSED_GAP_MS });
}

// Read one cap and send it. Returns { sent: true } or { skipped: <reason> }. Never throws except
// what `touch` throws (the caller's lock lost), which must stop the run.
export async function sendCapReading({ config, claudeDir, stateDir = claudeDir, clock = Date.now, touch = () => {}, options = {} }) {
  const reading = await readCap({ claudeDir, stateDir, clock, touch, options });
  if (!reading) return { skipped: 'no reading' };
  touch();
  const outcome = await callTool(config, CAP_TOOL, reading, options);
  if (outcome.ok) markSent(stateDir, reading, clock);
  else if (reading.source === SOURCE_API) markRefused(stateDir, clock);
  return outcome.ok ? { sent: true, source: reading.source } : { skipped: outcome.error };
}
