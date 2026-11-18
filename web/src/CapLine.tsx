import type { CapReadingDto, CapWindowDto, UsageResponse } from "../../src/api/usageDto";
import { percentText, weekdayClock } from "./usageFormat";
import { capAxisTop, capTicks, chartBuckets, isInRange, labelEvery, xForBucket, xForReset, xForTime, yForValue, type ChartBucket, type Frame } from "./chartGeometry";
import { useUsageView, type UsageView } from "./usageView";

interface CapLayout {
  width: number;
  height: number;
  frame: Frame;
  labelX: number;
  dayY: number;
  font: number;
  dotRadius: number;
  maxLabels: number;
}

const DESKTOP: CapLayout = { width: 1000, height: 280, frame: { x0: 48, x1: 976, yTop: 20, yBottom: 240 }, labelX: 38, dayY: 266, font: 12, dotRadius: 5, maxLabels: 12 };
const PHONE: CapLayout = { width: 358, height: 150, frame: { x0: 34, x1: 350, yTop: 10, yBottom: 126 }, labelX: 28, dayY: 144, font: 11, dotRadius: 4, maxLabels: 14 };
const FULL_AXIS = 100;
const LABEL_BASELINE = 4;
const RESET_LABEL_GAP = 8;
const RESET_LABEL_DROP = 14;
const NOW_LABEL_RISE = 12;
const DROPPED_LABEL_DROP = 18;
const DROPPED_LABEL_GAP = 10;
const LABEL_FLIP_SHARE = 0.7;
const FIRST = 0;

interface Place {
  x: number;
  y: number;
}

interface Geometry {
  layout: CapLayout;
  top: number;
  /** The chart's buckets: every position, range test and label takes its bucket from this one list. */
  buckets: ChartBucket[];
  where: (iso: string, percent: number) => Place;
  /** A window's reset at 0%, drawn at the left edge when it begins the range. */
  resetAt: (iso: string) => Place;
  inRange: (iso: string) => boolean;
}

function geometryFor(data: UsageResponse, view: UsageView): Geometry {
  const layout = view.phone ? PHONE : DESKTOP;
  const readings = data.cap.weekly.windows.flatMap((w) => w.readings.map((r) => r.percent));
  const top = view.phone ? capAxisTop(Math.max(0, ...readings)) : FULL_AXIS;
  const buckets = chartBuckets(data, view);
  return {
    layout,
    top,
    buckets,
    where: (iso, percent) => ({
      x: xForTime(iso, buckets, layout.frame),
      y: yForValue(percent, top, layout.frame),
    }),
    resetAt: (iso) => ({
      x: xForReset(iso, buckets, layout.frame),
      y: yForValue(0, top, layout.frame),
    }),
    inRange: (iso) => isInRange(iso, buckets),
  };
}

