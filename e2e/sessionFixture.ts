import type { BoardResponse } from "../src/api/boardDto";
import { PLANNING_SEED_ITEMS, SESSION_SEED_ITEMS } from "../scripts/seed-data";
import { boardOfSeeds, demoBoard, itemOf } from "./fixture";

export const WORKING_KEY = "example-app/session-9c1e";
export const WAVE_KEY = "example-app/wave-3";
export const NO_GOAL_KEY = "example-app/session-a71b";
export const QUESTION_KEY = "example-app/session-4f2a";
export const TOOLS_QUESTION_KEY = "tools/session-51e0";
export const STALE_SESSION_KEY = "example-app/session-7b3d";

/** The faked /api/board for the session cards: the mock's made-up projects (Slice 13). */
export function sessionBoard(): BoardResponse {
  return demoBoard(SESSION_SEED_ITEMS.map((seed) => itemOf(seed)));
}

/** The planning board of Slice 14: the session set plus the planning set (slices, checks, bug, problem, done). */
export function planningBoard(): BoardResponse {
  return boardOfSeeds([...SESSION_SEED_ITEMS, ...PLANNING_SEED_ITEMS]);
}
