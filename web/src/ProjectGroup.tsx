import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectGroup as Group } from "./model";
import { QuestionList, SessionList, StaleRow } from "./SessionCards";
import { Tile } from "./Tile";
import { useView } from "./view";

interface GroupProps {
  group: Group;
  onOpen: (key: string) => void;
}

function Section({ label, items, onOpen }: { label: string; items: BoardItemDto[]; onOpen: (key: string) => void }) {
  return (
    <div className="section">
      <h3>{label}</h3>
      <div className="tiles">
        {items.map((item) => (
          <Tile key={item.key} item={item} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function summaryOf(group: Group, view: ReturnType<typeof useView>): string {
  const { t, phone, hours } = view;
  const parts: string[] = [];
  const waiting = group.waiting.length + group.needs.length;
  if (waiting > 0) {
    parts.push(t(phone ? "summaryWaitingShort" : "summaryWaiting", { n: waiting }));
  }
  parts.push(t("summaryOpen", { n: group.inFlight.length + group.working.length }));
  parts.push(t(phone ? "summaryDoneShort" : "summaryDone", { n: group.done.length + group.staleSessions.length, hours }));
  return parts.join(" · ");
}

/** The Done section: the finished tiles, with the stopped session cards as dashed rows first. */
function DoneSection({ group, onOpen }: GroupProps) {
  const { t, hours } = useView();
  const count = group.done.length + group.staleSessions.length;
  return (
    <div className="section">
      <h3>{t("doneN", { hours, n: count })}</h3>
      {group.staleSessions.length > 0 && (
        <div className="stale-rows">
          {group.staleSessions.map((item) => (
            <StaleRow key={item.key} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
      {group.done.length > 0 && (
        <div className="tiles">
          {group.done.map((item) => (
            <Tile key={item.key} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One project: its name and counts, then its sections. A project's questions sit under its name on
 * desktop; the phone lists every question above the projects and leaves a note here. The phone's
 * old-shape waiting items live in the strip above.
 */
export function ProjectGroup({ group, onOpen }: GroupProps) {
  const view = useView();
  const { t, phone } = view;
  const hasCards = group.needs.length + group.working.length + group.staleSessions.length;
  if (phone && group.inFlight.length + group.done.length + hasCards === 0) return null;
  return (
    <section className="project">
      <div className="project-head">
        <h2>{group.label}</h2>
        <span className="project-summary">{summaryOf(group, view)}</span>
      </div>
      {!phone && <QuestionList items={group.needs} onOpen={onOpen} />}
      {phone && group.needs.length > 0 && <p className="question-note">{t("questionAtTop")}</p>}
      <SessionList items={group.working} onOpen={onOpen} />
      {!phone && group.waiting.length > 0 && (
        <Section label={t("waitingForYouN", { n: group.waiting.length })} items={group.waiting} onOpen={onOpen} />
      )}
      {group.inFlight.length > 0 && (
        <Section label={t("inFlightN", { n: group.inFlight.length })} items={group.inFlight} onOpen={onOpen} />
      )}
      {group.done.length + group.staleSessions.length > 0 && <DoneSection group={group} onOpen={onOpen} />}
    </section>
  );
}
