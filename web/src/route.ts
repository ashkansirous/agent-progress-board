/** The views the tab bar switches between; the address hash says which one shows (no server route needed). */
export enum Route {
  Board = "board",
  Usage = "usage",
}

export const ROUTE_HASH: Record<Route, string> = {
  [Route.Board]: "#/",
  [Route.Usage]: "#/usage",
};

export function routeOf(hash: string): Route {
  return hash === ROUTE_HASH[Route.Usage] ? Route.Usage : Route.Board;
}
