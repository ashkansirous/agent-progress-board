import { useEffect, useMemo } from "react";
import type { BoardItemDto, BoardResponse } from "../../src/api/boardDto";
import type { ProjectGroups } from "../../src/domain/boardGroups";
import { ItemType } from "../../src/domain/item";
import type { BoardState } from "./boardState";
import { Detail } from "./Detail";
import { Header } from "./Header";
import { opensCardDrawer } from "./cards";
import { LooseChecksDrawer } from "./LooseChecksDrawer";
import { itemsByKey, needsYouItems } from "./model";
import { PhoneNeeds } from "./PhoneNeeds";
import { ProjectGroup } from "./ProjectGroup";
import { looseProjectOf, Route } from "./route";
import { SessionDrawer } from "./SessionDrawer";
import { EmptyCard, ErrorCard, LoadingCard } from "./StatePanels";
import type { Translate } from "./strings";
import { looksFor, paletteVars, type SchemeName } from "./theme";
import { useOpenItem } from "./useRoute";
import { ViewProvider, type View } from "./view";
import { ViewTabs } from "./ViewTabs";

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

/** The slice items by key (a card's `parent_key` names one). */
function sliceItems(items: BoardItemDto[]): Map<string, BoardItemDto> {
  return new Map(items.filter((item) => item.type === ItemType.Slice).map((item) => [item.key, item]));
}

/** The groups come from the Worker: the page draws them as given and never sorts items into lists itself. */
function Groups({ data, phone, onOpen }: { data: BoardResponse; phone: boolean; onOpen: (key: string) => void }) {
  const items = itemsByKey(data.items);
  return (
    <>
      {phone && <PhoneNeeds items={needsYouItems(data.groups, items)} onOpen={onOpen} />}
      {data.groups.map((group) => (
        <ProjectGroup key={group.id} group={group} items={items} onOpen={onOpen} />
      ))}
    </>
  );
}

/** What the address asks to open: an item, a project's loose checks, or nothing on the board. */
type OpenTarget = { loose: ProjectGroups; item?: undefined } | { item: BoardItemDto; loose?: undefined };

function openTarget(data: BoardResponse | null, key: string | null): OpenTarget | null {
  if (!data || key === null) return null;
  const projectId = looseProjectOf(key);
  if (projectId !== null) {
    const group = data.groups.find((g) => g.id === projectId);
    return group && group.loose_checks.length > 0 ? { loose: group } : null;
  }
  const item = data.items.find((candidate) => candidate.key === key);
  return item ? { item } : null;
}

function Body({ props, onOpen }: { props: PageProps; onOpen: (key: string) => void }) {
  const { state, onRefresh } = props;
  if (state.data) {
    return state.data.groups.length === 0 ? <EmptyCard /> : <Groups data={state.data} phone={props.env.phone} onOpen={onOpen} />;
  }
  if (state.slow) return <LoadingCard />;
  if (state.error) return <ErrorCard status={state.error.status} onRetry={onRefresh} />;
  return null;
}

function OpenDrawer({ target, onClose }: { target: OpenTarget; onClose: () => void }) {
  const { item, loose } = target;
  if (loose) return <LooseChecksDrawer projectId={loose.id} checks={loose.loose_checks} onClose={onClose} />;
  if (!item) return null;
  return opensCardDrawer(item) ? <SessionDrawer item={item} onClose={onClose} /> : <Detail item={item} onClose={onClose} />;
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
      slices: sliceItems(state.data?.items ?? []),
    }),
    // The slices follow the data, not only its clock: a refresh with the same server time is not one.
    [env, state.config, state.data?.window_hours, serverTime, state.data?.items],
  );
}

/** The whole board: header, strip, project groups or a state card, and the open item's detail. */
export function BoardPage(props: PageProps) {
  const { state, env, onRefresh } = props;
  const { openKey, open: onOpen, close } = useOpenItem();
  const view = useViewValue(props);
  const open = openTarget(state.data, openKey);
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
        <div className="page board-page" inert={open ? true : undefined}>
          {/* The same bar at the top on the phone as on the desktop (the PhoneV2 mock); the other pages keep the bottom bar. */}
          <ViewTabs current={Route.Board} phone={false} t={env.t} activeCount={state.data?.working_count} />
          <Header
            groups={state.data?.groups ?? null}
            updatedAt={state.updatedAt}
            busy={state.loading && state.slow}
            onRefresh={onRefresh}
          />
          <Body props={props} onOpen={onOpen} />
        </div>
        {open && <OpenDrawer target={open} onClose={close} />}
      </div>
    </ViewProvider>
  );
}
