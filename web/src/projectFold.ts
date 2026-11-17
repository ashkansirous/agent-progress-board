import { useCallback, useState } from "react";
import type { ProjectGroups } from "../../src/domain/boardGroups";
import { type OpenMap, readOpenMap, resolveOpen } from "./foldRules";

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
 * One project block's open state, derived at render from the group and the stored click (`resolveOpen`), so a
 * question that arrives on a refresh paints open at once. A click keeps the question keys the block showed.
 */
export function useProjectOpen(group: ProjectGroups): [boolean, () => void] {
  const [stored, setStored] = useState(readStored);
  const open = resolveOpen(stored, group);
  const id = group.id;
  const questions = group.needs_you;
  const toggle = useCallback(() => {
    // Re-read storage at click time: every block holds its own copy of the map, so a stale copy would overwrite
    // the other projects' saved choices.
    const current = readStored() ?? stored ?? {};
    const next: OpenMap = { ...current, [id]: { open: !open, questions } };
    storeMap(next);
    setStored(next);
  }, [stored, id, open, questions]);
  return [open, toggle];
}
