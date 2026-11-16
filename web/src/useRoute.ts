import { useCallback, useSyncExternalStore } from "react";
import { type Route, routeOf } from "./route";

/** The view the address hash names; follows the browser's back and forward buttons and the tab links. */
export function useRoute(): Route {
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("hashchange", notify);
    return () => window.removeEventListener("hashchange", notify);
  }, []);
  return routeOf(useSyncExternalStore(subscribe, () => window.location.hash));
}
