import type { ColorSet, Palette, ProjectConfig, Schemes, StatusColors, TypeConfig } from "../config";
import type { ItemLink, ItemStatus, ItemType, Priority } from "../domain/item";

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
  heartbeat_at: string;
  created_at: string;
  done_at: string | null;
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
  items: BoardItemDto[];
}
