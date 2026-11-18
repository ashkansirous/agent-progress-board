import { useState } from "react";
import type { CapCostModelDto, UsagePageResponse } from "../../src/api/usageDto";
import { FitMode, MixSource } from "../../src/domain/capCost";
import { TOKEN_KINDS, TokenKind } from "../../src/domain/usage";
import { defaultBase, kindsSentence, logLow, logTicks, logX, multipleOf, multipleText, ratioText, splitBold, tokensPhone, tokensTable, tokensWords } from "./capCostFormat";
import { HowSurePill } from "./HowSurePill";
import { ClockIcon } from "./icons";
import { seriesColor, TOKEN_KIND_LABELS, useUsageView } from "./usageView";
import type { Translate } from "./strings";

const NO_VALUE = "–";
const GRID_TOP = 30;
const ROW_STEP = 56;
const FIRST_ROW_Y = 48;
const LABEL_GAP = 18;
const CHART_PAD = 52;
const MARKER_LABEL_OFFSET = 12;
const BELOW_OFFSET = 22;

type Props = { data: UsagePageResponse };

function swatchOf(data: UsagePageResponse, model: CapCostModelDto, scheme: "light" | "dark") {
  return seriesColor(data.palette, model.color_index, scheme);
}

function ModelName({ data, model }: { data: UsagePageResponse; model: CapCostModelDto }) {
  const { scheme } = useUsageView();
  return (
    <span className="model-name">
      <span className="swatch swatch-small" style={{ background: swatchOf(data, model, scheme) }} />
      {model.model}
    </span>
  );
}

/** A model with no weight has no tokens-per-1% figure: a dash, never "0 each". */
function wordsOrDash(value: number | null, locale: string, t: ReturnType<typeof useUsageView>["t"]): string {
  return value === null ? NO_VALUE : tokensWords(value, locale, t);
}

function kindCell(value: number | null, locale: string, t: ReturnType<typeof useUsageView>["t"]): string {
  return value === null ? NO_VALUE : tokensTable(value, locale, t);
}

/** Says so on a row whose "all kinds" figure is weighted by last week's mix because this window is under a day old (Slice 26). */
function MixNote({ model }: { model: CapCostModelDto }) {
  const { t } = useUsageView();
  if (model.mix_source !== MixSource.LastFull) return null;
  return <span className="mix-note">{t("mixLastWeek")}</span>;
}

/** The name of the all-kinds figure for one model: its own source of mix. */
function mixLabel(model: CapCostModelDto, t: ReturnType<typeof useUsageView>["t"]): string {
  return t(model.mix_source === MixSource.LastFull ? "columnMixLast" : "columnMix");
}

function TokensPerOne({ data }: Props) {
  const { t, locale } = useUsageView();
  const models = data.cap_cost.models;
  return (
    <div className="cost-block">
      <h3>{t("tokensPerOneTitle")}</h3>
      <div className="table-scroll">
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col" className="left">{t("columnModel")}</th>
              {TOKEN_KINDS.map((kind) => (
                <th key={kind} scope="col">{t(TOKEN_KIND_LABELS[kind])}</th>
              ))}
              <th scope="col" className="strong-col">{t("columnMix")}</th>
              <th scope="col">{t("columnHowSure")}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model}>
                <th scope="row" className="left"><ModelName data={data} model={model} /></th>
                {model.mode === FitMode.PerKind ? (
                  TOKEN_KINDS.map((kind) => <td key={kind}>{kindCell(model.tokens_per_percent[kind], locale, t)}</td>)
                ) : (
                  <td colSpan={TOKEN_KINDS.length} className="merged-cell">
                    {t("oneWeightUntil", { n: model.finer_at, x: wordsOrDash(model.all_kinds_tokens_per_percent, locale, t) })}
                  </td>
                )}
                <td className="strong-col">
                  {kindCell(model.all_kinds_tokens_per_percent, locale, t)}
                  <MixNote model={model} />
                </td>
                <td>
                  <HowSurePill howSure={model.how_sure} />
                  <span className="pill-count">{t("stretchesN", { n: model.stretches })}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const KIND_MARKS: Record<TokenKind, "circle" | "square" | "diamond" | "triangle"> = {
  [TokenKind.Input]: "circle",
  [TokenKind.CacheWrite]: "square",
  [TokenKind.CacheRead]: "diamond",
  [TokenKind.Output]: "triangle",
};

function Mark({ shape, x, y, fill }: { shape: (typeof KIND_MARKS)[TokenKind]; x: number; y: number; fill: string }) {
  const common = { fill, stroke: "var(--card)", strokeWidth: 2 };
  if (shape === "circle") return <circle cx={x} cy={y} r={6} {...common} />;
  if (shape === "square") return <rect x={x - 6} y={y - 6} width={12} height={12} rx={1.5} {...common} />;
  if (shape === "diamond") return <polygon points={`${x},${y - 8} ${x + 8},${y} ${x},${y + 8} ${x - 8},${y}`} {...common} />;
  return <polygon points={`${x},${y - 8} ${x + 8},${y + 6} ${x - 8},${y + 6}`} {...common} />;
}

function LegendMark({ shape }: { shape: (typeof KIND_MARKS)[TokenKind] | "bar" }) {
  const ink = "var(--markInk)";
  const inner =
    shape === "bar" ? (
      <rect x={6} y={1} width={2} height={12} fill="var(--text)" />
    ) : (
      <Mark shape={shape} x={7} y={7} fill={ink} />
    );
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      {inner}
    </svg>
  );
}

