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
import { pruneIdsOf, pruneStoredFolds } from "./projectFold";
import { Route } from "./route";
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
function Groups({ data, phone, openers }: { data: BoardResponse; phone: boolean; openers: Openers }) {
  const items = itemsByKey(data.items);
  const { onOpen, onOpenLoose } = openers;
  return (
    <>
      {phone && <PhoneNeeds items={needsYouItems(data.groups, items)} onOpen={onOpen} />}
      {data.groups.map((group) => (
        <ProjectGroup key={group.id} group={group} items={items} onOpen={onOpen} onOpenLoose={onOpenLoose} />
      ))}
    </>
  );
}

interface Openers {
  onOpen: (key: string) => void;
  onOpenLoose: (projectId: string) => void;
}

/** What the address asks to open: an item, a project's loose checks, or nothing on the board. */
type OpenTarget = { loose: ProjectGroups; item?: undefined } | { item: BoardItemDto; loose?: undefined };

/** The address as the page reads it: an item key, a project's loose checks, or neither. */
export interface OpenAddress {
  openKey: string | null;
  looseProject: string | null;
}

function openTarget(data: BoardResponse | null, address: OpenAddress): OpenTarget | null {
  if (!data) return null;
  if (address.looseProject !== null) {
    const group = data.groups.find((g) => g.id === address.looseProject);
    return group && group.loose_checks.length > 0 ? { loose: group } : null;
  }
  if (address.openKey === null) return null;
  const item = data.items.find((candidate) => candidate.key === address.openKey);
  return item ? { item } : null;
}

function Body({ props, openers }: { props: PageProps; openers: Openers }) {
  const { state, onRefresh } = props;
  if (state.data) {
    return state.data.groups.length === 0 ? <EmptyCard /> : <Groups data={state.data} phone={props.env.phone} openers={openers} />;
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
  const { openKey, looseProject, open: onOpen, openLoose: onOpenLoose, close } = useOpenItem();
  const view = useViewValue(props);
  const open = openTarget(state.data, { openKey, looseProject });
  // The detail shows when the address names a key and that item is in the data. The address is cleared only
  // when a successful load lacks the item. A failed load (first or refresh) keeps it: the board shows its
  // error card meanwhile, and Retry opens the item again.
  // Only a settled load counts: cached data during a reload may be older than the item the owner just opened.
  const loaded = state.data !== null && state.error === null && !state.loading;
  const named = openKey !== null || looseProject !== null;
  const gone = loaded && !open;
  useEffect(() => {
    if (named && gone) close();
  }, [gone, named, close]);
  const groupIds = state.data?.groups.map((g) => g.id).join("\n");
  useEffect(() => {
    // Only a loaded board with projects prunes: an empty or failed board (no data) keeps every stored choice.
    const ids = pruneIdsOf(groupIds);
    if (ids) pruneStoredFolds(ids);
  }, [groupIds]);
  const openers: Openers = { onOpen, onOpenLoose };
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
          <Body props={props} openers={openers} />
        </div>
        {open && <OpenDrawer target={open} onClose={close} />}
      </div>
    </ViewProvider>
  );
}
