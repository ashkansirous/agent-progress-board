/** The views the tab bar switches between; the address hash says which one shows (no server route needed). */
export enum Route {
  Board = "board",
  Active = "active",
  Usage = "usage",
  /** The "Set up a chat" panel (Slice 19); reached by a link on the board, not a tab. */
  Setup = "setup",
}

export const ROUTE_HASH: Record<Route, string> = {
  [Route.Board]: "#/",
  [Route.Active]: "#/active",
  [Route.Usage]: "#/usage",
  [Route.Setup]: "#/setup",
};

/** The board with one item's detail open, e.g. `#/open/demo-app%2Fslice-7`; the Active work card links here. */
const OPEN_PREFIX = "#/open/";

export function openItemHash(key: string): string {
  return `${OPEN_PREFIX}${encodeURIComponent(key)}`;
}

/** The item key an address hash asks the board to open, or null. */
export function openKeyOf(hash: string): string | null {
  if (!hash.startsWith(OPEN_PREFIX)) return null;
  try {
    return decodeURIComponent(hash.slice(OPEN_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

/**
 * The "checks with no open slice" drawer of a project opens at the same address as an item, under a key no
 * item can have (item keys never start with this prefix: a check's key is `<slice>/check-N`).
 */
const LOOSE_PREFIX = "loose-checks:";

export function looseChecksKey(projectId: string): string {
  return `${LOOSE_PREFIX}${projectId}`;
}

/** The project a loose-checks key names, or null when the key is an item's. */
export function looseProjectOf(key: string | null): string | null {
  return key !== null && key.startsWith(LOOSE_PREFIX) ? key.slice(LOOSE_PREFIX.length) : null;
}

/** Active work with one item's card expanded, e.g. `#/active/demo-app%2Fslice-7%2Fpart-B`; the slice's follow links go here (Slice 11). */
const ACTIVE_PREFIX = "#/active/";

export function activeItemHash(key: string): string {
  return `${ACTIVE_PREFIX}${encodeURIComponent(key)}`;
}

/** The item key an address hash asks Active work to expand, or null; a key with no card leaves everything closed. */
export function activeKeyOf(hash: string): string | null {
  if (!hash.startsWith(ACTIVE_PREFIX)) return null;
  try {
    return decodeURIComponent(hash.slice(ACTIVE_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

export function routeOf(hash: string): Route {
  if (hash === ROUTE_HASH[Route.Usage]) return Route.Usage;
  if (hash === ROUTE_HASH[Route.Setup]) return Route.Setup;
  if (hash === ROUTE_HASH[Route.Active] || hash.startsWith(ACTIVE_PREFIX)) return Route.Active;
  return Route.Board;
}
