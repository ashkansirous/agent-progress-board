import { useEffect, useMemo } from "react";
import { ActivePage } from "./ActivePage";
import { BoardPage, type Environment } from "./BoardPage";
import { DARK_QUERY, PHONE_QUERY, useBoard, useMediaQuery } from "./hooks";
import { Route } from "./route";
import { SetupPage } from "./SetupPage";
import { translator } from "./strings";
import { UsagePage } from "./UsagePage";
import { useRoute } from "./useRoute";

/** The page is English only. */
const PAGE_LOCALE = "en";

/** The page's colour scheme and layout, read from the device. */
function useEnvironment(): Environment {
  const phone = useMediaQuery(PHONE_QUERY);
  const dark = useMediaQuery(DARK_QUERY);
  useEffect(() => {
    document.documentElement.lang = PAGE_LOCALE;
  }, []);
  return useMemo(() => ({ phone, scheme: dark ? "dark" : "light", locale: PAGE_LOCALE, t: translator() }), [phone, dark]);
}

function BoardRoute({ env }: { env: Environment }) {
  const { state, refresh } = useBoard();
  return <BoardPage state={state} env={env} onRefresh={refresh} />;
}

export function App() {
  const route = useRoute();
  const env = useEnvironment();
  if (route === Route.Usage) return <UsagePage env={env} />;
  if (route === Route.Setup) return <SetupPage env={env} />;
  if (route === Route.Active) return <ActivePage env={env} />;
  return <BoardRoute env={env} />;
}
