import { useId } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { type CheckView, countedChecks, isCountedCheck } from "../../src/domain/checks";
import { ItemStatus } from "../../src/domain/item";
import { PartState } from "../../src/domain/parts";
import { useView } from "./view";

/** The checks not tried on a device: an empty box and the line each; nothing at all when there are none. */
export function ChecksList({ heading, checks }: { heading: string; checks: CheckView[] }) {
  const { t } = useView();
  const headingId = useId();
  if (checks.length === 0) return null;
  return (
    <div className="drawer-section checks-section">
      <h3 id={headingId}>{heading}</h3>
      <ul className="check-rows" aria-labelledby={headingId}>
        {checks.map((check) => (
          <li key={check.key} className={isCountedCheck(check.status) ? "check-row" : "check-row check-row-stale"}>
            <span className="check-box" aria-hidden="true" />
            <span className="check-label">{check.title}</span>
            {!isCountedCheck(check.status) && <span className="check-state">{checkStateWord(check.status, t)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATE_CLASS: Record<PartState, string> = {
  [PartState.Done]: "check-row-done",
  [PartState.Active]: "check-row-active",
  [PartState.Stale]: "check-row-stale",
  [PartState.Blocked]: "check-row-stale",
  [PartState.Pending]: "check-row-later",
};

/** The slice's parts as a checklist: a filled box for done, the working one in the slice colour, a stale one dashed and muted, later ones empty. */
export function PartChecklist({ item, own }: { item: BoardItemDto; own: boolean }) {
  const { t } = useView();
  const headingId = useId();
  const parts = item.parts;
  const progress = item.parts_progress;
  if (!parts || !progress) return null;
  const number = item.slice?.number ?? null;
  const params = { n: progress.done, m: progress.total };
  const heading = own
    ? t("drawerPartsHead", params)
    : number === null
      ? t("drawerSlicePartsHeadPlain", params)
      : t("drawerSlicePartsHead", { ...params, number });
  return (
    <div className="drawer-section checks-section">
      <h3 id={headingId}>{heading}</h3>
      <ul className="check-rows" aria-labelledby={headingId}>
        {parts.map((part) => (
          <li
            key={part.key}
            className={`check-row ${STATE_CLASS[part.state]}`}
            aria-current={part.state === PartState.Active ? "step" : undefined}
          >
            <span className="check-box" aria-hidden="true">
              {part.state === PartState.Done && "✓"}
            </span>
            <span className="check-label">{t("partRowLabel", { letter: part.letter, title: part.title })}</span>
            <span className="check-state">{stateWord(part.state, t)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function checkStateWord(status: ItemStatus, t: ReturnType<typeof useView>["t"]): string {
  return status === ItemStatus.Blocked ? t("statusBlocked") : t("statusStale");
}

function stateWord(state: PartState, t: ReturnType<typeof useView>["t"]): string {
  if (state === PartState.Done) return t("partDone");
  if (state === PartState.Active) return t("stateWorkingNow");
  if (state === PartState.Blocked) return t("statusBlocked");
  return state === PartState.Stale ? t("statusStale") : "";
}

/** A slice's checks heading: "Checks not tried on a device · 3", or with the slice number on a card that points at it. */
export function SliceChecks({ item, own }: { item: BoardItemDto; own: boolean }) {
  const { t } = useView();
  const checks = item.checks ?? [];
  const number = item.slice?.number ?? null;
  const params = { n: countedChecks(checks) };
  const heading = own
    ? t("drawerChecksHead", params)
    : number === null
      ? t("drawerSliceChecksHeadPlain", params)
      : t("drawerSliceChecksHead", { ...params, number });
  return <ChecksList heading={heading} checks={checks} />;
}

/**
 * Under a working card's steps: the parts and the checks of the slice it names with `parent_key`
 * ("Slice 12 parts · 2 of 5 done"). Nothing when the key names no slice on the board.
 */
export function SliceOfCard({ item }: { item: BoardItemDto }) {
  const { slices } = useView();
  const slice = item.parent_key ? slices.get(item.parent_key) : undefined;
  if (!slice || slice.key === item.key) return null;
  return (
    <>
      <PartChecklist item={slice} own={false} />
      <SliceChecks item={slice} own={false} />
    </>
  );
}
