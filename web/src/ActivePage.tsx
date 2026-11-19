import { useMemo, useState } from "react";
import type { BoardItemDto } from "../../src/api/boardDto";
import { ActiveCard } from "./ActiveCard";
import { ActiveEmptyCard, ActiveErrorCard, ActiveLoadingCard } from "./ActiveStates";
import { type Environment, useViewValue } from "./BoardPage";
import type { BoardState } from "./boardState";
import { useBoard } from "./hooks";
import { activeTasks, boardTotals } from "./model";
import { NEEDS_YOU_HASH, Route } from "./route";
import { paletteVars } from "./theme";
import { clockTime } from "./time";
import { useActiveKey } from "./useRoute";
import { useView, ViewProvider } from "./view";
import { ViewTabs } from "./ViewTabs";

/** The two lines under the title (ActiveV3 lines 32 and 33): what the page lists, and what it leaves out. */
function Subtitle({ updatedAt }: { updatedAt: Date | null }) {
  const { t } = useView();
  if (updatedAt === null) return null;
  return (
    <>
      <p className="subtitle">{t("activeSubtitle", { time: clockTime(updatedAt) })}</p>
      <p className="subtitle">{t("activeNoChats")}</p>
    </>
  );
}

/** The link to the board's "Needs you" section; absent when no question is open (ActiveV3 line 36). */
function WaitingLink({ questions }: { questions: number }) {
  const { t } = useView();
  if (questions === 0) return null;
  const text = t(t.plural(questions, "questionsWaitingOne", "questionsWaiting"), { n: questions });
  return (
    <a className="waiting-link" href={NEEDS_YOU_HASH}>
      {text}
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </a>
  );
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
          <ViewTabs current={Route.Active} t={env.t} activeCount={count} />
          <header className="header">
            <div className="header-text">
              <h1>{env.t("activeTitle")}</h1>
              <Subtitle updatedAt={state.data ? state.updatedAt : null} />
            </div>
          </header>
          <WaitingLink questions={state.data ? boardTotals(state.data.groups).needsYou : 0} />
          <div aria-busy={state.loading}>
            <Body state={state} tasks={tasks} onRefresh={refresh} />
          </div>
        </div>
      </div>
    </ViewProvider>
  );
}
