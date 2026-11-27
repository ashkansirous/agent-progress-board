import { ItemStatus, ItemType, Priority } from "./domain/item";
import {
  DEFAULT_STALE_AFTER_MINUTES,
  isValidStaleAfter,
  MAX_STALE_AFTER_MINUTES,
  MIN_STALE_AFTER_MINUTES,
} from "./domain/stale";
import { isProcessKey } from "./domain/steps";
import { MAX_WINDOW_HOURS, type WindowConfig } from "./domain/window";

export const DEFAULT_WINDOW: WindowConfig = { defaultHours: 12, maxHours: 72 };

export interface ProjectConfig {
  id: string;
  label: string;
}

/** A background, text and border colour: a type tile or a priority badge in one colour scheme. */
export interface ColorSet {
  bg: string;
  fg: string;
  border: string;
}

/** A status label colour and its dot fill. */
export interface StatusColors {
  fg: string;
  dot: string;
}

export interface Schemes<T> {
  light?: T;
  dark?: T;
}

export interface TypeConfig extends Schemes<ColorSet> {
  label: string;
  color: string;
}

/** The named colours of the page chrome, one set per colour scheme. */
export const PALETTE_KEYS = [
  "page",
  "text",
  "muted",
  "card",
  "hairline",
  "link",
  "linkHover",
  "tileWhy",
  "staleBg",
  "staleBorder",
  "grab",
  "scrim",
  "panel",
  "well",
  "closeBg",
  "waitingHeading",
  "waitingMeta",
  "waitingTitle",
  "success",
  "danger",
  "primaryBg",
  "primaryFg",
  "skeletonBar",
  "skeletonStrip",
  "skeletonTile",
  "segmentBg",
  "segmentText",
  "segmentPressedBg",
  "segmentPressedText",
  "tabBg",
  "tabOn",
  "shadow",
  "track",
  "barFill",
  "rowLine",
  "pillSureBg",
  "pillSureFg",
  "pillRoughBg",
  "pillRoughFg",
  "pillNoneBg",
  "pillNoneFg",
  "mergedCellBg",
  "markInk",
  "chipBg",
  "stepDone",
  "stepDoneText",
  "stepActive",
  "stepActiveRow",
  "stepPendingTile",
  "partTrack",
  // Session cards, question cards and their drawer (Slice 13): the mock's theme keys of those names.
  "sub",
  "needBg",
  "needBd",
  "needFg",
  "sliceBg",
  "sliceFg",
  "nowBg",
  "nowFg",
  "doneFg",
  "panelShadow",
  // Planned slice cards and the problems list (Slice 14): the mock's theme keys of those names.
  "sliceBd",
  "bugBg",
  "bugBd",
  "bugFg",
  "probBg",
  "probBd",
  "probFg",
] as const;

export type Palette = Record<(typeof PALETTE_KEYS)[number], string>;

export interface BoardConfig {
  window: WindowConfig;
  /** Whole minutes without a heartbeat before a live item turns stale. */
  staleAfterMinutes: number;
  projects: ProjectConfig[];
  types: Partial<Record<ItemType, TypeConfig>>;
  statuses: Partial<Record<ItemStatus, Schemes<StatusColors>>>;
  priorities: Partial<Record<Priority, Schemes<ColorSet>>>;
  palettes: Schemes<Partial<Palette>>;
  /** Exact extra redirect addresses an OAuth client may register, besides Claude's own (Slice 5). */
  oauthRedirectUris: string[];
  /** The https origin the OAuth issuer and /mcp resource are pinned to; null means the request's own origin (Slice 5). */
  publicOrigin: string | null;
  usage: UsageConfig;
  /** What a step of each process may use before the card flags it (Slice 56). */
  budgets: BudgetsConfig;
}

/** One process's limits (Slice 56); a limit left out is not checked, except the peak context, which falls back to the default. */
export interface ProcessBudget {
  /** Whole minutes a running step may take. */
  minutes?: number;
  /** Tokens (all kinds) a finished step may use. */
  tokens?: number;
  /** The largest single request's context a finished step may reach. */
  peakContext?: number;
}