function Grid({ geo, view }: { geo: Geometry; view: UsageView }) {
  const { layout, top, buckets } = geo;
  const { frame } = layout;
  const every = labelEvery(buckets.length, layout.maxLabels);
  return (
    <>
      {capTicks(top).map((tick) => {
        const y = yForValue(tick, top, frame);
        return (
          <g key={tick}>
            <line className="grid-line" x1={frame.x0} x2={frame.x1} y1={y} y2={y} />
            <text className="axis-text" x={layout.labelX} y={y + LABEL_BASELINE} textAnchor="end" fontSize={layout.font}>{`${tick}%`}</text>
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

function ResetMarker({ window, geo, view }: { window: CapWindowDto; geo: Geometry; view: UsageView }) {
  const { t, phone, locale, offsetAt } = view;
  const { frame, font } = geo.layout;
  const { x } = geo.resetAt(window.started_at);
  const label = phone ? t("resetShort") : t("resetMarker", { when: weekdayClock(locale, window.started_at, offsetAt) });
  return (
    <g>
      <line className="reset-line" x1={x} x2={x} y1={frame.yTop} y2={frame.yBottom} />
      <text className="reset-text" x={x + (phone ? 5 : RESET_LABEL_GAP)} y={frame.yTop + (phone ? 10 : RESET_LABEL_DROP)} fontSize={font}>
        {label}
      </text>
    </g>
  );
}

function Readings({ window, geo, view }: { window: CapWindowDto; geo: Geometry; view: UsageView }) {
  const { t, phone } = view;
  const started = geo.inRange(window.started_at);
  const points: Place[] = window.readings.map((r) => geo.where(r.taken_at, r.percent));
  if (started) points.unshift(geo.resetAt(window.started_at));
  return (
    <g>
      <polyline className="cap-path" points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />
      {window.readings.map((r) => {
        const place = geo.where(r.taken_at, r.percent);
        return (
          <circle key={r.taken_at} className="cap-dot" cx={place.x} cy={place.y} r={geo.layout.dotRadius}>
            {!phone && <title>{t("capAtReading", { pct: percentText(r.percent) })}</title>}
          </circle>
        );
      })}
    </g>
  );
}

interface DroppedProps {
  reading: CapReadingDto & { stored_percent: number };
  geo: Geometry;
  view: UsageView;
}

function Dropped({ reading, geo, view }: DroppedProps) {
  const { t, phone } = view;
  const { x, y } = geo.where(reading.taken_at, reading.percent);
  const flip = x > geo.layout.frame.x0 + (geo.layout.frame.x1 - geo.layout.frame.x0) * LABEL_FLIP_SHARE;
  const label = phone ? t("droppedShort") : t("droppedLabel", { pct: percentText(reading.percent) });
  return (
    <g>
      <circle className="cap-dropped" cx={x} cy={y} r={geo.layout.dotRadius}>
        {!phone && <title>{t("capDroppedTip", { pct: percentText(reading.percent), stored: percentText(reading.stored_percent) })}</title>}
      </circle>
      <text
        className="axis-text"
        x={flip ? x - DROPPED_LABEL_GAP : x + DROPPED_LABEL_GAP}
        y={y + (phone ? LABEL_BASELINE : DROPPED_LABEL_DROP)}
        textAnchor={flip ? "end" : "start"}
        fontSize={phone ? 10 : geo.layout.font}
      >
        {label}
      </text>
    </g>
  );
}

function altText(data: UsageResponse, view: UsageView): string {
  const { t, locale, offsetAt } = view;
  const windows = data.cap.weekly.windows;
  const latest = data.cap.weekly.latest;
  const start = windows[FIRST];
  if (!start || !latest) return t("capAltNone");
  const rose = t("capAlt", { when: weekdayClock(locale, start.started_at, offsetAt), pct: percentText(latest.percent) });
  const n = data.cap.weekly.dropped.length;
  if (n === 0) return rose;
  return `${rose} ${t(t.plural(n, "capAltDroppedOne", "capAltDroppedMany"), { n })}`;
}

/** The weekly cap line, hand drawn: accepted readings joined, resets dashed, dropped readings hollow. */
export function CapLine({ data }: { data: UsageResponse }) {
  const view = useUsageView();
  const { t, phone } = view;
  const geo = geometryFor(data, view);
  const { layout } = geo;
  const latest = data.cap.weekly.latest;
  const now = latest ? geo.where(latest.taken_at, latest.percent) : null;
  return (
    <section className="usage-card" aria-labelledby="cap-chart-title">
      <div className="card-head">
        <h2 id="cap-chart-title">{t("capChartTitle")}</h2>
        {!phone && <span className="card-note">{t("capChartNote")}</span>}
      </div>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" role="img" aria-label={altText(data, view)} className="chart">
        <Grid geo={geo} view={view} />
        {data.cap.weekly.windows.filter((w) => geo.inRange(w.started_at)).map((w) => (
          <ResetMarker key={w.started_at} window={w} geo={geo} view={view} />
        ))}
        {data.cap.weekly.windows.map((w) => (
          <Readings key={w.started_at} window={w} geo={geo} view={view} />
        ))}
        {data.cap.weekly.dropped.map((d) => (
          <Dropped key={d.taken_at} reading={d} geo={geo} view={view} />
        ))}
        {!phone && latest && now && (
          <text className="now-text" x={now.x - 8} y={now.y - NOW_LABEL_RISE} textAnchor="end" fontSize={13}>
            {t("capNow", { pct: percentText(latest.percent) })}
          </text>
        )}
      </svg>
    </section>
  );
}
