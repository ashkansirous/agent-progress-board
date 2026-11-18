import type { BoardItemDto, BoardPartDto } from "../../src/api/boardDto";
import { PartNowKind, type PartsProgress, partNow } from "../../src/domain/parts";
import type { Translate } from "./strings";

/**
 * The text a card shows for its parent: "Slice N · title" for a part whose slice is on the board (the
 * title alone when it already starts with "Slice N" or the key has no number), else the stored free text.
 */
export function parentText(item: BoardItemDto, t: Translate): string | null {
  const slice = item.parent_slice;
  if (!slice) return item.parent;
  if (slice.number === null || slice.title.startsWith(`${t("sliceNumber", { number: slice.number })} `)) return slice.title;
  return t("parentSlice", { number: slice.number, title: slice.title });
}

/** "{done} of {total} parts · {pct}%". */
export function partsLabel(progress: PartsProgress, t: Translate): string {
  return t("partsLabel", { done: progress.done, total: progress.total, pct: progress.percent });
}

function stepOf(part: BoardPartDto, t: Translate): string {
  return part.step ?? t("stepStarting");
}

/** The tile's part-now line: "Part B · Reviewing", with " (stale)" for a stale part, "Next: part C" or "All parts done". */
export function partNowText(parts: BoardPartDto[], t: Translate): string {
  const now = partNow(parts);
  const part = now.part;
  if (now.kind === PartNowKind.AllDone || !part) return t("partsAllDone");
  if (now.kind === PartNowKind.Next) return t("partNext", { letter: part.letter });
  const text = t("partNow", { letter: part.letter, step: stepOf(part, t) });
  if (now.kind === PartNowKind.Blocked) return `${text}${t("partBlockedSuffix")}`;
  return now.kind === PartNowKind.Stale ? `${text}${t("partStaleSuffix")}` : text;
}

