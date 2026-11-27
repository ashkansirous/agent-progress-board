/**
 * List prices as the prior of the cap-cost fit (Slice 67). The models run at the same times, so the
 * cap's growth cannot tell their weights apart; the published prices carry the gaps between models
 * and kinds, and the data only moves a model off them as far as it clearly says.
 */
import { CACHE_WRITE_FACTOR, type ListPrice } from "../config";
import { hasParts } from "./cap";
import { TokenKind, type TokenTotals } from "./usage";

/** The model's list price per kind (dollars per million tokens); null when no entry matches its name parts. The entry naming the most parts wins. */
export function priceOf(model: string, prices: Record<string, ListPrice>): TokenTotals | null {
  const parts = model.toLowerCase().split("-");
  let best: { parts: number; price: ListPrice } | null = null;
  for (const [name, price] of Object.entries(prices)) {
    const wanted = name.toLowerCase().split("-");
    if (hasParts(parts, wanted) && (best === null || wanted.length > best.parts)) best = { parts: wanted.length, price };
  }
  if (best === null) return null;
  const { price } = best;
  return {
    [TokenKind.Input]: price.input,
    [TokenKind.Output]: price.output,
    [TokenKind.CacheRead]: price.cache_read,
    [TokenKind.CacheWrite]: price.cache_write ?? price.input * CACHE_WRITE_FACTOR,
  } as TokenTotals;
}
