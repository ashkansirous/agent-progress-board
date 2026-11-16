import type { ColorSet, Palette, ProjectConfig, Schemes, StatusColors, TypeConfig } from "../config";
import type { ItemLink, ItemStatus, ItemType, Priority } from "../domain/item";
import type { Step, StepProgress } from "../domain/stepTypes";

/** What `GET /api/board` returns; the page and the Worker share these shapes. */
export interface BoardEventDto {
  at: string;
  status: ItemStatus;
  note: string | null;
}

export interface BoardItemDto {
  key: string;
  project: string;
  parent: string | null;
  type: ItemType;
  priority: Priority;
  status: ItemStatus;
  title: string;
  why: string | null;
  details_md: string | null;
  links: ItemLink[];
  /** Time of the item's last report. */
  heartbeat_at: string;
  created_at: string;
  done_at: string | null;
  /** Where the work ran as the client sent it, and the config's label for it (the value itself when none). */
  environment: string | null;
  environment_label: string | null;
  agent: string | null;
  model: string | null;
  /** The task's steps in the order sent; null when it has none. */
  steps: Step[] | null;
  /** Worked out at read from the steps; null when the item has no steps list. */
  progress: StepProgress | null;
  /** An agent is working on it now (the Active work rule); the page lists exactly these. */
  working: boolean;
  /** Newest first, at most the latest 20. */
  events: BoardEventDto[];
}

/** The config the page needs, with the example file's colours filling anything BOARD_CONFIG leaves out. */
export interface BoardPageConfig {
  projects: ProjectConfig[];
  types: Partial<Record<ItemType, TypeConfig>>;
  statuses: Partial<Record<ItemStatus, Schemes<StatusColors>>>;
  priorities: Partial<Record<Priority, Schemes<ColorSet>>>;
  palettes: Schemes<Partial<Palette>>;
}

export interface BoardResponse {
  server_time: string;
  window_hours: number;
  config: BoardPageConfig;
  /** How many items are `working`: the Active work tab's count. */
  working_count: number;
  items: BoardItemDto[];
}
