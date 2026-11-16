import type { UsagePageResponse } from "../../src/api/usageDto";

/** What the controls list; kept across a failure and a reload so they stay put while the data is gone. */
export type UsageControls = Pick<UsagePageResponse, "plans" | "environments" | "palettes">;

/** The usage page's load state. `data` is cleared when the question changes, and kept on a failed refresh. */
export interface UsageState {
  data: UsagePageResponse | null;
  controls: UsageControls | null;
  /** The request the data answers (or the load running); a different one clears the data. */
  question: string;
  error: { status: number | null } | null;
  loading: boolean;
  /** True once a load has run past the 500 ms the page waits before it shows a loading state. */
  slow: boolean;
  updatedAt: Date | null;
}

export type UsageAction =
  | { type: "start"; question: string }
  | { type: "slow" }
  | { type: "success"; data: UsagePageResponse; at: Date }
  | { type: "failure"; status: number | null };

export const INITIAL_USAGE_STATE: UsageState = {
  data: null,
  controls: null,
  question: "",
  error: null,
  loading: true,
  slow: false,
  updatedAt: null,
};

export function usageReducer(state: UsageState, action: UsageAction): UsageState {
  switch (action.type) {
    case "start":
      if (action.question === state.question) return { ...state, loading: true, slow: false };
      return { ...state, question: action.question, data: null, error: null, loading: true, slow: false };
    case "slow":
      return state.loading ? { ...state, slow: true } : state;
    case "success": {
      const { plans, environments, palettes } = action.data;
      return { ...state, data: action.data, controls: { plans, environments, palettes }, error: null, loading: false, slow: false, updatedAt: action.at };
    }
    case "failure":
      // Data still held answers the current question (a changed question cleared it at "start"):
      // a failed background refresh keeps it on screen, and only a first load shows the error card.
      return { ...state, error: { status: action.status }, loading: false, slow: false };
  }
}
