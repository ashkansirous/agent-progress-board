import type { CSSProperties } from "react";
import { type Step, StepState } from "../../src/domain/stepTypes";
import type { Translate } from "./strings";
import { stepWords } from "./stepsText";

/** Where a bar draws its colours: the card's own palette roles, or the type's colours on a tile and in a drawer. */
export type BarVariant = "card" | "tile" | "drawer";

interface BarProps {
  steps: Step[];
  variant: BarVariant;
  /** The task is done: every segment reads done, whatever the list says. */
  finished: boolean;
  /** The type's colours for a tile or drawer bar (done = fg, active = border). */
  type?: { fg: string; border: string };
}

/** One equal segment per step: done, active or pending. Hidden from assistive tech; the text beside it carries the numbers. */
export function StepBar({ steps, variant, finished, type }: BarProps) {
  const style = type ? ({ "--seg-done": type.fg, "--seg-active": type.border } as CSSProperties) : undefined;
  return (
    <span className={`step-bar step-bar-${variant}`} aria-hidden="true" style={style}>
      {steps.map((step, index) => (
        // The list is replaced whole on every report, so the position is its identity.
        <span key={index} className={`seg seg-${finished ? StepState.Done : step.state}`} />
      ))}
    </span>
  );
}

interface RowsProps {
  steps: Step[];
  finished: boolean;
  t: Translate;
  /** The Active work card shows each step's note under its label; the drawer does not. */
  notes: boolean;
  label: string;
}

/** The full list: a numbered circle, the label (and note) and the state word, one row per step. */
export function StepRows({ steps, finished, t, notes, label }: RowsProps) {
  const words = stepWords(steps, finished);
  return (
    <ol className="step-rows" aria-label={label}>
      {steps.map((step, index) => {
        const word = words[index]!;
        return (
          <li key={index} className={`step-row step-row-${word.state}`} aria-current={word.state === StepState.Active ? "step" : undefined}>
            <span className="step-mark">{index + 1}</span>
            <span className="step-text">
              <span className="step-label">{step.label}</span>
              {notes && step.note && <span className="step-note">{step.note}</span>}
            </span>
            <span className="step-state">{t(word.key)}</span>
          </li>
        );
      })}
    </ol>
  );
}