export interface BudgetsConfig {
  /** The peak-context budget of every step with a cost row and no budget of its own for it. */
  defaultPeakContext: number;
  /** Per process key. */
  processes: Record<string, ProcessBudget>;
}

export const DEFAULT_PEAK_CONTEXT_BUDGET = 150_000;
const MAX_BUDGET_MINUTES = 100_000;
const MAX_BUDGET_TOKENS = 1_000_000_000_000;

/** One chart series colour: a light and a dark value (Slice 8). */
export interface SeriesColor {
  light: string;
  dark: string;
}

export interface UsageConfig {
  /** A lower cap reading with no reset time starts a new window when it falls to this percent. */
  lowMarkPercent: number;
  /** Samples older than this many days are thinned to one an hour per agent, model and environment. */
  keepDays: number;
  series: SeriesColor[];
  /** Tasks the usage route lists before its "everything else" row. */
  topTasks: number;
  /** The environment that counts as the main machine, as clients send it; null: the busiest one. */
  baseEnvironment: string | null;
  /** A sent environment value mapped to the text the page shows. */
  environmentLabels: Record<string, string>;
  /** The cap-cost estimate (Slice 9), under `usage.capCost`. */
  capCost: CapCostConfig;
}

export interface CapCostConfig {
  /** Fewer stretches than this in the plan: the page shows "estimate not ready". */
  minStretches: number;
  /** An environment with fewer stretches holding its use is not estimated (counts as 1x). */
  environmentMinStretches: number;
  /** A model is fitted per token kind from this many stretches per unknown (four kinds each). */
  fineFactor: number;
  /** "Fairly sure" needs at least this many stretches and at most this share of growth left unexplained. */
  sure: { minStretches: number; maxLeftoverShare: number };
  /** How many unexplained stretches the route lists. */
  unexplainedStretches: number;
  /** A stretch is at least this long (the reporting interval). */
  minStretchMinutes: number;
  /** A stretch needs the cap to rise by at least this many points. */
  minGrowthPoints: number;
  /** The alternating fit stops when no multiplier moves by more than this. */
  convergence: number;
  /** Slice 67: history before this ISO date is left out of the fit (never deleted); null uses all of it. */
  fitFrom: string | null;
  /** Slice 67: a model shows weights only with this many stretches where it holds a real share of the use. */
  modelMinStretches: number;
  /** Slice 67: a model's tokens must be at least this share of a stretch's tokens for the stretch to count as evidence. */
  modelMinShare: number;
  /** Slice 67: ridge strength on the weights (a share of each column's own size), so kinds that move together cannot run away. */
  ridge: number;
  /** Slice 67: the same for the intercept ("untracked use"), set high so tokens explain what they can first. */
  untrackedRidge: number;
  /** Slice 67: a kind below this share of a model's tokens has no column of its own; it takes the model's mean weight. */
  minKindShare: number;
  /** Slice 67: list prices in dollars per million tokens, by model family (whole name parts, case ignored); the fit keeps the gaps between models at these ratios unless the data clearly says otherwise. */
  prices: Record<string, ListPrice>;
  /** Slice 67: how hard a model's factor is held to 1, as the number of typical stretches' worth of evidence for the list price; the same for every model, so more separable use outweighs it, collinear use never does. */
  priceShrink: number;
  /** Slice 67: the page names a model's factor only when it is further than this from 1 (0.5 is half again or half). */
  priceFactorShown: number;
}

/** Dollars per million tokens. `cache_write` defaults to `CACHE_WRITE_FACTOR` times `input`. */
export interface ListPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write?: number;
}

export const CACHE_WRITE_FACTOR = 1.25;

/** Public list prices of 2026-11-27 (Slice 67). */
export const DEFAULT_PRICES: Record<string, ListPrice> = {
  opus: { input: 4, output: 20, cache_read: 0.2 },
  sonnet: { input: 2, output: 10, cache_read: 0.1 },
  haiku: { input: 0.1, output: 0.5, cache_read: 0.01 },
  fable: { input: 8, output: 40, cache_read: 0.2 },
};

