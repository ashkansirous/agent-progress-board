import { env, exports } from "cloudflare:workers";
import { createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleAuthorize } from "../src/api/oauth/authorize";
import { CLIENT_REGISTRATION_TTL_SECONDS, scopeOfCaller } from "../src/api/oauth/provider";
import { allows, Need, Scope } from "../src/domain/scope";
import { callTool, countRows, fetchWithEnv, READ_TOKEN, resetBoard, WRITE_TOKEN } from "./helpers";

const ORIGIN = "https://board.example.com";
const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const PASSPHRASE = "test-owner-passphrase-0123456789-abcdef";
describe("scopeOfCaller", () => {
  it("gives the owner only to the positive owner marker; missing or unknown props read", () => {
    expect(scopeOfCaller({ kind: "owner" })).toBe(Scope.Owner);
    expect(scopeOfCaller(undefined)).toBe(Scope.Read);
    expect(scopeOfCaller({})).toBe(Scope.Read);
    expect(scopeOfCaller({ kind: "other" } as never)).toBe(Scope.Read);
    expect(scopeOfCaller({ scope: Scope.Write })).toBe(Scope.Write);
  });

  it("refuses a scope or need the rule does not name, without throwing", () => {
    expect(allows("future" as Scope, Need.Read)).toBe(false);
    expect(allows(Scope.Read, "future" as Need)).toBe(false);
    expect(allows(Scope.Owner, Need.Write)).toBe(true);
    expect(allows(Scope.Owner, Need.Snapshot)).toBe(false);
  });
});

const SLICE = { key: "demo-app/slice-1", project: "demo-app", type: "slice", title: "Sample slice" };

interface Registered {
  client_id: string;
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

function fetchBoard(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, init);
}

async function register(redirectUris: string[]): Promise<Response> {
  return fetchBoard("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test client",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
}

async function registerClient(): Promise<string> {
  const response = await register([CLAUDE_REDIRECT]);
  expect(response.status).toBe(201);
  return ((await response.json()) as Registered).client_id;
}

function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT,
    scope: "mcp:read",
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
    ...extra,
  });
  for (const [name, value] of [...params]) if (value === "") params.delete(name);
  return `${ORIGIN}/authorize?${params.toString()}`;
}

/** Opens the consent page and returns its handle and the cookies the browser would send back. */
async function openConsent(url: string): Promise<Consent> {
  return readConsent(await exports.default.fetch(url));
}

interface Consent {
  handle: string;
  cookie: string;
  html: string;
  status: number;
}

/** The handle and cookies of a consent page the Worker just sent (the first one, or a re-shown form). */
async function readConsent(response: Response): Promise<Consent> {
  const html = await response.text();
  const handle = /name="handle" value="([^"]*)"/.exec(html)?.[1] ?? "";
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { handle, cookie, html, status: response.status };
}

