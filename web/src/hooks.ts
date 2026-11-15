import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { fetchBoard, LoadError } from "./api";
import { boardReducer, INITIAL_STATE } from "./boardState";

/** The page waits this long before it shows a loading state. */
export const SLOW_AFTER_MS = 500;
export const REFRESH_EVERY_MS = 60_000;
export const PHONE_QUERY = "(max-width: 599px)";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/**
 * Loads the board now and every 60 s while the tab is visible (and when it becomes visible again).
 * A newer load cancels the one still running; a failed load clears the board.
 */
export function useBoard() {
  const [state, dispatch] = useReducer(boardReducer, INITIAL_STATE);
  const running = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    dispatch({ type: "start" });
    const slowTimer = setTimeout(() => dispatch({ type: "slow" }), SLOW_AFTER_MS);
    try {
      const data = await fetchBoard(controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "success", data, at: new Date() });
    } catch (error) {
      const status = error instanceof LoadError ? error.status : null;
      if (!controller.signal.aborted) dispatch({ type: "failure", status });
    } finally {
      clearTimeout(slowTimer);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshIfVisible = () => document.visibilityState === "visible" && void load();
    const timer = setInterval(refreshIfVisible, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      running.current?.abort();
    };
  }, [load]);

  return { state, refresh: load };
}
