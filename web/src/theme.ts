import type { CSSProperties } from "react";
import type { BoardPageConfig } from "../../src/api/boardDto";
import type { ColorSet, Palette, StatusColors } from "../../src/config";
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

/** The palette as CSS custom properties (`--page`, `--text`, ...) for the page's root element. */
export function paletteVars(config: BoardPageConfig | null, scheme: SchemeName): CSSProperties {
  const palette: Partial<Palette> = config?.palettes[scheme] ?? {};
  return Object.fromEntries(Object.entries(palette).map(([name, colour]) => [`--${name}`, colour])) as CSSProperties;
}
