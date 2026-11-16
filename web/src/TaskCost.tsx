import type { TaskCostDto, UsageResponse } from "../../src/api/usageDto";
import { shortTaskTitle, tokenText } from "./usageFormat";
import { useUsageView } from "./usageView";

const PHONE_ROWS = 4;
const FULL = 100;
const FIRST = 0;

function TaskTable({ data }: { data: UsageResponse }) {
  const { t, locale } = useUsageView();
  const other = data.other_tasks;
  return (
    <div className="table-scroll">
      <table className="usage-table usage-table-tasks">
        <thead>
          <tr>
            <th scope="col" className="left">{t("columnTask")}</th>
            <th scope="col" className="left">{t("columnProject")}</th>
            <th scope="col">{t("columnTokens")}</th>
          </tr>
        </thead>
        <tbody>
          {data.top_tasks.map((task) => (
            <tr key={task.key}>
              <td className="left task-title">{task.title}</td>
              <td className="left muted">{task.project}</td>
              <td>{tokenText(task.tokens, locale)}</td>
            </tr>
          ))}
          {other && (
            <tr>
              <td className="left task-title">{t("everythingElse")}</td>
              <td className="left muted">{t(other.projects === 1 ? "projectOne" : "projectMany", { n: other.projects })}</td>
              <td>{tokenText(other.tokens, locale)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function barShare(task: TaskCostDto, biggest: number): number {
  return biggest > 0 ? (task.tokens / biggest) * FULL : 0;
}

/** The phone's rows: the short title, the tokens and a bar sized against the biggest task shown. */
function TaskRows({ data }: { data: UsageResponse }) {
  const { locale } = useUsageView();
  const rows = data.top_tasks.slice(FIRST, PHONE_ROWS);
  const biggest = rows[FIRST]?.tokens ?? 0;
  return (
    <ul className="task-rows">
      {rows.map((task) => (
        <li key={task.key}>
          <span className="task-row-top">
            <span className="task-title">{shortTaskTitle(task.title)}</span>
            <span className="task-value">{tokenText(task.tokens, locale)}</span>
          </span>
          <span className="task-bar" aria-hidden="true">
            <span style={{ width: `${barShare(task, biggest)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cost per task: the biggest tasks by tokens and one row for the rest. The share of the cap is Slice 9's. */
export function TaskCost({ data }: { data: UsageResponse }) {
  const { t, phone } = useUsageView();
  if (data.top_tasks.length === 0) return null;
  return (
    <div className="cost-row">
      <section className="usage-card cost-card" aria-labelledby="cost-title">
        <div className="card-head">
          <h2 id="cost-title">{t("costTitle")}</h2>
          {!phone && <span className="card-note">{t("costNote")}</span>}
        </div>
        {phone ? <TaskRows data={data} /> : <TaskTable data={data} />}
      </section>
    </div>
  );
}
