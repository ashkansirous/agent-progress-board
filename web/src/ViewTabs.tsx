import type { ReactNode } from "react";
import { BoardIcon, UsageIcon } from "./icons";
import { Route, ROUTE_HASH } from "./route";
import type { StringKey, Translate } from "./strings";

interface ViewTabsProps {
  current: Route;
  phone: boolean;
  t: Translate;
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

/** Board and Usage now; Active work joins in Slice 10. */
const TABS: Tab[] = [
  { route: Route.Board, label: "tabBoard", icon: (current) => <BoardIcon {...iconProps(current)} /> },
  { route: Route.Usage, label: "tabUsage", icon: (current) => <UsageIcon {...iconProps(current)} /> },
];

/** The view switcher: a segmented bar above the header on the desktop, a bottom tab bar on the phone. */
export function ViewTabs({ current, phone, t }: ViewTabsProps) {
  return (
    <nav className={phone ? "view-tabs view-tabs-phone" : "view-tabs"} aria-label={t("viewsLabel")}>
      {TABS.map((tab) => {
        const isCurrent = tab.route === current;
        return (
          <a key={tab.route} href={ROUTE_HASH[tab.route]} className="view-tab" aria-current={isCurrent ? "page" : undefined}>
            {phone && tab.icon(isCurrent)}
            <span>{t(tab.label)}</span>
          </a>
        );
      })}
    </nav>
  );
}
