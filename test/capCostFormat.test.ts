import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CAP_COST, parseConfig } from "../src/config";
import type { CapCostModelDto } from "../src/api/usageDto";
import { FitMode, HowSure, MixSource } from "../src/domain/capCost";
import { TokenKind } from "../src/domain/usage";
import { defaultBase, kindsSentence, ratioAmount, logLow, logTicks, logX, multipleOf, multipleText, ratioText, shareText, spanText, splitBold, tokensPhone, tokensTable, tokensWords } from "../web/src/capCostFormat";
import { translator } from "../web/src/strings";

const t = translator();

function model(name: string, mix: number, input: number | null = mix): CapCostModelDto {
  const each = { input, cache_write: mix, cache_read: mix, output: mix };
  return {
    model: name,
    color_index: 0,
    mode: FitMode.OneWeight,
    tokens_per_percent: each,
    all_kinds_tokens_per_percent: mix,
    mix_source: MixSource.Current,
    kind_ratios: null,
    kind_ratio_reference: null,
    how_sure: HowSure.Sure,
    stretches: 5,
    finer_at: 12,
  };
}

describe("cap cost number text", () => {
  it("writes tokens in full below a million and as millions with at most one decimal from there", () => {
    expect(tokensWords(700_000, "en-US", t)).toBe("700,000");
    expect(tokensWords(1_400_000, "en-US", t)).toBe("1.4 million");
    expect(tokensWords(19_000_000, "en-US", t)).toBe("19 million");
  });

  it("writes the table formats: two decimals under ten million, the phone's M cells", () => {
    expect(tokensTable(1_740_000, "en-US", t)).toBe("1.74 million");
    expect(tokensTable(1_400_000, "en-US", t)).toBe("1.40 million");
    expect(tokensTable(174_000, "en-US", t)).toBe("174,000");
    expect(tokensTable(19_000_000, "en-US", t)).toBe("19 million");
    expect(tokensPhone(1_740_000, "en-US")).toBe("1.74 M");
    expect(tokensPhone(35_000, "en-US")).toBe("35,000");
  });

  it("rounds multiples and kind ratios the way the mock draws them", () => {
    expect(multipleText(109.4, "en-US")).toBe("109");
    expect(multipleText(13.57, "en-US")).toBe("13.6");
    expect(multipleText(10.9, "en-US")).toBe("10.9");
    expect(multipleText(0.5, "en-US")).toBe("0.5");
    expect(ratioText(1, "en-US", false)).toBe("1.0×");
    expect(ratioText(0.1, "en-US", false)).toBe("0.10×");
    expect(ratioText(5, "en-US", false)).toBe("5.0×");
    expect(ratioText(0.1, "en-US", true)).toBe("0.1×");
    expect(ratioText(5, "en-US", true)).toBe("5×");
    expect(shareText(0.0819)).toBe("8%");
  });
});

describe("the comparison", () => {
  it("defaults to the model with the most tokens per 1%, and counts multiples in its mix", () => {
    const models = [model("model-a", 700_000), model("model-b", 1_400_000), model("model-c", 19_000_000)];
    expect(defaultBase(models)).toBe("model-c");
    const base = models[2];
    expect(multipleOf(models[0] as CapCostModelDto, null, base)).toBeCloseTo(27.14, 1);
    expect(multipleOf(models[1] as CapCostModelDto, null, base)).toBeCloseTo(13.57, 1);
    expect(multipleOf(base as CapCostModelDto, null, base)).toBe(1);
  });

  it("gives no all-kinds multiple between models weighted by different windows' mixes (Slice 26)", () => {
    const last = { ...model("model-a", 700_000), mix_source: MixSource.LastFull };
    const base = model("model-c", 19_000_000);
    expect(multipleOf(last, null, base)).toBeNull();
    expect(multipleOf(last, null, { ...base, mix_source: MixSource.LastFull })).toBeCloseTo(27.14, 1);
  });

  it("gives none for a kind that costs nothing", () => {
    const free = model("model-a", 700_000, null);
    expect(multipleOf(free, "input" as never, model("model-c", 19_000_000))).toBeNull();
  });

  it("places 1x, 10x and 1000x on the log scale and keeps a value inside it", () => {
    expect(logX(1)).toBe(130);
    expect(logX(10)).toBe(410);
    expect(logX(100)).toBe(690);
    expect(logX(1000)).toBe(970);
    expect(logX(0.01)).toBe(130);
    expect(logX(5000)).toBe(970);
  });

  it("gives a multiple below 1x its own place by lowering the left end of the scale", () => {
    expect(logLow([5, 27])).toBe(1);
    expect(logLow([0.4, 12])).toBe(0.1);
    expect(logLow([0.004, 12])).toBe(0.001);
    expect(logLow([0.0001])).toBe(0.001);
    expect(logTicks(1)).toEqual([1, 10, 100, 1000]);
    expect(logTicks(0.1)).toEqual([0.1, 1, 10, 100, 1000]);
    expect(logX(0.1, 0.1)).toBe(130);
    expect(logX(1000, 0.1)).toBe(970);
    expect(logX(0.4, 0.1)).toBeLessThan(logX(1, 0.1));
    expect(logX(1, 0.1)).toBeGreaterThan(logX(0.4, 0.1));
    expect(logX(1, 0.1)).toBeCloseTo(130 + 210, 6);
  });

  it("writes a stretch's span in the viewer's time", () => {
    expect(spanText("en-US", "2026-11-14T10:05:00.000Z", "2026-11-14T12:40:00.000Z", 0)).toBe("Sat 14, 10:05–12:40");
    expect(spanText("en-US", "2026-11-14T10:05:00.000Z", "2026-11-14T12:40:00.000Z", 60)).toBe("Sat 14, 11:05–13:40");
  });

  it("splits a line so its numbers can be bold", () => {
    expect(splitBold("1% ≈ 700,000 tokens · 1 token = 27×", ["700,000", "27×"])).toEqual([
      { text: "1% ≈ ", bold: false },
      { text: "700,000", bold: true },
      { text: " tokens · 1 token = ", bold: false },
      { text: "27×", bold: true },
    ]);
  });
});

