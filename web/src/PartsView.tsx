import type { CSSProperties } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { partLetterOf } from "../../src/domain/parts";
import { ArrowIcon } from "./icons";
import { partNowText, partsLabel } from "./partsText";
import { activeItemHash } from "./route";
import { useView } from "./view";

/** The width of a parts bar's fill, as the percent of parts done. The part in progress adds nothing. */
function fillStyle(percent: number, colour: string): CSSProperties {
  return { width: `${percent}%`, background: colour };
}

/** The part now and "{done} of {total} parts · {pct}%" over the bar, on a slice's tile; nothing for a slice with no lettered parts. */
export function TileParts({ item }: { item: BoardItemDto }) {
  const { t, looks } = useView();
  if (!item.parts || !item.parts_progress) return null;
  return (
    <span className="tile-parts">
      <span className="tile-parts-line">
        <span className="tile-parts-now">{partNowText(item.parts, t)}</span>
        <span className="tile-parts-count">{partsLabel(item.parts_progress, t)}</span>
      </span>
      <span className="parts-bar parts-bar-tile" aria-hidden="true">
        <span className="parts-bar-fill" style={fillStyle(item.parts_progress.percent, looks.type(item.type).fg)} />
      </span>
    </span>
  );
}

/** "Follow part B" under the tile, outside the tile button (which still opens the drawer); only for an active part, never a stale one. */
export function FollowLink({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  const letter = item.active_part_key ? partLetterOf(item.active_part_key) : null;
  if (!item.active_part_key || !letter) return null;
  return (
    <a className="tile-follow" href={activeItemHash(item.active_part_key)}>
      {t("followPart", { letter })}
      <ArrowIcon size={14} stroke="currentColor" />
    </a>
  );
}

/** The drawer's button that follows the active part; nothing for a slice with no active part. */
export function FollowButton({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  const letter = item.active_part_key ? partLetterOf(item.active_part_key) : null;
  if (!item.active_part_key || !letter) return null;
  return (
    <a className="follow-button" href={activeItemHash(item.active_part_key)}>
      {t("followPartActive", { letter })}
      <ArrowIcon size={16} stroke="currentColor" />
    </a>
  );
}
