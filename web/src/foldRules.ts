import type { ProjectGroups } from "../../src/domain/boardGroups";

/** One stored click: the choice and the question keys the block showed at that moment. */
export interface Choice {
  open: boolean;
  questions: string[];
}

export type OpenMap = Record<string, Choice>;

function isChoice(value: unknown): value is Choice {
  if (typeof value !== "object" || value === null) return false;
  const { open, questions } = value as Partial<Choice>;
  return typeof open === "boolean" && Array.isArray(questions) && questions.every((q) => typeof q === "string");
}

/**
 * The stored choices: `{}` when nothing is stored, null when storage is unreadable or refused (every block
 * then draws expanded, the slice's rule).
 */
export function readOpenMap(read: () => string | null): OpenMap | null {
  try {
    const parsed: unknown = JSON.parse(read() ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isChoice(value)));
  } catch {
    return null;
  }
}

/** A project with no working card, no question and no open finding is quiet: it folds by default (the mock, `renderVals`; Slice 57: an open finding is counted like the other lists). */
export function isQuiet(group: ProjectGroups): boolean {
  return group.summary.working === 0 && group.summary.needs_you === 0 && group.findings.length === 0;
}

/**
 * Whether a project block is open. A click is stored with the question keys the block showed then. A block
 * opens when storage failed, or when it shows a question key the click did not see (a question is never
 * hidden); otherwise it takes the stored choice; with nothing stored, open unless the project is quiet.
 * While the address asks for the questions (`#/needs-you`), a project with a question is open (Slice 47 6d).
 */
export function resolveOpen(stored: OpenMap | null, group: ProjectGroups, showQuestions = false): boolean {
  if (stored === null) return true;
  if (showQuestions && group.needs_you.length > 0) return true;
  const choice = Object.hasOwn(stored, group.id) ? stored[group.id] : undefined;
  if (!choice) return !isQuiet(group);
  if (group.needs_you.some((key) => !choice.questions.includes(key))) return true;
  return choice.open;
}
