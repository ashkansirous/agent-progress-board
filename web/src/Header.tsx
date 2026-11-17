import type { ProjectGroups } from "../../src/domain/boardGroups";
import { RefreshIcon } from "./icons";
import { REFRESH_EVERY_MS } from "./hooks";
import { boardTotals } from "./model";
import { clockTime } from "./time";
import { useView } from "./view";

interface HeaderProps {
  /** The projects the Worker grouped; null while there is no data (the title shows alone). */
  groups: ProjectGroups[] | null;
  updatedAt: Date | null;
  busy: boolean;
  onRefresh: () => void;
}

const MS_PER_SECOND = 1000;

/** "3 projects · updated 13:48 · refreshes every 60 s". */
function Subtitle({ count, updatedAt }: { count: number; updatedAt: Date }) {
  const { t } = useView();
  const projects = t(count === 1 ? "projectOne" : "projectMany", { n: count });
  const bits = [projects, t("boardUpdated", { time: clockTime(updatedAt) }), t("boardRefreshes", { n: REFRESH_EVERY_MS / MS_PER_SECOND })];
  return <p className="subtitle">{bits.join(" · ")}</p>;
}

/** The totals over all projects: "2 need you", "3 working", "2 problems". A count of 0 stays and reads "0 ...". */
function CountRow({ groups }: { groups: ProjectGroups[] }) {
  const { t } = useView();
  const totals = boardTotals(groups);
  return (
    <p className="count-row">
      <span className="count-pill count-pill-needs">{totals.needsYou === 1 ? t("countNeedYouOne") : t("countNeedYou", { n: totals.needsYou })}</span>
      <span className="count-pill">{totals.working === 1 ? t("countWorkingOne") : t("countWorking", { n: totals.working })}</span>
      <span className="count-pill">{totals.problems === 1 ? t("countProblemsOne") : t("countProblems", { n: totals.problems })}</span>
    </p>
  );
}

/** Title, the projects and update line, the count row and the 44 px refresh button. */
export function Header({ groups, updatedAt, busy, onRefresh }: HeaderProps) {
  const { t } = useView();
  return (
    <header className="header board-header">
      <div className="header-text">
        <h1>{t("title")}</h1>
        {groups && updatedAt && <Subtitle count={groups.length} updatedAt={updatedAt} />}
      </div>
      <div className="header-actions">
        {groups && <CountRow groups={groups} />}
        <button
          type="button"
          className={busy ? "icon-button refresh busy" : "icon-button refresh"}
          aria-label={t("refreshNow")}
          aria-busy={busy}
          onClick={onRefresh}
        >
          <RefreshIcon size={18} stroke="currentColor" />
        </button>
      </div>
    </header>
  );
}