export const DEFAULT_CAP_COST: CapCostConfig = {
  minStretches: 3,
  environmentMinStretches: 4,
  fineFactor: 3,
  sure: { minStretches: 8, maxLeftoverShare: 0.2 },
  unexplainedStretches: 3,
  minStretchMinutes: 10,
  minGrowthPoints: 1,
  convergence: 1e-7,
  fitFrom: null,
  modelMinStretches: 4,
  modelMinShare: 0.02,
  ridge: 0.001,
  untrackedRidge: 20,
  minKindShare: 0.01,
  prices: DEFAULT_PRICES,
  priceShrink: 50,
  priceFactorShown: 0.5,
};

export const DEFAULT_LOW_MARK_PERCENT = 2;
export const DEFAULT_KEEP_DAYS = 30;
export const DEFAULT_TOP_TASKS = 6;
const MAX_KEEP_DAYS = 3650;
const MAX_TOP_TASKS = 50;
const MAX_ENVIRONMENT_LENGTH = 40;

export const DEFAULT_SERIES: SeriesColor[] = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
];

/**
 * Parses BOARD_CONFIG where it is used (list_open). Never throws: a bad value is logged and the
 * defaults apply, so a config typo cannot stop reporters from writing.
 */
export function parseConfig(raw: string | undefined): BoardConfig {
  return configFromRecord(parseJson(raw));
}

export function configFromRecord(parsed: Record<string, unknown>): BoardConfig {
  return {
    window: readWindow(asRecord(parsed.window)),
    staleAfterMinutes: readStaleAfter(parsed.staleAfterMinutes),
    projects: readProjects(parsed.projects),
    types: readTypes(parsed.types),
    statuses: readNamed("statuses", parsed.statuses, Object.values(ItemStatus), isStatusEntry),
    priorities: readNamed("priorities", parsed.priorities, Object.values(Priority), isPriorityEntry),
    palettes: readPalettes(parsed.palettes),
    oauthRedirectUris: readRedirectUris(parsed.oauth_redirect_uris),
    publicOrigin: readPublicOrigin(parsed.public_origin),
    usage: readUsage(asRecord(parsed.usage)),
    budgets: readBudgets(asRecord(parsed.budgets)),
  };
}

function readBudgets(raw: Record<string, unknown>): BudgetsConfig {
  const processes = asRecord(raw.processes);
  const kept: Record<string, ProcessBudget> = {};
  for (const [key, entry] of Object.entries(processes)) {
    const budget = readProcessBudget(key, entry);
    if (budget) kept[key] = budget;
  }
  return {
    defaultPeakContext: readNumber("budgets.defaultPeakContext", raw.defaultPeakContext, DEFAULT_PEAK_CONTEXT_BUDGET, 1, MAX_BUDGET_TOKENS, true),
    processes: kept,
  };
}

