import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey, type RemoteJWKSet } from "jose";
import type { Clock } from "../application/board";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_CERTS_PATH = "/cdn-cgi/access/certs";
const ACCESS_ALGORITHM = "RS256";
const SCHEME_PATTERN = /^https?:\/\//i;
const TRAILING_SLASHES = /\/+$/;

/** Worker vars or secrets, never in the repo. Either one unset means every request is refused. */
export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/** Finds the signing keys of one Access team; a test passes a local key set instead. */
export type AccessKeys = (teamUrl: string) => JWTVerifyGetKey;

const systemClock: Clock = { now: () => new Date() };

/** The getter's errors that are about the token's key id, not about reaching the keys: a 403, no cool-down. */
function isTokenKeyError(error: unknown): boolean {
  return error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys;
}

/**
 * Wraps jose's remote key set in the one key getter. An error from the getter is either about the token's key id
 * (no or several matching keys: thrown as is, a 403) or a failure to get the keys (anything else: wrapped in
 * KeyFetchFailure, which starts a KEY_RETRY_SECONDS cool-down). During the cool-down the getter throws that failure
 * at once without calling jose, so no request refetches. Errors jwtVerify raises after the key was found never
 * come through here.
 */
function guardedKeys(remote: RemoteJWKSet, clock: Clock): JWTVerifyGetKey {
  let failure: { at: number; error: KeyFetchFailure } | null = null;
  return async (header, token) => {
    const now = clock.now().getTime();
    if (failure && now - failure.at < KEY_RETRY_SECONDS * MS_PER_SECOND) throw failure.error;
    try {
      const key = await remote(header, token);
      failure = null;
      return key;
    } catch (error) {
      if (isTokenKeyError(error)) throw error;
      failure = { at: now, error: new KeyFetchFailure(error) };
      throw failure.error;
    }
  };
}

/** One remote key set per team, kept in a map so jose's key cache survives between requests. */
export function createRemoteAccessKeys(clock: Clock): AccessKeys {
  const remoteSets = new Map<string, JWTVerifyGetKey>();
  return (teamUrl) => {
    let keys = remoteSets.get(teamUrl);
    if (!keys) {
      keys = guardedKeys(createRemoteJWKSet(new URL(`${teamUrl}${ACCESS_CERTS_PATH}`)), clock);
      remoteSets.set(teamUrl, keys);
    }
    return keys;
  };
}

/** The Worker's own key sets, at module level so the cache lives as long as the isolate. */
export const remoteAccessKeys: AccessKeys = createRemoteAccessKeys(systemClock);

/** "team.cloudflareaccess.com" or the full URL becomes the issuer URL, no trailing slash. */
export function teamUrlOf(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(TRAILING_SLASHES, "");
  return SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Granted: valid token. Denied: no or bad token (403). Unavailable: the check itself could not run (503). */
export enum AccessDecision {
  Granted = "granted",
  Denied = "denied",
  Unavailable = "unavailable",
}

/** After a failed key fetch the remote key set answers "unavailable" for this long without fetching again. */
export const KEY_RETRY_SECONDS = 10;
/** The same line is logged at most once in this window per Worker instance (asset requests would repeat it). */
const LOG_WINDOW_MS = 60_000;
const MS_PER_SECOND = 1000;

/** The key getter could not get the signing keys (fetch, timeout, bad document...); `cause` is what jose or fetch threw. */
export class KeyFetchFailure extends Error {
  constructor(readonly cause: unknown) {
    super("signing keys could not be fetched");
    this.name = "KeyFetchFailure";
  }
}

/** Throttle key to last-logged time; keyed by the kind of line, never its text, and pruned past MAX_LOG_KEYS. */
const lastLogged = new Map<string, number>();
const MAX_LOG_KEYS = 50;
const SETTINGS_LOG_KEY = "settings";

/** Test seam: forget what was logged, so each test sees its own line. */
export function resetAccessLogThrottle(): void {
  lastLogged.clear();
}

function pruneLogged(now: number): void {
  for (const [key, at] of lastLogged) {
    if (now - at >= LOG_WINDOW_MS) lastLogged.delete(key);
  }
}

function logOncePerWindow(key: string, line: string): void {
  const now = Date.now();
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < LOG_WINDOW_MS) return;
  if (lastLogged.size >= MAX_LOG_KEYS) pruneLogged(now);
  if (lastLogged.size >= MAX_LOG_KEYS) lastLogged.clear();
  lastLogged.set(key, now);
  console.error(line);
}

/** Only the kind of failure is logged, never the token or the request; repeats (and the cool-down's) fall in the throttle. */
function logUnavailable(failure: KeyFetchFailure): void {
  const cause = failure.cause;
  const kind = cause instanceof Error ? cause.name : typeof cause;
  const message = cause instanceof Error ? cause.message : "";
  logOncePerWindow(kind, `Access check unavailable (${kind}): ${message}`);
}

/** The names (never the values) of the Access settings that are unset. */
function missingSettings(env: AccessEnv): string[] {
  const missing: string[] = [];
  if (!env.ACCESS_TEAM_DOMAIN?.trim()) missing.push("ACCESS_TEAM_DOMAIN");
  if (!env.ACCESS_AUD?.trim()) missing.push("ACCESS_AUD");
  return missing;
}

/** Decides one request: a valid Cloudflare Access JWT for this application is the only way in. */
export async function checkAccess(request: Request, env: AccessEnv, keys: AccessKeys): Promise<AccessDecision> {
  const missing = missingSettings(env);
  if (missing.length > 0) {
    logOncePerWindow(`${SETTINGS_LOG_KEY}:${missing.join(",")}`, `Access check unavailable: ${missing.join(", ")} not set`);
    return AccessDecision.Unavailable;
  }
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) return AccessDecision.Denied;
  const issuer = teamUrlOf(env.ACCESS_TEAM_DOMAIN ?? "");
  let getKey: JWTVerifyGetKey;
  try {
    getKey = keys(issuer);
  } catch (error) {
    // A team domain that is no URL is a setting problem, not something the request can cause.
    logUnavailable(new KeyFetchFailure(error));
    return AccessDecision.Unavailable;
  }
  try {
    await jwtVerify(token, getKey, { issuer, audience: env.ACCESS_AUD, algorithms: [ACCESS_ALGORITHM] });
    return AccessDecision.Granted;
  } catch (error) {
    if (!(error instanceof KeyFetchFailure)) return AccessDecision.Denied;
    logUnavailable(error);
    return AccessDecision.Unavailable;
  }
}
