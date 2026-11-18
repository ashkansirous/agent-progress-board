import { useCallback, useEffect, useState } from "react";
import type { Environment } from "./BoardPage";
import { ConnectedApps, failureLine } from "./ConnectedApps";
import { fetchChatText, LoadError } from "./api";
import { ArrowIcon } from "./icons";
import { SLOW_AFTER_MS } from "./hooks";
import { Route, ROUTE_HASH } from "./route";
import type { Translate } from "./strings";
import { paletteVars } from "./theme";

const COPIED_SHOWN_MS = 6000;
const FAILED_SHOWN_MS = 6000;
const ICON_SIZE = 16;
const CHECK_STROKE = 2.2;

type TextState =
  | { phase: "loading"; slow: boolean }
  | { phase: "ready"; text: string }
  | { phase: "failed"; status: number | null };

/** What goes in the claude.ai Instructions box: the connector line, a blank line, then the rules (Slice 37). */
export function pasteText(preface: string, text: string): string {
  return `${preface}\n\n${text}`;
}

/** Loads the instruction text; the loading state shows only after the 500 ms wait. */
function useChatText(): { state: TextState; retry: () => void } {
  const [state, setState] = useState<TextState>({ phase: "loading", slow: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = setTimeout(() => setState((s) => (s.phase === "loading" ? { phase: "loading", slow: true } : s)), SLOW_AFTER_MS);
    fetchChatText(controller.signal)
      .then((body) => setState({ phase: "ready", text: pasteText(body.preface, body.text) }))
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
  return { state, retry };
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={CHECK_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** The one Copy for the whole paste; after it the button reads "Copied" and a line says what to do next. */
function CopyButton({ text, t }: { text: string; t: Translate }) {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (result === "idle") return;
    const timer = setTimeout(() => setResult("idle"), result === "copied" ? COPIED_SHOWN_MS : FAILED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [result]);
  const copy = () => {
    try {
      if (!navigator.clipboard?.writeText) {
        setResult("failed");
        return;
      }
      navigator.clipboard.writeText(text).then(
        () => setResult("copied"),
        () => setResult("failed"),
      );
    } catch {
      setResult("failed");
    }
  };
  return (
    <div className="setup-actions">
      <button type="button" className={result === "copied" ? "setup-primary setup-copied" : "setup-primary"} onClick={copy}>
        {result === "copied" ? <CheckIcon /> : <CopyIcon />}
        {result === "copied" ? t("setupCopied") : t("setupCopy")}
      </button>
      {result === "copied" && (
        <p className="setup-muted" role="status">
          {t("setupPasteNext")}
        </p>
      )}
      {result === "failed" && (
        <p className="state-note" role="alert">
          {t("setupCopyFailed")}
        </p>
      )}
    </div>
  );
}

function Body({ state, retry, t }: { state: TextState; retry: () => void; t: Translate }) {
  if (state.phase === "ready") {
    return (
      <section className="setup-card-block" aria-labelledby="setup-block-title">
        <h2 id="setup-block-title">{t("setupBlockTitle")}</h2>
        <p className="setup-note">
          <strong>{t("setupNoteLead")}</strong> {t("setupNoteRest")}
        </p>
        <pre className="setup-block" tabIndex={0}>
          {state.text}
        </pre>
        <CopyButton text={state.text} t={t} />
      </section>
    );
  }
  if (state.phase === "loading") {
    return state.slow ? (
      <section className="state-card" role="status" aria-label={t("setupLoading")}>
        <div className="skeleton skeleton-usage-wide" aria-hidden="true" />
        <p className="state-note">{t("setupLoading")}</p>
      </section>
    ) : null;
  }
  return (
    <section className="state-card state-center" role="alert">
      <p className="state-title">{t("setupFailedTitle")}</p>
      <p className="state-body state-body-wide">{failureLine(state.status, t)}</p>
      <button type="button" className="setup-primary" onClick={retry}>
        {t("retry")}
      </button>
    </section>
  );
}

/** The "Set up a chat" panel: the server's reporting rules, read from the Worker, with a Copy button (Slice 19). */
export function SetupPage({ env }: { env: Environment }) {
  const { state, retry } = useChatText();
  return (
    <div className={env.phone ? "app phone" : "app"} style={paletteVars(null, env.scheme)}>
      <div className="page setup-page">
        <a className="setup-back" href={ROUTE_HASH[Route.Board]}>
          <span className="setup-back-arrow">
            <ArrowIcon size={ICON_SIZE} stroke="var(--link)" />
          </span>
          {env.t("setupBack")}
        </a>
        <header className="setup-header">
          <h1>{env.t("setupTitle")}</h1>
          <p className="setup-muted">{env.t("setupIntro")}</p>
        </header>
        <div aria-busy={state.phase === "loading"}>
          <Body state={state} retry={retry} t={env.t} />
        </div>
        <ConnectedApps locale={env.locale} t={env.t} />
      </div>
    </div>
  );
}
