import { env, exports } from "cloudflare:workers";
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_JWT_HEADER, type AccessKeys, remoteAccessKeys } from "../src/api/access";
import type { BoardResponse } from "../src/api/boardDto";
import { route, type RouterDeps, type RouterEnv } from "../src/api/router";
import { D1ItemRepository } from "../src/infrastructure/d1Repository";
import { callTool, resetBoard } from "./helpers";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "test-aud-tag";
const KEY_ID = "test-key";
const PAGE_URL = "http://example.com/";
const BOARD_URL = "http://example.com/api/board";
const FIXED_NOW = new Date("2026-11-15T12:00:00.000Z");

let privateKey: CryptoKey;
let accessKeys: AccessKeys;
let assetRequests: string[];

const assets = {
  fetch: async (request: Request) => {
    assetRequests.push(new URL(request.url).pathname);
    return new Response("<html>page</html>", { headers: { "Content-Type": "text/html" } });
  },
} as unknown as Fetcher;

const accessEnv: RouterEnv = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: AUD, ASSETS: assets };

function deps(): RouterDeps {
  return { repo: new D1ItemRepository(env.DB), clock: { now: () => FIXED_NOW }, accessKeys };
}

async function sign(claims: { aud?: string; iss?: string; exp?: string } = {}): Promise<string> {
  return new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(claims.iss ?? TEAM)
    .setAudience(claims.aud ?? AUD)
    .setExpirationTime(claims.exp ?? "1h")
    .sign(privateKey);
}

function get(url: string, token?: string): Request {
  return new Request(url, { headers: token ? { [ACCESS_JWT_HEADER]: token } : {} });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" };
  const keySet = createLocalJWKSet({ keys: [publicJwk] });
  accessKeys = () => keySet;
});

beforeEach(async () => {
  assetRequests = [];
  await resetBoard();
});

describe("Access gate", () => {
  it("serves the page and the board to a valid Access token", async () => {
    const token = await sign();
    expect((await route(get(BOARD_URL, token), accessEnv, deps())).status).toBe(200);
    const page = await route(get(PAGE_URL, token), accessEnv, deps());
    expect(page.status).toBe(200);
    expect(assetRequests).toEqual(["/"]);
  });

  it("refuses a request with no token, and never reaches the assets", async () => {
    expect((await route(get(BOARD_URL), accessEnv, deps())).status).toBe(403);
    expect((await route(get(PAGE_URL), accessEnv, deps())).status).toBe(403);
    expect(assetRequests).toEqual([]);
  });

  it("refuses a wrong audience, a wrong issuer, an expired token and garbage", async () => {
    const bad = [
      await sign({ aud: "other-app" }),
      await sign({ iss: "https://other.cloudflareaccess.com" }),
      await sign({ exp: "-1h" }),
      "not-a-jwt",
    ];
    for (const token of bad) {
      expect((await route(get(BOARD_URL, token), accessEnv, deps())).status).toBe(403);
    }
  });

  it("refuses everyone while the team domain or the audience is unset", async () => {
    const token = await sign();
    for (const partial of [{ ACCESS_AUD: AUD }, { ACCESS_TEAM_DOMAIN: TEAM }, {}]) {
      expect((await route(get(BOARD_URL, token), { ...partial, ASSETS: assets }, deps())).status).toBe(403);
    }
  });

  it("refuses a token signed by a key the team does not publish", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(other.privateKey);
    expect((await route(get(BOARD_URL, forged), accessEnv, deps())).status).toBe(403);
  });

  it("answers 503, logs, and serves nothing when the key set cannot be fetched", async () => {
    const failing: AccessKeys = () => async () => {
      throw new errors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = await sign();
    for (const url of [BOARD_URL, PAGE_URL]) {
      const response = await route(get(url, token), accessEnv, { ...deps(), accessKeys: failing });
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("Access check unavailable");
    }
    expect(assetRequests).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(token);
    logged.mockRestore();
  });

  it("answers 503 and logs when the team domain is malformed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad: RouterEnv = { ...accessEnv, ACCESS_TEAM_DOMAIN: "not a domain" };
    const response = await route(get(BOARD_URL, await sign()), bad, { ...deps(), accessKeys: remoteAccessKeys });
    expect(response.status).toBe(503);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(assetRequests).toEqual([]);
    logged.mockRestore();
  });

  it("refuses the deployed worker's board when Access is not configured", async () => {
    const response = await exports.default.fetch(BOARD_URL);
    expect(response.status).toBe(403);
    expect((await exports.default.fetch(BOARD_URL, { headers: { [ACCESS_JWT_HEADER]: "x.y.z" } })).status).toBe(403);
  });

  it("leaves /mcp to its bearer tokens and answers 405 to a write on the page", async () => {
    const post = new Request(PAGE_URL, { method: "POST" });
    expect((await route(post, accessEnv, deps())).status).toBe(405);
    const mcp = await exports.default.fetch("https://example.com/mcp", { method: "POST", body: "{}" });
    expect(mcp.status).toBe(401);
  });
});

