import { useMemo, useState } from "react";
import type { UsagePageResponse } from "../../src/api/usageDto";
import { UsageRange } from "../../src/domain/usage";
import type { Environment } from "./BoardPage";
import { CapLine } from "./CapLine";
import { CapTiles, PhoneCapCard } from "./CapTiles";
import { Route } from "./route";
import { TaskCost } from "./TaskCost";
import { TokenChart } from "./TokenChart";
import { paletteVars } from "./theme";
import { EnvironmentFilter, PlanPicker, RangeSwitch } from "./UsageControls";
import { UsageEmptyCard, UsageErrorCard, UsageLoadingCard } from "./UsageStates";
import { clockTime } from "./time";
import { viewerOffsetMinutes } from "./usageApi";
import type { UsageParams } from "./usageQuery";
import type { UsageControls } from "./usageState";
import { useUsageView, UsageViewProvider, type UsageView } from "./usageView";
import { useUsage } from "./useUsage";
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
      <TaskCost data={data} />
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
  const view: UsageView = useMemo(
    () => ({ t: env.t, phone: env.phone, scheme: env.scheme, locale: env.locale, offsetMinutes: state.data?.utc_offset_minutes ?? viewerOffsetMinutes() }),
    [env, state.data?.utc_offset_minutes],
  );
  return (
    <UsageViewProvider value={view}>
      <div className={env.phone ? "app phone" : "app"} style={paletteVars(state.controls, env.scheme)}>
        <div className="page usage-page">
          {!env.phone && <ViewTabs current={Route.Usage} phone={false} t={env.t} />}
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
        {env.phone && <ViewTabs current={Route.Usage} phone t={env.t} />}
      </div>
    </UsageViewProvider>
  );
}
