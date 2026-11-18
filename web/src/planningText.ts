import type { BoardItemDto, BoardPartDto } from "../../src/api/boardDto";
import { type ProjectSummary, SliceState } from "../../src/domain/boardGroups";
import { PartNowKind, PartState, partNow } from "../../src/domain/parts";
import type { StringKey, Translate } from "./strings";

const PILL_KEYS: Record<SliceState, StringKey> = {
  [SliceState.InProgress]: "pillInProgress",
  [SliceState.Planned]: "pillPlanned",
  [SliceState.Parked]: "pillParked",
  [SliceState.Built]: "pillBuilt",
};

export function pillText(state: SliceState, t: Translate): string {
  return t(PILL_KEYS[state]);
}

/** "Slice 12", or the bare word when the slice has no number. */
export function sliceNumberText(number: number | null, t: Translate): string {
  return number === null ? t("sliceLabel") : t("sliceNumber", { number });
}

function lastDonePart(parts: BoardPartDto[]): BoardPartDto | undefined {
  return [...parts].reverse().find((part) => part.state === PartState.Done);
}

/**
 * The slice card's line under its parts bar: "Now: part C, title" (an active part, a stale one with the
 * stale suffix), "Parked after part A", "Not started", "Next: part D" when parts are done and none runs,
 * "All parts done". Null for a slice with no lettered parts.
 */
export function nowLine(parts: BoardPartDto[] | null, state: SliceState, t: Translate): string | null {
  if (!parts || parts.length === 0) return null;
  const now = partNow(parts);
  const part = now.part;
  if (now.kind === PartNowKind.AllDone || !part) return t("partsAllDone");
  const doneBefore = lastDonePart(parts);
  if (now.kind === PartNowKind.Next || state === SliceState.Parked) {
    if (state === SliceState.Parked) return doneBefore ? t("sliceParkedAfter", { letter: doneBefore.letter }) : t("sliceNotStarted");
    return doneBefore ? t("partNext", { letter: part.letter }) : t("sliceNotStarted");
  }
  const text = t("sliceNowLine", { letter: part.letter, title: part.title });
  if (now.kind === PartNowKind.Blocked) return `${text}${t("partBlockedSuffix")}`;
  return now.kind === PartNowKind.Stale ? `${text}${t("partStaleSuffix")}` : text;
}

/** "2 of 5 parts", null with no parts. */
export function partsCountText(item: BoardItemDto | undefined, t: Translate): string | null {
  const progress = item?.parts_progress;
  return progress ? t("partsOf", { n: progress.done, m: progress.total }) : null;
}

export function checksLine(count: number, t: Translate): string {
  if (count === 0) return t("allChecksTried");
  return t(t.plural(count, "checksNotTriedOne", "checksNotTriedMany"), { n: count });
}

export function looseLine(count: number, t: Translate): string {
  return t(t.plural(count, "looseChecksOne", "looseChecksMany"), { n: count });
}

export function slicePlannedText(slice: { number: number | null } | null, t: Translate): string {
  if (!slice) return t("noSliceYet");
  return slice.number === null ? t("slicePlanned") : t("sliceNPlanned", { n: slice.number });
}

/**
 * The project's summary line: needs you first, "N working" or "nothing running", then planned, problems
 * and checks not tried; each of those only above 0.
 */
export function summaryText(summary: ProjectSummary, t: Translate): string {
  const bits: string[] = [];
  if (summary.needs_you > 0) bits.push(t(t.plural(summary.needs_you, "summaryNeedsYouOne", "summaryNeedsYou"), { n: summary.needs_you }));
  bits.push(
    summary.working > 0 ? t(t.plural(summary.working, "summaryWorkingOne", "summaryWorking"), { n: summary.working }) : t("summaryNothingRunning"),
  );
  if (summary.planned > 0) bits.push(t("summaryPlanned", { n: summary.planned }));
  if (summary.built > 0) bits.push(t("summaryBuilt", { n: summary.built }));
  if (summary.problems > 0) bits.push(t(t.plural(summary.problems, "summaryProblemOne", "summaryProblemMany"), { n: summary.problems }));
  if (summary.checks_not_tried > 0) {
    bits.push(t(t.plural(summary.checks_not_tried, "summaryCheckOne", "summaryCheckMany"), { n: summary.checks_not_tried }));
  }
  return bits.join(" · ");
}
