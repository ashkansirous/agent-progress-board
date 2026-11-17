import type { BoardItemDto } from "../../src/api/boardDto";
import { StepState } from "../../src/domain/stepTypes";
import { hasNoGoal, sessionLabel, waitingText } from "./cards";
import { projectLabel } from "./model";
import { ageText } from "./time";
import { useView } from "./view";

interface CardProps {
  item: BoardItemDto;
  onOpen: (key: string) => void;
}

/** One question: the question in full, what happens after the answer, and who asked. The board is read-only, so the card says where to answer. */
export function QuestionCard({ item, onOpen }: CardProps) {
  const { t, phone, nowMs, projects } = useView();
  const waiting = waitingText(item, nowMs, t);
  const session = sessionLabel(item);
  const asked = t("askedBy", { session });
  return (
    <button type="button" className="question-card" onClick={() => onOpen(item.key)}>
      <span className="question-top">
        {phone ? (
          <span className="question-project">{projectLabel(item.project, projects)}</span>
        ) : (
          <span className="question-label">{t("questionLabel")}</span>
        )}
        {waiting && <span className="question-waiting">{waiting}</span>}
      </span>
      <span className="question-text">{item.needs_you}</span>
      {item.after_answer && <span className="question-after">{t("afterThen", { text: item.after_answer })}</span>}
      <span className="question-asked">{phone ? asked : `${asked} · ${t("answerInSession")}`}</span>
    </button>
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
  const noGoal = hasNoGoal(item);
  return (
    <button type="button" className={noGoal ? "session-card session-card-nogoal" : "session-card"} onClick={() => onOpen(item.key)}>
      <span className="session-top">
        <span>{sessionLabel(item)}</span>
        <span className="session-last">{t("lastActivityAge", { age: ageText(item.heartbeat_at, nowMs, t) })}</span>
      </span>
      {noGoal ? (
        <span className="session-nogoal">{t("startedNoGoal", { age: ageText(item.created_at, nowMs, t) })}</span>
      ) : (
        <>
          <span className="session-goal">{item.title}</span>
          {item.why && <span className="session-why">{item.why}</span>}
          <StepChips item={item} />
        </>
      )}
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