/** One process's limits, or null (logged) when the key is no process key or a limit is not a positive whole number. */
function readProcessBudget(key: string, raw: unknown): ProcessBudget | null {
  const entry = asRecord(raw);
  const names = ["minutes", "tokens", "peakContext"];
  const field = `budgets.processes.${key}`;
  if (raw !== entry || !isProcessKey(key)) {
    console.error(`BOARD_CONFIG ${field}: need a process key mapped to {minutes, tokens, peakContext} whole numbers; skipping it`);
    return null;
  }
  const clean: ProcessBudget = {};
  for (const [name, value] of Object.entries(entry)) {
    if (!names.includes(name)) {
      console.error(`BOARD_CONFIG ${field}.${name}: unknown limit (use minutes, tokens or peakContext); skipping it`);
      continue;
    }
    const max = name === "minutes" ? MAX_BUDGET_MINUTES : MAX_BUDGET_TOKENS;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max) {
      clean[name as keyof ProcessBudget] = value;
    } else {
      console.error(`BOARD_CONFIG ${field}.${name}: need a whole number from 1 to ${max}, got ${JSON.stringify(value)}; skipping it`);
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

function readUsage(raw: Record<string, unknown>): UsageConfig {
  return {
    lowMarkPercent: readNumber("usage.lowMarkPercent", raw.lowMarkPercent, DEFAULT_LOW_MARK_PERCENT, 0, 100, false),
    keepDays: readNumber("usage.keepDays", raw.keepDays, DEFAULT_KEEP_DAYS, 1, MAX_KEEP_DAYS, true),
    series: readSeries(raw.series),
    topTasks: readNumber("usage.topTasks", raw.topTasks, DEFAULT_TOP_TASKS, 1, MAX_TOP_TASKS, true),
    baseEnvironment: readBaseEnvironment(raw.baseEnvironment),
    environmentLabels: readEnvironmentLabels(raw.environmentLabels),
    capCost: readCapCost(asRecord(raw.capCost)),
  };
}

function readCapCost(raw: Record<string, unknown>): CapCostConfig {
  const base = DEFAULT_CAP_COST;
  const sure = asRecord(raw.sure);
  const field = (name: string, value: unknown, fallback: number, min: number, max: number, whole: boolean): number =>
    readNumber(`usage.capCost.${name}`, value, fallback, min, max, whole);
  return {
    minStretches: field("minStretches", raw.minStretches, base.minStretches, 1, 1000, true),
    environmentMinStretches: field("environmentMinStretches", raw.environmentMinStretches, base.environmentMinStretches, 1, 1000, true),
    fineFactor: field("fineFactor", raw.fineFactor, base.fineFactor, 1, 100, true),
    sure: {
      minStretches: field("sure.minStretches", sure.minStretches, base.sure.minStretches, 1, 1000, true),
      maxLeftoverShare: field("sure.maxLeftoverShare", sure.maxLeftoverShare, base.sure.maxLeftoverShare, 0, 1, false),
    },
    unexplainedStretches: field("unexplainedStretches", raw.unexplainedStretches, base.unexplainedStretches, 1, 50, true),
    minStretchMinutes: field("minStretchMinutes", raw.minStretchMinutes, base.minStretchMinutes, 0, 1440, false),
    minGrowthPoints: field("minGrowthPoints", raw.minGrowthPoints, base.minGrowthPoints, 0, 100, false),
    convergence: field("convergence", raw.convergence, base.convergence, 1e-12, 1, false),
    fitFrom: readFitFrom(raw.fitFrom),
    modelMinStretches: field("modelMinStretches", raw.modelMinStretches, base.modelMinStretches, 1, 1000, true),
    modelMinShare: field("modelMinShare", raw.modelMinShare, base.modelMinShare, 0, 1, false),
    ridge: field("ridge", raw.ridge, base.ridge, 0, 10, false),
    untrackedRidge: field("untrackedRidge", raw.untrackedRidge, base.untrackedRidge, 0, 1000, false),
    minKindShare: field("minKindShare", raw.minKindShare, base.minKindShare, 0, 1, false),
    prices: readPrices(raw.prices),
    priceShrink: field("priceShrink", raw.priceShrink, base.priceShrink, 0, 1000, false),
    priceFactorShown: field("priceFactorShown", raw.priceFactorShown, base.priceFactorShown, 0, 100, false),
  };
}

const MAX_PRICE = 100_000;

/** The default prices with the configured entries added or replacing one of the same name; a bad entry is logged and skipped. */
function readPrices(raw: unknown): Record<string, ListPrice> {
  const prices: Record<string, ListPrice> = { ...DEFAULT_PRICES };
  if (raw === undefined) return prices;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.error("BOARD_CONFIG usage.capCost.prices: need an object of model family to prices; using the defaults");
    return prices;
  }
  for (const [name, value] of Object.entries(raw)) {
    const price = readPrice(name, asRecord(value));
    if (price !== null && name.trim() !== "") prices[name.trim().toLowerCase()] = price;
  }
  return prices;
}

function readPrice(name: string, raw: Record<string, unknown>): ListPrice | null {
  const field = (key: string): number | null => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE ? value : null;
  };
  const input = field("input");
  const output = field("output");
  const cacheRead = field("cache_read");
  const cacheWrite = raw.cache_write === undefined ? undefined : field("cache_write");
  if (input === null || output === null || cacheRead === null || cacheWrite === null || input + output + cacheRead === 0) {
    console.error(`BOARD_CONFIG usage.capCost.prices.${name}: need input, output and cache_read as numbers from 0 to ${MAX_PRICE} (cache_write optional); entry ignored`);
    return null;
  }
  return cacheWrite === undefined ? { input, output, cache_read: cacheRead } : { input, output, cache_read: cacheRead, cache_write: cacheWrite };
}

