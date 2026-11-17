import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectGroups } from "../../src/domain/boardGroups";
import { isQuestion } from "./cards";
import { DoneSection } from "./DoneSection";
import { projectLabel } from "./model";
import { PlannedSection } from "./PlannedSection";
import { summaryText } from "./planningText";
import { ProblemsSection } from "./ProblemsSection";
import { QuestionList, SessionList } from "./SessionCards";
import { Tile } from "./Tile";
import { looseChecksKey } from "./route";
import { useView } from "./view";

interface GroupProps {
  group: ProjectGroups;
  items: Map<string, BoardItemDto>;
  onOpen: (key: string) => void;
}

function itemsOf(keys: string[], items: Map<string, BoardItemDto>): BoardItemDto[] {
  return keys.flatMap((key) => {
    const item = items.get(key);
    return item ? [item] : [];
  });
}

function Section({ label, list, onOpen }: { label: string; list: BoardItemDto[]; onOpen: (key: string) => void }) {
  return (
    <div className="section">
      <h3>{label}</h3>
      <div className="tiles">
        {list.map((item) => (
          <Tile key={item.key} item={item} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/** Nothing here for the phone's list: its questions are above the projects and the rest is empty. */
function isQuietOnPhone(group: ProjectGroups): boolean {
  const { summary } = group;
  const shown = summary.working + summary.planned + summary.problems + summary.checks_not_tried + group.other.length + group.done.count;
  return shown === 0;
}

/**
 * One project: its name and summary line, then the lists the server sorted (Needs you, Working now,
 * Planned, Problems and bugs, Done). A project's questions sit under its name on desktop; the phone
 * lists every question above the projects and leaves a note here. Nothing here regroups.
 */
export function ProjectGroup({ group, items, onOpen }: GroupProps) {
  const { t, phone, projects } = useView();
  if (phone && isQuietOnPhone(group)) return null;
  const needs = itemsOf(group.needs_you, items);
  const questions = needs.filter(isQuestion);
  const waiting = needs.filter((item) => !isQuestion(item));
  return (
    <section className="project">
      <div className="project-head">
        <h2>{projectLabel(group.id, projects)}</h2>
        <span className={group.summary.needs_you > 0 ? "project-summary project-summary-needs" : "project-summary"}>
          {summaryText(group.summary, t)}
        </span>
      </div>
      {!phone && <QuestionList items={questions} onOpen={onOpen} />}
      {phone && questions.length > 0 && <p className="question-note">{t("questionAtTop")}</p>}
      <SessionList items={itemsOf(group.working_now, items)} onOpen={onOpen} />
      {!phone && waiting.length > 0 && <Section label={t("waitingForYouN", { n: waiting.length })} list={waiting} onOpen={onOpen} />}
      <PlannedSection
        slices={group.planned}
        items={items}
        looseCount={group.loose_checks.length}
        onOpen={() => onOpen(looseChecksKey(group.id))}
        onOpenItem={onOpen}
      />
      <ProblemsSection problems={group.problems} items={items} onOpen={onOpen} />
      {group.other.length > 0 && <Section label={t("otherOpenN", { n: group.other.length })} list={itemsOf(group.other, items)} onOpen={onOpen} />}
      <DoneSection done={group.done} onOpen={onOpen} />
    </section>
  );
}
