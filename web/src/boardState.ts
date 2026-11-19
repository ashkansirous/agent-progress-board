import type { BoardPageConfig, BoardResponse } from "../../src/api/boardDto";

/** The page's load state. `data` is cleared on a failure: the board shows nothing rather than old data. */
export interface BoardState {
  data: BoardResponse | null;
  /** Kept across failures so the error card is still drawn in the owner's palette. */
  config: BoardPageConfig | null;
  /** The status the API answered with, null for "could not be reached". Set only after a failure. */
  error: { status: number | null } | null;
  loading: boolean;
  /** True once a load has run past the 500 ms the page waits before it shows a loading state. */
  slow: boolean;
  updatedAt: Date | null;
  /** How many loads have settled (succeeded or failed, never aborted): a page compares it with the count it mounted at. */
  settles: number;
}

/**
 * True once a load has settled since the page mounted at `settlesAtMount` and none runs now, so cached data from
 * before the page does not count. It says nothing of success: the caller checks `data` (Slice 47 1a).
 */
export function isFreshLoad(state: BoardState, settlesAtMount: number): boolean {
  return !state.loading && state.settles > settlesAtMount;
}

/** True when a load settled since the page mounted and left data: the only moment an address-driven scroll may run. */
export function isFreshData(state: BoardState, settlesAtMount: number): boolean {
  return state.data !== null && isFreshLoad(state, settlesAtMount);
}

/**
 * Whether an address-driven scroll should run now, and the address it has scrolled for. It scrolls once per arrival at
 * `address`, and records it only when the target element was found (`found`): a later poll does not scroll again, a poll
 * that adds the target still does, leaving and returning does (Slice 47 6d).
 */
export function nextScroll(ready: boolean, hash: string, address: string, scrolledFor: string | null, found: boolean): { scroll: boolean; scrolledFor: string | null } {
  if (hash !== address) return { scroll: false, scrolledFor: null };
  if (!ready || !found || scrolledFor === hash) return { scroll: false, scrolledFor };
  return { scroll: true, scrolledFor: hash };
}

export type BoardAction =
  | { type: "start" }
  | { type: "slow" }
  | { type: "success"; data: BoardResponse; at: Date }
  | { type: "failure"; status: number | null }
  | { type: "aborted" };

export const INITIAL_STATE: BoardState = {
  data: null,
  config: null,
  error: null,
  loading: true,
  slow: false,
  updatedAt: null,
  settles: 0,
};

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "start":
      return { ...state, loading: true, slow: false };
    case "slow":
      return state.loading ? { ...state, slow: true } : state;
    case "success":
      return {
        data: action.data,
        config: action.data.config,
        error: null,
        loading: false,
        slow: false,
        updatedAt: action.at,
        settles: state.settles + 1,
      };
    case "failure":
      return {
        ...state,
        data: null,
        error: { status: action.status },
        loading: false,
        slow: false,
        settles: state.settles + 1,
      };
    case "aborted":
      // A load nobody waits for any more: the last answer stays, and nothing claims a load is still running.
      // With nothing to show yet (no data, no error) the board is still "loading": the next page's first frame
      // must not paint an empty body before its own load starts (Slice 47 1c).
      return { ...state, loading: state.data === null && state.error === null, slow: false };
  }
}
