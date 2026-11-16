import exampleConfig from "../config/board.example.json" with { type: "json" };
import { ItemStatus, ItemType, Priority } from "./domain/item";
import {
  DEFAULT_STALE_AFTER_MINUTES,
  isValidStaleAfter,
  MAX_STALE_AFTER_MINUTES,
  MIN_STALE_AFTER_MINUTES,
} from "./domain/stale";
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
}

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
}

export const DEFAULT_CAP_COST: CapCostConfig = {
  minStretches: 3,
  environmentMinStretches: 4,
  fineFactor: 3,
  sure: { minStretches: 8, maxLeftoverShare: 0.2 },
  unexplainedStretches: 3,
  minStretchMinutes: 10,
  minGrowthPoints: 1,
  convergence: 1e-7,
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
    palettes: palettesWithDefaults(parsed.palettes),
    oauthRedirectUris: readRedirectUris(parsed.oauth_redirect_uris),
    publicOrigin: readPublicOrigin(parsed.public_origin),
    usage: readUsage(asRecord(parsed.usage)),
  };
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
  };
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

/** The configured palettes laid over the example config's, so a config written before a colour name existed still paints it. */
function palettesWithDefaults(raw: unknown): BoardConfig["palettes"] {
  const given = readPalettes(raw);
  const defaults = readPalettes(exampleConfig.palettes);
  return { light: { ...defaults.light, ...given.light }, dark: { ...defaults.dark, ...given.dark } };
}

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
