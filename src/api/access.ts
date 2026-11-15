import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

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

const remoteSets = new Map<string, JWTVerifyGetKey>();

/** One remote key set per team, kept at module level so jose's key cache survives between requests. */
export const remoteAccessKeys: AccessKeys = (teamUrl) => {
  let keys = remoteSets.get(teamUrl);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${teamUrl}${ACCESS_CERTS_PATH}`));
    remoteSets.set(teamUrl, keys);
  }
  return keys;
};

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

/** Errors that mean "this token is not acceptable", as opposed to "the key set could not be read". */
const TOKEN_ERRORS = [
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
];

function isTokenError(error: unknown): boolean {
  return TOKEN_ERRORS.some((kind) => error instanceof kind);
}

/** Only the kind of failure is logged, never the token or the request. */
function logUnavailable(error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : "";
  console.error(`Access check unavailable (${kind}): ${message}`);
}

/** Decides one request: a valid Cloudflare Access JWT for this application is the only way in. */
export async function checkAccess(request: Request, env: AccessEnv, keys: AccessKeys): Promise<AccessDecision> {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token || !env.ACCESS_TEAM_DOMAIN?.trim() || !env.ACCESS_AUD?.trim()) return AccessDecision.Denied;
  try {
    const issuer = teamUrlOf(env.ACCESS_TEAM_DOMAIN);
    await jwtVerify(token, keys(issuer), { issuer, audience: env.ACCESS_AUD, algorithms: [ACCESS_ALGORITHM] });
    return AccessDecision.Granted;
  } catch (error) {
    if (isTokenError(error)) return AccessDecision.Denied;
    logUnavailable(error);
    return AccessDecision.Unavailable;
  }
}
