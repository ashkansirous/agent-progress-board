import { useCallback, useSyncExternalStore } from "react";
import { activeKeyOf, openItemHash, openKeyOf, Route, ROUTE_HASH, routeOf } from "./route";

function subscribeToHash(notify: () => void): () => void {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

const currentHash = (): string => window.location.hash;

/** The view the address hash names; follows the browser's back and forward buttons and the tab links. */
export function useRoute(): Route {
  return routeOf(useSyncExternalStore(subscribeToHash, currentHash));
}

/** The item whose Active work card the address asks to show expanded (`#/active/<key>`), or null. */
export function useActiveKey(): string | null {
  return activeKeyOf(useSyncExternalStore(subscribeToHash, currentHash));
}

/**
 * The item whose detail is open. The address hash is the only source of truth: opening sets it, closing
 * puts the board's own hash in its place (no history entry left behind), and back or forward moves the drawer.
 */
export function useOpenItem(): { openKey: string | null; open: (key: string) => void; close: () => void } {
  const openKey = openKeyOf(useSyncExternalStore(subscribeToHash, currentHash));
  const open = useCallback((key: string) => {
    window.location.hash = openItemHash(key);
  }, []);
  const close = useCallback(() => {
    window.location.replace(ROUTE_HASH[Route.Board]);
  }, []);
  return { openKey, open, close };
}
