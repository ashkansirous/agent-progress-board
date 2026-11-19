import { useState } from "react";
import type { UsageResponse, UsageSeriesDto } from "../../src/api/usageDto";
import { BucketUnit, Split } from "../../src/domain/usage";
import {
  barSlot,
  chartBuckets,
  isInRange,
  labelEvery,
  roundedTopPath,
  resetLabelPlace,
  stackSegments,
  xForBucket,
  xForReset,
  yForValue,
  type ChartBucket,
  type Frame,
  type Segment,
} from "./chartGeometry";
import type { StringKey } from "./strings";
import { Segmented, type Choice } from "./UsageControls";
import { TokenKindsTable } from "./TokenKindsTable";
import { niceScale, tokenText, type NiceScale } from "./usageFormat";
import { seriesColor, seriesName, useUsageView, type UsageView } from "./usageView";

interface ChartLayout {
  width: number;
  height: number;
  frame: Frame;
  labelX: number;
  dayY: number;
  font: number;
  intervals: number;
  share: number;
  maxBar: number;
  radius: number;
  maxLabels: number;
}

const DESKTOP: ChartLayout = {
  width: 1000, height: 300, frame: { x0: 48, x1: 890, yTop: 16, yBottom: 260 }, labelX: 38, dayY: 286,
  font: 12, intervals: 4, share: 0.46, maxBar: 55.3, radius: 4, maxLabels: 12,
};
const PHONE: ChartLayout = {
  width: 358, height: 170, frame: { x0: 34, x1: 350, yTop: 10, yBottom: 146 }, labelX: 28, dayY: 164,
  font: 11, intervals: 2, share: 0.55, maxBar: 24.8, radius: 3, maxLabels: 14,
};
const LABEL_BASELINE = 4;
const TOTAL_RISE = 6;
const MIN_SLOT_FOR_TOTALS = 36;
const SERIES_LABEL_GAP = 8;
const SERIES_LABEL_MAX = 16;
const RESET_LABEL_GAP = 6;
const RESET_LABEL_DROP = 12;
const RESET_CHAR_WIDTH = 0.62;
const FIRST = 0;

const SPLIT_CHOICES: [Split, StringKey, StringKey][] = [
  [Split.Model, "splitModel", "splitModel"],
  [Split.TokenKind, "splitKind", "splitKindShort"],
  [Split.AgentKind, "splitAgent", "splitAgentShort"],
  [Split.Environment, "splitEnv", "splitEnvShort"],
];

const SPLIT_NAMES: Record<Split, StringKey> = {
  [Split.Model]: "splitModelName",
  [Split.TokenKind]: "splitKindName",
  [Split.AgentKind]: "splitAgentName",
  [Split.Environment]: "splitEnvName",
};

function sumAt(series: UsageSeriesDto[], index: number): number {
  return series.reduce((sum, s) => sum + (s.values[index] ?? 0), 0);
}

function sumOf(series: UsageSeriesDto): number {
  return series.values.reduce((sum, v) => sum + v, 0);
}

function Legend({ series, split, palette }: { series: UsageSeriesDto[]; split: Split; palette: UsageResponse["palette"] }) {
  const { t, scheme } = useUsageView();
  return (
    <ul className="series-legend">
      {series.map((s) => (
        <li key={s.name ?? "none"}>
          <span className="swatch" style={{ background: seriesColor(palette, s.color_index, scheme) }} />
          <span className="mono">{seriesName(s, split, t)}</span>
        </li>
      ))}
    </ul>
  );
}

interface BarsProps {
  data: UsageResponse;
  /** Every position and label takes its bucket from this list (real time, a repeated hour kept apart). */
  buckets: ChartBucket[];
  series: UsageSeriesDto[];
  split: Split;
  layout: ChartLayout;
  scale: NiceScale;
  view: UsageView;
}

