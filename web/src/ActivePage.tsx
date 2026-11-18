import { useMemo, useState } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { ActiveCard } from "./ActiveCard";
import { ActiveEmptyCard, ActiveErrorCard, ActiveLoadingCard } from "./ActiveStates";
import { type Environment, useViewValue } from "./BoardPage";
import type { BoardState } from "./boardState";
import { useBoard } from "./hooks";
import { activeTasks } from "./model";
import { Route } from "./route";
import { paletteVars } from "./theme";
import { clockTime } from "./time";
import { useActiveKey } from "./useRoute";
import { useView, ViewProvider } from "./view";
import { ViewTabs } from "./ViewTabs";

function Subtitle({ count, updatedAt }: { count: number; updatedAt: Date | null }) {
  const { t, phone } = useView();
  if (updatedAt === null) return null;
  const time = clockTime(updatedAt);
  if (!phone) return <p className="subtitle">{t("activeSubtitle", { time })}</p>;
  return <p className="subtitle">{t(t.plural(count, "activeRunningOne", "activeRunning"), { n: count, time })}</p>;
}

/**
 * How many times the address has newly named each card. A card remounts (and so opens) only when the address newly
 * names it; a hash change that leaves it, or names another card, keeps every card's own expand state.
 */
function useAddressGenerations(openKey: string | null): ReadonlyMap<string, number> {
  const [seen, setSeen] = useState<{ last: string | null; counts: ReadonlyMap<string, number> }>({ last: null, counts: new Map() });
  if (openKey !== seen.last) {
    // Adjusting state while rendering (React's "previous renders" pattern): React re-renders at once with the new counts.
    const counts = openKey === null ? seen.counts : new Map(seen.counts).set(openKey, (seen.counts.get(openKey) ?? 0) + 1);
    setSeen({ last: openKey, counts });
  }
  return seen.counts;
}

function Cards({ tasks }: { tasks: BoardItemDto[] }) {
  const openKey = useActiveKey();
  const generations = useAddressGenerations(openKey);
  if (tasks.length === 0) return <ActiveEmptyCard />;
  return (
    <ul className="active-list">
      {tasks.map((item) => (
        <ActiveCard key={`${item.key}|${generations.get(item.key) ?? 0}`} item={item} initiallyOpen={item.key === openKey} />
      ))}
    </ul>
  );
}

function Body({ state, tasks, onRefresh }: { state: BoardState; tasks: BoardItemDto[]; onRefresh: () => void }) {
  if (state.data) return <Cards tasks={tasks} />;
  if (state.slow) return <ActiveLoadingCard />;
  if (state.error) return <ActiveErrorCard status={state.error.status} onRetry={onRefresh} />;
  return null;
}

/** The Active work view: every task an agent is working on now, across projects, with its bar and its steps. */
export function ActivePage({ env }: { env: Environment }) {
  const { state, refresh } = useBoard();
  const view = useViewValue({ state, env });
  const tasks = useMemo(() => (state.data ? activeTasks(state.data.items) : []), [state.data]);
  // The tab pill and the subtitle show the Worker's own count, the one the Board page's tab bar shows.
  const count = state.data?.working_count ?? 0;
  return (
    <ViewProvider value={view}>
      <div className={env.phone ? "app phone" : "app"} style={paletteVars(state.config, env.scheme)}>
        <div className="page active-page">
          {/* The same bar at the top on every page and both layouts (the PhoneV2 and ActiveV3Phone mocks). */}
          <ViewTabs current={Route.Active} phone={false} t={env.t} activeCount={count} />
          <header className="header">
            <div className="header-text">
              <h1>{env.t("activeTitle")}</h1>
              <Subtitle count={count} updatedAt={state.data ? state.updatedAt : null} />
            </div>
          </header>
          <div aria-busy={state.loading}>
            <Body state={state} tasks={tasks} onRefresh={refresh} />
          </div>
        </div>
      </div>
    </ViewProvider>
  );
}
