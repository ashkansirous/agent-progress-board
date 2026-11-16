import { useEffect, useMemo } from "react";
import { BoardPage, type Environment } from "./BoardPage";
import { DARK_QUERY, PHONE_QUERY, useBoard, useMediaQuery } from "./hooks";
import { Route } from "./route";
import { pickLocale, translator } from "./strings";
import { UsagePage } from "./UsagePage";
import { useRoute } from "./useRoute";

/** The page's colour scheme, layout and language, read from the device. */
function useEnvironment(): Environment {
  const phone = useMediaQuery(PHONE_QUERY);
  const dark = useMediaQuery(DARK_QUERY);
  const locale = pickLocale(navigator.language);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return useMemo(() => ({ phone, scheme: dark ? "dark" : "light", locale, t: translator(locale) }), [phone, dark, locale]);
}

function BoardRoute({ env }: { env: Environment }) {
  const { state, refresh } = useBoard();
  return <BoardPage state={state} env={env} onRefresh={refresh} />;
}

export function App() {
  const route = useRoute();
  const env = useEnvironment();
  return route === Route.Usage ? <UsagePage env={env} /> : <BoardRoute env={env} />;
}