/** An ISO date or time, or null (all history). A bad value is logged and means null, never a throw. */
function readFitFrom(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    // A time with no zone is UTC (every stored time is), never the host's local time.
    const zoned = /^\d{4}-\d{2}-\d{2}$/.test(raw) || /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    if (Number.isFinite(Date.parse(zoned))) return zoned;
  }
  console.error("BOARD_CONFIG usage.capCost.fitFrom: need an ISO date such as 2026-11-19; using all history");
  return null;
}

function readNumber(field: string, raw: unknown, fallback: number, min: number, max: number, whole: boolean): number {
  if (raw === undefined) return fallback;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= min && raw <= max && (!whole || Number.isInteger(raw))) {
    return raw;
  }
  console.error(`BOARD_CONFIG ${field}: need ${whole ? "a whole " : "a "}number from ${min} to ${max}; using ${fallback}`);
  return fallback;
}

function isEnvironmentText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_ENVIRONMENT_LENGTH;
}

function readBaseEnvironment(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (isEnvironmentText(raw)) return raw;
  console.error("BOARD_CONFIG usage.baseEnvironment: need text of 1 to 40 characters; using the busiest environment");
  return null;
}

function readEnvironmentLabels(raw: unknown): Record<string, string> {
  if (raw === undefined) return {};
  const record = asRecord(raw);
  const valid = raw === record && Object.entries(record).every(([name, label]) => isEnvironmentText(name) && typeof label === "string");
  if (valid) return record as Record<string, string>;
  console.error("BOARD_CONFIG usage.environmentLabels: need sent values mapped to text; using none");
  return {};
}

function readSeries(raw: unknown): SeriesColor[] {
  if (raw === undefined) return DEFAULT_SERIES;
  const valid = Array.isArray(raw) && raw.length > 0 && raw.every((pair) => isColour(asRecord(pair).light) && isColour(asRecord(pair).dark));
  if (valid) return (raw as SeriesColor[]).map(({ light, dark }) => ({ light, dark }));
  console.error("BOARD_CONFIG usage.series: need a list of {light, dark} colours; using the defaults");
  return DEFAULT_SERIES;
}

/** An https origin with no path, query or credentials; anything else is logged and dropped. */
function readPublicOrigin(raw: unknown): string | null {
  if (raw === undefined) return null;
  const origin = typeof raw === "string" ? httpsOrigin(raw) : null;
  if (!origin) console.error("BOARD_CONFIG public_origin: need an https origin such as https://host; using the request origin");
  return origin;
}

function httpsOrigin(text: string): string | null {
  try {
    const url = new URL(text);
    const bare = url.protocol === "https:" && url.username === "" && url.password === "" && url.search === "" && url.hash === "";
    return bare && (url.pathname === "/" || url.pathname === "") && url.origin === text.replace(/\/$/, "") ? url.origin : null;
  } catch {
    return null;
  }
}

function readRedirectUris(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((uri) => typeof uri === "string")) {
    console.error("BOARD_CONFIG oauth_redirect_uris: need a list of strings; using none");
    return [];
  }
  return raw;
}

/** Reads a map from a closed set of names to validated entries; a bad map is logged and dropped. */
function readNamed<K extends string, V>(
  field: string,
  raw: unknown,
  names: K[],
  valid: (entry: unknown) => boolean,
): Partial<Record<K, V>> {
  if (raw === undefined) return {};
  const record = asRecord(raw);
  const ok = raw === record && Object.entries(record).every(([n, e]) => (names as string[]).includes(n) && valid(e));
  if (ok) return record as Partial<Record<K, V>>;
  console.error(`BOARD_CONFIG ${field}: need known names mapped to colour entries; using none`);
  return {};
}

