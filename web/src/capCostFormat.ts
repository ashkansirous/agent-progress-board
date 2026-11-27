import type { CapCostModelDto } from "../../src/api/usageDto";
import { TokenKind, type OffsetAt } from "../../src/domain/usage";
import { clockAt, dayText, millionsText, shifted } from "./usageFormat";
import type { Translate } from "./strings";

const MILLION = 1_000_000;
const TEN_MILLION = 10_000_000;
const HUNDRED = 100;
const LOG_ORIGIN_X = 130;
const LOG_DECADE_WIDTH = 280;
const LOG_MIN = 1;
const LOG_MAX = 1000;
const LOG_DEFAULT_DECADES = 3;
const LOG_MAX_DECADES_BELOW = 3;
const PERCENT = 100;

function plain(n: number, locale: string, decimals: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(n);
}

/** The sentence format: below one million in full ("700,000"), from one million "N million" with at most one decimal. */
export function tokensWords(tokens: number, locale: string, t: Translate): string {
  if (tokens < MILLION) return plain(Math.round(tokens), locale, 0);
  return t("million", { n: plain(tokens / MILLION, locale, 1) });
}

/** The table format: in full below a million, two decimals up to ten million ("1.74 million"), else as the sentence. */
export function tokensTable(tokens: number, locale: string, t: Translate): string {
  if (tokens < MILLION) return plain(Math.round(tokens), locale, 0);
  if (tokens < TEN_MILLION) return t("million", { n: millionsText(tokens, 2, locale) });
  return tokensWords(tokens, locale, t);
}

/** The phone's kind cells: in full below a million, "1.74 M" from there. */
export function tokensPhone(tokens: number, locale: string): string {
  return tokens < MILLION ? plain(Math.round(tokens), locale, 0) : `${millionsText(tokens, 2, locale)} M`;
}

/** What one token is worth in base tokens: whole from 100, one decimal from 10, else two significant digits. */
export function multipleText(multiple: number, locale: string): string {
  if (multiple >= HUNDRED) return plain(multiple, locale, 0);
  if (multiple >= 1) return plain(multiple, locale, 1);
  return plain(multiple, locale, 2);
}

/** A kind's weight against fresh input: below one two decimals, else one (the phone drops trailing zeros). */
export function ratioText(ratio: number, locale: string, phone: boolean): string {
  return `${ratioDigits(ratio, locale, phone)}×`;
}

function ratioDigits(ratio: number, locale: string, phone: boolean): string {
  const decimals = ratio < 1 ? 2 : 1;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: phone ? 0 : decimals,
    maximumFractionDigits: phone ? 2 : decimals,
  }).format(ratio);
}

const FRACTION_WORDS: Array<[number, "fractionTenth" | "fractionFifth" | "fractionQuarter" | "fractionThird" | "fractionHalf"]> = [
  [0.1, "fractionTenth"],
  [0.2, "fractionFifth"],
  [0.25, "fractionQuarter"],
  [0.33, "fractionThird"],
  [0.5, "fractionHalf"],
];
const MULTIPLE_WORDS = ["", "", "multipleTwo", "multipleThree", "multipleFour", "multipleFive", "multipleSix", "multipleSeven", "multipleEight", "multipleNine", "multipleTen"] as const;
const SHOWN_BELOW_ONE_DECIMALS = 2;
const SHOWN_ABOVE_ONE_DECIMALS = 1;

/** The ratio at the table's precision (two decimals below one, one above); `toFixed` rounds the printed digits, so 1.005 is not lost to float error. */
function shownRatio(ratio: number, decimals: number): number {
  return Number(ratio.toFixed(decimals));
}

/** One ratio in words where the table's precision makes it exact ("a tenth", "five times"), else its number with "times" ("5.5 times"). */
export function ratioAmount(ratio: number, locale: string, t: Translate): { text: string; fraction: boolean } {
  if (ratio < 1) {
    const shown = shownRatio(ratio, SHOWN_BELOW_ONE_DECIMALS);
    const word = FRACTION_WORDS.find(([value]) => value === shown);
    if (word) return { text: t(word[1]), fraction: true };
  } else {
    const shown = shownRatio(ratio, SHOWN_ABOVE_ONE_DECIMALS);
    const key = Number.isInteger(shown) ? MULTIPLE_WORDS[shown] : undefined;
    if (key) return { text: t(key), fraction: false };
  }
  return { text: t("multipleOther", { n: ratioDigits(ratio, locale, false) }), fraction: false };
}

const SUBJECT_KEYS = {
  [TokenKind.Input]: "kindsSubjectInput",
  [TokenKind.CacheWrite]: "kindsSubjectCacheWrite",
  [TokenKind.CacheRead]: "kindsSubjectCacheRead",
  [TokenKind.Output]: "kindsSubjectOutput",
} as const;
const REFERENCE_KEYS = {
  [TokenKind.Input]: "kindsRefFresh",
  [TokenKind.CacheWrite]: "kindsRefCacheWrite",
  [TokenKind.CacheRead]: "kindsRefCacheRead",
  [TokenKind.Output]: "kindsRefOutput",
} as const;

