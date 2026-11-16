import type { CSSProperties } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { partLetterOf, PartState } from "../../src/domain/parts";
import { ArrowIcon } from "./icons";
import { partNowText, partsLabel, partStateText } from "./partsText";
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

function FollowButton({ item }: { item: BoardItemDto }) {
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

/** The drawer's parts: the label and bar, one row per part with its state, and the button that follows the active part. */
export function PartsSection({ item }: { item: BoardItemDto }) {
  const { t, phone, looks } = useView();
  const parts = item.parts;
  if (!parts || !item.parts_progress) return null;
  return (
    <div className="parts-section">
      <div className="parts-head">
        <h3>{t("partsHeading")}</h3>
        <span className="parts-count">{partsLabel(item.parts_progress, t)}</span>
      </div>
      <span className="parts-bar parts-bar-drawer" aria-hidden="true">
        <span className="parts-bar-fill" style={fillStyle(item.parts_progress.percent, looks.type(item.type).fg)} />
      </span>
      <ol className="part-rows" aria-label={t("partsHeading")}>
        {parts.map((part) => (
          <li key={part.key} className={`part-row part-row-${part.state}`} aria-current={part.state === PartState.Active ? "step" : undefined}>
            <span className="part-mark">{part.letter}</span>
            <span className="part-title">{part.title}</span>
            <span className="part-state">{partStateText(part, parts, phone, t)}</span>
          </li>
        ))}
      </ol>
      <FollowButton item={item} />
    </div>
  );
}
