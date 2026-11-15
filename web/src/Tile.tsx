import type { CSSProperties } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus } from "../../src/domain/item";
import { PriorityBadge } from "./PriorityBadge";
import { statusLabel, useView } from "./view";

export interface TileProps {
  item: BoardItemDto;
  onOpen: (key: string) => void;
}

function StatusText({ item }: { item: BoardItemDto }) {
  const view = useView();
  const colours = view.looks.status(item.status);
  const dot: CSSProperties = { background: colours.dot, borderColor: colours.fg };
  return (
    <span className="status" style={{ color: colours.fg }}>
      {!view.phone && <span className="status-dot" style={dot} />}
      {statusLabel(item, view)}
    </span>
  );
}

/** One item: type label and priority, title, why, and its parent with the status. */
export function Tile({ item, onOpen }: TileProps) {
  const { looks } = useView();
  const type = looks.type(item.type);
  const stale = item.status === ItemStatus.Stale;
  const style: CSSProperties = stale ? {} : { background: type.bg, borderColor: type.border };
  const classes = ["tile", stale && "tile-stale", item.status === ItemStatus.Done && "tile-done"];
  return (
    <button type="button" className={classes.filter(Boolean).join(" ")} style={style} onClick={() => onOpen(item.key)}>
      <span className="tile-top">
        <span className="type-label" style={{ color: type.fg }}>
          <span className="type-dot" style={{ background: type.fg }} />
          {type.label}
        </span>
        <PriorityBadge priority={item.priority} />
      </span>
      <span className="tile-title">{item.title}</span>
      {item.why && <span className="tile-why">{item.why}</span>}
      <span className="tile-foot">
        {item.parent && <span className="tile-parent">↳ {item.parent}</span>}
        <StatusText item={item} />
      </span>
    </button>
  );
}
