import type { ReactNode } from "react";
import { ActiveIcon, BoardIcon, UsageIcon } from "./icons";
import { Route, ROUTE_HASH } from "./route";
import type { StringKey, Translate } from "./strings";

interface ViewTabsProps {
  current: Route;
  phone: boolean;
  t: Translate;
  /** Tasks an agent is working on now; the Active work tab shows it as a pill, and leaves it out for 0 or null (unknown). */
  activeCount?: number | null;
}

interface Tab {
  route: Route;
  label: StringKey;
  icon: (current: boolean) => ReactNode;
}

const ICON_SIZE = 22;
const ICON_STROKE_CURRENT = 2;
const ICON_STROKE = 1.6;

function iconProps(current: boolean) {
  return { size: ICON_SIZE, stroke: "currentColor", strokeWidth: current ? ICON_STROKE_CURRENT : ICON_STROKE };
}

const TABS: Tab[] = [
  { route: Route.Board, label: "tabBoard", icon: (current) => <BoardIcon {...iconProps(current)} /> },
  { route: Route.Active, label: "tabActive", icon: (current) => <ActiveIcon {...iconProps(current)} /> },
  { route: Route.Usage, label: "tabUsage", icon: (current) => <UsageIcon {...iconProps(current)} /> },
];

/** The view switcher: a segmented bar above the header on the desktop, a bottom tab bar on the phone. */
export function ViewTabs({ current, phone, t, activeCount }: ViewTabsProps) {
  return (
    <nav className={phone ? "view-tabs view-tabs-phone" : "view-tabs"} aria-label={t("viewsLabel")}>
      {TABS.map((tab) => {
        const isCurrent = tab.route === current;
        const count = tab.route === Route.Active && activeCount ? activeCount : null;
        return (
          <a key={tab.route} href={ROUTE_HASH[tab.route]} className="view-tab" aria-current={isCurrent ? "page" : undefined}>
            {phone && tab.icon(isCurrent)}
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
