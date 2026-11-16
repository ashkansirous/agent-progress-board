import type { CapLineDto, UsageResponse } from "../../src/api/usageDto";
import { clockAt, longReset, percentText, timeUntil, weekdayClock } from "./usageFormat";
import { useUsageView, type UsageView } from "./usageView";

const MAX_PERCENT = 100;
const NO_VALUE = "–";

interface TileProps {
  label: string;
  percent: number | null;
  note: string;
}

function CapTile({ label, percent, note }: TileProps) {
  const width = Math.min(MAX_PERCENT, Math.max(0, percent ?? 0));
  return (
    <div className="cap-tile">
      <span className="cap-label">{label}</span>
      <span className="cap-value">{percent === null ? NO_VALUE : percentText(percent)}</span>
      <span className="cap-bar" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </span>
      <span className="cap-note">{note}</span>
    </div>
  );
}

function weeklyNote(line: CapLineDto, view: UsageView): string {
  const { t, locale, offsetMinutes } = view;
  const latest = line.latest;
  if (!latest) return t("noReading");
  const resets = latest.reset_at ? t("resetsAt", { when: longReset(locale, latest.reset_at, offsetMinutes) }) : null;
  return [resets, t("readingTaken", { time: clockAt(latest.taken_at, offsetMinutes) })].filter(Boolean).join(" · ");
}

function shortNote(line: CapLineDto, serverTime: string, view: UsageView): string {
  const { t, locale, offsetMinutes } = view;
  const latest = line.latest;
  if (!latest?.reset_at) return latest ? t("readingTaken", { time: clockAt(latest.taken_at, offsetMinutes) }) : "";
  const left = timeUntil(latest.reset_at, serverTime);
  if (left) return t("resetsIn", { h: left.hours, m: left.minutes });
  return t("resetsAt", { when: longReset(locale, latest.reset_at, offsetMinutes) });
}

/** The weekly tile, and the shorter-window tile when a shorter window was reported. */
export function CapTiles({ data }: { data: UsageResponse }) {
  const view = useUsageView();
  const { t } = view;
  const short = data.cap.short.latest;
  return (
    <section className="cap-tiles" aria-label={t("capSection")}>
      <CapTile label={t("capWeekly")} percent={data.cap.weekly.latest?.percent ?? null} note={weeklyNote(data.cap.weekly, view)} />
      {short && <CapTile label={t("capShort")} percent={short.percent} note={shortNote(data.cap.short, data.server_time, view)} />}
    </section>
  );
}

/** The phone's one card: the weekly value and, in its line, the reset and the shorter window. */
export function PhoneCapCard({ data }: { data: UsageResponse }) {
  const { t, locale, offsetMinutes } = useUsageView();
  const weekly = data.cap.weekly.latest;
  const short = data.cap.short.latest;
  const parts = [
    weekly?.reset_at ? t("resetsAt", { when: weekdayClock(locale, weekly.reset_at, offsetMinutes) }) : null,
    short ? t("shorterWindow", { pct: percentText(short.percent) }) : null,
  ].filter(Boolean);
  const note = parts.length > 0 ? parts.join(" · ") : t("noReading");
  return (
    <section className="cap-tiles" aria-label={t("capSection")}>
      <CapTile label={t("capWeekly")} percent={weekly?.percent ?? null} note={note} />
    </section>
  );
}