function Bar({ index, segments, props }: { index: number; segments: Segment[]; props: BarsProps }) {
  const { data, buckets, series, split, layout, view } = props;
  const slot = barSlot(index, buckets.length, layout.frame, layout.share, layout.maxBar);
  const bucket = buckets[index]?.label ?? "";
  const top = segments.at(-1);
  const wide = (layout.frame.x1 - layout.frame.x0) / buckets.length >= MIN_SLOT_FOR_TOTALS;
  return (
    <g>
      {segments.map((seg) => {
        const s = series[seg.series];
        const fill = seriesColor(data.palette, s?.color_index ?? 0, view.scheme);
        const title = s ? view.t("tokenTip", { bucket, series: seriesName(s, split, view.t), tokens: tokenText(seg.value, view.locale) }) : "";
        const tip = view.phone ? null : <title>{title}</title>;
        if (seg.top) return <path key={seg.series} d={roundedTopPath(slot.x, seg.y, slot.width, seg.height, layout.radius)} fill={fill}>{tip}</path>;
        return <rect key={seg.series} x={slot.x} y={seg.y} width={slot.width} height={seg.height} fill={fill}>{tip}</rect>;
      })}
      {!view.phone && wide && top && (
        <text className="strong-text" x={slot.x + slot.width / 2} y={top.y - TOTAL_RISE} textAnchor="middle" fontSize={layout.font}>
          {tokenText(sumAt(series, index), view.locale)}
        </text>
      )}
    </g>
  );
}

function Axes({ props }: { props: BarsProps }) {
  const { buckets, layout, scale, view } = props;
  const { frame } = layout;
  const every = labelEvery(buckets.length, layout.maxLabels);
  return (
    <>
      {Array.from({ length: layout.intervals + 1 }, (_, i) => i * scale.step).map((value) => {
        const y = yForValue(value, scale.top, frame);
        return (
          <g key={value}>
            <line className="grid-line" x1={frame.x0} x2={frame.x1} y1={y} y2={y} />
            <text className="axis-text" x={layout.labelX} y={y + LABEL_BASELINE} textAnchor="end" fontSize={layout.font}>
              {value === 0 ? "0" : tokenText(value, view.locale)}
            </text>
          </g>
        );
      })}
      {buckets.map((bucket, i) =>
        i % every === 0 ? (
          <text key={bucket.key} className="axis-text" x={xForBucket(i, buckets.length, frame)} y={layout.dayY} textAnchor="middle" fontSize={layout.font}>
            {view.phone ? bucket.letter : bucket.label}
          </text>
        ) : null,
      )}
    </>
  );
}

function ResetText({ x, layout, text }: { x: number; layout: ChartLayout; text: string }) {
  const place = resetLabelPlace(x, layout.frame, text.length * layout.font * RESET_CHAR_WIDTH, RESET_LABEL_GAP);
  if (!place.fits) return null;
  return (
    <text className="reset-text" x={place.x} y={layout.frame.yTop + RESET_LABEL_DROP} textAnchor={place.anchor} fontSize={layout.font}>
      {text}
    </text>
  );
}

function ResetLines({ props }: { props: BarsProps }) {
  const { data, buckets, layout, view } = props;
  if (buckets.length === 0) return null;
  return (
    <>
      {data.cap.weekly.windows.map((w) => {
        if (!isInRange(w.started_at, buckets)) return null;
        const x = xForReset(w.started_at, buckets, layout.frame);
        if (x >= layout.frame.x1) return null;
        return (
          <g key={w.started_at}>
            <line className="reset-line" x1={x} x2={x} y1={layout.frame.yTop} y2={layout.frame.yBottom} />
            {!view.phone && <ResetText x={x} layout={layout} text={view.t("resetShort")} />}
          </g>
        );
      })}
    </>
  );
}

function SeriesLabels({ props }: { props: BarsProps }) {
  const { series, split, layout, scale, view } = props;
  const last = props.buckets.length - 1;
  if (view.phone || last < 0) return null;
  const values = series.map((s) => s.values[last] ?? 0);
  const segments = stackSegments(values, scale, layout.frame);
  return (
    <>
      {segments.map((seg) => {
        const s = series[seg.series];
        if (!s) return null;
        const name = seriesName(s, split, view.t);
        const text = name.length > SERIES_LABEL_MAX ? `${name.slice(0, SERIES_LABEL_MAX - 1)}…` : name;
        return (
          <text key={seg.series} className="axis-text" x={layout.frame.x1 + SERIES_LABEL_GAP} y={seg.y + seg.height / 2 + LABEL_BASELINE} fontSize={layout.font}>
            {text}
          </text>
        );
      })}
    </>
  );
}

