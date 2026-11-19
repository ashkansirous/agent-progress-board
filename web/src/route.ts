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
 * The "checks with no open slice" drawer of a project has its own address, `#/loose/<project>`, so it never
 * shares the item address `#/open/<key>` (item keys are free strings: any key prefix could be a real item's).
 */
const LOOSE_PREFIX = "#/loose/";

export function looseChecksHash(projectId: string): string {
  return `${LOOSE_PREFIX}${encodeURIComponent(projectId)}`;
}

/** The project whose loose-checks drawer an address hash asks for, or null. */
export function looseProjectOf(hash: string): string | null {
  if (!hash.startsWith(LOOSE_PREFIX)) return null;
  try {
    return decodeURIComponent(hash.slice(LOOSE_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

/** The board, scrolled to its first "Needs you" section (the Active work page's waiting-questions link). `routeOf` reads it as the board. */
export const NEEDS_YOU_HASH = "#/needs-you";
/** The attribute that marks a "Needs you" section, so the link can scroll to the first one. */
export const NEEDS_YOU_ATTRIBUTE = "data-needs-you";

/** True for an address that opens a drawer on the board (an item's, or a project's loose checks). */
export function isDrawerHash(hash: string): boolean {
  // The same reading as the drawer itself: `#/open/` with no key names nothing, so it is no drawer (Slice 47 1p).
  return openKeyOf(hash) !== null || looseProjectOf(hash) !== null;
}

/** The hash part of a full URL ("" when it has none); `hashchange` events carry full URLs. */
export function hashOfUrl(url: string): string {
  const at = url.indexOf("#");
  return at < 0 ? "" : url.slice(at);
}

/** Where closing a drawer goes: the page it was opened from, else the board. The open item's own address stays `#/open/<key>`. */
export function closeHashFor(origin: string | null): string {
  return origin !== null && origin !== "" && !isDrawerHash(origin) ? origin : ROUTE_HASH[Route.Board];
}

/** What to remember as "opened from" after the address moved: the old page when a drawer just opened, nothing once it closed, else unchanged. */
export function nextOrigin(origin: string | null, fromHash: string, toHash: string): string | null {
  if (!isDrawerHash(toHash)) return null;
  return isDrawerHash(fromHash) ? origin : fromHash;
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
