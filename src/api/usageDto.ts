import type { BoardConfig, SeriesColor } from "../config";
import type { BucketUnit, Split, TokenKind, UsageRange } from "../domain/usage";

/** What `GET /api/usage` returns; the page and the Worker share these shapes (Slice 8). */
export interface UsageSeriesDto {
  /** The value as reported; null when the delta had none (no agent kind, no environment and no base). */
  name: string | null;
  /** What the page shows: the config label for an environment, else the name. */
  label: string | null;
  /** Place of the name in its kind's first-reported order; the page takes palette[index % palette.length]. */
  color_index: number;
  /** Tokens per bucket, aligned with `buckets`. */
  values: number[];
}

export interface UsageEnvironmentDto {
  value: string;
  label: string;
  /** Tokens in the range and the number of reports (samples) that carried them. */
  tokens: number;
  reports: number;
}

export interface ModelTotalsDto extends Record<TokenKind, number> {
  model: string;
  color_index: number;
  total: number;
}

export interface TaskCostDto {
  key: string;
  /** The item's title; the key itself when no item has it. */
  title: string;
  project: string;
  tokens: number;
}

export interface OtherTasksDto {
  tokens: number;
  projects: number;
}

export interface AgentKindDto {
  name: string;
  color_index: number;
  tokens: number;
}

export interface CapReadingDto {
  taken_at: string;
  percent: number;
}

export interface CapWindowDto {
  /** The reset that began this window when known, else the time of its first reading. */
  started_at: string;
  reset_at: string | null;
  readings: CapReadingDto[];
}

export interface DroppedReadingDto extends CapReadingDto {
  /** The stored percent this reading lost to. */
  stored_percent: number;
}

/** The weekly line or the shorter window of the chosen plan; the environment filter never changes it. */
export interface CapLineDto {
  windows: CapWindowDto[];
  dropped: DroppedReadingDto[];
  /** The newest accepted reading. */
  latest: (CapReadingDto & { reset_at: string | null }) | null;
}

export interface UsageResponse {
  server_time: string;
  range: UsageRange;
  /** Start of the range: the current weekly window's start for `window`. */
  from: string;
  /** The plan in force; null when no cap reading exists. */
  plan: string | null;
  plans: string[];
  /** The environment filter as asked; null is all. */
  environment: string | null;
  environments: UsageEnvironmentDto[];
  /** The environment null counts as: from config, else the busiest one. */
  base_environment: string | null;
  utc_offset_minutes: number;
  palette: SeriesColor[];
  bucket_unit: BucketUnit;
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH` for hours, in the viewer's time. */
  buckets: string[];
  splits: Record<Split, UsageSeriesDto[]>;
  totals_by_model: ModelTotalsDto[];
  totals_by_token_kind: Record<TokenKind, number> & { total: number };
  top_tasks: TaskCostDto[];
  other_tasks: OtherTasksDto | null;
  agent_kinds: AgentKindDto[];
  cap: { weekly: CapLineDto; short: CapLineDto };
}

/** What the route sends: the answer plus the page colours from config, so the page needs no second request. */
export interface UsagePageResponse extends UsageResponse {
  palettes: BoardConfig["palettes"];
}
