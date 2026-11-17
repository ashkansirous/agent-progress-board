import { CheckCircleIcon, WarningIcon } from "./icons";
import type { StringKey } from "./strings";
import { useView } from "./view";

const REASON_KEYS: Record<number, StringKey> = {
  401: "reason401",
  403: "reason403",
  404: "reason404",
  500: "reason500",
  502: "reason502",
  503: "reason503",
  504: "reason504",
};

/** One skeleton project: a title bar and two tiles side by side (StatesV2). */
function SkeletonBlock() {
  return (
    <div className="skeleton-block" aria-hidden="true">
      <div className="skeleton skeleton-title" />
      <div className="skeleton-pair">
        <div className="skeleton skeleton-tile" />
        <div className="skeleton skeleton-tile" />
      </div>
    </div>
  );
}

/** A bar for the question area, two skeleton projects and "Loading the board…"; shown only after the 500 ms wait. */
export function LoadingCard() {
  const { t } = useView();
  return (
    <section className="state-card" role="status" aria-label={t("loading")}>
      <div className="skeleton skeleton-strip" aria-hidden="true" />
      <SkeletonBlock />
      <SkeletonBlock />
      <p className="state-note">{t("loading")}</p>
    </section>
  );
}

export function EmptyCard() {
  const { t } = useView();
  return (
    <section className="state-card state-center">
      <CheckCircleIcon size={44} stroke="var(--success)" strokeWidth={1.6} />
      <p className="state-title">{t("emptyTitle")}</p>
      <p className="state-body state-body-wide">{t("emptyBody")}</p>
    </section>
  );
}

export function ErrorCard({ status, onRetry }: { status: number | null; onRetry: () => void }) {
  const { t } = useView();
  const reason = t(REASON_KEYS[status ?? 0] ?? "reasonOther");
  const body = status === null ? t("failedNetwork") : t("failedApi", { code: status, reason });
  return (
    <section className="state-card state-center" role="alert">
      <WarningIcon size={44} stroke="var(--danger)" strokeWidth={1.6} />
      <p className="state-title">{t("failedTitle")}</p>
      <p className="state-body state-body-wide">{body}</p>
      <button type="button" className="retry" onClick={onRetry}>
        {t("retry")}
      </button>
    </section>
  );
}
