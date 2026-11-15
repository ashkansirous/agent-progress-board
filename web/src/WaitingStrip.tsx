import type { BoardItemDto } from "../../src/api/boardDto";
import { ItemType } from "../../src/domain/item";
import { distinctProjects, projectLabel } from "./model";
import { PriorityBadge } from "./PriorityBadge";
import { ageText } from "./time";
import { useView } from "./view";

interface StripProps {
  items: BoardItemDto[];
  onOpen: (key: string) => void;
}

function AskedLine({ item }: { item: BoardItemDto }) {
  const { t, nowMs } = useView();
  const age = ageText(item.created_at, nowMs, t);
  return <span className="card-asked">{item.parent ? t("askedAge", { age, parent: item.parent }) : t("askedOnly", { age })}</span>;
}

function WaitingCard({ item, onOpen }: { item: BoardItemDto; onOpen: (key: string) => void }) {
  const { looks, phone, projects } = useView();
  const type = looks.type(ItemType.WaitingForMe);
  return (
    <button
      type="button"
      className="waiting-card"
      style={{ background: type.bg, borderColor: type.border }}
      onClick={() => onOpen(item.key)}
    >
      <span className="card-top">
        <span className="card-project">{projectLabel(item.project, projects)}</span>
        <PriorityBadge priority={item.priority} variant={phone ? "strip" : "tile"} />
      </span>
      <span className="card-title">{item.title}</span>
      {item.why && <span className="card-why">{item.why}</span>}
      {!phone && <AskedLine item={item} />}
    </button>
  );
}

function plural(count: number, one: "itemOne" | "projectOne", many: "itemMany" | "projectMany", t: ReturnType<typeof useView>["t"]) {
  return t(count === 1 ? one : many, { n: count });
}

function StripHeading({ items }: { items: BoardItemDto[] }) {
  const { t, phone } = useView();
  if (phone) return <h2 id="waiting-h">{t("waitingForYouN", { n: items.length })}</h2>;
  const across = t("acrossProjects", {
    items: plural(items.length, "itemOne", "itemMany", t),
    projects: plural(distinctProjects(items), "projectOne", "projectMany", t),
  });
  return (
    <div className="strip-heading">
      <h2 id="waiting-h">{t("waitingForYou")}</h2>
      <span className="strip-count">{across}</span>
    </div>
  );
}

/** The "Waiting for you" strip at the top: a card grid on desktop, a sideways scroller on the phone. */
export function WaitingStrip({ items, onOpen }: StripProps) {
  if (items.length === 0) return null;
  return (
    <section className="strip" aria-labelledby="waiting-h">
      <StripHeading items={items} />
      <div className="strip-cards">
        {items.map((item) => (
          <WaitingCard key={item.key} item={item} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
