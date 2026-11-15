import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

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

/** True only for a request carrying a valid Cloudflare Access JWT for this application. */
export async function hasAccess(request: Request, env: AccessEnv, keys: AccessKeys): Promise<boolean> {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token || !env.ACCESS_TEAM_DOMAIN?.trim() || !env.ACCESS_AUD?.trim()) return false;
  const issuer = teamUrlOf(env.ACCESS_TEAM_DOMAIN);
  try {
    await jwtVerify(token, keys(issuer), {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: [ACCESS_ALGORITHM],
    });
    return true;
  } catch {
    return false;
  }
}
