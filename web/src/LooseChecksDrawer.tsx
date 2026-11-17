import type { CheckView } from "../../src/domain/checks";
import { ChecksList } from "./ChecksView";
import { useDialogFocus } from "./Detail";
import { CloseIcon } from "./icons";
import { projectLabel } from "./model";
import { looseLine } from "./planningText";
import { useView } from "./view";

interface LooseProps {
  projectId: string;
  checks: CheckView[];
  onClose: () => void;
}

/** The checks whose slice is closed, listed as in a slice's drawer; they have no card, so this opens from the dashed card. */
export function LooseChecksDrawer({ projectId, checks, onClose }: LooseProps) {
  const { t, phone, projects } = useView();
  const closeRef = useDialogFocus(onClose);
  return (
    <div className="overlay">
      <button type="button" className="scrim card-scrim" aria-label={t("closeDetails")} tabIndex={-1} onClick={onClose} />
      <aside className={phone ? "card-drawer card-drawer-phone" : "card-drawer"} role="dialog" aria-modal="true" aria-label={looseLine(checks.length, t)}>
        <div className="drawer-top">
          <span className="kicker kicker-other">{t("checksKicker")}</span>
          <span className="drawer-project">{projectLabel(projectId, projects)}</span>
          <button type="button" className="icon-button close-button" aria-label={t("close")} onClick={onClose} ref={closeRef}>
            <CloseIcon size={16} stroke="currentColor" />
          </button>
        </div>
        <div className="drawer-heading">
          <h2>{looseLine(checks.length, t)}</h2>
          <span className="drawer-purpose">{t("looseChecksNote")}</span>
        </div>
        <ChecksList heading={t("drawerChecksHead", { n: checks.length })} checks={checks} />
      </aside>
    </div>
  );
}
