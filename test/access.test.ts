import { env } from "cloudflare:test";
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_JWT_HEADER,
  AccessDecision,
  type AccessKeys,
  checkAccess,
  createRemoteAccessKeys,
  KEY_RETRY_SECONDS,
  KeyFetchFailure,
  resetAccessLogThrottle,
} from "../src/api/access";
import { type GrantHelpers, GRANTS_PATH, type GrantsResponse } from "../src/api/grants";
import { route, type RouterEnv } from "../src/api/router";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const KEY_ID = "test-key";
const ORIGIN = "https://board.example.com";
const FORBIDDEN = 403;
const UNAVAILABLE = 503;
const NO_CONTENT = 204;

let privateKey: CryptoKey;
let localKeys: AccessKeys;
const accessEnv = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: AUD };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }] });
  localKeys = () => keySet;
});

beforeEach(() => {
  resetAccessLogThrottle();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function accessJwt(): Promise<string> {
  return new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function requestWithToken(path = "/api/board", init: RequestInit = {}): Promise<Request> {
  return new Request(`${ORIGIN}${path}`, { ...init, headers: { ...init.headers, [ACCESS_JWT_HEADER]: await accessJwt() } });
}

function failingKeys(error: unknown): AccessKeys {
  return () => () => Promise.reject(error);
}

describe("checkAccess", () => {
  it("grants a valid token and denies a request with none", async () => {
    expect(await checkAccess(await requestWithToken(), accessEnv, localKeys)).toBe(AccessDecision.Granted);
    expect(await checkAccess(new Request(`${ORIGIN}/`), accessEnv, localKeys)).toBe(AccessDecision.Denied);
  });

  it("denies, not 503, for every jose error that is about the token", async () => {
    const tokenErrors = [
      new errors.JWTInvalid("bad"),
      new errors.JWEInvalid("bad"),
      new errors.JOSENotSupported("bad"),
      new errors.JWKInvalid("bad"),
      new errors.JWEDecryptionFailed(),
      new errors.JWKSNoMatchingKey(),
    ];
    for (const error of tokenErrors) {
      expect(await checkAccess(await requestWithToken(), accessEnv, failingKeys(error)), error.name).toBe(AccessDecision.Denied);
    }
  });

  it("answers unavailable when the signing keys cannot be read, and logs the kind once", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unreadable = [new errors.JWKSTimeout(), new errors.JWKSInvalid("bad"), new errors.JOSEError("Expected 200 OK"), new TypeError("fetch failed")];
    for (const cause of unreadable) {
      expect(await checkAccess(await requestWithToken(), accessEnv, failingKeys(new KeyFetchFailure(cause))), cause.name).toBe(AccessDecision.Unavailable);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Access check unavailable (JWKSTimeout)"));
    await checkAccess(await requestWithToken(), accessEnv, failingKeys(new KeyFetchFailure(new errors.JWKSTimeout())));
    expect(log.mock.calls.filter(([line]) => String(line).includes("JWKSTimeout"))).toHaveLength(1);
  });

  it("answers unavailable and names each unset setting, never a value, whether or not a token came", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noDomain = { ACCESS_AUD: AUD };
    expect(await checkAccess(await requestWithToken(), noDomain, localKeys)).toBe(AccessDecision.Unavailable);
    expect(log).toHaveBeenCalledWith("Access check unavailable: ACCESS_TEAM_DOMAIN not set");
    expect(await checkAccess(new Request(`${ORIGIN}/`), { ACCESS_TEAM_DOMAIN: " ", ACCESS_AUD: "" }, localKeys)).toBe(AccessDecision.Unavailable);
    expect(log).toHaveBeenCalledWith("Access check unavailable: ACCESS_TEAM_DOMAIN, ACCESS_AUD not set");
  });
});

describe("the remote key set", () => {
  it("does not fetch again for KEY_RETRY_SECONDS after a failed fetch, then tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);
    const clock = { at: Date.now() };
    const keys = createRemoteAccessKeys({ now: () => new Date(clock.at) })("https://cooldown.cloudflareaccess.com");
    const e = { ACCESS_TEAM_DOMAIN: "cooldown.cloudflareaccess.com", ACCESS_AUD: AUD };
    const request = await requestWithToken();
    expect(await checkAccess(request, e, () => keys)).toBe(AccessDecision.Unavailable);
    clock.at += (KEY_RETRY_SECONDS - 1) * 1000;
    expect(await checkAccess(request, e, () => keys)).toBe(AccessDecision.Unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.at += 2000;
    expect(await checkAccess(request, e, () => keys)).toBe(AccessDecision.Unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers 403, never 503, for a forged key id while the key endpoint works, and starts no cool-down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const pair = await generateKeyPair("RS256");
      const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }] };
      const fetchMock = vi.fn(() => Promise.resolve(Response.json(jwks)));
      vi.stubGlobal("fetch", fetchMock);
      const keys = createRemoteAccessKeys({ now: () => new Date() })("https://forged.cloudflareaccess.com");
      const e = { ACCESS_TEAM_DOMAIN: "forged.cloudflareaccess.com", ACCESS_AUD: AUD };
      const tokenFor = (kid: string) =>
        new SignJWT({}).setProtectedHeader({ alg: "RS256", kid }).setIssuer("https://forged.cloudflareaccess.com").setAudience(AUD).setExpirationTime("1h").sign(pair.privateKey);
      const asRequest = async (kid: string) => new Request(`${ORIGIN}/`, { headers: { [ACCESS_JWT_HEADER]: await tokenFor(kid) } });
      expect(await checkAccess(await asRequest(KEY_ID), e, () => keys)).toBe(AccessDecision.Granted);
      vi.setSystemTime(Date.now() + 40_000);
      expect(await checkAccess(await asRequest("forged"), e, () => keys)).toBe(AccessDecision.Denied);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await checkAccess(await asRequest(KEY_ID), e, () => keys)).toBe(AccessDecision.Granted);
    } finally {
      vi.useRealTimers();
    }
  });

  it("denies an expired token, not 503", async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    const request = new Request(`${ORIGIN}/`, { headers: { [ACCESS_JWT_HEADER]: expired } });
    expect(await checkAccess(request, accessEnv, localKeys)).toBe(AccessDecision.Denied);
  });

  it("denies, and does not log as unavailable, a token that raises an unexpected non-fetch error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await checkAccess(await requestWithToken(), accessEnv, failingKeys(new RangeError("odd")))).toBe(AccessDecision.Denied);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("the access log throttle", () => {
  it("is keyed by the kind of failure, so a changing message does not bypass it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const message of ["a", "b", "c"]) {
      await checkAccess(await requestWithToken(), accessEnv, failingKeys(new KeyFetchFailure(new TypeError(message))));
    }
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("the router's answers around Access", () => {
  const deps = () => ({ repo: new D1ItemRepository(env.DB), clock: { now: () => new Date() }, accessKeys: localKeys });

  it("answers 503 with no-store and Retry-After when the check is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await route(new Request(`${ORIGIN}/`), { ACCESS_AUD: AUD }, deps());
    expect(response.status).toBe(UNAVAILABLE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe(String(KEY_RETRY_SECONDS));
  });
});

interface FakeGrant {
  id: string;
  clientId: string;
  createdAt: number;
}

function fakeHelpers(grants: FakeGrant[], pageSize = 100): GrantHelpers & { revoked: string[] } {
  const revoked: string[] = [];
  return {
    revoked,
    listUserGrants: (userId, options) => {
      expect(userId).toBe("owner");
      const start = Number(options?.cursor ?? 0);
      const items = grants.slice(start, start + pageSize);
      const next = start + pageSize;
      const cursor = next < grants.length ? String(next) : undefined;
      return Promise.resolve({ items, cursor } as never);
    },
    revokeGrant: (grantId, userId) => {
      expect(userId).toBe("owner");
      revoked.push(grantId);
      return Promise.resolve();
    },
    lookupClient: (clientId) => Promise.resolve(clientId === "unnamed" ? ({} as never) : ({ clientName: `Client ${clientId}` } as never)),
  };
}

describe("the grants routes", () => {
  const grants: FakeGrant[] = [
    { id: "g1", clientId: "a", createdAt: 1_700_000_000 },
    { id: "g2", clientId: "unnamed", createdAt: 1_700_100_000 },
    { id: "g3", clientId: "c", createdAt: 1_699_000_000 },
  ];
  const deps = () => ({ repo: new D1ItemRepository(env.DB), clock: { now: () => new Date() }, accessKeys: localKeys });
  const routerEnv = (helpers: GrantHelpers): RouterEnv => ({ ...accessEnv, OAUTH_PROVIDER: helpers });

  it("refuses the list and the revoke without the Access header, and does not touch a grant", async () => {
    const helpers = fakeHelpers(grants);
    expect((await route(new Request(`${ORIGIN}${GRANTS_PATH}`), routerEnv(helpers), deps())).status).toBe(FORBIDDEN);
    const revoke = new Request(`${ORIGIN}${GRANTS_PATH}/g1/revoke`, { method: "POST" });
    expect((await route(revoke, routerEnv(helpers), deps())).status).toBe(FORBIDDEN);
    expect(helpers.revoked).toEqual([]);
  });

  it("lists the owner's grants newest first with the client name and an ISO time, across pages", async () => {
    const response = await route(await requestWithToken(GRANTS_PATH), routerEnv(fakeHelpers(grants, 2)), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as GrantsResponse;
    expect(body.grants.map((grant) => grant.id)).toEqual(["g2", "g1", "g3"]);
    expect(body.grants[1]).toEqual({ id: "g1", client_name: "Client a", connected_at: new Date(1_700_000_000_000).toISOString() });
    expect(body.grants[0]?.client_name).toBe("");
  });

  it("ends one grant on a POST from the page's own origin", async () => {
    const helpers = fakeHelpers(grants);
    const request = await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST", headers: { Origin: ORIGIN } });
    const response = await route(request, routerEnv(helpers), deps());
    expect(response.status).toBe(NO_CONTENT);
    expect(helpers.revoked).toEqual(["g1"]);
  });

  it("refuses a revoke sent from another origin", async () => {
    const helpers = fakeHelpers(grants);
    const request = await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST", headers: { Origin: "https://evil.example" } });
    expect((await route(request, routerEnv(helpers), deps())).status).toBe(FORBIDDEN);
    expect(helpers.revoked).toEqual([]);
  });

  it("takes the expected origin from public_origin when the board config sets it", async () => {
    const helpers = fakeHelpers(grants);
    const proxied = { ...routerEnv(helpers), BOARD_CONFIG: JSON.stringify({ public_origin: "https://public.example.com" }) };
    const fromPublic = await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST", headers: { Origin: "https://public.example.com" } });
    expect((await route(fromPublic, proxied, deps())).status).toBe(NO_CONTENT);
    const fromRequestHost = await requestWithToken(`${GRANTS_PATH}/g2/revoke`, { method: "POST", headers: { Origin: ORIGIN } });
    expect((await route(fromRequestHost, proxied, deps())).status).toBe(FORBIDDEN);
    expect(helpers.revoked).toEqual(["g1"]);
  });

  it("says so, and logs, when more grants exist than the page limit reads", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, clientId: "a", createdAt: 1_700_000_000 + i }));
    const body = (await (await route(await requestWithToken(GRANTS_PATH), routerEnv(fakeHelpers(many, 1)), deps())).json()) as GrantsResponse;
    expect([body.grants.length, body.truncated]).toEqual([20, true]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("more grants exist"));
    const whole = (await (await route(await requestWithToken(GRANTS_PATH), routerEnv(fakeHelpers(grants, 2)), deps())).json()) as GrantsResponse;
    expect(whole.truncated).toBe(false);
  });

  it("refuses a revoke with no Origin unless Sec-Fetch-Site says same-origin", async () => {
    const helpers = fakeHelpers(grants);
    const bare = await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST" });
    expect((await route(bare, routerEnv(helpers), deps())).status).toBe(FORBIDDEN);
    const cross = await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect((await route(cross, routerEnv(helpers), deps())).status).toBe(FORBIDDEN);
    expect(helpers.revoked).toEqual([]);
    const same = await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    expect((await route(same, routerEnv(helpers), deps())).status).toBe(NO_CONTENT);
    expect(helpers.revoked).toEqual(["g1"]);
  });

  it("looks each client up once however many grants it has", async () => {
    const helpers = fakeHelpers([...grants, { id: "g4", clientId: "a", createdAt: 1_600_000_000 }, { id: "g5", clientId: "a", createdAt: 1_600_000_001 }]);
    const lookup = vi.spyOn(helpers, "lookupClient");
    const response = await route(await requestWithToken(GRANTS_PATH), routerEnv(helpers), deps());
    expect(((await response.json()) as GrantsResponse).grants).toHaveLength(5);
    expect(lookup.mock.calls.map(([clientId]) => clientId).sort()).toEqual(["a", "c", "unnamed"]);
  });

  it("answers 503 with no-store, and logs only the kind, when the provider fails on list or revoke", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const helpers = fakeHelpers(grants);
    helpers.listUserGrants = () => Promise.reject(new Error("kv down for g1"));
    helpers.revokeGrant = () => Promise.reject(new Error("kv down for g1"));
    const list = await route(await requestWithToken(GRANTS_PATH), routerEnv(helpers), deps());
    expect([list.status, list.headers.get("Cache-Control")]).toEqual([UNAVAILABLE, "no-store"]);
    const revoke = await route(await requestWithToken(`${GRANTS_PATH}/g1/revoke`, { method: "POST", headers: { Origin: ORIGIN } }), routerEnv(helpers), deps());
    expect([revoke.status, revoke.headers.get("Cache-Control")]).toEqual([UNAVAILABLE, "no-store"]);
    expect(log).toHaveBeenCalledWith("grants: revoke failed (Error)");
    expect(log.mock.calls.some(([line]) => String(line).includes("kv down"))).toBe(false);
  });

  it("answers 405 to a GET on revoke and a POST on the list, and 503 when the provider is missing", async () => {
    const helpers = fakeHelpers(grants);
    expect((await route(await requestWithToken(`${GRANTS_PATH}/g1/revoke`), routerEnv(helpers), deps())).status).toBe(405);
    expect((await route(await requestWithToken(GRANTS_PATH, { method: "POST" }), routerEnv(helpers), deps())).status).toBe(405);
    expect((await route(await requestWithToken(GRANTS_PATH), accessEnv, deps())).status).toBe(UNAVAILABLE);
  });
});
