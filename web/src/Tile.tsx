import type { CSSProperties } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus } from "../../src/domain/item";
import { FollowLink, TileParts } from "./PartsView";
import { PriorityBadge } from "./PriorityBadge";
import { currentStepText, progressText } from "./stepsText";
import { StepBar } from "./stepsView";
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

/** The step now and "{done} of {total} steps · {pct}%" over one bar segment per step; nothing for a task with no list. */
function TileSteps({ item }: { item: BoardItemDto }) {
  const { t, looks } = useView();
  if (!item.progress || !item.steps) return null;
  const type = looks.type(item.type);
  return (
    <span className="tile-steps">
      <span className="tile-steps-line">
        <span className="tile-steps-now">{currentStepText(item, t)}</span>
        <span className="tile-steps-count">{progressText(item, t)}</span>
      </span>
      <StepBar steps={item.steps} variant="tile" finished={item.status === ItemStatus.Done} type={type} />
    </span>
  );
}

/** One item: type label and priority, title, why, its steps bar, and its parent with the status. */
export function Tile({ item, onOpen }: TileProps) {
  const { looks } = useView();
  const type = looks.type(item.type);
  const stale = item.status === ItemStatus.Stale;
  const style: CSSProperties = stale ? {} : { background: type.bg, borderColor: type.border };
  const classes = ["tile-box", stale && "tile-stale", item.status === ItemStatus.Done && "tile-done"];
  return (
    <div className={classes.filter(Boolean).join(" ")} style={style}>
      <button type="button" className="tile" onClick={() => onOpen(item.key)}>
        <span className="tile-top">
          <span className="type-label" style={{ color: type.fg }}>
            <span className="type-dot" style={{ background: type.fg }} />
            {type.label}
          </span>
          <PriorityBadge priority={item.priority} />
        </span>
        <span className="tile-title">{item.title}</span>
        {item.why && <span className="tile-why">{item.why}</span>}
        <TileParts item={item} />
        <TileSteps item={item} />
        <span className="tile-foot">
          {item.parent && <span className="tile-parent">↳ {item.parent}</span>}
          <StatusText item={item} />
        </span>
      </button>
      <FollowLink item={item} />
    </div>
  );
}
