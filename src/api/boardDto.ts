import type { ColorSet, Palette, ProjectConfig, Schemes, StatusColors, TypeConfig } from "../config";
import type { ProjectGroups } from "../domain/boardGroups";
import type { CheckView } from "../domain/checks";
import type { SliceName } from "../domain/docSync";
import type { EventMarker, ItemLink, ItemStatus, ItemType, Priority } from "../domain/item";
import type { PartsProgress, PartState } from "../domain/parts";
import type { Step, StepProgress } from "../domain/stepTypes";

/** What `GET /api/board` returns; the page and the Worker share these shapes. */
export interface BoardEventDto {
  at: string;
  status: ItemStatus;
  note: string | null;
  /** Set when the server wrote the row as a question or an answer; the page builds the words (Slice 47 1q). */
  marker: EventMarker | null;
}

/** One lettered part of a slice, as the slice's tile and drawer list it (Slice 11). */
export interface BoardPartDto {
  key: string;
  letter: string;
  title: string;
  state: PartState;
  /** The label of the step the part is on (an active or a stale part); null when none is active or it has no list. */
  step: string | null;
  /** The part's finished steps over its steps, for "{n} of {m} steps"; null when it has no list. */
  steps_done: number | null;
  steps_total: number | null;
}

/** The slice a part belongs to, as data; the page builds "Slice N · title" from it in the reader's language. */
export interface ParentSliceDto {
  key: string;
  /** The N of a key ending in `slice-N`; null for any other key shape. */
  number: number | null;
  title: string;
}

/** The newest history event when it is a doc sync's reopen; the page shows its reason. */
export interface ReopenedDto {
  at: string;
  /** The status the plan now gives; the page words the reason from it. */
  status: ItemStatus;
}

export interface BoardItemDto {
  key: string;
  project: string;
  /** The free text stored on the item, shown on the tile. */
  parent: string | null;
  /** For a part, bug or problem whose slice is on the board: that slice; null otherwise. */
  parent_slice: ParentSliceDto | null;
  /** The key of the item this one belongs to; a part names its slice, a bug or problem the slice planned for it. */
  parent_key: string | null;
  /** For a slice: its number and its title as two values (Slice 14); null for any other type. */
  slice: SliceName | null;
  /** For a slice: its checks not tried on a device, never cards of their own; null for any other type. */
  checks: CheckView[] | null;
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
  /** What the task delivers, one line (Slice 41); null for older reports. The Worker always sends it; a test fixture may leave it out. */
  outcome?: string | null;
  /**
   * The agent's open question for the owner (Slice 13), what it does after the answer and when it
   * first asked; all null when no question waits (cleared, the item done, or its heartbeat past the
   * configured expiry). The page words "waiting N min" from `needs_you_at`.
   */
  needs_you: string | null;
  after_answer: string | null;
  needs_you_at: string | null;
  /** The task's steps in the order sent; null when it has none. A step over its budget carries a `breach`, worked out at read (Slice 56). */
  steps: Step[] | null;
  /** Worked out at read from the steps (and a slice's open checks); null when the item has no steps list. */
  progress: StepProgress | null;
  /** A step is blocked on the owner (Slice 51): the card reads red and is listed under Needs you. Optional in a test fixture, which means false. */
  blocked_on_owner?: boolean;
  /** Why a doc sync moved the item back from done (Slice 51), when that is its newest event; null otherwise. */
  reopened?: ReopenedDto | null;
  /** An agent is working on it now (the Active work rule); the page lists exactly these. */
  working: boolean;
  /** A slice's parts in letter order, worked out at read; null when it has none (no bar). */
  parts: BoardPartDto[] | null;
  /** Parts done over parts; null with `parts`. */
  parts_progress: PartsProgress | null;
  /** The key of the part an agent is working on now; null when none (a stale part does not count). */
  active_part_key: string | null;
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
  /**
   * The items sorted into each project's lists (Slice 14): Needs you, Working now, Planned (with the
   * checks), Problems, Done and the summary numbers. The page draws these and never regroups; the
   * keys name items in `items`. Check items are not in `items`.
   */
  groups: ProjectGroups[];
}
