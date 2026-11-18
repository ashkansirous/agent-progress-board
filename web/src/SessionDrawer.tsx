import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemStatus } from "../../src/domain/item";
import { SESSION_STALE_AFTER_MINUTES } from "../../src/domain/stale";
import { SliceOfCard } from "./ChecksView";
import { doneSoFar, eventKeys, historyWords, isQuestion, isSessionItem, isStaleSession, isWorkingCard, sessionLabel, waitingText } from "./cards";
import { DetailsBody, useDialogFocus } from "./Detail";
import { CloseIcon } from "./icons";
import { projectLabel } from "./model";
import { isSafeHttpUrl } from "./safeUrl";
import { StepRows } from "./stepsView";
import { ageText, clockTime } from "./time";
import { statusName, useView } from "./view";

interface DrawerProps {
  item: BoardItemDto;
  onClose: () => void;
}

enum Kicker {
  Need = "need",
  Work = "work",
  Stale = "stale",
  Other = "other",
}

function kickerOf(item: BoardItemDto): Kicker {
  if (isQuestion(item)) return Kicker.Need;
  if (isWorkingCard(item)) return Kicker.Work;
  return isStaleSession(item) ? Kicker.Stale : Kicker.Other;
}

function kickerText(item: BoardItemDto, kicker: Kicker, t: ReturnType<typeof useView>["t"]): string {
  if (kicker === Kicker.Need) return t("needsYou");
  if (kicker === Kicker.Work) return t("kickerWorking");
  return kicker === Kicker.Stale ? t("statusStale") : statusName(item.status, t);
}

/** "session 9c1e · Laptop · last activity 2 min ago", "... · waiting 6 min" or "... · no activity for 15 min". */
function metaText(item: BoardItemDto, kicker: Kicker, view: ReturnType<typeof useView>): string {
  const { t, nowMs } = view;
  const label = sessionLabel(item);
  if (kicker === Kicker.Need) return [label, waitingText(item, nowMs, t)].filter(Boolean).join(" · ");
  if (kicker === Kicker.Stale) return t("metaStale", { label, n: SESSION_STALE_AFTER_MINUTES });
  return t("metaLastActivity", { label, age: ageText(item.heartbeat_at, nowMs, view.t) });
}

function TopRow({ item, kicker, onClose, closeRef }: DrawerProps & { kicker: Kicker; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const { t, projects } = useView();
  return (
    <div className="drawer-top">
      <span className={`kicker kicker-${kicker}`}>{kickerText(item, kicker, t)}</span>
      <span className="drawer-project">{projectLabel(item.project, projects)}</span>
      <button type="button" className="icon-button close-button" aria-label={t("close")} onClick={onClose} ref={closeRef}>
        <CloseIcon size={16} stroke="currentColor" />
      </button>
    </div>
  );
}

function DoneSoFar({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  const lines = doneSoFar(item);
  if (lines.length === 0) return null;
  return (
    <div className="drawer-section">
      <h3>{t("doneSoFar")}</h3>
      <ul className="drawer-bullets">
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function DrawerSteps({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  if (!item.steps || item.steps.length === 0) return null;
  return (
    <div className="drawer-section">
      <h3>{t("stepsHeading")}</h3>
      <StepRows steps={item.steps} finished={item.status === ItemStatus.Done} t={t} notes={false} label={t("stepsHeading")} />
    </div>
  );
}

function DrawerLinks({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  if (item.links.length === 0) return null;
  return (
    <div className="drawer-section">
      <h3>{t("links")}</h3>
      <span className="drawer-links">
        {item.links.map((link) =>
          isSafeHttpUrl(link.url) ? (
            <a key={`${link.label}|${link.url}`} href={link.url} target="_blank" rel="noreferrer noopener">
              {link.label}
            </a>
          ) : (
            <span key={`${link.label}|${link.url}`}>{link.label}</span>
          ),
        )}
      </span>
    </div>
  );
}

/** Oldest first, as the mock lists it; the server sends the newest first. */
function DrawerHistory({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  if (item.events.length === 0) return null;
  const rows = [...item.events].reverse();
  const keys = eventKeys(item.events).reverse();
  return (
    <div className="drawer-section">
      <h3>{t("history")}</h3>
      <ol className="drawer-history">
        {rows.map((event, index) => (
          <li key={keys[index]}>
            <span className="drawer-time">{clockTime(event.at)}</span>
            <span>{historyWords(event, t)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The card drawer for a question, a working session or a stopped one: a 480px panel with a scrim on
 * desktop, the same content full screen on the phone. The board is read-only: it has no answer box.
 */
export function SessionDrawer({ item, onClose }: DrawerProps) {
  const view = useView();
  const { t, phone } = view;
  const closeRef = useDialogFocus(onClose);
  const kicker = kickerOf(item);
  const question = kicker === Kicker.Need;
  return (
    <div className="overlay">
      <button type="button" className="scrim card-scrim" aria-label={t("closeDetails")} tabIndex={-1} onClick={onClose} />
      <aside className={phone ? "card-drawer card-drawer-phone" : "card-drawer"} role="dialog" aria-modal="true" aria-label={t("cardDetails")}>
        <TopRow item={item} kicker={kicker} onClose={onClose} closeRef={closeRef} />
        <div className="drawer-heading">
          <h2>{question ? item.needs_you : item.title}</h2>
          {item.why && isSessionItem(item) && <span className="drawer-purpose">{item.why}</span>}
          <span className="drawer-meta">{metaText(item, kicker, view)}</span>
        </div>
        {question && item.after_answer && (
          <div className="drawer-after">
            <strong>{t("afterYouAnswer")}</strong> {item.after_answer}
          </div>
        )}
        {isSessionItem(item) ? (
          <DoneSoFar item={item} />
        ) : (
          <>
            {item.why && <p className="drawer-why">{item.why}</p>}
            <DetailsBody item={item} />
          </>
        )}
        <DrawerSteps item={item} />
        <SliceOfCard item={item} />
        <DrawerLinks item={item} />
        <DrawerHistory item={item} />
      </aside>
    </div>
  );
}
