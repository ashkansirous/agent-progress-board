import { useEffect, useRef, useState } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus, ItemType } from "../../src/domain/item";
import { partLetterOf } from "../../src/domain/parts";
import type { Translate } from "./strings";
import { ChevronIcon } from "./icons";
import { projectLabel } from "./model";
import { parentText } from "./partsText";
import { openItemHash } from "./route";
import { currentStepText, progressText } from "./stepsText";
import { StepBar, StepRows } from "./stepsView";
import { ageText } from "./time";
import { useView } from "./view";

interface CardProps {
  item: BoardItemDto;
  /** Open at first (the page starts every card closed). */
  initiallyOpen?: boolean;
}

function Chips({ item }: { item: BoardItemDto }) {
  const chips = [
    item.agent && <span key="agent" className="chip">{item.agent}</span>,
    item.model && <span key="model" className="chip chip-mono">{item.model}</span>,
    item.environment && <span key="env" className="chip">{item.environment_label ?? item.environment}</span>,
  ].filter(Boolean);
  return chips.length > 0 ? <div className="chips">{chips}</div> : null;
}

function MetaRow({ item }: { item: BoardItemDto }) {
  const { t, looks, projects, nowMs } = useView();
  const type = looks.type(item.type);
  const parent = parentText(item, t);
  return (
    <div className="active-meta">
      <span className="active-project">{projectLabel(item.project, projects)}</span>
      <span aria-hidden="true">·</span>
      <span className="active-type" style={{ color: type.fg }}>{type.label}</span>
      {parent && (
        <>
          <span aria-hidden="true">·</span>
          <span>{parent}</span>
        </>
      )}
      <span className="active-beat">{t("lastReport", { age: ageText(item.heartbeat_at, nowMs, t) })}</span>
    </div>
  );
}

/** The Slice and Part types draw the plain hairline (a part wears its slice's colours); any other type (a bug, a problem) takes its own border colour. */
function cardBorder(item: BoardItemDto, border: string): string | undefined {
  return item.type === ItemType.Slice || item.type === ItemType.Part ? undefined : border;
}

/** "Part B · Search box" for a part (its letter is the end of its key), the plain title for anything else. */
function cardTitle(item: BoardItemDto, t: Translate): string {
  const letter = item.type === ItemType.Part ? partLetterOf(item.key) : null;
  return letter ? t("partTitle", { letter, title: item.title }) : item.title;
}

/** A card the address asked for scrolls into view once it is open. */
function useScrollIntoView(wanted: boolean) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (wanted) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [wanted]);
  return ref;
}

/** One task an agent is working on: where it is, the step now, the bar and a way to open the whole list. */
export function ActiveCard({ item, initiallyOpen = false }: CardProps) {
  const { t, looks, projects } = useView();
  const [open, setOpen] = useState(initiallyOpen);
  const type = looks.type(item.type);
  const steps = item.steps ?? [];
  const finished = item.status === ItemStatus.Done;
  const border = cardBorder(item, type.border);
  const ref = useScrollIntoView(initiallyOpen);
  return (
    <li className="active-card" style={border ? { borderColor: border } : undefined} ref={ref}>
      <MetaRow item={item} />
      <div className="active-main">
        <div className="active-head">
          <h2>{cardTitle(item, t)}</h2>
          <Chips item={item} />
        </div>
        {item.progress && (
          <div className="active-progress">
            <div className="progress-line">
              <span className="progress-now">{currentStepText(item, t)}</span>
              <span className="progress-count">{progressText(item, t)}</span>
            </div>
            <StepBar steps={steps} variant="card" finished={finished} />
          </div>
        )}
      </div>
      {steps.length > 0 && (
        <>
          <button type="button" className="steps-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className={open ? "chevron chevron-open" : "chevron"}>
              <ChevronIcon size={16} stroke="currentColor" />
            </span>
            {open ? t("hideSteps") : t("showSteps", { n: steps.length })}
          </button>
          {open && (
            <div className="steps-open">
              <StepRows steps={steps} finished={finished} t={t} notes label={t("stepsHeading")} />
              <a className="back-link" href={openItemHash(item.parent_slice ? item.parent_slice.key : item.key)}>
                {t("backToBoard", { parent: parentText(item, t) ?? projectLabel(item.project, projects) })}
              </a>
            </div>
          )}
        </>
      )}
    </li>
  );
}
