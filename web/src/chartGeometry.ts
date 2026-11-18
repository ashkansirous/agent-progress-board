import type { UsageResponse } from "../../src/api/usageDto";
import { BucketUnit, bucketsBetween, REPEATED_HOUR_MARK, xOfMoment, type Bucket, type OffsetAt } from "../../src/domain/usage";
import type { Translate } from "./strings";
import { bucketLabel, bucketLetter, type NiceScale } from "./usageFormat";

const SEGMENT_GAP = 2;
const MIN_SEGMENT = 1;
const CAP_QUARTER = 25;

/** What the words of a bucket need: the clock rule, the locale and the translator. */
export interface BucketView {
  offsetAt: OffsetAt;
  locale: string;
  t: Translate;
}

/** A bucket with the words the chart shows for it. */
export interface ChartBucket extends Bucket {
  label: string;
  letter: string;
}

const SECOND_PASS_LETTER = "²";

/**
 * The chart's buckets, made by the same walk of real time as the Worker's (from `from` to `server_time`, with the answer's
 * own offset rule), so every position and label takes its bucket from one list. A repeated hour reads "02:00 (2nd)".
 */
export function chartBuckets(data: UsageResponse, view: BucketView): ChartBucket[] {
  const buckets = bucketsBetween(Date.parse(data.from), Date.parse(data.server_time), view.offsetAt, data.bucket_unit);
  return buckets.map((bucket) => {
    const again = data.bucket_unit === BucketUnit.Hour && bucket.key.includes(REPEATED_HOUR_MARK);
    const label = bucketLabel(view.locale, bucket.key);
    const letter = bucketLetter(view.locale, bucket.key);
    return {
      ...bucket,
      label: again ? view.t("hourAgain", { hour: label }) : label,
      letter: again ? `${letter}${SECOND_PASS_LETTER}` : letter,
    };
  });
}

/** The plot rectangle of a chart in its viewBox units. */
export interface Frame {
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
}

/**
 * Where a time falls on the x axis of a chart whose buckets are `buckets`; clamped to the plot. The position is
 * `xOfMoment` (the bucket holding the moment, plus the part of it gone), so a 23 or 25 hour day, a repeated hour and a
 * half-hour change keep a point on its own bar.
 */
export function xForTime(iso: string, buckets: Bucket[], frame: Frame): number {
  if (buckets.length === 0) return frame.x0;
  return frame.x0 + (xOfMoment(Date.parse(iso), buckets) / buckets.length) * (frame.x1 - frame.x0);
}

/** Whether a time is inside the range: not before the start of the first bucket (compared in milliseconds). */
export function isInRange(iso: string, buckets: Bucket[]): boolean {
  const first = buckets[0];
  return first !== undefined && Date.parse(iso) >= first.startMs;
}

/** Where a reset is drawn: at the left edge when it falls in the first bucket (or before it), else at its own time. */
export function xForReset(iso: string, buckets: Bucket[], frame: Frame): number {
  const first = buckets[0];
  if (first !== undefined && Date.parse(iso) < first.endMs) return frame.x0;
  return xForTime(iso, buckets, frame);
}

/** The x of the centre of bucket `index`. */
export function xForBucket(index: number, count: number, frame: Frame): number {
  return frame.x0 + ((index + 0.5) * (frame.x1 - frame.x0)) / count;
}

/** y of a value on a 0..top axis. */
export function yForValue(value: number, top: number, frame: Frame): number {
  return frame.yBottom - (Math.min(value, top) / top) * (frame.yBottom - frame.yTop);
}

/** Show every n-th axis label so at most `maxLabels` are drawn. */
export function labelEvery(count: number, maxLabels: number): number {
  return Math.max(1, Math.ceil(count / maxLabels));
}

/** Top of the phone cap axis: the next quarter above the highest accepted reading, at least 25. */
export function capAxisTop(highest: number): number {
  return Math.max(CAP_QUARTER, (Math.floor(highest / CAP_QUARTER) + 1) * CAP_QUARTER);
}

export function capTicks(top: number): number[] {
  return Array.from({ length: top / CAP_QUARTER + 1 }, (_, i) => i * CAP_QUARTER);
}

export interface BarSlot {
  x: number;
  width: number;
}

/** Where the bar of bucket `index` goes: centred in its slot, `share` of the slot wide, at most `maxWidth`. */
export function barSlot(index: number, count: number, frame: Frame, share: number, maxWidth: number): BarSlot {
  const slot = (frame.x1 - frame.x0) / count;
  const width = Math.min(maxWidth, slot * share);
  return { x: frame.x0 + index * slot + (slot - width) / 2, width };
}

export interface Segment {
  series: number;
  value: number;
  y: number;
  height: number;
  top: boolean;
}

/** The stacked segments of one bar, bottom up in series order, 2 units apart; zero values are skipped. */
export function stackSegments(values: number[], scale: NiceScale, frame: Frame): Segment[] {
  const segments: Segment[] = [];
  let sum = 0;
  values.forEach((value, series) => {
    if (value <= 0) return;
    const low = yForValue(sum, scale.top, frame);
    sum += value;
    const high = yForValue(sum, scale.top, frame);
    const height = Math.max(low - SEGMENT_GAP - high, MIN_SEGMENT);
    segments.push({ series, value, y: low - SEGMENT_GAP - height, height, top: false });
  });
  const last = segments.at(-1);
  if (last) last.top = true;
  return segments;
}

/** A bar segment whose top corners are rounded by `radius`. */
export function roundedTopPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height, width / 2);
  const bottom = y + height;
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${bottom} Z`;
}
