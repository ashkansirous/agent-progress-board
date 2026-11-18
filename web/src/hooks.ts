import { useCallback, useSyncExternalStore } from "react";
import { fetchBoard } from "./api";
import { createBoardStore } from "./boardStore";
import type { BoardState } from "./boardState";

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

/** Reloads every 60 s while the tab is visible, and when it becomes visible again; returns the function that stops it. */
function startPolling(reload: () => void): () => void {
  const refreshIfVisible = () => document.visibilityState === "visible" && reload();
  const timer = setInterval(refreshIfVisible, REFRESH_EVERY_MS);
  document.addEventListener("visibilitychange", refreshIfVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refreshIfVisible);
  };
}

/** The one board read every page shares (Slice 36); see `createBoardStore`. */
const board = createBoardStore({ fetchBoard, startPolling, slowAfterMs: SLOW_AFTER_MS });

/**
 * The board read: loads when the first page uses it, then every 60 s while the tab is visible. Every caller
 * gets the same state; the last answer stays while no page uses it, so the next page paints it at once.
 */
export function useBoard() {
  const state = useSyncExternalStore(board.subscribe, board.getState);
  return { state, refresh: board.refresh };
}

/** The last board answer for a reader that is not a board page (the Usage tab bar's count): no polling of its own. */
export function useBoardSnapshot(): BoardState {
  return useSyncExternalStore(board.subscribePassive, board.getState);
}