/** Only what the config sets; the defaults are laid under it at read (`pageConfigOf`), never stored. */
function readPalettes(raw: unknown): BoardConfig["palettes"] {
  if (raw === undefined) return {};
  const record = asRecord(raw);
  const ok = raw === record && Object.entries(record).every(([n, e]) => isScheme(n) && isPalette(e));
  if (ok) return record as BoardConfig["palettes"];
  console.error("BOARD_CONFIG palettes: need light/dark maps of known colour names to colours; using none");
  return {};
}

function isScheme(name: string): boolean {
  return name === "light" || name === "dark";
}

function isPalette(value: unknown): boolean {
  const entry = asRecord(value);
  return (
    value === entry &&
    Object.entries(entry).every(([key, colour]) => (PALETTE_KEYS as readonly string[]).includes(key) && isColour(colour))
  );
}

const COLOUR_PATTERN = /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i;

function isColour(value: unknown): value is string {
  return typeof value === "string" && COLOUR_PATTERN.test(value);
}

function schemesOf(value: unknown, valid: (set: unknown) => boolean): boolean {
  const entry = asRecord(value);
  return value === entry && ["light", "dark"].every((scheme) => entry[scheme] === undefined || valid(entry[scheme]));
}

function isColorSet(value: unknown): boolean {
  const set = asRecord(value);
  return isColour(set.bg) && isColour(set.fg) && isColour(set.border);
}

function isStatusColors(value: unknown): boolean {
  const set = asRecord(value);
  return isColour(set.fg) && isColour(set.dot);
}

function isStatusEntry(value: unknown): boolean {
  return schemesOf(value, isStatusColors);
}

function isPriorityEntry(value: unknown): boolean {
  return schemesOf(value, isColorSet);
}

function readProjects(raw: unknown): ProjectConfig[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every(isProject)) {
    console.error("BOARD_CONFIG projects: need a list of {id, label} strings; using none");
    return [];
  }
  return raw;
}

function readTypes(raw: unknown): BoardConfig["types"] {
  if (raw === undefined) return {};
  const record = asRecord(raw);
  const valid = raw === record && Object.entries(record).every(([name, entry]) => isTypeEntry(name, entry));
  if (!valid) {
    console.error("BOARD_CONFIG types: need item type names mapped to {label, color} strings; using none");
    return {};
  }
  return record as BoardConfig["types"];
}

function isProject(value: unknown): value is ProjectConfig {
  const entry = asRecord(value);
  return typeof entry.id === "string" && typeof entry.label === "string";
}

function isTypeEntry(name: string, value: unknown): boolean {
  const entry = asRecord(value);
  return (
    (Object.values(ItemType) as string[]).includes(name) &&
    typeof entry.label === "string" &&
    typeof entry.color === "string" &&
    schemesOf(entry, isColorSet)
  );
}

function parseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    console.error("BOARD_CONFIG is not valid JSON; using defaults");
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readWindow(raw: Record<string, unknown>): WindowConfig {
  const defaultHours = raw.default_hours ?? DEFAULT_WINDOW.defaultHours;
  const maxHours = raw.max_hours ?? DEFAULT_WINDOW.maxHours;
  if (!isHours(defaultHours) || !isHours(maxHours) || maxHours < defaultHours) {
    console.error(
      `BOARD_CONFIG window: need numbers with 1 <= default_hours <= max_hours <= ${MAX_WINDOW_HOURS}; using defaults`,
    );
    return DEFAULT_WINDOW;
  }
  return { defaultHours, maxHours };
}

function readStaleAfter(raw: unknown): number {
  if (raw === undefined) return DEFAULT_STALE_AFTER_MINUTES;
  if (isValidStaleAfter(raw)) return raw;
  console.error(
    `BOARD_CONFIG staleAfterMinutes: need a whole number from ${MIN_STALE_AFTER_MINUTES} to ${MAX_STALE_AFTER_MINUTES}; using ${DEFAULT_STALE_AFTER_MINUTES}`,
  );
  return DEFAULT_STALE_AFTER_MINUTES;
}

function isHours(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= MAX_WINDOW_HOURS;
}
