import { useCallback, useEffect, useReducer, useRef } from "react";
import { LoadError } from "./api";
import { REFRESH_EVERY_MS, SLOW_AFTER_MS } from "./hooks";
import { fetchUsage } from "./usageApi";
import { usageQuery, type UsageParams } from "./usageQuery";
import { INITIAL_USAGE_STATE, usageReducer } from "./usageState";

/**
 * Loads usage for `params` now and every 60 s while the tab is visible. A change of `params` clears the
 * data (the page must not show numbers for another question) and starts a load; a newer load cancels the
 * one still running.
 */
export function useUsage(params: UsageParams) {
  const [state, dispatch] = useReducer(usageReducer, INITIAL_USAGE_STATE);
  const running = useRef<AbortController | null>(null);
  const { range, plan, environment } = params;

  const load = useCallback(async () => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    dispatch({ type: "start", question: usageQuery({ range, plan, environment }, 0) });
    const slowTimer = setTimeout(() => dispatch({ type: "slow" }), SLOW_AFTER_MS);
    try {
      const data = await fetchUsage({ range, plan, environment }, controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "success", data, at: new Date() });
    } catch (error) {
      const status = error instanceof LoadError ? error.status : null;
      if (!controller.signal.aborted) dispatch({ type: "failure", status });
    } finally {
      clearTimeout(slowTimer);
    }
  }, [range, plan, environment]);

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

  return { state, retry: load };
}
