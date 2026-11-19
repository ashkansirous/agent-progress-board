import type { BoardItemDto } from "../../src/api/boardDto";
import { QuestionCard } from "./SessionCards";
import { NEEDS_YOU_ATTRIBUTE } from "./route";
import { useView } from "./view";

interface PhoneNeedsProps {
  /** Every open question and waiting item of every project, questions first (the order the phone shows them in). */
  items: BoardItemDto[];
  onOpen: (key: string) => void;
}

/** The phone's "Needs you · {total}" above the projects: the cards of all projects, so nothing waits inside a folded block. */
export function PhoneNeeds({ items, onOpen }: PhoneNeedsProps) {
  const { t } = useView();
  if (items.length === 0) return null;
  const heading = t("needsYouN", { n: items.length });
  return (
    <section className="questions questions-top" aria-label={heading} {...{ [NEEDS_YOU_ATTRIBUTE]: "" }}>
      <h2>{heading}</h2>
      {items.map((item) => <QuestionCard key={item.key} item={item} onOpen={onOpen} />)}
    </section>
  );
}
