import { useCallback, useMemo, useState } from "react";
import type { BoardResponse } from "../../src/api/boardDto";
import type { BoardState } from "./boardState";
import { Detail } from "./Detail";
import { Header } from "./Header";
import { groupByProject, waitingItems } from "./model";
import { ProjectGroup } from "./ProjectGroup";
import { EmptyCard, ErrorCard, LoadingCard } from "./StatePanels";
import type { Translate } from "./strings";
import { looksFor, paletteVars, type SchemeName } from "./theme";
import { ViewProvider, type View } from "./view";
import { WaitingStrip } from "./WaitingStrip";

export interface Environment {
  phone: boolean;
  scheme: SchemeName;
  t: Translate;
}

interface PageProps {
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

function useViewValue(props: PageProps): View {
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
  const [openKey, setOpenKey] = useState<string | null>(null);
  const close = useCallback(() => setOpenKey(null), []);
  const view = useViewValue(props);
  const open = state.data?.items.find((item) => item.key === openKey);
  // The open item left the data (a refresh dropped it, or a failed refresh cleared the board): forget it.
  if (openKey !== null && !open) setOpenKey(null);
  return (
    <ViewProvider value={view}>
      <div className={env.phone ? "app phone" : "app"} style={paletteVars(state.config, env.scheme)}>
        <div className="page" inert={open ? true : undefined}>
          <Header
            config={state.config}
            hours={state.data?.window_hours ?? null}
            updatedAt={state.updatedAt}
            busy={state.loading && state.slow}
            onRefresh={onRefresh}
          />
          <Body props={props} onOpen={setOpenKey} />
        </div>
        {open && <Detail item={open} onClose={close} />}
      </div>
    </ViewProvider>
  );
}
