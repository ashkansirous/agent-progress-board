import type { BoardResponse } from "../../src/api/boardDto";
import type { ChatTextResponse } from "../../src/api/chatText";
import type { GrantsResponse } from "../../src/api/grants";

export const BOARD_URL = "/api/board";
/** Held equal to the Worker's `CHAT_TEXT_PATH` and `GRANTS_PATH` by `test/chatTextRoute.test.ts` (importing them would bundle the server text). */
export const CHAT_TEXT_URL = "/api/chat-text";
export const GRANTS_URL = "/api/grants";
export const REQUEST_TIMEOUT_MS = 15_000;

/** Why a load failed: the HTTP status the API answered, or null when it could not be reached or read. */
export class LoadError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "board request failed" : `board API answered ${status}`);
  }
}

async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new LoadError(null);
  }
  if (!response.ok) throw new LoadError(response.status);
  return response;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await send(url, { headers: { Accept: "application/json" } }, signal);
  try {
    return (await response.json()) as T;
  } catch {
    throw new LoadError(null);
  }
}

export function fetchBoard(signal: AbortSignal): Promise<BoardResponse> {
  return getJson<BoardResponse>(BOARD_URL, signal);
}

/** The instruction text and the connector line; a body missing either counts as a failed load (no status). */
export async function fetchChatText(signal: AbortSignal): Promise<ChatTextResponse> {
  const body = await getJson<Partial<ChatTextResponse> | null>(CHAT_TEXT_URL, signal);
  if (typeof body?.text !== "string" || body.text === "") throw new LoadError(null);
  if (typeof body.preface !== "string" || body.preface === "") throw new LoadError(null);
  return { text: body.text, preface: body.preface };
}

export async function fetchGrants(signal: AbortSignal): Promise<GrantsResponse> {
  const body = await getJson<Partial<GrantsResponse> | null>(GRANTS_URL, signal);
  if (!Array.isArray(body?.grants)) throw new LoadError(null);
  return { grants: body.grants, truncated: body.truncated === true };
}

/** Ends one grant; the same-origin `Origin` header the browser adds is what the Worker checks. */
export async function endGrant(id: string): Promise<void> {
  await send(`${GRANTS_URL}/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}
