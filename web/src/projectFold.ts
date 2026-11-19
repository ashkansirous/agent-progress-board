import { useCallback, useState } from "react";
import type { ProjectGroups } from "../../src/domain/boardGroups";
import { type OpenMap, readOpenMap, resolveOpen } from "./foldRules";
import { NEEDS_YOU_HASH } from "./route";
import { useAddressHash } from "./useRoute";

/** The viewer's fold choices, one object in localStorage: project id to "open" (true) or "folded" (false). */
export const FOLD_STORAGE_KEY = "board.projectOpen";

function readStored() {
  return readOpenMap(() => window.localStorage.getItem(FOLD_STORAGE_KEY));
}

function storeMap(map: OpenMap): void {
  try {
    window.localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage is a convenience: when it fails the choice only lasts until reload.
  }
}

/**
 * The project ids a key made with `JSON.stringify(ids)` holds, or null when there is nothing to prune by: no answer, a
 * failed load or an empty board. JSON, not a joined string, so an id holding any character stays one id (Slice 47 1n).
 */
export function pruneIdsOf(encoded: string | undefined): string[] | null {
  if (!encoded) return null;
  const ids: unknown = JSON.parse(encoded);
  return Array.isArray(ids) && ids.length > 0 ? ids.filter((id): id is string => typeof id === "string") : null;
}

/** The stored map without the projects the board no longer has; the same object when nothing was dropped. */
export function prunedMap(map: OpenMap, ids: readonly string[]): OpenMap {
  const keep = new Set(ids);
  const kept = Object.entries(map).filter(([id]) => keep.has(id));
  return kept.length === Object.keys(map).length ? map : Object.fromEntries(kept);
}

/** Drops the stored choices of projects that left the board, so the map does not grow for ever. Nothing when the board is empty. */
export function pruneStoredFolds(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const current = readStored();
  if (!current) return;
  const next = prunedMap(current, ids);
  if (next !== current) storeMap(next);
}

/**
 * One project block's open state, derived at render from the group and the stored click (`resolveOpen`), so a
 * question that arrives on a refresh paints open at once. A click keeps the question keys the block showed.
 */
export function useProjectOpen(group: ProjectGroups): [boolean, () => void] {
  const [stored, setStored] = useState(readStored);
  const onAddress = useAddressHash() === NEEDS_YOU_HASH;
  // A fold click ends the forcing for this block only, until the owner leaves the address; the address stays, so the
  // other projects with a question stay open (Slice 47 6d, review #5).
  const [released, setReleased] = useState(false);
  if (!onAddress && released) setReleased(false);
  const showQuestions = onAddress && !released;
  const open = resolveOpen(stored, group, showQuestions);
  const id = group.id;
  const questions = group.needs_you;
  const toggle = useCallback(() => {
    // Re-read storage at click time: every block holds its own copy of the map, so a stale copy would overwrite
    // the other projects' saved choices.
    const current = readStored() ?? stored ?? {};
    const next: OpenMap = { ...current, [id]: { open: !open, questions } };
    storeMap(next);
    setStored(next);
    if (showQuestions) setReleased(true);
  }, [stored, id, open, questions, showQuestions]);
  return [open, toggle];
}
