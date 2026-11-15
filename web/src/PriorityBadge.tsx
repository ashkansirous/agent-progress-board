import type { Priority } from "../../src/domain/item";
import { useView } from "./view";

export type BadgeVariant = "tile" | "detail" | "strip";

/** P0..P3 in the owner's colours; `strip` is the phone strip's outline badge in the strip's own text colour. */
export function PriorityBadge({ priority, variant = "tile" }: { priority: Priority; variant?: BadgeVariant }) {
  const { looks } = useView();
  const colours = looks.priority(priority);
  const style =
    variant === "strip"
      ? { color: "var(--waitingMeta)", borderColor: "var(--waitingMeta)" }
      : { background: colours.bg, color: colours.fg, borderColor: colours.border };
  return (
    <span className={`badge badge-${variant}`} style={style}>
      {priority}
    </span>
  );
}