interface ModelRowProps {
  data: UsagePageResponse;
  model: CapCostModelDto;
  base: CapCostModelDto | undefined;
  y: number;
  /** The multiple at the left end of the scale. */
  low: number;
}

function ModelRow({ data, model, base, y, low }: ModelRowProps) {
  const { t, scheme, locale } = useUsageView();
  const fill = swatchOf(data, model, scheme);
  const mix = multipleOf(model, null, base);
  const isBase = model.model === base?.model;
  const marks =
    model.mode === FitMode.PerKind
      ? TOKEN_KINDS.map((kind, i) => ({ kind, multiple: multipleOf(model, kind, base), below: i % 2 === 1 }))
      : [];
  return (
    <g>
      <text x={0} y={y + 4} className="chart-model">{model.model}</text>
      <line x1={logX(low, low)} x2={logX(1000, low)} y1={y} y2={y} className="chart-hairline" />
      {marks.map(({ kind, multiple, below }) =>
        multiple === null ? null : (
          <g key={kind}>
            <title>{t("compareTip", { model: model.model, kind: t(TOKEN_KIND_LABELS[kind]), n: multipleText(multiple, locale) })}</title>
            <Mark shape={KIND_MARKS[kind]} x={logX(multiple, low)} y={y} fill={fill} />
            {model.mode === FitMode.PerKind && (
              <text x={logX(multiple, low)} y={below ? y + BELOW_OFFSET : y - MARKER_LABEL_OFFSET} textAnchor="middle" className="chart-label">
                {`${t(TOKEN_KIND_LABELS[kind])} ${multipleText(multiple, locale)}×`}
              </text>
            )}
          </g>
        ),
      )}
      {mix !== null && (
        <g>
          <title>{t("compareTip", { model: model.model, kind: mixLabel(model, t), n: multipleText(mix, locale) })}</title>
          <line x1={logX(mix, low)} x2={logX(mix, low)} y1={y - 12} y2={y + 12} className="chart-mix" />
        </g>
      )}
      {isBase && model.mode === FitMode.OneWeight && (
        <text x={logX(1, low) + 14} y={y + 4} className="chart-label">{t("everyKindBase")}</text>
      )}
    </g>
  );
}

function CompareChart({ data, base }: { data: UsagePageResponse; base: CapCostModelDto | undefined }) {
  const { t } = useUsageView();
  const models = data.cap_cost.models;
  const gridBottom = GRID_TOP + ROW_STEP * models.length;
  const multiples = models.flatMap((model) => [multipleOf(model, null, base), ...TOKEN_KINDS.map((kind) => multipleOf(model, kind, base))]);
  const low = logLow(multiples.filter((m): m is number => m !== null));
  return (
    <svg className="compare-chart" viewBox={`0 0 1000 ${gridBottom + CHART_PAD}`} role="img" aria-label={t("compareAlt", { base: base?.model ?? "" })}>
      {logTicks(low).map((n) => (
        <g key={n}>
          <line x1={logX(n, low)} x2={logX(n, low)} y1={GRID_TOP} y2={gridBottom} className="grid-line" />
          <text x={logX(n, low)} y={gridBottom + LABEL_GAP} textAnchor="middle" className="axis-text">{`${n}×`}</text>
        </g>
      ))}
      {models.map((model, i) => (
        <ModelRow key={model.model} data={data} model={model} base={base} y={FIRST_ROW_Y + ROW_STEP * i} low={low} />
      ))}
    </svg>
  );
}

