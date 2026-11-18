import type { UsagePageResponse } from "../../src/api/usageDto";
import { barWidth, costPercentText, tokenText } from "./usageFormat";
import { useUsageView } from "./usageView";

const NO_VALUE = "–";
/** React keys: the unexplained row never shares one with an agent kind, whatever the kind is called or the language. */
const NOT_EXPLAINED_KEY = "not-explained-row";
const KIND_KEY_PREFIX = "kind:";

interface Row {
  name: string;
  tokensText: string;
  percent: number | null;
  notReported: boolean;
}

/** Cost per agent kind in points of the cap, with the "Not explained" row; the desktop only. */
export function AgentKindCost({ data }: { data: UsagePageResponse }) {
  const { t, phone, locale } = useUsageView();
  if (phone || data.agent_kinds.length === 0) return null;
  const rows: Row[] = data.agent_kinds.map((kind) => ({
    name: kind.name,
    tokensText: tokenText(kind.tokens, locale),
    percent: kind.cap_points,
    notReported: false,
  }));
  const unexplained = data.cap_cost.unexplained;
  if (unexplained) rows.push({ name: t("notExplained"), tokensText: t("notReported"), percent: unexplained.points, notReported: true });
  const biggest = Math.max(...rows.map((row) => row.percent ?? 0));
  return (
    <section className="usage-card kind-cost-card" aria-labelledby="kind-cost-title">
      <h2 id="kind-cost-title">{t("agentKindTitle")}</h2>
      <ul className="kind-cost-rows">
        {rows.map((row) => (
          <li key={row.notReported ? NOT_EXPLAINED_KEY : `${KIND_KEY_PREFIX}${row.name}`} className="kind-cost-row">
            <span className="kind-cost-name">{row.name}</span>
            <span className="kind-cost-tokens">{row.tokensText}</span>
            <span className="kind-cost-percent">{row.percent === null ? NO_VALUE : costPercentText(row.percent, locale)}</span>
            <span className="kind-cost-bar" aria-hidden="true">
              <span className={row.notReported ? "kind-cost-fill kind-cost-fill-open" : "kind-cost-fill"} style={{ width: `${barWidth(row.percent, biggest)}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="card-note">{t("helperNote")}</p>
    </section>
  );
}
