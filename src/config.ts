import { ItemType } from "./domain/item";
import { MAX_WINDOW_HOURS, type WindowConfig } from "./domain/window";

export const DEFAULT_WINDOW: WindowConfig = { defaultHours: 12, maxHours: 72 };

export interface ProjectConfig {
  id: string;
  label: string;
}

export interface TypeConfig {
  label: string;
  color: string;
}

export interface BoardConfig {
  window: WindowConfig;
  projects: ProjectConfig[];
  types: Partial<Record<ItemType, TypeConfig>>;
}

/**
 * Parses BOARD_CONFIG where it is used (list_open). Never throws: a bad value is logged and the
 * defaults apply, so a config typo cannot stop reporters from writing.
 */
export function parseConfig(raw: string | undefined): BoardConfig {
  const parsed = parseJson(raw);
  return {
    window: readWindow(asRecord(parsed.window)),
    projects: readProjects(parsed.projects),
    types: readTypes(parsed.types),
  };
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
    typeof entry.color === "string"
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