/** The two kinds the sentence describes: cache read and output, or cache write in place of the one that is the reference. */
export function sentenceSubjects(reference: TokenKind): [TokenKind, TokenKind] {
  if (reference === TokenKind.CacheRead) return [TokenKind.CacheWrite, TokenKind.Output];
  if (reference === TokenKind.Output) return [TokenKind.CacheWrite, TokenKind.CacheRead];
  return [TokenKind.CacheRead, TokenKind.Output];
}

/** "A cache read costs a tenth of a fresh input token; output costs five times as much." from the fitted ratios. */
export function kindsSentence(ratios: Record<TokenKind, number | null>, reference: TokenKind, locale: string, t: Translate): string | null {
  const [firstKind, secondKind] = sentenceSubjects(reference);
  const [firstRatio, secondRatio] = [ratios[firstKind], ratios[secondKind]];
  if (firstRatio == null || secondRatio == null) return null;
  const first = ratioAmount(firstRatio, locale, t);
  const second = ratioAmount(secondRatio, locale, t);
  const firstCost = t(first.fraction ? "kindsFractionOf" : "kindsMultipleOf", { amount: first.text, ref: t(REFERENCE_KEYS[reference]) });
  const secondCost = t(second.fraction ? "kindsSecondFraction" : "kindsSecondMultiple", { amount: second.text });
  const subject = t(SUBJECT_KEYS[firstKind]);
  return t("kindsSentence", {
    first: subject.charAt(0).toLocaleUpperCase(locale) + subject.slice(1),
    firstCost,
    second: t(SUBJECT_KEYS[secondKind]),
    secondCost,
  });
}

/** Percent of a 0-to-1 share, whole: "8%". */
export function shareText(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

/** The model that gets the least cap per token (the most tokens per 1% in its mix): the default comparison base. */
export function defaultBase(models: CapCostModelDto[]): string | null {
  const ranked = models.filter((m) => m.all_kinds_tokens_per_percent !== null && m.own_cap === null);
  const best = ranked.sort((a, b) => (b.all_kinds_tokens_per_percent ?? 0) - (a.all_kinds_tokens_per_percent ?? 0))[0];
  return best?.model ?? models[0]?.model ?? null;
}

/** Tokens per 1% of the base model's mix, the unit every multiple is counted in. */
function unitOf(base: CapCostModelDto | undefined): number | null {
  return base?.all_kinds_tokens_per_percent ?? null;
}

/** How many base tokens one token of `model` (in `kind`, or its whole mix) uses as much of the week as; null when unknown. */
export function multipleOf(model: CapCostModelDto, kind: TokenKind | null, base: CapCostModelDto | undefined): number | null {
  const unit = unitOf(base);
  // Slice 67: a model on its own cap counts points of another cap; no multiple either way.
  if (model.own_cap !== null || (base !== undefined && base.own_cap !== null)) return null;
  // Two figures weighted by different windows' mixes (Slice 26) are not comparable: show a dash.
  if (kind === null && base !== undefined && model.mix_source !== base.mix_source) return null;
  const own = kind === null ? model.all_kinds_tokens_per_percent : model.tokens_per_percent[kind];
  return unit !== null && own !== null && own > 0 ? unit / own : null;
}

/**
 * The place on the 1,000-wide log scale of the comparison chart: `low` (1x by default) at 130, 1000x
 * at 970, clamped. With the default, every decade is 280 wide, as drawn in the mock; a lower `low`
 * (from `logLow`) squeezes the same width over more decades.
 */
export function logX(multiple: number, low: number = LOG_MIN): number {
  const clamped = Math.min(LOG_MAX, Math.max(low, multiple));
  const decades = Math.log10(LOG_MAX / low);
  return LOG_ORIGIN_X + (Math.log10(clamped / low) * LOG_DECADE_WIDTH * LOG_DEFAULT_DECADES) / decades;
}

/** The lowest power of ten on the chart: 1x, or lower when a multiple is below 1 (never below 0.001). */
export function logLow(multiples: number[]): number {
  const smallest = Math.min(LOG_MIN, ...multiples.filter((m) => m > 0));
  return 10 ** Math.max(-LOG_MAX_DECADES_BELOW, Math.floor(Math.log10(smallest)));
}

/** The gridline values from `low` to 1000x, one per power of ten. */
export function logTicks(low: number): number[] {
  const first = Math.round(Math.log10(low));
  return Array.from({ length: Math.round(Math.log10(LOG_MAX)) - first + 1 }, (_, i) => 10 ** (first + i));
}

/** "Sat 14, 10:05–12:40" in the viewer's time. */
export function spanText(locale: string, start: string, end: string, offset: OffsetAt): string {
  return `${dayText(locale, shifted(start, offset))}, ${clockAt(start, offset)}–${clockAt(end, offset)}`;
}

/** The text split so each of the given pieces can be drawn bold; pieces that do not occur are skipped. */
export function splitBold(text: string, pieces: string[]): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [{ text, bold: false }];
  for (const piece of pieces) {
    const at = parts.findIndex((part) => !part.bold && part.text.includes(piece));
    if (at < 0 || piece === "") continue;
    const part = parts[at];
    if (!part) continue;
    const start = part.text.indexOf(piece);
    parts.splice(at, 1, { text: part.text.slice(0, start), bold: false }, { text: piece, bold: true }, { text: part.text.slice(start + piece.length), bold: false });
  }
  return parts.filter((part) => part.text !== "");
}
