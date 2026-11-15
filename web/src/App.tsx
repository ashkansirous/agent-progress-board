import { useEffect, useMemo } from "react";
import { BoardPage, type Environment } from "./BoardPage";
import { DARK_QUERY, PHONE_QUERY, useBoard, useMediaQuery } from "./hooks";
import { pickLocale, translator } from "./strings";

/** The page's colour scheme, layout and language, read from the device. */
function useEnvironment(): Environment {
  const phone = useMediaQuery(PHONE_QUERY);
  const dark = useMediaQuery(DARK_QUERY);
  const locale = pickLocale(navigator.language);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return useMemo(() => ({ phone, scheme: dark ? "dark" : "light", t: translator(locale) }), [phone, dark, locale]);
}

export function App() {
  const { state, refresh } = useBoard();
  const env = useEnvironment();
  return <BoardPage state={state} env={env} onRefresh={refresh} />;
}
