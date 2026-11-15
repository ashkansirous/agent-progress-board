import { createContext, useContext } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import type { ProjectConfig } from "../../src/config";
import { ItemStatus } from "../../src/domain/item";
import type { StringKey, Translate } from "./strings";
import type { Looks } from "./theme";
import { ageText, hoursSince } from "./time";

/** What every component needs to draw an item: words, colours, layout and "now". */
export interface View {
  t: Translate;
  looks: Looks;
  phone: boolean;
  nowMs: number;
  hours: number;
  projects: ProjectConfig[];
}

const ViewContext = createContext<View | null>(null);
export const ViewProvider = ViewContext.Provider;

export function useView(): View {
  const view = useContext(ViewContext);
  if (!view) throw new Error("useView needs a ViewProvider");
  return view;
}

const STATUS_KEYS: Record<ItemStatus, StringKey> = {
  [ItemStatus.Open]: "statusOpen",
  [ItemStatus.InProgress]: "statusInProgress",
  [ItemStatus.Blocked]: "statusBlocked",
  [ItemStatus.Done]: "statusDone",
  [ItemStatus.Stale]: "statusStale",
};

export function statusName(status: ItemStatus, t: Translate): string {
  return t(STATUS_KEYS[status]);
}

/** The tile's status text: plain name, "Done 2 h ago" or "Stale · No heartbeat for 3 h". */
export function statusLabel(item: BoardItemDto, view: Pick<View, "t" | "nowMs">): string {
  const { t, nowMs } = view;
  if (item.status === ItemStatus.Done && item.done_at) return t("doneAge", { age: ageText(item.done_at, nowMs, t) });
  if (item.status === ItemStatus.Stale) {
    return t("staleNote", { note: t("noHeartbeat", { n: hoursSince(item.heartbeat_at, nowMs) }) });
  }
  return statusName(item.status, t);
}
