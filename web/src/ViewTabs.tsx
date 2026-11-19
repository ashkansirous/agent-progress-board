import { Route, ROUTE_HASH } from "./route";
import type { StringKey, Translate } from "./strings";

interface ViewTabsProps {
  current: Route;
  t: Translate;
  /** Tasks an agent is working on now; the Active work tab shows it as a pill, and leaves it out for 0 or null (unknown). */
  activeCount?: number | null;
}

interface Tab {
  route: Route;
  label: StringKey;
}

const TABS: Tab[] = [
  { route: Route.Board, label: "tabBoard" },
  { route: Route.Active, label: "tabActive" },
  { route: Route.Usage, label: "tabUsage" },
];

/** The view switcher: a segmented bar at the top of the page, on the desktop and on the phone (Slice 43). */
export function ViewTabs({ current, t, activeCount }: ViewTabsProps) {
  return (
    <nav className="view-tabs" aria-label={t("viewsLabel")}>
      {TABS.map((tab) => {
        const isCurrent = tab.route === current;
        const count = tab.route === Route.Active && activeCount ? activeCount : null;
        return (
          <a key={tab.route} href={ROUTE_HASH[tab.route]} className="view-tab" aria-current={isCurrent ? "page" : undefined}>
            <span className="view-tab-label">
              {t(tab.label)}
              {count !== null && <span className="tab-count">{count}</span>}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
