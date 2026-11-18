import type { UsagePageResponse } from "../../src/api/usageDto";
import { offsetForZone, type OffsetAt } from "../../src/domain/usage";
import { LoadError } from "./api";
import { usageQuery, type UsageParams } from "./usageQuery";

export const USAGE_URL = "/api/usage";
const REQUEST_TIMEOUT_MS = 15_000;

/** The viewer's offset from UTC in minutes, east positive, as the route wants it. */
export function viewerOffsetMinutes(): number {
  return -new Date().getTimezoneOffset() || 0;
}

/** The viewer's IANA time zone name, or null when the browser gives none. */
export function viewerTimeZone(): string | null {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}

/** The viewer's offset at each moment (their time zone's, which follows daylight saving), else the fixed `fallback`. */
export function viewerOffsetAt(fallback: number): OffsetAt {
  return offsetForZone(viewerTimeZone(), fallback);
}

export async function fetchUsage(params: UsageParams, signal: AbortSignal): Promise<UsagePageResponse> {
  let response: Response;
  try {
    response = await fetch(`${USAGE_URL}?${usageQuery(params, viewerOffsetMinutes(), viewerTimeZone())}`, {
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
