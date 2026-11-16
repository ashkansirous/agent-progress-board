import { UsageIcon, WarningIcon } from "./icons";
import type { StringKey } from "./strings";
import { useUsageView } from "./usageView";

const REASON_KEYS: Record<number, StringKey> = {
  401: "reason401",
  403: "reason403",
  404: "reason404",
  500: "reason500",
  502: "reason502",
  503: "reason503",
  504: "reason504",
};

/** Three tile blocks, two chart blocks and "Loading usage…"; shown only after the 500 ms wait. */
export function UsageLoadingCard() {
  const { t } = useUsageView();
  return (
    <section className="state-card" role="status" aria-label={t("usageLoading")}>
      <div className="usage-skeleton-tiles" aria-hidden="true">
        <div className="skeleton skeleton-usage-tile" />
        <div className="skeleton skeleton-usage-tile" />
        <div className="skeleton skeleton-usage-tile" />
      </div>
      <div className="skeleton skeleton-usage-wide" aria-hidden="true" />
      <div className="skeleton skeleton-usage-short" aria-hidden="true" />
      <p className="state-note">{t("usageLoading")}</p>
    </section>
  );
}

export function UsageEmptyCard() {
  const { t } = useUsageView();
  return (
    <section className="state-card state-center">
      <UsageIcon size={44} stroke="var(--muted)" strokeWidth={1.6} />
      <p className="state-title">{t("usageEmptyTitle")}</p>
      <p className="state-body state-body-wide">{t("usageEmptyBody")}</p>
    </section>
  );
}

export function UsageErrorCard({ status, onRetry }: { status: number | null; onRetry: () => void }) {
  const { t } = useUsageView();
  const reason = t(REASON_KEYS[status ?? 0] ?? "reasonOther");
  const body = status === null ? t("usageFailedNetwork") : t("usageFailedApi", { code: status, reason });
  return (
    <section className="state-card state-center" role="alert">
      <WarningIcon size={44} stroke="var(--danger)" strokeWidth={1.6} />
      <p className="state-title">{t("usageFailedTitle")}</p>
      <p className="state-body state-body-wide">{body}</p>
      <button type="button" className="retry" onClick={onRetry}>
        {t("retry")}
      </button>
    </section>
  );
}
