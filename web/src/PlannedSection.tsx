import type { BoardItemDto, BoardPartDto } from "../../src/api/boardDto";
import { type PlannedSlice, SliceState } from "../../src/domain/boardGroups";
import { PartState } from "../../src/domain/parts";
import { useState } from "react";
import { ChevronIcon, PhoneIcon } from "./icons";
import { FollowLink } from "./PartsView";
import { checksLine, looseLine, nowLine, partsCountText, pillText, sliceNumberText } from "./planningText";
import { useView } from "./view";

interface PlannedProps {
  slices: PlannedSlice[];
  items: Map<string, BoardItemDto>;
  looseCount: number;
  onOpen: () => void;
  onOpenItem: (key: string) => void;
}

const SEGMENT_CLASS: Record<PartState, string> = {
  [PartState.Done]: "slice-seg-done",
  [PartState.Active]: "slice-seg-active",
  [PartState.Stale]: "slice-seg-active",
  [PartState.Pending]: "slice-seg-later",
};

/** One segment per part with its letter; decorative, the line under it says the same in words. */
function PartsBar({ parts }: { parts: BoardPartDto[] }) {
  return (
    <span className="slice-segs" aria-hidden="true">
      {parts.map((part) => (
        <span key={part.key} className={`slice-seg ${SEGMENT_CLASS[part.state]}`}>
          {part.letter}
        </span>
      ))}
    </span>
  );
}

function SliceCard({ slice, item, onOpenItem }: { slice: PlannedSlice; item: BoardItemDto | undefined; onOpenItem: (key: string) => void }) {
  const { t } = useView();
  const parts = item?.parts ?? null;
  const line = nowLine(parts, slice.state, t);
  const count = partsCountText(item, t);
  const parked = slice.state === SliceState.Parked;
  return (
    <div className={parked ? "slice-box slice-box-parked" : "slice-box"}>
      <button type="button" className="slice-card" onClick={() => onOpenItem(slice.key)}>
        <span className="slice-top">
          <span className="slice-number">{sliceNumberText(slice.number, t)}</span>
          <span className="slice-pill">{pillText(slice.state, t)}</span>
        </span>
        <span className="slice-title">{slice.title}</span>
        {parts && <PartsBar parts={parts} />}
        {(line || count) && (
          <span className="slice-now">
            <span className="slice-now-line">{line}</span>
            <span className="slice-now-count">{count}</span>
          </span>
        )}
        <span className="slice-checks">
          <PhoneIcon size={13} stroke="var(--muted)" />
          {checksLine(slice.checks.length, t)}
        </span>
      </button>
      {item && <FollowLink item={item} />}
    </div>
  );
}

/** The dashed card for checks whose slice is not on the board: they are never cards of their own. */
function LooseCard({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { t } = useView();
  return (
    <button type="button" className="loose-card" onClick={onOpen}>
      <span className="loose-line">{looseLine(count, t)}</span>
      <span className="loose-note">{t("looseChecksNote")}</span>
    </button>
  );
}

/**
 * "Built · {n}": done slices that still have checks not tried on a device. Folded on load, like Done work; the
 * header button opens the cards, which are the planned cards with the "Built" pill.
 */
export function BuiltSection({ slices, items, onOpenItem }: Omit<PlannedProps, "looseCount" | "onOpen">) {
  const { t } = useView();
  const [open, setOpen] = useState(false);
  if (slices.length === 0) return null;
  return (
    <div className="section built-section">
      <button type="button" className="done-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={open ? "done-chevron done-chevron-open" : "done-chevron"}>
          <ChevronIcon size={16} stroke="currentColor" />
        </span>
        <span className="done-toggle-text">{t("builtN", { n: slices.length })}</span>
      </button>
      {open && (
        <div className="plan-grid">
          {slices.map((slice) => (
            <SliceCard key={slice.key} slice={slice} item={items.get(slice.key)} onOpenItem={onOpenItem} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Planned · {n}": the slices (counted), each as a card with its parts bar and check count, then the loose-checks card. */
export function PlannedSection({ slices, items, looseCount, onOpen, onOpenItem }: PlannedProps) {
  const { t } = useView();
  if (slices.length === 0 && looseCount === 0) return null;
  return (
    <div className="section planned-section">
      <h3>{t("plannedN", { n: slices.length })}</h3>
      <div className="plan-grid">
        {slices.map((slice) => (
          <SliceCard key={slice.key} slice={slice} item={items.get(slice.key)} onOpenItem={onOpenItem} />
        ))}
        {looseCount > 0 && <LooseCard count={looseCount} onOpen={onOpen} />}
      </div>
    </div>
  );
}
