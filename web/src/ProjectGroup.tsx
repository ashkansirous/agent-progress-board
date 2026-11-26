import { useId } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectGroups } from "../../src/domain/boardGroups";
import { countedChecks } from "../../src/domain/checks";
import { DoneSection } from "./DoneSection";
import { ChevronIcon } from "./icons";
import { projectLabel } from "./model";
import { BuiltSection, PlannedSection } from "./PlannedSection";
import { summaryText } from "./planningText";
import { useProjectOpen } from "./projectFold";
import { ProblemsSection } from "./ProblemsSection";
import { NEEDS_YOU_ATTRIBUTE } from "./route";
import { QuestionCard, SessionList } from "./SessionCards";
import { Tile } from "./Tile";
import { useView } from "./view";

interface GroupProps {
  group: ProjectGroups;
  items: Map<string, BoardItemDto>;
  onOpen: (key: string) => void;
  /** Opens the project's "checks with no open slice" drawer. */
  onOpenLoose: (projectId: string) => void;
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

/**
 * "Needs you · {n}": the question cards, then the old-shape waiting items as tiles. The phone lists every
 * question above the projects, so here it leaves the note that points there.
 */
function NeedsGroup({ needs, onOpen }: { needs: BoardItemDto[]; onOpen: (key: string) => void }) {
  const { t, phone } = useView();
  if (needs.length === 0) return null;
  if (phone) return <p className="question-note">{t("questionAtTop")}</p>;
  const heading = t("needsYouN", { n: needs.length });
  return (
    <section className="questions" aria-label={heading} {...{ [NEEDS_YOU_ATTRIBUTE]: "" }}>
      <h3>{heading}</h3>
      {needs.map((item) => <QuestionCard key={item.key} item={item} onOpen={onOpen} />)}
    </section>
  );
}

function ProjectBody({ group, items, onOpen, onOpenLoose, id }: GroupProps & { id: string }) {
  const { t } = useView();
  return (
    <div className="project-body" id={id}>
      <NeedsGroup needs={itemsOf(group.needs_you, items)} onOpen={onOpen} />
      <SessionList items={itemsOf(group.working_now, items)} onOpen={onOpen} />
      <PlannedSection
        slices={group.planned}
        items={items}
        looseCount={group.loose_checks.length}
        looseNotTried={countedChecks(group.loose_checks)}
        onOpen={() => onOpenLoose(group.id)}
        onOpenItem={onOpen}
      />
      <BuiltSection slices={group.built} items={items} onOpenItem={onOpen} />
      <ProblemsSection problems={group.problems} items={items} onOpen={onOpen} />
      {group.findings.length > 0 && <Section label={t("findingsN", { n: group.findings.length })} list={itemsOf(group.findings, items)} onOpen={onOpen} />}
      {group.other.length > 0 &&<Section label={t("otherOpenN", { n: group.other.length })} list={itemsOf(group.other, items)} onOpen={onOpen} />}
      <DoneSection done={group.done} onOpen={onOpen} />
    </div>
  );
}

/**
 * One project as a block that folds: a header button (name, summary line, Fold or Open) and, while open, the
 * lists the server sorted (Needs you, Working now, Planned, Problems and bugs, Done). Nothing here regroups.
 */
export function ProjectGroup({ group, items, onOpen, onOpenLoose }: GroupProps) {
  const { t, projects } = useView();
  const [open, toggle] = useProjectOpen(group);
  const bodyId = useId();
  const summaryClass = group.summary.needs_you > 0 ? "project-summary project-summary-needs" : "project-summary";
  return (
    <section className="project">
      <h2 className="project-head">
        <button type="button" className="project-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={toggle}>
          <span className={open ? "project-chevron project-chevron-open" : "project-chevron"}>
            <ChevronIcon size={18} stroke="currentColor" />
          </span>
          <span className="project-title">
            <span className="project-name">{projectLabel(group.id, projects)}</span>
            <span className={summaryClass}>{summaryText(group.summary, t)}</span>
          </span>
          <span className="project-fold">{open ? t("foldProject") : t("openProject")}</span>
        </button>
      </h2>
      {open && <ProjectBody id={bodyId} group={group} items={items} onOpen={onOpen} onOpenLoose={onOpenLoose} />}
    </section>
  );
}
