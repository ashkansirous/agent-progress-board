import type { BoardItemDto } from "../../src/api/boardDto";
import { type ProblemEntry } from "../../src/domain/boardGroups";
import { ItemType } from "../../src/domain/item";
import { slicePlannedText } from "./planningText";
import { useView } from "./view";

interface ProblemsProps {
  problems: ProblemEntry[];
  items: Map<string, BoardItemDto>;
  onOpen: (key: string) => void;
}

/** One bug or problem: its kind, what is wrong, where it was found (the item's `why`) and the slice chip. */
function ProblemCard({ entry, item, onOpen }: { entry: ProblemEntry; item: BoardItemDto | undefined; onOpen: (key: string) => void }) {
  const { t } = useView();
  const bug = entry.kind === ItemType.Bug;
  const planned = entry.slice !== null;
  return (
    <button type="button" className={`problem-card ${bug ? "problem-bug" : "problem-problem"}`} onClick={() => onOpen(entry.key)}>
      <span className="problem-kind">{t(bug ? "kindBug" : "kindProblem")}</span>
      <span className="problem-what">{item?.title ?? entry.key}</span>
      {item?.why && <span className="problem-where">{item.why}</span>}
      <span className={planned ? "problem-chip problem-chip-planned" : "problem-chip problem-chip-none"}>
        {slicePlannedText(entry.slice, t)}
      </span>
    </button>
  );
}

/** "Problems and bugs · {n}": the project's own list, apart from the planned slices. */
export function ProblemsSection({ problems, items, onOpen }: ProblemsProps) {
  const { t } = useView();
  if (problems.length === 0) return null;
  return (
    <div className="section">
      <h3>{t("problemsN", { n: problems.length })}</h3>
      <div className="plan-grid">
        {problems.map((entry) => (
          <ProblemCard key={entry.key} entry={entry} item={items.get(entry.key)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
