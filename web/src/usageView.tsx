import { createContext, useContext } from "react";
import type { UsageSeriesDto } from "../../src/api/usageDto";
import type { SeriesColor } from "../../src/config";
import { Split, TokenKind } from "../../src/domain/usage";
import type { StringKey, Translate } from "./strings";
import type { SchemeName } from "./theme";

/** What every usage section needs to draw itself: words, layout, colour scheme and the viewer's clock. */
export interface UsageView {
  t: Translate;
  phone: boolean;
  scheme: SchemeName;
  locale: string;
  offsetMinutes: number;
}

const UsageViewContext = createContext<UsageView | null>(null);
export const UsageViewProvider = UsageViewContext.Provider;

export function useUsageView(): UsageView {
  const view = useContext(UsageViewContext);
  if (!view) throw new Error("useUsageView needs a UsageViewProvider");
  return view;
}

/** The colour of series number `index`: the palette repeats when the data has more series than colours. */
export function seriesColor(palette: SeriesColor[], index: number, scheme: SchemeName): string {
  const entry = palette[index % palette.length];
  return entry ? entry[scheme] : "currentColor";
}

export const TOKEN_KIND_LABELS: Record<TokenKind, StringKey> = {
  [TokenKind.Input]: "kindInput",
  [TokenKind.CacheWrite]: "kindCacheWrite",
  [TokenKind.CacheRead]: "kindCacheRead",
  [TokenKind.Output]: "kindOutput",
};

/** What a series is called on the page: a token kind in words, an environment by its label, else the name. */
export function seriesName(series: UsageSeriesDto, split: Split, t: Translate): string {
  if (split === Split.TokenKind) return t(TOKEN_KIND_LABELS[series.name as TokenKind] ?? "noValue");
  return series.label ?? series.name ?? t("noValue");
}
