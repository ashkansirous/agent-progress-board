import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCESS_JWT_HEADER, type AccessKeys } from "../src/api/access";
import { CHAT_PREFACE, CHAT_TEXT_PATH,type ChatTextResponse } from "../src/api/chatText";
import { GRANTS_PATH } from "../src/api/grants";
import { route, type RouterEnv } from "../src/api/router";
// @ts-expect-error Vite's ?raw import has no type declaration in this project's tsconfig.
import apiSource from "../web/src/api.ts?raw";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { SERVER_INSTRUCTIONS } from "../src/mcp/instructions";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const KEY_ID = "test-key";
const FORBIDDEN = 403;
const METHOD_NOT_ALLOWED = 405;

let privateKey: CryptoKey;
let accessKeys: AccessKeys;
const routerEnv: RouterEnv = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: AUD };
const deps = () => ({ repo: new D1ItemRepository(env.DB), clock: { now: () => new Date() }, accessKeys });

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" }] });
  accessKeys = () => keySet;
});

async function accessJwt(): Promise<string> {
  return new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime("1h")
    .sign(privateKey);
}

/** The page's copy of a path constant, read from its source (the page cannot import the Worker's, which carries the server text). */
function pageConstant(name: string): string | undefined {
  return new RegExp(`export const ${name} = "([^"]+)"`).exec(apiSource)?.[1];
}

describe("the page's copies of the routes", () => {
  it("keep the same paths as the Worker", () => {
    expect(pageConstant("CHAT_TEXT_URL")).toBe(CHAT_TEXT_PATH);
    expect(pageConstant("GRANTS_URL")).toBe(GRANTS_PATH);
  });
});

describe("the chat text route", () => {
  it("returns the server instructions constant to a caller past the Access check", async () => {
    const request = new Request(`http://example.com${CHAT_TEXT_PATH}`, { headers: { [ACCESS_JWT_HEADER]: await accessJwt() } });
    const response = await route(request, routerEnv, deps());
    expect(response.status).toBe(200);
    const body = (await response.json()) as ChatTextResponse;
    expect(body.text).toBe(SERVER_INSTRUCTIONS);
    expect(body.preface).toBe(CHAT_PREFACE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses a token for another audience", async () => {
    const wrong = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setIssuer(TEAM)
      .setAudience("other-app")
      .setExpirationTime("1h")
      .sign(privateKey);
    const request = new Request(`http://example.com${CHAT_TEXT_PATH}`, { headers: { [ACCESS_JWT_HEADER]: wrong } });
    expect((await route(request, routerEnv, deps())).status).toBe(FORBIDDEN);
  });

  it("refuses a write method", async () => {
    const request = new Request(`http://example.com${CHAT_TEXT_PATH}`, {
      method: "POST",
      headers: { [ACCESS_JWT_HEADER]: await accessJwt() },
    });
    expect((await route(request, routerEnv, deps())).status).toBe(METHOD_NOT_ALLOWED);
  });

  it("refuses a caller with no Access token", async () => {
    const response = await route(new Request(`http://example.com${CHAT_TEXT_PATH}`), routerEnv, deps());
    expect(response.status).toBe(FORBIDDEN);
  });
});
