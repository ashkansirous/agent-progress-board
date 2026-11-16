import { BucketUnit } from "../../src/domain/usage";
import { bucketStartMs, type NiceScale } from "./usageFormat";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const SEGMENT_GAP = 2;
const MIN_SEGMENT = 1;
const CAP_QUARTER = 25;

/** The plot rectangle of a chart in its viewBox units. */
export interface Frame {
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
}

export function bucketSpanMs(unit: BucketUnit): number {
  return unit === BucketUnit.Hour ? MS_PER_HOUR : MS_PER_DAY;
}

/** Where a time falls on the x axis of a chart whose buckets are `buckets`; clamped to the plot. */
export function xForTime(iso: string, offsetMinutes: number, buckets: string[], unit: BucketUnit, frame: Frame): number {
  const first = buckets[0];
  if (first === undefined) return frame.x0;
  const local = Date.parse(iso) + offsetMinutes * MS_PER_MINUTE;
  const share = (local - bucketStartMs(first)) / (buckets.length * bucketSpanMs(unit));
  return frame.x0 + Math.min(1, Math.max(0, share)) * (frame.x1 - frame.x0);
}

/** Where a reset is drawn: at the left edge when it begins the first bucket's window, else at its own time. */
export function xForReset(iso: string, offsetMinutes: number, buckets: string[], unit: BucketUnit, frame: Frame): number {
  const first = buckets[0];
  const local = Date.parse(iso) + offsetMinutes * MS_PER_MINUTE;
  if (first !== undefined && local < bucketStartMs(first) + bucketSpanMs(unit)) return frame.x0;
  return xForTime(iso, offsetMinutes, buckets, unit, frame);
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
