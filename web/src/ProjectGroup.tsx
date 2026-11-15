import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectGroup as Group } from "./model";
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
  if (group.waiting.length > 0) {
    parts.push(t(phone ? "summaryWaitingShort" : "summaryWaiting", { n: group.waiting.length }));
  }
  parts.push(t("summaryOpen", { n: group.inFlight.length }));
  parts.push(t(phone ? "summaryDoneShort" : "summaryDone", { n: group.done.length, hours }));
  return parts.join(" · ");
}

/** One project: its name and counts, then its sections. The phone's waiting items live in the strip above. */
export function ProjectGroup({ group, onOpen }: GroupProps) {
  const view = useView();
  const { t, phone, hours } = view;
  if (phone && group.inFlight.length + group.done.length === 0) return null;
  return (
    <section className="project">
      <div className="project-head">
        <h2>{group.label}</h2>
        <span className="project-summary">{summaryOf(group, view)}</span>
      </div>
      {!phone && group.waiting.length > 0 && (
        <Section label={t("waitingForYouN", { n: group.waiting.length })} items={group.waiting} onOpen={onOpen} />
      )}
      {group.inFlight.length > 0 && (
        <Section label={t("inFlightN", { n: group.inFlight.length })} items={group.inFlight} onOpen={onOpen} />
      )}
      {group.done.length > 0 && (
        <Section label={t("doneN", { hours, n: group.done.length })} items={group.done} onOpen={onOpen} />
      )}
    </section>
  );
}
