import { useCallback, useEffect, useState } from "react";
import type { ChatTextResponse } from "../../src/api/chatText";
import type { Environment } from "./BoardPage";
import { REQUEST_TIMEOUT_MS } from "./api";
import { SLOW_AFTER_MS } from "./hooks";
import { Route, ROUTE_HASH } from "./route";
import type { StringKey, Translate } from "./strings";
import { paletteVars } from "./theme";

export const CHAT_TEXT_URL = "/api/chat-text";
const COPIED_SHOWN_MS = 2000;
const FAILED_SHOWN_MS = 6000;

const REASON_KEYS: Record<number, StringKey> = {
  401: "reason401",
  403: "reason403",
  404: "reason404",
  500: "reason500",
  502: "reason502",
  503: "reason503",
  504: "reason504",
};

type TextState =
  | { phase: "loading"; slow: boolean }
  | { phase: "ready"; text: string; preface: string }
  | { phase: "failed"; status: number | null };

async function fetchChatText(signal: AbortSignal): Promise<ChatTextResponse> {
  const response = await fetch(CHAT_TEXT_URL, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
  if (!response.ok) throw response.status;
  const body = (await response.json()) as Partial<ChatTextResponse> | null;
  if (typeof body?.text !== "string" || body.text === "") throw new TypeError("chat text response has no text");
  if (typeof body.preface !== "string" || body.preface === "") throw new TypeError("chat text response has no preface");
  return { text: body.text, preface: body.preface };
}

/** Loads the instruction text; the loading state shows only after the 500 ms wait. */
function useChatText(): { state: TextState; retry: () => void } {
  const [state, setState] = useState<TextState>({ phase: "loading", slow: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = setTimeout(() => setState((s) => (s.phase === "loading" ? { phase: "loading", slow: true } : s)), SLOW_AFTER_MS);
    fetchChatText(controller.signal)
      .then((body) => setState({ phase: "ready", text: body.text, preface: body.preface }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ phase: "failed", status: typeof error === "number" ? error : null });
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

function CopyButton({ text, label, t }: { text: string; label: StringKey; t: Translate }) {
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
    <>
      <button type="button" className="setup-copy" onClick={copy}>
        {result === "copied" ? t("setupCopied") : t(label)}
      </button>
      {result === "failed" && (
        <p className="state-note" role="alert">
          {t("setupCopyFailed")}
        </p>
      )}
    </>
  );
}

function Body({ state, retry, t }: { state: TextState; retry: () => void; t: Translate }) {
  if (state.phase === "ready") {
    return (
      <section className="state-card setup-card">
        <p className="setup-intro">{t("setupIntro")}</p>
        <textarea className="setup-text" aria-label={t("setupTextLabel")} readOnly rows={16} value={state.text} />
        <div className="setup-actions">
          <CopyButton text={state.text} label="setupCopy" t={t} />
        </div>
        <p className="setup-intro">{t("setupPrefaceIntro")}</p>
        <p className="setup-preface">{state.preface}</p>
        <div className="setup-actions">
          <CopyButton text={state.preface}label="setupCopyPreface" t={t} />
        </div>
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
  const reason = t(REASON_KEYS[state.status ?? 0] ?? "reasonOther");
  const body = state.status === null ? t("setupFailedNetwork") : t("setupFailedApi", { code: state.status, reason });
  return (
    <section className="state-card state-center" role="alert">
      <p className="state-title">{t("setupFailedTitle")}</p>
      <p className="state-body state-body-wide">{body}</p>
      <button type="button" className="setup-copy" onClick={retry}>
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
        <header className="header">
          <div className="header-text">
            <h1>{env.t("setupTitle")}</h1>
            <p className="subtitle">
              <a href={ROUTE_HASH[Route.Board]}>{env.t("setupBack")}</a>
            </p>
          </div>
        </header>
        <div aria-busy={state.phase === "loading"}>
          <Body state={state} retry={retry} t={env.t} />
        </div>
      </div>
    </div>
  );
}
