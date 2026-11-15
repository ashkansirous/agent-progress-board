import { useEffect, useRef, useState } from "react";
import type { BoardEventDto, BoardItemDto } from "../../src/api/boardDto";
import { CloseIcon } from "./icons";
import { Markdown } from "./Markdown";
import { projectLabel } from "./model";
import { PriorityBadge } from "./PriorityBadge";
import { isSafeHttpUrl } from "./safeUrl";
import { clockTime } from "./time";
import { statusLabel, statusName, useView } from "./view";

function Fields({ item }: { item: BoardItemDto }) {
  const view = useView();
  const { t, projects, looks } = view;
  return (
    <dl className="fields">
      <dt>{t("fieldStatus")}</dt>
      <dd className="field-status" style={{ color: looks.status(item.status).fg }}>
        {statusLabel(item, view)}
      </dd>
      <dt>{t("fieldProject")}</dt>
      <dd>{projectLabel(item.project, projects)}</dd>
      <dt>{t("fieldParent")}</dt>
      <dd>{item.parent ?? "–"}</dd>
      <dt>{t("fieldKey")}</dt>
      <dd className="field-key">{item.key}</dd>
    </dl>
  );
}

function Links({ item }: { item: BoardItemDto }) {
  const { t, phone } = useView();
  if (item.links.length === 0) return null;
  return (
    <div className={phone ? "links links-row" : "links"}>
      {!phone && <h3>{t("links")}</h3>}
      {item.links.map((link) => (
        <LinkItem key={`${link.label}|${link.url}`} label={link.label} url={link.url} />
      ))}
    </div>
  );
}

function LinkItem({ label, url }: { label: string; url: string }) {
  if (!isSafeHttpUrl(url)) return <span className="link-text">{label}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  );
}

function HistoryRow({ event }: { event: BoardEventDto }) {
  const { t, phone } = useView();
  const status = statusName(event.status, t);
  return (
    <li className="event">
      <span className="event-time">{clockTime(event.at)}</span>
      {phone ? (
        <span>
          <strong>{status}</strong> {event.note && <span className="event-note">· {event.note}</span>}
        </span>
      ) : (
        <span className="event-body">
          <strong>{status}</strong>
          {event.note && <span className="event-note">{event.note}</span>}
        </span>
      )}
    </li>
  );
}

function History({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  const events = [...item.events].sort((a, b) => b.at.localeCompare(a.at));
  if (events.length === 0) return null;
  return (
    <div className="history">
      <h3>{t("history")}</h3>
      <ol>
        {events.map((event) => (
          <HistoryRow key={`${event.at}|${event.status}|${event.note ?? ""}`} event={event} />
        ))}
      </ol>
    </div>
  );
}

function DetailsBody({ item }: { item: BoardItemDto }) {
  const { t, phone } = useView();
  if (!item.details_md) return null;
  return (
    <div className="details">
      {!phone && <h3>{t("details")}</h3>}
      <div className="details-box">
        <Markdown source={item.details_md} />
      </div>
    </div>
  );
}

function TopRow({ item, onClose, closeRef }: DetailProps & { closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const { t, looks } = useView();
  const type = looks.type(item.type);
  return (
    <div className="detail-top">
      <span className="type-pill" style={{ background: type.bg, color: type.fg }}>
        <span className="type-dot" style={{ background: type.fg }} />
        {type.label}
      </span>
      <PriorityBadge priority={item.priority} variant="detail" />
      <button type="button" className="icon-button close-button" aria-label={t("close")} onClick={onClose} ref={closeRef}>
        <CloseIcon size={16} stroke="currentColor" />
      </button>
    </div>
  );
}

interface DetailProps {
  item: BoardItemDto;
  onClose: () => void;
}

/**
 * Closes on Escape, focuses the close button on open and gives focus back to the tile on close. The
 * opener is read during render: the page behind goes inert in the same commit, which would blur it
 * before an effect could read it.
 */
function useDialogFocus(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose, opener]);
  return closeRef;
}

/** The detail view: a side panel over the board on desktop, a bottom sheet on the phone. */
export function Detail({ item, onClose }: DetailProps) {
  const { t, phone } = useView();
  const closeRef = useDialogFocus(onClose);
  return (
    <div className="overlay">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <aside className={phone ? "panel sheet" : "panel"} role="dialog" aria-modal="true" aria-label={t("itemDetails")}>
        {phone && <div className="grab" aria-hidden="true" />}
        <TopRow item={item} onClose={onClose} closeRef={closeRef} />
        <div className="detail-heading">
          <h2>{item.title}</h2>
          {item.why && <span className="detail-why">{item.why}</span>}
        </div>
        <Fields item={item} />
        <DetailsBody item={item} />
        <Links item={item} />
        <History item={item} />
      </aside>
    </div>
  );
}
