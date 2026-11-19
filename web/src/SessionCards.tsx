import type { MouseEvent } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { StepState } from "../../src/domain/stepTypes";
import { OutcomeLine } from "./ActiveCard";
import { cardLabel, cardQuestion, fillBoardAddress, isOwnerStep, ownerStepDetails, resolveBoardAddress, sessionLabel, stepUrls, waitingText } from "./cards";
import { projectLabel } from "./model";
import { isSafeHttpUrl } from "./safeUrl";
import { ageText } from "./time";
import { useView } from "./view";

/** Card text for a screen reader: a link to a board page is read by its page name, not its `/#/page` address. */
function spokenText(text: string): string {
  const origin = window.location.origin;
  return resolveBoardAddress(text, origin)
    .map((part) => (part.href ? part.text.slice(origin.length).replace(/^\/#\/?/, "") || part.text : part.text))
    .join("");
}

interface CardProps {
  item: BoardItemDto;
  onOpen: (key: string) => void;
}

/**
 * Card text with `<board address>` read as this page's own origin and `<board address>/#/page` as a link to that page
 * of the board (Slice 43); the same tab, because it is the board itself. `asText` keeps the link out (a card's body is
 * one button, which holds no link): its links sit in the row under it instead.
 */
export function AddressText({ text, asText = false }: { text: string; asText?: boolean }) {
  return (
    <>
      {resolveBoardAddress(text, window.location.origin).map((part, index) =>
        part.href && !asText ? (
          // The text is replaced whole on every report, so the position is its identity.
          <a key={index} href={part.href}>
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** Card text with `<board address>` read as this page's origin, as plain text (for a string that goes through `t`). */
function addressAsText(text: string): string {
  return resolveBoardAddress(text, window.location.origin).map((part) => part.text).join("");
}

/** The board pages a card's text names (`<board address>/#/setup`), as links for the row under the card. */
function addressLinks(texts: Array<string | null>): CardLink[] {
  const urls = texts.flatMap((text) => resolveBoardAddress(text ?? "", window.location.origin).flatMap((part) => (part.href ? [part.href] : [])));
  return [...new Set(urls)].map((url) => ({ label: url.slice(window.location.origin.length) || url, url, sameTab: true }));
}

/** One link per address: a step's own link is not listed twice when the item also carries it. */
function dedupeLinks(links: CardLink[]): CardLink[] {
  const seen = new Set<string>();
  return links.filter((link) => !seen.has(link.url) && seen.add(link.url));
}

interface CardLink {
  label: string;
  url: string;
  /** A page of this board opens in this tab, like the same link in the drawer; any other link opens a new one. */
  sameTab?: boolean;
}

/**
 * One "Needs you" card (Slice 27): the question in full (`needs_you`; for a doc-sync card with a reason, its title is
 * the step), why in full, the work it belongs to, what happens after the answer, and the links to where to act. A card
 * with no question and no why says so instead of repeating its title. The board is read-only, so the card says where to answer.
 */
export function QuestionCard({ item, onOpen }: CardProps) {
  const { t, phone, nowMs, projects } = useView();
  const waiting = waitingText(item, nowMs, t);
  const session = sessionLabel(item, t);
  const asked = t("askedBy", { session });
  // An owner step's own text is its title, with or without a why (the drawer heading reads it the same way).
  const question = cardQuestion(item);
  const work = item.title !== question ? item.title : null;
  const why = item.why && item.why !== question ? item.why : null;
  const steps = ownerStepDetails(item);
  const stepLinks: CardLink[] = stepUrls(steps ? fillBoardAddress(steps, window.location.origin) : "").filter(isSafeHttpUrl).map((url) => ({ label: url, url }));
  const links: CardLink[] = dedupeLinks([...addressLinks([work, question, why, item.after_answer, steps]), ...stepLinks, ...item.links.filter((link) => isSafeHttpUrl(link.url))]);
  // The whole card opens the drawer (a tap on its padding too); the button keeps the keyboard and the screen reader
  // path, and a link inside the card follows its own address.
  const openFromPadding = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("a, button")) return;
    const selection = window.getSelection();
    // The end of a text-selection drag inside this card is not a tap; a selection elsewhere does not block it.
    if (selection?.toString() && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return;
    onOpen(item.key);
  };
  return (
    <div className="question-card" role="group" aria-label={spokenText(question ?? item.title)} onClick={openFromPadding}>
      <button type="button" className="question-body" onClick={() => onOpen(item.key)}>
        <span className="question-top">
          {phone ? (
            <span className="question-project">{isOwnerStep(item) ? `${cardLabel(item, t)} · ${projectLabel(item.project, projects)}` : projectLabel(item.project, projects)}</span>
          ) : (
            <span className="question-label">{cardLabel(item, t)}</span>
          )}
          {waiting && <span className="question-waiting">{waiting}</span>}
        </span>
        {work && <span className="question-work"><AddressText text={work} asText /></span>}
        {question ? <span className="question-text"><AddressText text={question} asText /></span> : <span className="question-text question-none">{t("noQuestionRecorded")}</span>}
        {why && <span className="question-why"><AddressText text={why} asText /></span>}
        {steps && <span className="question-why question-steps"><AddressText text={steps} asText /></span>}
        {item.after_answer && <span className="question-after">{t("afterThen", { text: addressAsText(item.after_answer) })}</span>}
        {item.needs_you ? <span className="question-asked">{phone ? asked : `${asked} · ${t("answerInSession")}`}</span> : null}
      </button>
      {links.length > 0 && (
        <span className="question-links">
          {links.map((link, index) => (
            <a key={`${link.label}|${link.url}|${index}`} href={link.url} {...(link.sameTab ? {} : { target: "_blank", rel: "noreferrer noopener" })}>
              {link.label}
            </a>
          ))}
        </span>
      )}
    </div>
  );
}

/** "Needs you · {n}" over a list of question cards. */
export function QuestionList({ items, onOpen }: { items: BoardItemDto[]; onOpen: (key: string) => void }) {
  const { t, phone } = useView();
  if (items.length === 0) return null;
  const heading = t("needsYouN", { n: items.length });
  return (
    <section className={phone ? "questions questions-top" : "questions"} aria-label={heading}>
      {phone ? <h2>{heading}</h2> : <h3>{heading}</h3>}
      {items.map((item) => (
        <QuestionCard key={item.key} item={item} onOpen={onOpen} />
      ))}
    </section>
  );
}

const STEP_MARKS: Record<StepState, string> = {
  [StepState.Done]: "✓",
  [StepState.Active]: "●",
  [StepState.Pending]: "",
};

/** The steps as pills: a mark and the weight say the state (done ✓, now ●), so colour is not the only signal. */
function StepChips({ item }: { item: BoardItemDto }) {
  const { t } = useView();
  if (!item.steps || item.steps.length === 0) return null;
  return (
    <ol className="step-chips" aria-label={t("stepsAria")}>
      {item.steps.map((step, index) => (
        // The list is replaced whole on every report, so the position is its identity.
        <li key={index} className={`step-chip step-chip-${step.state}`}>
          {STEP_MARKS[step.state] && <span aria-hidden="true">{STEP_MARKS[step.state]}</span>}
          {step.label}
        </li>
      ))}
    </ol>
  );
}

/** One working session: which session, how long since it did anything, its goal, purpose and steps. */
export function SessionCard({ item, onOpen }: CardProps) {
  const { t, nowMs } = useView();
  return (
    <button type="button" className="session-card" onClick={() => onOpen(item.key)}>
      <span className="session-top">
        <span>{sessionLabel(item, t)}</span>
        <span className="session-last">{t("lastActivityAge", { age: ageText(item.heartbeat_at, nowMs, t) })}</span>
      </span>
      <span className="session-goal">{item.title}</span>
      <OutcomeLine outcome={item.outcome} compact />
      {item.why && <span className="session-why">{item.why}</span>}
      <StepChips item={item} />
    </button>
  );
}

/** "Working now · {n}" over a grid of session cards. */
export function SessionList({ items, onOpen }: { items: BoardItemDto[]; onOpen: (key: string) => void }) {
  const { t } = useView();
  if (items.length === 0) return null;
  return (
    <div className="section session-section">
      <h3>{t("workingNowN", { n: items.length })}</h3>
      <div className="session-grid">
        {items.map((item) => (
          <SessionCard key={item.key} item={item} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