function altText(props: BarsProps): string {
  const { data, series, split, view } = props;
  const biggest = [...series].sort((a, b) => sumOf(b) - sumOf(a))[FIRST];
  const first = props.buckets[FIRST];
  const last = props.buckets.at(-1);
  if (!biggest || first === undefined || last === undefined || sumOf(biggest) === 0) return view.t("tokensAltNone");
  return view.t("tokensAlt", {
    unit: view.t(data.bucket_unit === BucketUnit.Hour ? "unitHour" : "unitDay"),
    split: view.t(SPLIT_NAMES[split]),
    from: first.label,
    to: last.label,
    top: seriesName(biggest, split, view.t),
  });
}

/** The same numbers as the chart, for a screen reader: one row per series, one column per bucket. */
function DataTable({ props }: { props: BarsProps }) {
  const { data, series, split, view } = props;
  return (
    <div className="sr-only">
      <table>
        <caption>{view.t("tokensTitle", { unit: view.t(data.bucket_unit === BucketUnit.Hour ? "unitHour" : "unitDay"), split: view.t(SPLIT_NAMES[split]) })}</caption>
        <thead>
          <tr>
            <th scope="col">{view.t(SPLIT_NAMES[split])}</th>
            {props.buckets.map((b) => (
              <th key={b.key} scope="col">{b.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.name ?? "none"}>
              <th scope="row">{seriesName(s, split, view.t)}</th>
              {s.values.map((v, i) => (
                <td key={props.buckets[i]?.key ?? i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ props }: { props: BarsProps }) {
  const { series, layout, scale } = props;
  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" role="img" aria-label={altText(props)} className="chart">
      <Axes props={props} />
      <ResetLines props={props} />
      {props.buckets.map((bucket, i) => (
        <Bar key={bucket.key} index={i} segments={stackSegments(series.map((s) => s.values[i] ?? 0), scale, layout.frame)} props={props} />
      ))}
      <SeriesLabels props={props} />
    </svg>
  );
}

/** Tokens per day (or hour) as stacked bars, with the split switch, the legend and the token kinds table. */
export function TokenChart({ data }: { data: UsageResponse }) {
  const view = useUsageView();
  const { t, phone } = view;
  const [split, setSplit] = useState<Split>(Split.Model);
  const series = data.splits[split];
  const layout = phone ? PHONE : DESKTOP;
  const buckets = chartBuckets(data, view);
  const maxTotal = Math.max(0, ...buckets.map((_, i) => sumAt(series, i)));
  const props: BarsProps = { data, buckets, series, split, layout, scale: niceScale(maxTotal, layout.intervals), view };
  const unit = t(data.bucket_unit === BucketUnit.Hour ? "unitHour" : "unitDay");
  const title = phone ? t("tokensTitlePhone", { unit }) : t("tokensTitle", { unit, split: t(SPLIT_NAMES[split]) });
  const choices: Choice<Split>[] = SPLIT_CHOICES.map(([value, long, short]) => ({ value, label: t(phone ? short : long) }));
  return (
    <section className="usage-card" aria-labelledby="tokens-title">
      <div className="card-head">
        <h2 id="tokens-title">{title}</h2>
        <Segmented label={t("splitBy")} choices={choices} value={split} onChange={setSplit} small />
        <Legend series={series} split={split} palette={data.palette} />
      </div>
      <Chart props={props} />
      {split === Split.Environment && data.base_environment === null && series.some((s) => !s.name) && <p className="card-note">{t("noEnvironmentHint")}</p>}
      <DataTable props={props} />
      <TokenKindsTable data={data} />
    </section>
  );
}
