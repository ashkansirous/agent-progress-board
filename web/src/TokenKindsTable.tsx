import type { UsageResponse } from "../../src/api/usageDto";
import { TOKEN_KINDS } from "../../src/domain/usage";
import { millionsText } from "./usageFormat";
import { seriesColor, TOKEN_KIND_LABELS, useUsageView } from "./usageView";

const KIND_DECIMALS = 2;
const TOTAL_DECIMALS = 1;

/** Fresh input, cache write, cache read, output and total per model, in millions. */
export function TokenKindsTable({ data }: { data: UsageResponse }) {
  const { t, scheme, locale } = useUsageView();
  return (
    <div className="table-scroll">
      <table className="usage-table">
        <caption>{t("tokenTableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col" className="left">{t("columnModel")}</th>
            {TOKEN_KINDS.map((kind) => (
              <th key={kind} scope="col">{t(TOKEN_KIND_LABELS[kind])}</th>
            ))}
            <th scope="col" className="total">{t("columnTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {data.totals_by_model.map((row) => (
            <tr key={row.model}>
              <th scope="row" className="left">
                <span className="model-name">
                  <span className="swatch swatch-small" style={{ background: seriesColor(data.palette, row.color_index, scheme) }} />
                  {row.model}
                </span>
              </th>
              {TOKEN_KINDS.map((kind) => (
                <td key={kind}>{millionsText(row[kind], KIND_DECIMALS, locale)}</td>
              ))}
              <td className="total">{millionsText(row.total, TOTAL_DECIMALS, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