describe("cap cost config", () => {
  it("has defaults, reads capCost under usage and falls back on a bad value", () => {
    expect(parseConfig(undefined).usage.capCost).toEqual(DEFAULT_CAP_COST);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = parseConfig(JSON.stringify({ usage: { capCost: { minStretches: 5, sure: { minStretches: 10 }, fineFactor: "x" } } }));
    expect(config.usage.capCost.minStretches).toBe(5);
    expect(config.usage.capCost.sure).toEqual({ minStretches: 10, maxLeftoverShare: DEFAULT_CAP_COST.sure.maxLeftoverShare });
    expect(config.usage.capCost.fineFactor).toBe(DEFAULT_CAP_COST.fineFactor);
    log.mockRestore();
  });
});

describe("the kinds sentence", () => {
  const ratios = { input: 1, cache_write: 1.24, cache_read: 0.1, output: 5 } as Record<TokenKind, number | null>;

  it("reads exactly the mock's text from the fitted 0.10 and 5.0", () => {
    expect(kindsSentence(ratios, TokenKind.Input, "en-US", t)).toBe("A cache read costs a tenth of a fresh input token; output costs five times as much.");
  });

  it("uses words only where the shown precision is exact", () => {
    expect(ratioAmount(0.2, "en-US", t).text).toBe("a fifth");
    expect(ratioAmount(0.25, "en-US", t).text).toBe("a quarter");
    expect(ratioAmount(0.33, "en-US", t).text).toBe("a third");
    expect(ratioAmount(0.5, "en-US", t).text).toBe("half");
    expect(ratioAmount(2, "en-US", t).text).toBe("twice");
    expect(ratioAmount(10, "en-US", t).text).toBe("ten times");
    expect(ratioAmount(0.3, "en-US", t).text).toBe("0.30 times");
    expect(ratioAmount(5.5, "en-US", t).text).toBe("5.5 times");
    expect(ratioAmount(11, "en-US", t).text).toBe("11.0 times");
    expect(ratioAmount(1, "en-US", t).text).toBe("1.0 times");
    expect(ratioAmount(1.005, "en-US", t).text).toBe("1.0 times");
    expect(ratioAmount(0.995, "en-US", t).text).toBe("1.00 times");
    expect(ratioAmount(1.96, "en-US", t).text).toBe("twice");
    expect(ratioAmount(0.5, "en-US", t).text).toBe("half");
  });

  it("writes the second amount as a phrase, in numbers too", () => {
    const odd = { input: null, cache_write: 4, cache_read: 0.1, output: 5.5 } as Record<TokenKind, number | null>;
    expect(kindsSentence(odd, TokenKind.Input, "en-US", t)).toBe("A cache read costs a tenth of a fresh input token; output costs 5.5 times as much.");
    const half = { ...odd, output: 0.5 };
    expect(kindsSentence(half, TokenKind.Input, "en-US", t)).toBe(
      "A cache read costs a tenth of a fresh input token; output costs half as much.",
    );
  });

  it("names the real reference when it is not fresh input", () => {
    const other = { input: null, cache_write: 4, cache_read: 1, output: 0.5 } as Record<TokenKind, number | null>;
    expect(kindsSentence(other, TokenKind.CacheRead, "en-US", t)).toBe("A cache write costs four times as much as a cache read token; output costs half as much.");
  });

  it("is left out without ratios", () => {
    expect(kindsSentence({ ...ratios, output: null }, TokenKind.Input, "en-US", t)).toBeNull();
  });
});
