import type { BoardResponse } from "../../src/api/boardDto";
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
  return <p className="subtitle">{count === 1 ? t("activeRunningOne", { time }) : t("activeRunning", { n: count, time })}</p>;
}

function Cards({ data }: { data: BoardResponse }) {
  const tasks = activeTasks(data.items);
  const openKey = useActiveKey();
  if (tasks.length === 0) return <ActiveEmptyCard />;
  return (
    <ul className="active-list">
      {tasks.map((item) => (
        // The address decides which card is expanded: the key changes with it, so a card follows a new address.
        <ActiveCard key={`${item.key}|${item.key === openKey}`} item={item} initiallyOpen={item.key === openKey} />
      ))}
    </ul>
  );
}

function Body({ state, onRefresh }: { state: BoardState; onRefresh: () => void }) {
  if (state.data) return <Cards data={state.data} />;
  if (state.slow) return <ActiveLoadingCard />;
  if (state.error) return <ActiveErrorCard status={state.error.status} onRetry={onRefresh} />;
  return null;
}

/** The Active work view: every task an agent is working on now, across projects, with its bar and its steps. */
export function ActivePage({ env }: { env: Environment }) {
  const { state, refresh } = useBoard();
  const view = useViewValue({ state, env });
  const count = state.data ? activeTasks(state.data.items).length : 0;
  return (
    <ViewProvider value={view}>
      <div className={env.phone ? "app phone" : "app"} style={paletteVars(state.config, env.scheme)}>
        <div className="page active-page">
          {!env.phone && <ViewTabs current={Route.Active} phone={false} t={env.t} activeCount={count} />}
          <header className="header">
            <div className="header-text">
              <h1>{env.t("activeTitle")}</h1>
              <Subtitle count={count} updatedAt={state.data ? state.updatedAt : null} />
            </div>
          </header>
          <div aria-busy={state.loading}>
            <Body state={state} onRefresh={refresh} />
          </div>
        </div>
        {env.phone && <ViewTabs current={Route.Active} phone t={env.t} activeCount={count} />}
      </div>
    </ViewProvider>
  );
}
