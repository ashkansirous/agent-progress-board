import { ItemStatus, ItemType, Priority } from "./domain/item";
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
] as const;

export type Palette = Record<(typeof PALETTE_KEYS)[number], string>;

export interface BoardConfig {
  window: WindowConfig;
  projects: ProjectConfig[];
  types: Partial<Record<ItemType, TypeConfig>>;
  statuses: Partial<Record<ItemStatus, Schemes<StatusColors>>>;
  priorities: Partial<Record<Priority, Schemes<ColorSet>>>;
  palettes: Schemes<Partial<Palette>>;
}

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
    projects: readProjects(parsed.projects),
    types: readTypes(parsed.types),
    statuses: readNamed("statuses", parsed.statuses, Object.values(ItemStatus), isStatusEntry),
    priorities: readNamed("priorities", parsed.priorities, Object.values(Priority), isPriorityEntry),
    palettes: readPalettes(parsed.palettes),
  };
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

function isHours(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= MAX_WINDOW_HOURS;
}
