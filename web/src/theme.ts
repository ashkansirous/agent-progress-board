import type { CSSProperties } from "react";
import type { BoardPageConfig } from "../../src/api/boardDto";
import type { ColorSet, Palette, StatusColors } from "../../src/config";
import exampleConfig from "../../config/board.example.json" with { type: "json" };
import type { ItemStatus, ItemType, Priority } from "../../src/domain/item";

export type SchemeName = "light" | "dark";

export interface TypeLook extends ColorSet {
  label: string;
}

/** What shows for a name the config has no colours for: the page's own neutral colours. */
const FALLBACK_SET: ColorSet = { bg: "var(--card)", fg: "var(--text)", border: "var(--hairline)" };
const FALLBACK_STATUS: StatusColors = { fg: "var(--muted)", dot: "transparent" };
const FALLBACK_PRIORITY: ColorSet = { bg: "transparent", fg: "var(--muted)", border: "var(--hairline)" };

export interface Looks {
  type(type: ItemType): TypeLook;
  status(status: ItemStatus): StatusColors;
  priority(priority: Priority): ColorSet;
}

/** The colours for one colour scheme, all read from the board config. */
export function looksFor(config: BoardPageConfig | null, scheme: SchemeName): Looks {
  return {
    type: (type) => {
      const entry = config?.types[type];
      return { ...FALLBACK_SET, ...entry?.[scheme], label: entry?.label ?? type };
    },
    status: (status) => config?.statuses[status]?.[scheme] ?? FALLBACK_STATUS,
    priority: (priority) => config?.priorities[priority]?.[scheme] ?? FALLBACK_PRIORITY,
  };
}

/**
 * The palette the page starts with, per colour scheme, taken at build time from the example config (the
 * one source of colours). It paints the loading and failed-load cards, which show before or without a
 * response; the server's own palette replaces it as soon as one arrives.
 */
const DEFAULT_PALETTES = exampleConfig.palettes as Record<SchemeName, Palette>;

/** The palette as CSS custom properties (`--page`, `--text`, ...) for the page's root element. */
export function paletteVars(config: Pick<BoardPageConfig, "palettes"> | null, scheme: SchemeName): CSSProperties {
  const palette: Partial<Palette> = { ...DEFAULT_PALETTES[scheme], ...config?.palettes[scheme] };
  return Object.fromEntries(Object.entries(palette).map(([name, colour]) => [`--${name}`, colour])) as CSSProperties;
}
