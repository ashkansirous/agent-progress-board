import type { UsageRange } from "../../src/domain/usage";

/** What the page asks the route for; null plan and environment mean "the plan in force" and "all". */
export interface UsageParams {
  range: UsageRange;
  plan: string | null;
  environment: string | null;
}

/** The query string of `GET /api/usage`: only what was chosen, plus the viewer's offset from UTC in minutes and, when known, their time zone (the offset alone cannot follow a daylight-saving change). */
export function usageQuery(params: UsageParams, offsetMinutes: number, timeZone: string | null = null): string {
  const query = new URLSearchParams({ range: params.range, utc_offset: String(offsetMinutes) });
  if (timeZone !== null) query.set("time_zone", timeZone);
  if (params.plan !== null) query.set("plan", params.plan);
  if (params.environment !== null) query.set("environment", params.environment);
  return query.toString();
}
