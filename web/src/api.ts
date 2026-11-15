import type { BoardResponse } from "../../src/api/boardDto";

export const BOARD_URL = "/api/board";
const REQUEST_TIMEOUT_MS = 15_000;

/** Why a load failed: the HTTP status the API answered, or null when it could not be reached or read. */
export class LoadError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "board request failed" : `board API answered ${status}`);
  }
}

export async function fetchBoard(signal: AbortSignal): Promise<BoardResponse> {
  let response: Response;
  try {
    response = await fetch(BOARD_URL, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch {
    throw new LoadError(null);
  }
  if (!response.ok) throw new LoadError(response.status);
  try {
    return (await response.json()) as BoardResponse;
  } catch {
    throw new LoadError(null);
  }
}
