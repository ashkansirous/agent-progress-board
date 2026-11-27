import type { BoardConfig, SeriesColor } from "../config";
import type { FitMode, HowSure, MixSource, MultiplierState } from "../domain/capCost";
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

/** One bucket of the chart: its key (`YYYY-MM-DD`, or `YYYY-MM-DDTHH` for hours, in the viewer's time) and its real span in UTC ISO. */
export interface UsageBucketDto {
  key: string;
  start: string;
  end: string;
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
  /** Points of the cap; null while the estimate is not ready (Slice 9). */
  cap_points: number | null;
}

export interface OtherTasksDto {
  tokens: number;
  projects: number;
  /** Points of the cap (percent) the tasks cost; null while the estimate is not ready (Slice 9). */
  cap_points: number | null;
}

export interface AgentKindDto {
  name: string;
  color_index: number;
  tokens: number;
  /** Points of the cap; null while the estimate is not ready. */
  cap_points: number | null;
}

/** What 1% of the cap costs in one model (Slice 9). */
export interface CapCostModelDto {
  model: string;
  color_index: number;
  mode: FitMode;
  /** Slice 67: too few stretches where this model holds a real share of the use; every figure is null and the page says "not enough data". */
  not_enough: boolean;
  /** Slice 67: the model is fitted against a cap of its own (its window kind); its figures are points of that cap, so never compared with another model's. */
  own_cap: string | null;
  /** Slice 67: how far the data moved this model off its list-price ratio (1 is none); null unless it is further than `priceFactorShown` from 1. */
  price_factor: number | null;
  /** Tokens that use 1% of the cap, per kind; the same number for every kind on one weight; null when the kind costs nothing. */
  tokens_per_percent: Record<TokenKind, number | null>;
  /** The same for this window's mix of kinds. */
  all_kinds_tokens_per_percent: number | null;
  /** Whose mix of kinds that figure is weighted by: the last full window's while this one is under a day old (Slice 26). */
  mix_source: MixSource;
  /** Weight of each kind relative to fresh input; null when the model is on one weight. */
  kind_ratios: Record<TokenKind, number | null> | null;
  /** The kind the ratios are measured against: fresh input, or the heaviest kind when fresh input weighs nothing; null when on one weight. */
  kind_ratio_reference: TokenKind | null;
  how_sure: HowSure;
  /** Stretches holding use of this model. */
  stretches: number;
  /** The stretch count at which the model gets a weight per kind. */
  finer_at: number;
}

export interface CapCostEnvironmentDto {
  value: string;
  label: string;
  /** null for an environment placed from its work windows: it reports no tokens, so they are unknown, never 0. */
  tokens: number | null;
  reports: number;
  /** Points of the cap this environment's use cost, multiplier applied; null when some of the use is of a model with no fitted weight. */
  cap_points: number | null;
  /** null for an environment placed from its work windows: it has no fitted weight. */
  multiplier: number | null;
  state: MultiplierState;
  /** null for the base and for an environment not measured yet. */
  how_sure: HowSure | null;
  stretches: number;
}

export interface UnexplainedDto {
  /** Points of cap growth no report explains, of the growth in the range. */
  points: number;
  growth_points: number;
  /** 0 to 1. */
  share: number;
}

export interface UnexplainedStretchDto {
  start: string;
  end: string;
  points: number;
  growth_points: number;
  explained_points: number;
}

export interface StepCostDto {
  step: string;
  /** null when some of the step's use is of a model with no fitted weight. */
  cap_points: number | null;
}

/** The estimate of the chosen plan; models, environments and the lists are empty while it is not ready. */
export interface CapCostDto {
  ready: boolean;
  /** Stretches inside one window on the plan. */
  stretches: number;
  min_stretches: number;
  /** Slice 67: a model with a cap of its own has its own fitted result, whether or not the shared estimate is ready; then `models` holds those models. */
  own_cap_ready: boolean;
  /** Slice 67: the gaps between models come from list prices (some model is priced); the page says so under the table. */
  price_anchored: boolean;
  models: CapCostModelDto[];
  environments: CapCostEnvironmentDto[];
  /** Slice 67: points of the cap per day the fit puts on use no report explains ("untracked use"); null while not ready. */
  untracked_per_day: number | null;
  unexplained: UnexplainedDto | null;
  unexplained_stretches: UnexplainedStretchDto[];
  steps: StepCostDto[];
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
  /** The offset the buckets used at `server_time`; with `time_zone` it changes across a daylight-saving change. */
  utc_offset_minutes: number;
  /** The time zone the buckets followed (the one the caller sent), or null when they used the fixed offset. */
  time_zone: string | null;
  palette: SeriesColor[];
  bucket_unit: BucketUnit;
  /** The Worker's own bucket list, oldest first: the page uses exactly this list for positions and labels and never rebuilds it. */
  buckets: UsageBucketDto[];
  splits: Record<Split, UsageSeriesDto[]>;
  totals_by_model: ModelTotalsDto[];
  totals_by_token_kind: Record<TokenKind, number> & { total: number };
  top_tasks: TaskCostDto[];
  other_tasks: OtherTasksDto | null;
  agent_kinds: AgentKindDto[];
  cap: { weekly: CapLineDto; short: CapLineDto };
  cap_cost: CapCostDto;
}

/** What the route sends: the answer plus the page colours from config, so the page needs no second request. */
export interface UsagePageResponse extends UsageResponse {
  palettes: BoardConfig["palettes"];
}
