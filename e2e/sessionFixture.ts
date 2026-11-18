import type { BoardItemDto, BoardResponse } from "../src/api/boardDto";
import { PLANNING_SEED_ITEMS, SESSION_SEED_ITEMS, type SeedItem } from "../scripts/seed-data";
import { boardOfSeeds, demoBoard, itemOf } from "./fixture";

export const WORKING_KEY = "example-app/session-9c1e";
export const SLICE_CARD_KEY = "example-app/session-3e8c";
export const QUESTION_KEY = "example-app/session-4f2a";
export const TOOLS_QUESTION_KEY = "tools/session-51e0";
export const STALE_SESSION_KEY = "example-app/session-7b3d";

/** The faked /api/board for the session cards: the mock's made-up projects (Slice 13). */
export function sessionBoard(): BoardResponse {
  return demoBoard(SESSION_SEED_ITEMS.map((seed) => withOutcome(itemOf(seed), seed)));
}

/** The shared item builder leaves `outcome` out (Slice 41): a session card carries the seed's own. */
function withOutcome(item: BoardItemDto, seed: SeedItem): BoardItemDto {
  return { ...item, outcome: seed.outcome ?? null };
}

/** The planning board of Slice 14: the session set plus the planning set (slices, checks, bug, problem, done). */
export function planningBoard(): BoardResponse {
  return boardOfSeeds([...SESSION_SEED_ITEMS, ...PLANNING_SEED_ITEMS]);
}
