import type { BoardResponse } from "../../src/api/boardDto";
import { LoadError } from "./api";
import { type BoardAction, type BoardState, boardReducer, INITIAL_STATE } from "./boardState";

export interface BoardStoreParts {
  /** How long a load runs before it counts as slow (the page shows its loading state only then). */
  slowAfterMs: number;
  fetchBoard: (signal: AbortSignal) => Promise<BoardResponse>;
  /** Starts the periodic reload; returns the function that stops it. */
  startPolling: (reload: () => void) => () => void;
}

export interface BoardStore {
  getState: () => BoardState;
  /** A page that uses the board: the first one starts the load and the polling, the last one stops both. */
  subscribe: (notify: () => void) => () => void;
  /** A reader of the last answer (the tab bar count): never starts polling; loads once only when nothing was read yet. */
  subscribePassive: (notify: () => void) => () => void;
  refresh: () => Promise<void>;
}

/**
 * The one board read every page shares (Slice 36). It lives for the whole page; polling runs only while a page
 * is subscribed, and the last answer stays while none is, so the next page paints it at once.
 */
export function createBoardStore(parts: BoardStoreParts): BoardStore {
  let state: BoardState = INITIAL_STATE;
  let running: AbortController | null = null;
  let stopPolling: (() => void) | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const passive = new Set<() => void>();

  const publish = (action: BoardAction): void => {
    state = boardReducer(state, action);
    // One throwing listener must not stop the others, nor turn the publish of a success into a failure (Slice 47 1b).
    [...listeners, ...passive].forEach((notify) => {
      try {
        notify();
      } catch {
        // A listener's own fault stays its own.
      }
    });
  };

  /** True while a page or a reader (or the deferred stop of the last page) still holds the read. */
  const isWatched = (): boolean => listeners.size > 0 || passive.size > 0 || stopTimer !== null;

  /** True while a load runs that nobody has aborted. */
  const isLoadingNow = (): boolean => running !== null && !running.signal.aborted && state.loading;

  let slowTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSlowTimer = (): void => {
    if (slowTimer !== null) clearTimeout(slowTimer);
    slowTimer = null;
  };

  /** The one end of every load: success, failure or aborted. Nothing else clears `loading` or `slow`. */
  const settle = (outcome: BoardAction & { type: "success" | "failure" | "aborted" }): void => {
    clearSlowTimer();
    publish(outcome);
  };

  /** Loads the board now; a newer load cancels the one still running. A failed load clears the board. */
  const refresh = async (): Promise<void> => {
    running?.abort();
    const controller = new AbortController();
    running = controller;
    clearSlowTimer();
    publish({ type: "start" });
    slowTimer = setTimeout(() => publish({ type: "slow" }), parts.slowAfterMs);
    let outcome: BoardAction & { type: "success" | "failure" };
    try {
      outcome = { type: "success", data: await parts.fetchBoard(controller.signal), at: new Date() };
    } catch (error) {
      outcome = { type: "failure", status: error instanceof LoadError ? error.status : null };
    }
    // Settled outside the try: a fault while publishing is never read as a failed load (Slice 47 1b).
    if (!controller.signal.aborted) settle(outcome);
  };

  /** Aborts the read nobody waits for; it settles as aborted, so the next reader sees no stale loading card. */
  const abortUnwatched = (): void => {
    if (isWatched()) return; // a passive reader still waits for this load
    if (running && isLoadingNow()) {
      running.abort();
      running = null;
      settle({ type: "aborted" });
    }
  };

  const stopReading = (): void => {
    stopTimer = null;
    stopPolling?.();
    stopPolling = null;
    abortUnwatched();
  };

  const subscribe = (notify: () => void): (() => void) => {
    listeners.add(notify);
    if (stopTimer !== null) {
      // A page switch: the next page arrived in the same tick, so the read and the polling carry on.
      clearTimeout(stopTimer);
      stopTimer = null;
      // Every page arrival starts a load unless one runs now: the page may name an item the cached answer lacks (Slice 47 1a).
      if (!isLoadingNow()) void refresh();
    } else if (listeners.size === 1) {
      // A load a passive reader already started carries on: aborting it would only repeat the request (Slice 47 1d).
      if (!isLoadingNow()) void refresh();
      stopPolling = parts.startPolling(() => void refresh());
    }
    // No branch for "loading true, nothing running": an aborted first load (loading left true on purpose) exists only when
    // nothing is watched, so the next reader is always the first listener above, or a passive reader that loads (Slice 48 1).
    return () => {
      listeners.delete(notify);
      // Stopping waits one tick, so a page switch (leave, then subscribe) does not abort and reissue the read.
      if (listeners.size === 0) stopTimer = setTimeout(stopReading, 0);
    };
  };

  const subscribePassive = (notify: () => void): (() => void) => {
    passive.add(notify);
    if (state.data === null && state.error === null && running === null) void refresh();
    return () => {
      passive.delete(notify);
      abortUnwatched();
    };
  };

  return { getState: () => state, subscribe, subscribePassive, refresh };
}
