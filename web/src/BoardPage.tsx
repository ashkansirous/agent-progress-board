import { useEffect, useMemo } from "react";
import type { BoardResponse } from "../../src/api/boardDto";
import type { BoardState } from "./boardState";
import { Detail } from "./Detail";
import { Header } from "./Header";
import { groupByProject, waitingItems } from "./model";
import { ProjectGroup } from "./ProjectGroup";
import { Route } from "./route";
import { EmptyCard, ErrorCard, LoadingCard } from "./StatePanels";
import type { Translate } from "./strings";
import { looksFor, paletteVars, type SchemeName } from "./theme";
import { useOpenItem } from "./useRoute";
import { ViewProvider, type View } from "./view";
import { ViewTabs } from "./ViewTabs";
import { WaitingStrip } from "./WaitingStrip";

export interface Environment {
  phone: boolean;
  scheme: SchemeName;
  locale: string;
  t: Translate;
}

export interface PageProps {
  state: BoardState;
  env: Environment;
  onRefresh: () => void;
}

function Groups({ data, onOpen }: { data: BoardResponse; onOpen: (key: string) => void }) {
  const groups = groupByProject(data.items, data.config.projects);
  return (
    <>
      <WaitingStrip items={waitingItems(data.items)} onOpen={onOpen} />
      {groups.map((group) => (
        <ProjectGroup key={group.id} group={group} onOpen={onOpen} />
      ))}
    </>
  );
}

function Body({ props, onOpen }: { props: PageProps; onOpen: (key: string) => void }) {
  const { state, onRefresh } = props;
  if (state.data) {
    return state.data.items.length === 0 ? <EmptyCard hours={state.data.window_hours} /> : <Groups data={state.data} onOpen={onOpen} />;
  }
  if (state.slow) return <LoadingCard />;
  if (state.error) return <ErrorCard status={state.error.status} onRetry={onRefresh} />;
  return null;
}

/** The words, colours, layout and "now" the board's components draw with; the Active work page shares it. */
export function useViewValue(props: Pick<PageProps, "state" | "env">): View {
  const { state, env } = props;
  const serverTime = state.data?.server_time;
  return useMemo(
    () => ({
      t: env.t,
      looks: looksFor(state.config, env.scheme),
      phone: env.phone,
      nowMs: serverTime ? Date.parse(serverTime) : 0,
      hours: state.data?.window_hours ?? 0,
      projects: state.config?.projects ?? [],
    }),
    [env, state.config, state.data?.window_hours, serverTime],
  );
}

/** The whole board: header, strip, project groups or a state card, and the open item's detail. */
export function BoardPage(props: PageProps) {
  const { state, env, onRefresh } = props;
  const { openKey, open: onOpen, close } = useOpenItem();
  const view = useViewValue(props);
  const open = state.data?.items.find((item) => item.key === openKey);
  // The detail shows when the address names a key and that item is in the data. The address is
  // cleared when a successful load lacks the item, and when a refresh fails after data was shown
  // (the board drops its data). A first load that fails or is running leaves it.
  const loaded = state.data !== null && state.error === null;
  const gone = state.dataDropped || (loaded && !open);
  useEffect(() => {
    if (openKey !== null && gone) close();
  }, [gone, openKey, close]);
  return (
    <ViewProvider value={view}>
      <div className={env.phone ? "app phone" : "app"} style={paletteVars(state.config, env.scheme)}>
        <div className="page" inert={open ? true : undefined}>
          {!env.phone && <ViewTabs current={Route.Board} phone={false} t={env.t} activeCount={state.data?.working_count} />}
          <Header
            config={state.config}
            hours={state.data?.window_hours ?? null}
            updatedAt={state.updatedAt}
            busy={state.loading && state.slow}
            onRefresh={onRefresh}
          />
          <Body props={props} onOpen={onOpen} />
        </div>
        {env.phone && <ViewTabs current={Route.Board} phone t={env.t} activeCount={state.data?.working_count} />}
        {open && <Detail item={open} onClose={close} />}
      </div>
    </ViewProvider>
  );
}
