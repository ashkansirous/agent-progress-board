import type { UsagePageResponse } from "../../src/api/usageDto";
import { LoadError } from "./api";
import { usageQuery, type UsageParams } from "./usageQuery";

export const USAGE_URL = "/api/usage";
const REQUEST_TIMEOUT_MS = 15_000;

/** The viewer's offset from UTC in minutes, east positive, as the route wants it. */
export function viewerOffsetMinutes(): number {
  return -new Date().getTimezoneOffset() || 0;
}

export async function fetchUsage(params: UsageParams, signal: AbortSignal): Promise<UsagePageResponse> {
  let response: Response;
  try {
    response = await fetch(`${USAGE_URL}?${usageQuery(params, viewerOffsetMinutes())}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch {
    throw new LoadError(null);
  }
  if (!response.ok) throw new LoadError(response.status);
  try {
    return (await response.json()) as UsagePageResponse;
  } catch {
    throw new LoadError(null);
  }
}