/** One token of the model uses as much of the week as N tokens of the base, said for each other model. */
function compareSentence(models: CapCostModelDto[], base: CapCostModelDto | undefined, view: ReturnType<typeof useUsageView>): string {
  const { t, locale } = view;
  const others = models.filter((m) => m.model !== base?.model && multipleOf(m, null, base) !== null);
  const parts = others.map((model, i) => {
    const x = multipleText(multipleOf(model, null, base) ?? 0, locale);
    return i === 0 ? t("compareFirst", { model: model.model, x, base: base?.model ?? "" }) : t("compareNext", { model: model.model, x });
  });
  return parts.length === 0 ? "" : `${parts.join("; ")}. ${t("logScale")}`;
}

function CompareTable({ data, base }: { data: UsagePageResponse; base: CapCostModelDto | undefined }) {
  const { t, locale } = useUsageView();
  return (
    <div className="table-scroll">
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col" className="left">{t("columnModel")}</th>
            {TOKEN_KINDS.map((kind) => (
              <th key={kind} scope="col">{t(TOKEN_KIND_LABELS[kind])}</th>
            ))}
            <th scope="col" className="strong-col">{t("allKinds")}</th>
          </tr>
        </thead>
        <tbody>
          {data.cap_cost.models.map((model) => {
            const mix = multipleOf(model, null, base);
            const isBase = model.model === base?.model;
            return (
              <tr key={model.model}>
                <th scope="row" className="left"><ModelName data={data} model={model} /></th>
                {model.mode === FitMode.PerKind ? (
                  TOKEN_KINDS.map((kind) => {
                    const multiple = multipleOf(model, kind, base);
                    return <td key={kind}>{multiple === null ? NO_VALUE : `${multipleText(multiple, locale)}×`}</td>;
                  })
                ) : (
                  <td colSpan={TOKEN_KINDS.length} className="merged-cell">
                    {isBase ? t("baseOneWeight") : mix === null ? NO_VALUE : `${multipleText(mix, locale)}×`}
                  </td>
                )}
                <td className="strong-col">
                  {mix === null ? NO_VALUE : `${multipleText(mix, locale)}×`}
                  <MixNote model={model} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompareBlock({ data }: Props) {
  const view = useUsageView();
  const { t } = view;
  const models = data.cap_cost.models;
  const [chosen, setChosen] = useState<string | null>(null);
  const baseName = models.some((m) => m.model === chosen) ? chosen : defaultBase(models);
  const base = models.find((m) => m.model === baseName);
  return (
    <div className="cost-block">
      <div className="block-head">
        <h3>{t("compareTitle")}</h3>
        <label className="base-field">
          <span>{t("measuredIn")}</span>
          <select value={baseName ?? ""} onChange={(event) => setChosen(event.target.value)}>
            {models.map((model) => (
              <option key={model.model} value={model.model}>{t("modelTokens", { model: model.model })}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="block-note">{compareSentence(models, base, view)}</p>
      <ul className="mark-legend">
        {TOKEN_KINDS.map((kind) => (
          <li key={kind}>
            <LegendMark shape={KIND_MARKS[kind]} />
            {t(TOKEN_KIND_LABELS[kind])}
          </li>
        ))}
        <li>
          <LegendMark shape="bar" />
          {t("columnMix")}
        </li>
      </ul>
      <CompareChart data={data} base={base} />
      <CompareTable data={data} base={base} />
    </div>
  );
}

/** A line for each model whose kinds are compared with something other than fresh input (it weighed nothing). */
function ReferenceNotes({ models }: { models: CapCostModelDto[] }) {
  const { t } = useUsageView();
  return (
    <>
      {models
        .filter((m) => m.kind_ratio_reference !== null && m.kind_ratio_reference !== TokenKind.Input)
        .map((m) => (
          <p key={m.model} className="block-note">
            {t("kindsReference", { model: m.model, kind: t(TOKEN_KIND_LABELS[m.kind_ratio_reference as TokenKind]) })}
          </p>
        ))}
    </>
  );
}

/** One sentence per distinct set of fitted ratios; with more than one, each names the models it holds for. */
function kindsSentences(models: CapCostModelDto[], locale: string, t: Translate): string[] {
  const groups = ratioGroups(models, (kind, ratios) => String(ratios[kind]));
  const sentences = groups.flatMap((group) => {
    const model = models.find((m) => m.model === group.models[0]);
    const text = model?.kind_ratios && model.kind_ratio_reference ? kindsSentence(model.kind_ratios, model.kind_ratio_reference, locale, t) : null;
    if (text === null) return [];
    return [groups.length > 1 ? `${group.models.join(t("andJoin"))}: ${text}` : text];
  });
  return sentences;
}

function KindsBlock({ data }: Props) {
  const { t, locale } = useUsageView();
  const models = data.cap_cost.models;
  const sentences = kindsSentences(models, locale, t);
  const ratio = (model: CapCostModelDto, kind: TokenKind): string => {
    const value = model.kind_ratios?.[kind] ?? null;
    return value === null ? NO_VALUE : ratioText(value, locale, false);
  };
  return (
    <div className="cost-block">
      <h3>{t("kindsTitle")}</h3>
      {sentences.map((sentence) => (
        <p key={sentence} className="block-note">
          {sentence}
        </p>
      ))}
      <div className="table-scroll">
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col" className="left">{t("columnModel")}</th>
              {TOKEN_KINDS.map((kind) => (
                <th key={kind} scope="col">{t(TOKEN_KIND_LABELS[kind])}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model}>
                <th scope="row" className="left"><ModelName data={data} model={model} /></th>
                {model.kind_ratios ? (
                  TOKEN_KINDS.map((kind) => <td key={kind}>{ratio(model, kind)}</td>)
                ) : (
                  <td colSpan={TOKEN_KINDS.length} className="merged-cell">{t("notSplit")}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReferenceNotes models={models} />
    </div>
  );
}

function DesktopCapCost({ data }: Props) {
  const { t } = useUsageView();
  const plan = data.plan ?? NO_VALUE;
  return (
    <section className="usage-card cap-cost-card" aria-labelledby="cap-cost-title">
      <div className="card-head-stack">
        <h2 id="cap-cost-title">{t("oneTitle", { plan })}</h2>
        <p className="card-note">{t("oneCaption")}</p>
      </div>
      <TokensPerOne data={data} />
      <CompareBlock data={data} />
      <KindsBlock data={data} />
    </section>
  );
}

function Emphasised({ text, pieces }: { text: string; pieces: string[] }) {
  return (
    <>
      {splitBold(text, pieces).map((part, i) => (part.bold ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>))}
    </>
  );
}

function PhoneModel({ data, model, base }: { data: UsagePageResponse; model: CapCostModelDto; base: CapCostModelDto | undefined }) {
  const { t, locale } = useUsageView();
  const isBase = model.model === base?.model;
  const n = wordsOrDash(model.all_kinds_tokens_per_percent, locale, t);
  const mix = multipleOf(model, null, base);
  const x = mix === null ? NO_VALUE : multipleText(mix, locale);
  const line = isBase ? t("onePercentBase", { n }) : t("onePercentModel", { n, x, base: base?.model ?? "" });
  return (
    <li className="phone-model">
      <span className="phone-model-top">
        <ModelName data={data} model={model} />
        <HowSurePill howSure={model.how_sure} />
      </span>
      <span className="phone-model-line"><Emphasised text={line} pieces={[n, `${x}×`]} /></span>
      <MixNote model={model} />
      {model.mode === FitMode.PerKind ? (
        <span className="kind-cells">
          {TOKEN_KINDS.map((kind) => {
            const multiple = multipleOf(model, kind, base);
            return (
              <span key={kind} className="kind-cell">
                <span className="kind-cell-label">{t(kind === TokenKind.Input ? "kindFreshShort" : TOKEN_KIND_LABELS[kind])}</span>
                <span className="kind-cell-value">{model.tokens_per_percent[kind] === null ? NO_VALUE : tokensPhone(model.tokens_per_percent[kind] ?? 0, locale)}</span>
                <span className="kind-cell-multiple">{multiple === null ? NO_VALUE : `${multipleText(multiple, locale)}× ${base?.model ?? ""}`}</span>
              </span>
            );
          })}
        </span>
      ) : (
        <span className="phone-model-note">{t("oneWeightSoFar", { n: model.finer_at, m: model.stretches })}</span>
      )}
    </li>
  );
}

function PhoneKinds({ data }: Props) {
  const { t, locale } = useUsageView();
  const models = data.cap_cost.models;
  const groups = ratioGroups(models, (kind, ratios) => (ratios[kind] == null ? NO_VALUE : ratioText(ratios[kind] ?? 0, locale, true)));
  const unsplit = models.filter((m) => m.kind_ratios === null).map((m) => m.model);
  const notSplit = unsplit.length > 0 ? t("kindsNotSplit", { models: unsplit.join(t("andJoin")) }) : null;
  if (groups.length === 0 && notSplit === null) return null;
  return (
    <section className="usage-card" aria-labelledby="kinds-title">
      <h2 id="kinds-title">{t("phoneKindsTitle")}</h2>
      {groups.length === 0 && <p className="block-note">{`${notSplit}.`}</p>}
      {groups.map((group, i) => {
        const sentence = [t("kindsSameFor", { models: group.models.join(t("andJoin")) }), i === groups.length - 1 ? notSplit : null]
          .filter(Boolean)
          .join("; ");
        return (
          <div key={group.signature} className="kind-ratio-group">
            <div className="kind-ratio-grid">
              {TOKEN_KINDS.map((kind) => (
                <span key={kind} className="kind-ratio-cell">
                  <span className="kind-cell-label">{t(kind === TokenKind.Input ? "kindFreshShort" : TOKEN_KIND_LABELS[kind])}</span>
                  <b>{group.cells[kind]}</b>
                </span>
              ))}
            </div>
            <p className="block-note">{`${sentence}.`}</p>
          </div>
        );
      })}
      <ReferenceNotes models={models} />
    </section>
  );
}

interface RatioGroup {
  signature: string;
  models: string[];
  cells: Record<TokenKind, string>;
}

/** The per-kind models grouped by their fitted ratios: only models with equal ratios (not just equal text) share a grid. */
function ratioGroups(models: CapCostModelDto[], show: (kind: TokenKind, ratios: Record<TokenKind, number | null>) => string): RatioGroup[] {
  const groups = new Map<string, RatioGroup>();
  for (const model of models) {
    const ratios = model.kind_ratios;
    if (ratios === null) continue;
    const cells = Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, show(kind, ratios)])) as Record<TokenKind, string>;
    const signature = [model.kind_ratio_reference, ...TOKEN_KINDS.map((kind) => ratios[kind] ?? "none")].join("|");
    const group = groups.get(signature);
    if (group) group.models.push(model.model);
    else groups.set(signature, { signature, models: [model.model], cells });
  }
  return [...groups.values()];
}

function PhoneCapCost({ data }: Props) {
  const { t } = useUsageView();
  const models = data.cap_cost.models;
  const base = models.find((m) => m.model === defaultBase(models));
  return (
    <>
      <section className="usage-card" aria-labelledby="cap-cost-title">
        <h2 id="cap-cost-title">{t("oneTitleShort")}</h2>
        <p className="block-note">{t("phoneCaption", { base: base?.model ?? "" })}</p>
        <ul className="phone-models">
          {models.map((model) => (
            <PhoneModel key={model.model} data={data} model={model} base={base} />
          ))}
        </ul>
      </section>
      <PhoneKinds data={data} />
    </>
  );
}

/** The card that replaces the whole estimate until the plan has enough stretches of time. */
export function NotReadyCard({ data }: Props) {
  const { t } = useUsageView();
  return (
    <section className="state-card state-center">
      <ClockIcon size={44} stroke="var(--pillRoughFg)" strokeWidth={1.6} />
      <p className="state-title">{t("notReadyTitle")}</p>
      <p className="state-body state-body-wide">{t("notReadyBody", { n: data.cap_cost.stretches, plan: data.plan ?? NO_VALUE })}</p>
    </section>
  );
}

/** "What 1% of the week costs": three blocks on the desktop, two cards on the phone, or the "not ready" card. */
export function CapCostSection({ data }: Props) {
  const { phone } = useUsageView();
  if (!data.cap_cost.ready) return <NotReadyCard data={data} />;
  if (data.cap_cost.models.length === 0) return null;
  return phone ? <PhoneCapCost data={data} /> : <DesktopCapCost data={data} />;
}