function submit(url: string, fields: Record<string, string>, cookie: string, address = "203.0.113.7"): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie };
  if (address) headers["CF-Connecting-IP"] = address;
  return exports.default.fetch(url, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

async function signIn(passphrase: string): Promise<{ clientId: string; verifier: string; response: Response }> {
  const clientId = await registerClient();
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const url = authorizeUrl(clientId, await challengeFor(verifier));
  const consent = await openConsent(url);
  const response = await submit(url, { handle: consent.handle, passphrase, decision: "approve" }, consent.cookie);
  return { clientId, verifier, response };
}

async function exchange(clientId: string, verifier: string, location: string): Promise<Tokens> {
  const code = new URL(location).searchParams.get("code") ?? "";
  const response = await fetchBoard("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }).toString(),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Tokens;
}

async function oauthToken(): Promise<string> {
  const { clientId, verifier, response } = await signIn(PASSPHRASE);
  expect(response.status, await response.clone().text()).toBe(302);
  expect(response.headers.get("Location"), "Location").toContain("code=");
  return (await exchange(clientId, verifier, response.headers.get("Location") ?? "")).access_token;
}

function mcpCall(token: string | null, name: string, args: Record<string, unknown>): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchBoard("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

beforeEach(async () => {
  await resetBoard();
  const keys = await env.OAUTH_KV.list();
  await Promise.all(keys.keys.map((key) => env.OAUTH_KV.delete(key.name)));
});

describe("bearer tokens on /mcp", () => {
  it("still lets the write token write and the read token only read", async () => {
    expect((await callTool("report_progress", SLICE, WRITE_TOKEN)).isError).toBe(false);
    expect((await callTool("list_open", {}, READ_TOKEN)).isError).toBe(false);
    const refused = await callTool("report_progress", { ...SLICE, key: "demo-app/slice-2" }, READ_TOKEN);
    expect(refused.isError).toBe(true);
    expect(await countRows("items")).toBe(1);
  });

  it("answers 401 with the resource-metadata pointer when there is no token or a wrong one", async () => {
    for (const token of [null, "wrong-token"]) {
      const response = await mcpCall(token, "list_open", {});
      expect(response.status).toBe(401);
      const challenge = response.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toContain("Bearer");
      expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    }
  });

  it("checks tokens and runs the handlers against the env of the request", async () => {
    const swapped = { BOARD_WRITE_TOKEN: "swapped-write-token" };
    const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_progress", arguments: SLICE } };
    const post = (token: string) =>
      fetchWithEnv(
        new Request(`${ORIGIN}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
        swapped,
      );
    expect((await post(WRITE_TOKEN)).status).toBe(401);
    const accepted = await post("swapped-write-token");
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).not.toContain('"isError":true');
    expect(await countRows("items")).toBe(1);
  });

  it("keeps answering 405 to a GET on /mcp, with or without a token", async () => {
    expect((await fetchBoard("/mcp")).status).toBe(405);
    const withToken = await fetchBoard("/mcp", { headers: { Authorization: `Bearer ${WRITE_TOKEN}` } });
    expect(withToken.status).toBe(405);
  });

  it("answers 404 to every method on every path under /mcp, with or without a token", async () => {
    for (const path of ["/mcp/", "/mcp/x", "/mcp/x/y"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await fetchBoard(path, { method, headers: { Authorization: `Bearer ${WRITE_TOKEN}` } });
        expect(response.status, `${method} ${path}`).toBe(404);
        expect((await fetchBoard(path, { method })).status, `${method} ${path} without a token`).toBe(404);
      }
    }
  });
});

describe("metadata and registration", () => {
  it("publishes the protected resource and authorization server documents", async () => {
    const resource = (await (await fetchBoard("/.well-known/oauth-protected-resource/mcp")).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(`${ORIGIN}/mcp`);
    expect(resource.authorization_servers).toEqual([ORIGIN]);
    const server = (await (await fetchBoard("/.well-known/oauth-authorization-server")).json()) as Record<
      string,
      unknown
    >;
    expect(server.issuer).toBe(ORIGIN);
    expect(server.authorization_endpoint).toBe(`${ORIGIN}/authorize`);
    expect(server.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(server.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("pins the issuer and resource to public_origin from the config, whatever host the request used", async () => {
    const pinned = "https://pinned.example.org";
    const overrides = { BOARD_CONFIG: JSON.stringify({ public_origin: pinned }) };
    const server = (await (await fetchWithEnv(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), overrides)).json()) as Record<string, string>;
    expect(server.issuer).toBe(pinned);
    expect(server.token_endpoint).toBe(`${pinned}/oauth/token`);
    const found = await fetchWithEnv(new Request(`${pinned}/.well-known/oauth-protected-resource/mcp`), overrides);
    const resource = (await found.json()) as { resource: string; authorization_servers: string[] };
    expect(resource.resource).toBe(`${pinned}/mcp`);
    expect(resource.authorization_servers).toEqual([pinned]);
  });

  it("ignores a public_origin that is not a bare https origin and keeps the request origin", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const bad of ["http://board.example.com", "https://board.example.com/path", "not a url", 5]) {
      const overrides = { BOARD_CONFIG: JSON.stringify({ public_origin: bad }) };
      const server = (await (await fetchWithEnv(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), overrides)).json()) as {
        issuer: string;
      };
      expect(server.issuer, String(bad)).toBe(ORIGIN);
    }
    log.mockRestore();
  });

  it("registers Claude's callback and Claude Code's loopback callback", async () => {
    expect((await register([CLAUDE_REDIRECT])).status).toBe(201);
    expect((await register(["http://127.0.0.1:53682/callback"])).status).toBe(201);
    expect((await register(["http://localhost:8080/callback"])).status).toBe(201);
  });

  it("gives every registered client an expiry", async () => {
    const clientId = await registerClient();
    const listed = await env.OAUTH_KV.list({ prefix: `client:${clientId}` });
    expect(listed.keys).toHaveLength(1);
    const expiration = listed.keys[0]?.expiration ?? 0;
    const nowSeconds = Date.now() / 1000;
    expect(expiration).toBeGreaterThan(nowSeconds);
    expect(expiration).toBeLessThanOrEqual(nowSeconds + CLIENT_REGISTRATION_TTL_SECONDS + 60);
  });

  it("refuses any other redirect address, alone or beside an allowed one", async () => {
    for (const uris of [["https://attacker.example/cb"], [CLAUDE_REDIRECT, "https://attacker.example/cb"], ["http://evil.example/callback"]]) {
      const response = await register(uris);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/^invalid_/);
    }
  });
});

describe("authorize and token", () => {
  it("signs the owner in with PKCE; the OAuth token reads and writes but cannot sync documents", async () => {
    await callTool("report_progress", SLICE);
    const token = await oauthToken();
    const read = await mcpCall(token, "list_open", {});
    expect(read.status).toBe(200);
    expect(await read.text()).toContain(SLICE.key);
    const write = await mcpCall(token, "report_progress", { ...SLICE, key: "demo-app/slice-2", environment: "Claude chat" });
    expect(await write.text()).not.toContain("forbidden");
    expect(await countRows("items")).toBe(2);
    const sync = await mcpCall(token, "sync_snapshot", { project: "demo-app", items: [] });
    expect(await sync.text()).toContain("forbidden: sync_snapshot needs the static write token");
    expect(await countRows("items")).toBe(2);
  });

  it("lets an OAuth caller use every write tool but sync_snapshot", async () => {
    const token = await oauthToken();
    const session = { key: "demo-app/session-c1", project: "demo-app", type: "unplanned", title: "Plan a trip", agent: "session", environment: "Claude chat" };
    const calls: [string, Record<string, unknown>][] = [
      ["report_progress", session],
      ["ask_human", { key: "demo-app/waiting-1", project: "demo-app", title: "Pick a date" }],
      ["mark_done", { key: session.key }],
      ["report_cap", { taken_at: "2026-11-17T10:00:00Z", plan: "max", windows: [{ kind: "weekly", percent: 10 }] }],
      [
        "report_usage",
        { agent_key: "demo-app/session-c1", model: "m", record_at: "2026-11-17T10:00:00Z", input_tokens: 1, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 1, environment: "Claude chat" },
      ],
    ];
    for (const [name, args] of calls) {
      const reply = await (await mcpCall(token, name, args)).text();
      expect(reply, name).not.toContain("forbidden");
      expect(reply, name).not.toContain('"isError":true');
    }
    const stored = await env.DB.prepare("SELECT environment, agent FROM items WHERE key = ?1").bind(session.key).first<{ environment: string; agent: string }>();
    expect(stored).toEqual({ environment: "Claude chat", agent: "session" });
  });

  it("stores a session report from an OAuth caller with no environment as given", async () => {
    const token = await oauthToken();
    await mcpCall(token, "report_progress", { key: "demo-app/session-c2", project: "demo-app", type: "unplanned", title: "Chat", agent: "session" });
    const stored = await env.DB.prepare("SELECT environment FROM items WHERE key = 'demo-app/session-c2'").first<{ environment: string | null }>();
    expect(stored?.environment).toBeNull();
  });

  it("still refuses a read bearer token on a write tool and lets the write token sync", async () => {
    expect((await callTool("report_progress", SLICE, READ_TOKEN)).text).toContain("read-only");
    expect((await callTool("sync_snapshot", { project: "demo-app", items: [] }, WRITE_TOKEN)).isError).toBe(false);
  });

  it("refuses a token request with the wrong PKCE verifier", async () => {
    const { clientId, response } = await signIn(PASSPHRASE);
    const code = new URL(response.headers.get("Location") ?? "").searchParams.get("code") ?? "";
    const bad = await fetchBoard("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: CLAUDE_REDIRECT,
        code_verifier: "not-the-verifier-not-the-verifier-not-the-verifier",
        resource: `${ORIGIN}/mcp`,
      }).toString(),
    });
    expect(bad.status).toBe(400);
  });

  it("shows the form with the client name escaped", async () => {
    const response = await fetchBoard("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "<script>alert(1)</script>",
        redirect_uris: [CLAUDE_REDIRECT],
        token_endpoint_auth_method: "none",
      }),
    });
    const { client_id } = (await response.json()) as Registered;
    const consent = await openConsent(authorizeUrl(client_id, await challengeFor("v".repeat(50))));
    expect(consent.status).toBe(200);
    expect(consent.html).not.toContain("<script>alert(1)");
    expect(consent.html).toContain("&lt;script&gt;");
    expect(consent.html).toContain('type="password"');
  });

  it("forbids framing the consent page", async () => {
    const clientId = await registerClient();
    const response = await exports.default.fetch(authorizeUrl(clientId, await challengeFor("v".repeat(50))));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sends a denial back to the client as access_denied", async () => {
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await challengeFor("v".repeat(50)));
    const consent = await openConsent(url);
    const response = await submit(url, { handle: consent.handle, decision: "deny" }, consent.cookie);
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("Location") ?? "").searchParams.get("error")).toBe("access_denied");
  });

  it("re-shows the form with an error on a wrong passphrase and gives no code", async () => {
    const { response } = await signIn("not-the-passphrase");
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain("That passphrase is not right.");
    expect(html).toContain('type="password"');
    expect(response.headers.get("Location")).toBeNull();
  });

  it("never locks: each wrong try re-shows the form with a fresh handle, and the right passphrase still works", async () => {
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await challengeFor("v".repeat(50)));
    let consent = await openConsent(url);
    const handles = new Set([consent.handle]);
    for (let attempt = 0; attempt < 10; attempt++) {
      const wrong = await submit(url, { handle: consent.handle, passphrase: "nope", decision: "approve" }, consent.cookie);
      expect(wrong.status).toBe(401);
      consent = await readConsent(wrong);
      expect(consent.handle).not.toBe("");
      handles.add(consent.handle);
    }
    expect(handles.size).toBe(11);
    const right = await submit(url, { handle: consent.handle, passphrase: PASSPHRASE, decision: "approve" }, consent.cookie);
    expect(right.status).toBe(302);
    expect(right.headers.get("Location")).toContain("code=");
    expect((await env.OAUTH_KV.list({ prefix: "owner-lockout" })).keys).toHaveLength(0);
  });

  it("refuses everyone while OWNER_PASSPHRASE is shorter than 32 characters", async () => {
    const short = { ...env, OWNER_PASSPHRASE: "x".repeat(31) };
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await challengeFor("v".repeat(50)));
    const get = await handleAuthorize(new Request(url), short);
    expect(get.status).toBe(403);
    const post = await handleAuthorize(
      new Request(url, { method: "POST", body: new URLSearchParams({ passphrase: short.OWNER_PASSPHRASE, decision: "approve" }) }),
      short,
    );
    expect(post.status).toBe(403);
    expect(post.headers.get("Location")).toBeNull();
  });

  it("checks the consent handle and cookie before the passphrase is looked at", async () => {
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await challengeFor("v".repeat(50)));
    const consent = await openConsent(url);
    const forged = [
      { fields: { handle: "made-up", passphrase: PASSPHRASE }, cookie: "" },
      { fields: { handle: "made-up", passphrase: "nope" }, cookie: "" },
      { fields: { handle: consent.handle, passphrase: PASSPHRASE }, cookie: "" },
      { fields: { handle: consent.handle, passphrase: "nope" }, cookie: "" },
    ];
    const bodies = new Set<string>();
    for (const { fields, cookie } of forged) {
      const response = await submit(url, { ...fields, decision: "approve" }, cookie);
      expect(response.status).toBe(400);
      expect(response.headers.get("Location")).toBeNull();
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
    const genuine = await submit(url, { handle: consent.handle, passphrase: PASSPHRASE, decision: "approve" }, consent.cookie);
    expect(genuine.status).toBe(302);
  });

  it("answers 400, not 500, to a post that is not a form", async () => {
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await challengeFor("v".repeat(50)));
    for (const [type, body] of [["application/json", "{}"], ["text/plain", ""], ["application/x-www-form-urlencoded", null]] as const) {
      const response = await exports.default.fetch(url, { method: "POST", headers: { "Content-Type": type }, body });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("not valid");
    }
  });

  it("grants the scope of the stored consent request, whatever the posted URL says", async () => {
    const clientId = await registerClient();
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = await challengeFor(verifier);
    const url = authorizeUrl(clientId, challenge, { scope: "mcp:read" });
    const consent = await openConsent(url);
    const posted = authorizeUrl(clientId, challenge, { scope: "mcp:read offline_access" });
    const response = await submit(posted, { handle: consent.handle, passphrase: PASSPHRASE, decision: "approve" }, consent.cookie);
    expect(response.status).toBe(302);
    const tokens = (await exchange(clientId, verifier, response.headers.get("Location") ?? "")) as Tokens & { scope?: string };
    expect(tokens.scope).toBe("mcp:read");
    const write = await mcpCall(tokens.access_token, "report_progress", SLICE);
    expect(await write.text()).not.toContain("forbidden");
    expect(await countRows("items")).toBe(1);
  });

  it("grants the read scope when the client asked for none, and the caller still reads and reports", async () => {
    const clientId = await registerClient();
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const url = authorizeUrl(clientId, await challengeFor(verifier), { scope: "" });
    expect(new URL(url).searchParams.has("scope")).toBe(false);
    const consent = await openConsent(url);
    const response = await submit(url, { handle: consent.handle, passphrase: PASSPHRASE, decision: "approve" }, consent.cookie);
    expect(response.status).toBe(302);
    const tokens = (await exchange(clientId, verifier, response.headers.get("Location") ?? "")) as Tokens & { scope?: string };
    expect(tokens.scope).toBe("mcp:read");
    await callTool("report_progress", SLICE);
    const read = await mcpCall(tokens.access_token, "list_open", {});
    expect(read.status).toBe(200);
    expect(await read.text()).toContain(SLICE.key);
    const write = await mcpCall(tokens.access_token, "report_progress", { ...SLICE, key: "demo-app/slice-2" });
    expect(await write.text()).not.toContain("forbidden");
  });

  it("shows the client name and the full redirect address, port included, for a loopback client", async () => {
    const redirect = "http://127.0.0.1:53682/callback";
    const registered = await register([redirect]);
    const { client_id } = (await registered.json()) as Registered;
    const consent = await openConsent(authorizeUrl(client_id, await challengeFor("v".repeat(50)), { redirect_uri: redirect }));
    expect(consent.status).toBe(200);
    expect(consent.html).toContain("Test client");
    expect(consent.html).toContain(redirect);
  });

  it("refuses everyone when no OWNER_PASSPHRASE is set", async () => {
    const bare = { ...env, OWNER_PASSPHRASE: undefined };
    const clientId = await registerClient();
    const url = authorizeUrl(clientId, await challengeFor("v".repeat(50)));
    const get = await handleAuthorize(new Request(url), bare);
    expect(get.status).toBe(403);
    expect(await get.text()).toContain("not set up");
    const post = await handleAuthorize(
      new Request(url, { method: "POST", body: new URLSearchParams({ passphrase: "", decision: "approve" }) }),
      bare,
    );
    expect(post.status).toBe(403);
    expect(post.headers.get("Location")).toBeNull();
  });
});

describe("the rest of the Worker", () => {
  it("still runs the cron job on the default export", async () => {
    const controller = createScheduledController({ scheduledTime: new Date(), cron: "*/15 * * * *" });
    await worker.scheduled(controller, env);
  });

  it("leaves the board page and /api/board behind Access", async () => {
    expect((await fetchBoard("/api/board")).status).toBe(403);
    expect((await fetchBoard("/")).status).toBe(403);
    expect((await fetchBoard("/", { method: "POST" })).status).toBe(405);
  });
});
