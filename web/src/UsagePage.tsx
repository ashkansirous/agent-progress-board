import { useMemo, useState } from "react";
import type { UsagePageResponse } from "../../src/api/usageDto";
import { offsetForZone, UsageRange } from "../../src/domain/usage";
import { AgentKindCost } from "./AgentKindCost";
import type { Environment } from "./BoardPage";
import { CapCostSection } from "./CapCostSection";
import { CapLine } from "./CapLine";
import { CapTiles, PhoneCapCard } from "./CapTiles";
import { Route } from "./route";
import { SourcesSection } from "./SourcesSection";
import { TaskCost } from "./TaskCost";
import { TokenChart } from "./TokenChart";
import { paletteVars } from "./theme";
import { EnvironmentFilter, PlanPicker, RangeSwitch } from "./UsageControls";
import { UsageEmptyCard, UsageErrorCard, UsageLoadingCard } from "./UsageStates";
import { clockTime } from "./time";
import { viewerOffsetAt, viewerOffsetMinutes } from "./usageApi";
import type { UsageParams } from "./usageQuery";
import type { UsageControls } from "./usageState";
import { useUsageView, UsageViewProvider, type UsageView } from "./usageView";
import { useUsage } from "./useUsage";
import { useBoardSnapshot } from "./hooks";
import { ViewTabs } from "./ViewTabs";

interface HeaderProps {
  controls: UsageControls | null;
  params: UsageParams;
  shownPlan: string | null;
  updatedAt: Date | null;
  onChange: (params: UsageParams) => void;
}

function UsageHeader({ controls, params, shownPlan, updatedAt, onChange }: HeaderProps) {
  const { t, phone } = useUsageView();
  const subtitle = [t("usageSubtitle"), updatedAt ? t("usageUpdated", { time: clockTime(updatedAt) }) : null].filter(Boolean).join(" · ");
  const plan = (
    <PlanPicker plans={controls?.plans ?? []} value={shownPlan} onChange={(value) => onChange({ ...params, plan: value })} />
  );
  const range = <RangeSwitch value={params.range} onChange={(value) => onChange({ ...params, range: value })} />;
  const environment = (
    <EnvironmentFilter
      environments={controls?.environments ?? []}
      value={params.environment}
      onChange={(value) => onChange({ ...params, environment: value })}
    />
  );
  if (phone) {
    return (
      <header className="header usage-header">
        <div className="usage-title-row">
          <h1>{t("usageTitle")}</h1>
          {plan}
        </div>
        {range}
        {environment}
      </header>
    );
  }
  return (
    <header className="header usage-header">
      <div className="header-text">
        <h1>{t("usageTitle")}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="usage-controls">
        {range}
        {environment}
        {plan}
      </div>
    </header>
  );
}

/** Nothing to draw: no tokens and no cap reading, accepted or dropped, in the range. */
function hasNothing(data: UsagePageResponse): boolean {
  const lines = [data.cap.weekly, data.cap.short];
  const readings = lines.some((line) => line.windows.length > 0 || line.dropped.length > 0);
  return data.totals_by_token_kind.total === 0 && !readings;
}

function Sections({ data }: { data: UsagePageResponse }) {
  const { phone } = useUsageView();
  return (
    <>
      {phone ? <PhoneCapCard data={data} /> : <CapTiles data={data} />}
      <CapLine data={data} />
      <TokenChart data={data} />
      <CapCostSection data={data} />
      <SourcesSection data={data} />
      <div className="cost-row">
        <TaskCost data={data} />
        <AgentKindCost data={data} />
      </div>
    </>
  );
}

interface BodyProps {
  state: ReturnType<typeof useUsage>["state"];
  retry: () => void;
}

function Body({ state, retry }: BodyProps) {
  if (state.data) return hasNothing(state.data) ? <UsageEmptyCard /> : <Sections data={state.data} />;
  if (state.slow) return <UsageLoadingCard />;
  if (state.error) return <UsageErrorCard status={state.error.status} onRetry={retry} />;
  return null;
}

/** The usage view: header and filters, the cap tiles, the cap line, tokens per day and cost per task. */
export function UsagePage({ env }: { env: Environment }) {
  const [params, setParams] = useState<UsageParams>({ range: UsageRange.Window, plan: null, environment: null });
  const { state, retry } = useUsage(params);
  // The tab bar's Active work count comes from the shared board's last answer (read once, never polled from here); a failed read just leaves the pill out.
  const activeCount = useBoardSnapshot().data?.working_count;
  const answered = state.data !== null;
  const zone = state.data?.time_zone ?? null;
  const fixedMinutes = state.data?.utc_offset_minutes ?? viewerOffsetMinutes();
  const view: UsageView = useMemo(
    () => {
      // The zone the Worker bucketed by, so the bars and every label agree; before the first answer, the viewer's own.
      const offsetAt = answered ? offsetForZone(zone, fixedMinutes) : viewerOffsetAt(fixedMinutes);
      return { t: env.t, phone: env.phone, scheme: env.scheme, locale: env.locale, offsetAt };
    },
    [env, answered, zone, fixedMinutes],
  );
  return (
    <UsageViewProvider value={view}>
      <div className={env.phone ? "app phone" : "app"} style={paletteVars(state.controls, env.scheme)}>
        <div className="page usage-page">
          {!env.phone && <ViewTabs current={Route.Usage} phone={false} t={env.t} activeCount={activeCount} />}
          <UsageHeader
            controls={state.controls}
            params={params}
            shownPlan={params.plan ?? state.data?.plan ?? null}
            updatedAt={state.updatedAt}
            onChange={setParams}
          />
          <div className="usage-body" aria-busy={state.loading}>
            <Body state={state} retry={retry} />
          </div>
        </div>
        {/* PhoneUsage still draws the bottom tab bar; Board and Active work moved their bar to the top (PhoneV2, ActiveV3Phone). */}
        {env.phone && <ViewTabs current={Route.Usage} phone t={env.t} activeCount={activeCount} />}
      </div>
    </UsageViewProvider>
  );
}
