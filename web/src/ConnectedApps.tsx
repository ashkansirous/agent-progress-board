import { useCallback, useEffect, useState } from "react";
import type { GrantDto } from "../../src/api/grants";
import { endGrant, fetchGrants, LoadError } from "./api";
import { SLOW_AFTER_MS } from "./hooks";
import type { StringKey, Translate } from "./strings";
import { clockTime } from "./time";

const REASON_KEYS: Record<number, StringKey> = {
  401: "reason401",
  403: "reason403",
  404: "reason404",
  500: "reason500",
  502: "reason502",
  503: "reason503",
  504: "reason504",
};

/** "The API answered 503 (service unavailable)." or the unreachable line, from a failed load's status. */
export function failureLine(status: number | null, t: Translate): string {
  if (status === null) return t("setupFailedNetwork");
  return t("setupFailedApi", { code: status, reason: t(REASON_KEYS[status] ?? "reasonOther") });
}

type ListState =
  | { phase: "loading"; slow: boolean }
  | { phase: "ready"; grants: GrantDto[]; truncated: boolean }
  | { phase: "failed"; status: number | null };

/** Loads the owner's grants; the loading state shows only after the 500 ms wait. Ending one removes it from the list. */
function useGrants() {
  const [state, setState] = useState<ListState>({ phase: "loading", slow: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = setTimeout(() => setState((s) => (s.phase === "loading" ? { phase: "loading", slow: true } : s)), SLOW_AFTER_MS);
    fetchGrants(controller.signal)
      .then((body) => setState({ phase: "ready", grants: body.grants, truncated: body.truncated }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ phase: "failed", status: error instanceof LoadError ? error.status : null });
      })
      .finally(() => clearTimeout(slowTimer));
    return () => {
      controller.abort();
      clearTimeout(slowTimer);
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setState({ phase: "loading", slow: false });
    setAttempt((n) => n + 1);
  }, []);
  const remove = useCallback((id: string) => {
    setState((s) => (s.phase === "ready" ? { ...s, grants: s.grants.filter((grant) => grant.id !== id) } : s));
  }, []);
  return { state, retry, remove };
}

/** English is written day-first ("Tue 17 Nov"), as the mock draws it; other languages use their own order. */
const DAY_FIRST_ENGLISH = "en-GB";

/** "Tue 17 Nov, 09:12": weekday, day, month, 24-hour time, in the page's language. */
export function connectedWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  const tag = locale === "en" ? DAY_FIRST_ENGLISH : locale;
  const day = date.toLocaleDateString(tag, { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${clockTime(date)}`;
}

interface RowProps {
  grant: GrantDto;
  locale: string;
  t: Translate;
  onEnded: (id: string) => void;
}

function GrantRow({ grant, locale, t, onEnded }: RowProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const name = grant.client_name || t("grantsUnnamed");
  const end = async () => {
    setBusy(true);
    setFailed(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    try {
      await endGrant(grant.id);
      onEnded(grant.id);
    } catch {
      setBusy(false);
      setFailed(true);
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  };
  return (
    <li className={confirming ? "grant-row grant-row-confirming" : "grant-row"}>
      <div className="grant-line">
        <div className="grant-info">
          <span className="grant-name">{name}</span>
          <span className="grant-when">{t("grantsConnected", { when: connectedWhen(grant.connected_at, locale) })}</span>
        </div>
        {!confirming && (
          <button type="button" className="grant-end" onClick={() => setConfirming(true)}>
            {t("grantsEnd")}
          </button>
        )}
      </div>
      {confirming && (
        <div className="grant-confirm" role="alert">
          <p>
            {t("grantsConfirmBefore")} <strong>{name}</strong>
            {t("grantsConfirmAfter")}
          </p>
          {failed && <p className="grant-failed">{t("grantsEndFailed")}</p>}
          {slow && (
            <p className="setup-muted" role="status">
              {t("grantsEnding")}
            </p>
          )}
          <div className="grant-confirm-actions">
            <button type="button" className="grant-confirm-end" disabled={busy} onClick={end}>
              {t("grantsEnd")}
            </button>
            <button type="button" className="grant-keep" disabled={busy} onClick={() => setConfirming(false)}>
              {t("grantsKeep")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function ListBody({ locale, t }: { locale: string; t: Translate }) {
  const { state, retry, remove } = useGrants();
  if (state.phase === "loading") {
    return state.slow ? (
      <p className="grant-box grant-loading" role="status">
        {t("grantsLoading")}
      </p>
    ) : null;
  }
  if (state.phase === "failed") {
    return (
      <div className="grant-box" role="alert">
        <p>
          {t("grantsFailed")} {failureLine(state.status, t)}
        </p>
        <button type="button" className="setup-primary" onClick={retry}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (state.grants.length === 0) return <p className="grant-box">{t("grantsEmpty")}</p>;
  return (
    <>
      <ul className="grant-list">
        {state.grants.map((grant) => (
          <GrantRow key={grant.id} grant={grant} locale={locale} t={t} onEnded={remove} />
        ))}
      </ul>
      {state.truncated && <p className="setup-muted grant-truncated">{t("grantsTruncated")}</p>}
    </>
  );
}

/** The "Connected apps" card on the Setup page: each app the owner signed in from, with End access (Slice 37). */
export function ConnectedApps({ locale, t }: { locale: string; t: Translate }) {
  return (
    <section className="setup-card-block" aria-labelledby="grants-title">
      <h2 id="grants-title">{t("grantsTitle")}</h2>
      <p className="setup-muted">{t("grantsIntro")}</p>
      <ListBody locale={locale} t={t} />
    </section>
  );
}
