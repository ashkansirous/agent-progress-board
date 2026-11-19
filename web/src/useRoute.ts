import { useCallback, useSyncExternalStore } from "react";
import { activeKeyOf, closeHashFor, hashOfUrl, looseChecksHash, looseProjectOf, nextOrigin, openItemHash, openKeyOf, Route, routeOf } from "./route";

function subscribeToHash(notify: () => void): () => void {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
}

const currentHash = (): string => window.location.hash;

/** The address hash as it is now; a page that reacts to a link on itself (`#/needs-you`) reads it here. */
export function useAddressHash(): string {
  return useSyncExternalStore(subscribeToHash, currentHash);
}

/** The view the address hash names; follows the browser's back and forward buttons and the tab links. */
export function useRoute(): Route {
  return routeOf(useSyncExternalStore(subscribeToHash, currentHash));
}

/** The item whose Active work card the address asks to show expanded (`#/active/<key>`), or null. */
export function useActiveKey(): string | null {
  return activeKeyOf(useSyncExternalStore(subscribeToHash, currentHash));
}

/** The page the open drawer was reached from (the Active work page, say); null when the address was opened directly. */
let openedFrom: string | null = null;

function rememberOrigin(event: HashChangeEvent): void {
  openedFrom = nextOrigin(openedFrom, hashOfUrl(event.oldURL), hashOfUrl(event.newURL));
}

// Installed when the page loads, before any drawer can open: the Active work page has no drawer of its own,
// so only a listener that is always on sees the move from it to a drawer's address.
if (typeof window !== "undefined") window.addEventListener("hashchange", rememberOrigin);

/**
 * The drawer the address names: an item (`#/open/<key>`) or a project's loose checks (`#/loose/<project>`). The
 * address hash is the only source of truth: opening sets it, closing puts the page it was opened from in its place
 * (the board when there is none; no history entry left behind), and back or forward moves the drawer.
 */
export function useOpenItem(): {
  openKey: string | null;
  looseProject: string | null;
  open: (key: string) => void;
  openLoose: (projectId: string) => void;
  close: () => void;
} {
  const hash = useSyncExternalStore(subscribeToHash, currentHash);
  const open = useCallback((key: string) => {
    window.location.hash = openItemHash(key);
  }, []);
  const openLoose = useCallback((projectId: string) => {
    window.location.hash = looseChecksHash(projectId);
  }, []);
  const close = useCallback(() => {
    window.location.replace(closeHashFor(openedFrom));
  }, []);
  return { openKey: openKeyOf(hash), looseProject: looseProjectOf(hash), open, openLoose, close };
}
