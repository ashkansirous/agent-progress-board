import { useState } from "react";
import { type DoneGroup, type DoneRow } from "../../src/domain/boardGroups";
import { ChevronIcon } from "./icons";
import { clockTime } from "./time";
import { SESSION_STALE_AFTER_MINUTES } from "../../src/domain/stale";
import { useView } from "./view";

interface DoneProps {
  done: DoneGroup;
  onOpen: (key: string) => void;
}

function Row({ row, onOpen }: { row: DoneRow; onOpen: (key: string) => void }) {
  const { t } = useView();
  const time = clockTime(row.at);
  const when = row.stale ? t("staleRowWhen", { n: SESSION_STALE_AFTER_MINUTES, time }) : time;
  return (
    <li>
      <button type="button" className={row.stale ? "done-row done-row-stale" : "done-row"} onClick={() => onOpen(row.key)}>
        <span className="done-row-title">{[row.parent, row.title].filter(Boolean).join(" · ")}</span>
        <span className="done-row-when">{when}</span>
      </button>
    </li>
  );
}

/**
 * The Done button ("12 done in the last 12 hours") and, once opened, the newest rows; "Show all N" adds the rest
 * of the same hours. Collapsed on load: the fold belongs to the project block (Slice 15).
 */
export function DoneSection({ done, onOpen }: DoneProps) {
  const { t, hours } = useView();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (done.count === 0) return null;
  const rows = all ? [...done.recent, ...done.more] : done.recent;
  return (
    <div className="section done-section">
      <button type="button" className="done-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={open ? "done-chevron done-chevron-open" : "done-chevron"}>
          <ChevronIcon size={16} stroke="currentColor" />
        </span>
        <span className="done-toggle-text">{t("doneInWindow", { n: done.count, hours })}</span>
      </button>
      {open && (
        <ul className="done-rows">
          {rows.map((row) => (
            <Row key={row.key} row={row} onOpen={onOpen} />
          ))}
          {!all && done.more.length > 0 && (
            <li>
              <button type="button" className="done-row done-row-all" onClick={() => setAll(true)}>
                <span className="done-row-title">{t("showAllN", { n: done.count })}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
