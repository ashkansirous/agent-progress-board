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
  /** True once a failed load has dropped data an earlier load had; a success clears it. A first load that fails leaves it false. */
  dataDropped: boolean;
}

export type BoardAction =
  | { type: "start" }
  | { type: "slow" }
  | { type: "success"; data: BoardResponse; at: Date }
  | { type: "failure"; status: number | null };

export const INITIAL_STATE: BoardState = {
  data: null,
  config: null,
  error: null,
  loading: true,
  slow: false,
  updatedAt: null,
  dataDropped: false,
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
        dataDropped: false,
      };
    case "failure":
      return {
        ...state,
        data: null,
        error: { status: action.status },
        loading: false,
        slow: false,
        dataDropped: state.dataDropped || state.data !== null,
      };
  }
}
