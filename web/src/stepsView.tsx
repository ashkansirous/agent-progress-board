import { type CSSProperties, useState } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus } from "../../src/domain/item";
import { leavesOf, type Step, StepState } from "../../src/domain/stepTypes";
import { isSafeHttpUrl } from "./safeUrl";
import { ChevronIcon } from "./icons";
import type { StringKey, Translate } from "./strings";
import { breachText, costText, isOwnerBlocked, secondLine, shownState, type StepClock, stateText, timesText } from "./stepsText";
import { statusName, useView } from "./view";

const CHECK_WORDS: Partial<Record<ItemStatus, StringKey>> = {
  [ItemStatus.Open]: "checkNotTried",
  [ItemStatus.InProgress]: "checkTrying",
  [ItemStatus.Blocked]: "statusBlocked",
  [ItemStatus.Stale]: "statusStale",
};

/** A slice card's open checks after its steps, each with its state; they are counted in the progress line (Slice 51). */
export function CardChecks({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  const checks = item.checks ?? [];
  if (checks.length === 0) return null;
  return (
    <div className="card-checks">
      <h3>{t("cardChecksHeading", { n: checks.length })}</h3>
      <ul className="check-rows">
        {checks.map((check) => (
          <li key={check.key} className={check.status === ItemStatus.Blocked ? "check-row step-orange" : "check-row"}>
            <span className="check-box" aria-hidden="true" />
            <span className="check-label">{check.title}</span>
            <span className="check-state">{t(CHECK_WORDS[check.status] ?? "checkNotTried")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Why a doc sync moved the card back from done, when that is its newest history event (Slice 51). */
export function ReopenedLine({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  if (!item.reopened) return null;
  return <p className="reopened-line">{t("reopenedLine", { status: statusName(item.reopened.status, t).toLowerCase() })}</p>;
}

const INDENT_PX = 26;

/** Where a bar draws its colours: the card's own palette roles, or the type's colours on a tile and in a drawer. */
export type BarVariant = "card" | "tile" | "drawer";

interface BarProps {
  steps: Step[];
  variant: BarVariant;
  /** The task is done: every segment reads done, whatever the list says. */
  finished: boolean;
  /** The type's colours for a tile or drawer bar (done = fg, active = border). */
  type?: { fg: string; border: string };
}

/** One equal segment per leaf: done, active or pending. Hidden from assistive tech; the text beside it carries the numbers. */
export function StepBar({ steps, variant, finished, type }: BarProps) {
  const style = type ? ({ "--seg-done": type.fg, "--seg-active": type.border } as CSSProperties) : undefined;
  return (
    <span className={`step-bar step-bar-${variant}`} aria-hidden="true" style={style}>
      {leavesOf(steps).map((step) => (
        <span key={step.id} className={`seg seg-${finished ? StepState.Done : step.state}${!finished && isOwnerBlocked(step) ? " seg-owner" : ""}`} />
      ))}
    </span>
  );
}

interface RowsProps {
  steps: Step[];
  finished: boolean;
  t: Translate;
  /** The Active work card shows each leaf's note under its label; the drawer does not (the open box always has it). */
  notes: boolean;
  label: string;
}

/** The turning arc of a running step (Slice 39, ActiveV3 B1 Ring); it stays drawn, and stops turning, under reduced motion. */
function Ring() {
  return (
    <svg className="step-ring" aria-hidden="true" width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="12.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray="20 59" />
    </svg>
  );
}

interface RowProps {
  step: Step;
  path: string;
  level: number;
  isNext: boolean;
  open: boolean;
  clock: StepClock;
  notes: boolean;
  t: Translate;
  onToggle: (id: string) => void;
}

/** One row: the unfold arrow (parents only), the numbered circle with its ring, label and second line, and the state text; its open box follows when open. */
function StepRow({ step, path, level, isNext, open, clock, notes, t, onToggle }: RowProps) {
  const state = shownState(step, clock.finished);
  const parent = step.children.length > 0;
  const line = secondLine(step, clock.finished, t);
  const cost = costText(step, t);
  const breach = breachText(step, t);
  return (
    <li className="step-item" style={{ paddingLeft: level * INDENT_PX }}>
      <button
        type="button"
        className={`step-row step-row-${state}${isOwnerBlocked(step) ? " step-row-owner" : ""}${breach ? " step-row-over" : ""}`}
        aria-expanded={open}
        aria-current={state === StepState.Active ? "step" : undefined}
        onClick={() => onToggle(step.id)}
      >
        <span className={open ? "step-arrow step-arrow-open" : "step-arrow"} aria-hidden="true">
          {parent && <ChevronIcon size={14} stroke="currentColor" strokeWidth={2.4} />}
        </span>
        <span className="step-num">
          <span className="step-mark">{path}</span>
          {state === StepState.Active && <Ring />}
        </span>
        <span className="step-text">
          <span className="step-label">{step.label}</span>
          {line && (parent || notes) && <span className="step-note">{line}</span>}
          {cost && <span className="step-note step-cost">{cost}</span>}
          {breach && <span className="step-note step-cost step-breach">{breach}</span>}
        </span>
        <span className="step-state">{stateText(step, clock, isNext, t)}</span>
      </button>
      {open && (
        <div className="step-box">
          {step.note && <span>{step.note}</span>}
          {isSafeHttpUrl(step.link ?? undefined) && (
            <a className="step-link" href={step.link ?? undefined} target="_blank" rel="noreferrer noopener">
              {t("stepLinkLabel")}
            </a>
          )}
          <span className="step-times">{timesText(step, clock, t)}</span>
          {parent && <span className="step-kids">{t("stepKidsBelow", { n: step.children.length })}</span>}
        </div>
      )}
    </li>
  );
}

/** The rows to draw: each step, then (when it is open) its children one level deeper. Siblings track their own "Next". */
function visibleRows(steps: readonly Step[], open: ReadonlySet<string>, prefix: string, level: number, finished: boolean): RowModel[] {
  let seenNext = false;
  return steps.flatMap((step, index) => {
    const waiting = shownState(step, finished) === StepState.Pending;
    const isNext = waiting && !seenNext;
    if (waiting) seenNext = true;
    const path = `${prefix}${index + 1}`;
    const own: RowModel = { step, path, level, isNext };
    return open.has(step.id) ? [own, ...visibleRows(step.children, open, `${path}.`, level + 1, finished)] : [own];
  });
}

interface RowModel {
  step: Step;
  path: string;
  level: number;
  isNext: boolean;
}

/**
 * The step tree (Slice 39): one tappable row per step, numbered by path ("3.2.1"), parents unfold in place,
 * and one row's open state never closes another's. Running steps, parents included, wear the turning ring.
 */
export function StepRows({ steps, finished, t, notes, label }: RowsProps) {
  const { nowMs } = useView();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const clock: StepClock = { finished, nowMs };
  return (
    <ol className="step-rows" aria-label={label}>
      {visibleRows(steps, open, "", 0, finished).map(({ step, path, level, isNext }) => (
        <StepRow key={step.id} step={step} path={path} level={level} isNext={isNext} open={open.has(step.id)} clock={clock} notes={notes} t={t} onToggle={toggle} />
      ))}
    </ol>
  );
}
