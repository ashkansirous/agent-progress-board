import { type ApprovedConsent, AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../../env";
import { matches } from "../auth";
import { PageProblem, renderForm, renderMessage, STRINGS } from "./page";

/** The consent page must never be framed (clickjacking of the Allow button). */
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};
const FIELD_HANDLE = "handle";
const FIELD_PASSPHRASE = "passphrase";
const FIELD_DECISION = "decision";
const DECISION_APPROVE = "approve";
export const OWNER_USER_ID = "owner";
export const READ_SCOPE = "mcp:read";
const OFFLINE_SCOPE = "offline_access";
/** The page refuses everyone below this length: a long passphrase is what makes guessing hopeless. */
export const MIN_PASSPHRASE_LENGTH = 32;

/** Serves /authorize: the owner's consent page. Fails closed when no passphrase is configured. */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
  if (!env.OWNER_PASSPHRASE || env.OWNER_PASSPHRASE.length < MIN_PASSPHRASE_LENGTH) return page(renderMessage(STRINGS.notSetUp), 403);
  try {
    return request.method === "GET" ? await showForm(request, env, PageProblem.None) : await submitForm(request, env);
  } catch (error) {
    return authorizeErrorResponse(error);
  }
}

async function showForm(request: Request, env: Env, problem: PageProblem): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  const status = problem === PageProblem.None ? 200 : 401;
  return page(renderForm({ details, handle: consent.handle, problem }), status, consent.headers);
}

async function submitForm(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  if (!form) return page(renderMessage(STRINGS.invalidRequest), 400);
  const handle = String(form.get(FIELD_HANDLE) ?? "");
  if (form.get(FIELD_DECISION) !== DECISION_APPROVE) return deny(request, env, handle);
  // The consent handle and its cookie are checked first: a forged or unbound post learns nothing about the passphrase.
  const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle);
  const passphrase = String(form.get(FIELD_PASSPHRASE) ?? "");
  if (!(await matches(passphrase, env.OWNER_PASSPHRASE))) {
    // Nothing is counted: the 32-character floor is what makes guessing hopeless. The form comes
    // back with a fresh consent request, because the one just used is spent.
    console.log("authorize: wrong passphrase");
    return showForm(request, env, PageProblem.WrongPassphrase);
  }
  return complete(env, approved);
}

/** The posted form, or null when the body is not a form. */
async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.clone().formData();
  } catch {
    return null;
  }
}

async function deny(request: Request, env: Env, handle: string): Promise<Response> {
  const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
  denied.headers.set("Location", denied.redirectTo);
  return new Response(null, { status: 302, headers: denied.headers });
}

/** Approval always grants read, whatever the client asked for (even nothing); writes are never granted. */
async function complete(env: Env, approved: ApprovedConsent): Promise<Response> {
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: approved.request,
    userId: OWNER_USER_ID,
    metadata: {},
    scope: grantedScopes(approved.request.scope),
    props: { kind: "owner" },
  });
  approved.headers.set("Location", redirectTo);
  console.log("authorize: owner approved a client");
  return new Response(null, { status: 302, headers: approved.headers });
}

function grantedScopes(requested: string[]): string[] {
  return requested.includes(OFFLINE_SCOPE) ? [READ_SCOPE, OFFLINE_SCOPE] : [READ_SCOPE];
}

function authorizeErrorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError) return page(renderMessage(STRINGS.expired), 400);
  if (error instanceof CimdFetchError) return page(renderMessage(STRINGS.invalidRequest), 400);
  throw error;
}

function page(html: string, status: number, headers?: Headers): Response {
  const merged = new Headers(headers);
  for (const [name, value] of Object.entries(HTML_HEADERS)) merged.set(name, value);
  return new Response(html, { status, headers: merged });
}
