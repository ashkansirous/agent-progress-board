import type { CapCostEnvironmentDto, UnexplainedStretchDto, UsagePageResponse } from "../../src/api/usageDto";
import { HowSure, MultiplierState } from "../../src/domain/capCost";
import { shareText, spanText } from "./capCostFormat";
import { ReportsPill } from "./HowSurePill";
import { costPercentText, tokenText } from "./usageFormat";
import { useUsageView } from "./usageView";

const NO_VALUE = "–";

const MULTIPLIER_DECIMALS = 2;
const POINT_DECIMALS = 1;

type Props = { data: UsagePageResponse };

/** The base environment's label: what the cost per token is compared with. */
function baseLabel(data: UsagePageResponse): string {
  const base = data.cap_cost.environments.find((e) => e.state === MultiplierState.Base);
  return base?.label ?? data.base_environment ?? "";
}

function points(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: POINT_DECIMALS, maximumFractionDigits: POINT_DECIMALS }).format(n);
}

function multiplierText(env: CapCostEnvironmentDto, base: string, view: ReturnType<typeof useUsageView>, phone: boolean): string {
  const { t, locale } = view;
  if (env.state === MultiplierState.Base) return t("baseOne");
  if (env.state === MultiplierState.NotEnough) return t("notEnoughYet");
  const label = t(env.how_sure === HowSure.Sure ? "sureInline" : "roughInline");
  const m = new Intl.NumberFormat(locale, { minimumFractionDigits: MULTIPLIER_DECIMALS, maximumFractionDigits: MULTIPLIER_DECIMALS }).format(env.multiplier);
  return t(phone ? "multiplierPhone" : "multiplierMeasured", { m, base, label, n: env.stretches });
}

function FixedRows() {
  const { t } = useUsageView();
  const rows: [string, string][] = [
    [t("sourceDesign"), t("runsCloud")],
    [t("sourceChat"), t("runsDesktopPhone")],
    [t("sourceElse"), t("runsElse")],
  ];
  return (
    <>
      {rows.map(([source, runsOn]) => (
        <tr key={source}>
          <th scope="row" className="left source-name">{source}</th>
          <td className="left soft">{runsOn}</td>
          <td className="left"><ReportsPill reported={false} /></td>
          <td className="muted">{"—"}</td>
          <td className="strong-col muted">{t("inNotExplained")}</td>
          <td className="left muted">{"—"}</td>
        </tr>
      ))}
    </>
  );
}

function DesktopSourcesTable({ data }: Props) {
  const view = useUsageView();
  const { t, locale } = view;
  const base = baseLabel(data);
  const unexplained = data.cap_cost.unexplained;
  return (
    <div className="table-scroll">
      <table className="usage-table sources-table">
        <thead>
          <tr>
            <th scope="col" className="left">{t("columnSource")}</th>
            <th scope="col" className="left">{t("columnRunsOn")}</th>
            <th scope="col" className="left">{t("columnReports")}</th>
            <th scope="col">{t("columnTokens")}</th>
            <th scope="col" className="strong-col">{t("columnOfCap")}</th>
            <th scope="col" className="left">{t("columnCostVs", { base })}</th>
          </tr>
        </thead>
        <tbody>
          {data.cap_cost.environments.map((env) => (
            <tr key={env.value}>
              <th scope="row" className="left source-name">{t("sourceClaudeCode")}</th>
              <td className="left soft">{env.label}</td>
              <td className="left"><ReportsPill reported /></td>
              <td>{tokenText(env.tokens, locale)}</td>
              <td className="strong-col">{env.cap_points === null ? NO_VALUE : costPercentText(env.cap_points)}</td>
              <td className="left soft">{multiplierText(env, base, view, false)}</td>
            </tr>
          ))}
          <FixedRows />
          {unexplained && (
            <tr>
              <th scope="row" className="left source-name strong">{t("notExplained")}</th>
              <td colSpan={3} className="left muted">{t("notExplainedBody")}</td>
              <td className="strong-col strong">{costPercentText(unexplained.points)}</td>
              <td className="left muted">{t("ofThisWindow", { pct: shareText(unexplained.share) })}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StretchRow({ stretch }: { stretch: UnexplainedStretchDto }) {
  const { t, locale, offsetMinutes } = useUsageView();
  const explained = stretch.explained_points >= 0.05;
  return (
    <li className="stretch-row">
      <span className="stretch-span">{spanText(locale, stretch.start, stretch.end, offsetMinutes)}</span>
      <span className="stretch-points">{t("plusPoints", { n: points(stretch.points, locale) })}</span>
      <span className="soft">
        {explained ? t("agentsReported", { n: points(stretch.explained_points, locale) }) : t("noAgentReported")}
      </span>
    </li>
  );
}

function UnexplainedList({ data }: Props) {
  const { t } = useUsageView();
  const stretches = data.cap_cost.unexplained_stretches;
  if (stretches.length === 0) return null;
  return (
    <div className="cost-block">
      <h3>{t("whenTitle")}</h3>
      <p className="block-note">{t("whenCaption")}</p>
      <ul className="stretch-list">
        {stretches.map((stretch) => (
          <StretchRow key={stretch.start} stretch={stretch} />
        ))}
      </ul>
    </div>
  );
}

function PhoneSources({ data }: Props) {
  const view = useUsageView();
  const { t, locale, offsetMinutes } = view;
  const base = baseLabel(data);
  const unexplained = data.cap_cost.unexplained;
  const biggest = data.cap_cost.unexplained_stretches[0];
  const biggestText = biggest
    ? ` ${t("biggestStretch", { span: spanText(locale, biggest.start, biggest.end, offsetMinutes), n: points(biggest.points, locale) })}`
    : "";
  return (
    <section className="usage-card" aria-labelledby="sources-title">
      <h2 id="sources-title">{t("sourcesTitle")}</h2>
      <ul className="source-rows">
        {data.cap_cost.environments.map((env) => (
          <li key={env.value} className="source-row">
            <span className="source-main">{`${t("sourceClaudeCode")} · ${env.label}`}</span>
            <span className="source-value">{env.cap_points === null ? NO_VALUE : costPercentText(env.cap_points)}</span>
            <span className="source-sub">
              {env.state === MultiplierState.Base
                ? t("reportedBase")
                : t("reportedMultiple", { multiple: multiplierText(env, base, view, true) })}
            </span>
            <span className="source-sub source-tokens">{tokenText(env.tokens, locale)}</span>
          </li>
        ))}
        {unexplained && (
          <li className="source-row">
            <span className="source-main">{t("notExplained")}</span>
            <span className="source-value">{costPercentText(unexplained.points)}</span>
            <span className="source-sub source-wide">{`${t("phoneNoReports")}${biggestText}`}</span>
          </li>
        )}
      </ul>
    </section>
  );
}

function DesktopSources({ data }: Props) {
  const { t } = useUsageView();
  return (
    <section className="usage-card" aria-labelledby="sources-title">
      <div className="card-head-stack">
        <h2 id="sources-title">{t("sourcesTitle")}</h2>
        <p className="card-note">{t("sourcesCaption")}</p>
      </div>
      <DesktopSourcesTable data={data} />
      <UnexplainedList data={data} />
    </section>
  );
}

/** "Where the usage comes from" with the unexplained stretches; not drawn until the estimate is ready. */
export function SourcesSection({ data }: Props) {
  const { phone } = useUsageView();
  if (!data.cap_cost.ready) return null;
  return phone ? <PhoneSources data={data} /> : <DesktopSources data={data} />;
}