describe("GET /api/board", () => {
  async function board(extraEnv: RouterEnv = {}): Promise<BoardResponse> {
    const response = await route(get(BOARD_URL, await sign()), { ...accessEnv, ...extraEnv }, deps());
    return (await response.json()) as BoardResponse;
  }

  it("returns open items with details, links and events, and leaves out the source", async () => {
    await callTool("report_progress", {
      key: "recipe-box/slice-4",
      project: "recipe-box",
      type: "slice",
      title: "Tag search",
      status: "in_progress",
      details_md: "Search box and **tags**.",
      links: [{ label: "Slice file", url: "https://example.com/s4" }],
      source: "wave-runner",
    });
    const data = await board();
    expect(data.items).toHaveLength(1);
    const item = data.items[0]!;
    expect(item.details_md).toBe("Search box and **tags**.");
    expect(item.links).toEqual([{ label: "Slice file", url: "https://example.com/s4" }]);
    expect(item.events.length).toBeGreaterThan(0);
    expect(Object.keys(item)).not.toContain("source");
    expect(JSON.stringify(item.events)).not.toContain("wave-runner");
    expect(data.server_time).toBe(FIXED_NOW.toISOString());
  });

  it("carries the window hours and fills palettes and colour maps from the example defaults", async () => {
    const data = await board({ BOARD_CONFIG: '{"window":{"default_hours":6,"max_hours":24}}' });
    expect(data.window_hours).toBe(6);
    expect(data.config.palettes.light?.page).toBe("#F5F6F8");
    expect(data.config.palettes.dark?.page).toBe("#0E1014");
    expect(data.config.types.waiting_for_me?.label).toBe("Needs you");
    expect(data.config.priorities.P0?.dark?.bg).toBe("#E8EAEE");
    expect(data.config.statuses.blocked?.light?.fg).toBe("#B42318");
  });

  it("lets BOARD_CONFIG override a label and one palette colour, keeping the rest", async () => {
    const config = JSON.stringify({
      projects: [{ id: "recipe-box", label: "Kitchen" }],
      types: { bug: { label: "Defect", color: "#112233" } },
      palettes: { light: { page: "#FFFFFF" } },
    });
    const data = await board({ BOARD_CONFIG: config });
    expect(data.config.projects).toEqual([{ id: "recipe-box", label: "Kitchen" }]);
    expect(data.config.types.bug?.label).toBe("Defect");
    expect(data.config.types.bug?.light?.bg).toBe("#FCE4E4");
    expect(data.config.palettes.light?.page).toBe("#FFFFFF");
    expect(data.config.palettes.light?.text).toBe("#14171C");
  });

  it("counts an in-progress item with an open question as working", async () => {
    await callTool("report_progress", {
      key: "a/q", project: "a", type: "bug", title: "Asks", status: "in_progress", agent: "builder", needs_you: "Which one?",
    });
    const data = await board();
    expect(data.items[0]!.needs_you).toBe("Which one?");
    expect(data.items[0]!.working).toBe(true);
    expect(data.working_count).toBe(1);
  });

  it("lists a check that holds a question but never counts it as working, and names its slice", async () => {
    await callTool("report_progress", { key: "a/s1", project: "a", type: "slice", title: "Slice one" });
    await callTool("report_progress", {
      key: "a/s1/c1", project: "a", type: "check", title: "Check", status: "in_progress", parent_key: "a/s1", needs_you: "Ok?",
    });
    const data = await board();
    const check = data.items.find((item) => item.key === "a/s1/c1")!;
    expect(check.working).toBe(false);
    expect(check.parent_slice).toEqual({ key: "a/s1", number: null, title: "Slice one" });
    expect(data.working_count).toBe(0);
  });

  it("drops items finished before the window", async () => {
    await callTool("report_progress", { key: "a/open", project: "a", type: "bug", title: "Open one" });
    await callTool("report_progress", { key: "a/old", project: "a", type: "bug", title: "Old", status: "done" });
    await env.DB.prepare("UPDATE items SET done_at = ? WHERE key = ?").bind("2020-01-01T00:00:00.000Z", "a/old").run();
    const keys = (await board()).items.map((item) => item.key);
    expect(keys).toEqual(["a/open"]);
  });
});
