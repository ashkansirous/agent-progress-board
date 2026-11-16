import type { TaskCostDto, UsageResponse } from "../../src/api/usageDto";
import { costPercentText, shortTaskTitle, tokenText } from "./usageFormat";
import { useUsageView } from "./usageView";

const PHONE_ROWS = 4;
const FULL = 100;
const FIRST = 0;
const NO_VALUE = "–";

/** The biggest cap figure among the rows, the width every bar is counted against; 0 while the estimate is not ready. */
function biggestPoints(data: UsageResponse): number {
  const figures = [...data.top_tasks.map((task) => task.cap_points ?? 0), data.other_tasks?.cap_points ?? 0];
  return Math.max(...figures);
}

function capShare(points: number | null, biggest: number): number {
  return points === null || biggest <= 0 ? 0 : (points / biggest) * FULL;
}

function CapCell({ points, biggest }: { points: number | null; biggest: number }) {
  return (
    <td className="cap-cell">
      <span className="cap-cell-inner">
        {points !== null && (
          <span className="cap-cell-bar" aria-hidden="true">
            <span style={{ width: `${capShare(points, biggest)}%` }} />
          </span>
        )}
        <span className={points === null ? "cap-cell-value muted" : "cap-cell-value"}>{points === null ? NO_VALUE : costPercentText(points)}</span>
      </span>
    </td>
  );
}

function TaskTable({ data }: { data: UsageResponse }) {
  const { t, locale } = useUsageView();
  const other = data.other_tasks;
  const biggest = biggestPoints(data);
  return (
    <div className="table-scroll">
      <table className="usage-table usage-table-tasks">
        <thead>
          <tr>
            <th scope="col" className="left">{t("columnTask")}</th>
            <th scope="col" className="left">{t("columnProject")}</th>
            <th scope="col">{t("columnTokens")}</th>
            <th scope="col" className="cap-col">{t("columnOfCap")}</th>
          </tr>
        </thead>
        <tbody>
          {data.top_tasks.map((task) => (
            <tr key={task.key}>
              <td className="left task-title">{task.title}</td>
              <td className="left muted">{task.project}</td>
              <td>{tokenText(task.tokens, locale)}</td>
              <CapCell points={task.cap_points} biggest={biggest} />
            </tr>
          ))}
          {other && (
            <tr>
              <td className="left task-title">{t("everythingElse")}</td>
              <td className="left muted">{t(other.projects === 1 ? "projectOne" : "projectMany", { n: other.projects })}</td>
              <td>{tokenText(other.tokens, locale)}</td>
              <CapCell points={other.cap_points} biggest={biggest} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function barShare(task: TaskCostDto, biggest: number): number {
  return capShare(task.cap_points, biggest);
}

/** The phone's rows: the short title, the percent of the cap (a muted dash while it is not known) and a bar sized against the biggest. */
function TaskRows({ data }: { data: UsageResponse }) {
  const rows = data.top_tasks.slice(FIRST, PHONE_ROWS);
  const biggest = Math.max(...rows.map((task) => task.cap_points ?? 0));
  return (
    <ul className="task-rows">
      {rows.map((task) => (
        <li key={task.key}>
          <span className="task-row-top">
            <span className="task-title">{shortTaskTitle(task.title)}</span>
            <span className={task.cap_points === null ? "task-value muted" : "task-value"}>
              {task.cap_points === null ? NO_VALUE : costPercentText(task.cap_points)}
            </span>
          </span>
          <span className="task-bar" aria-hidden="true">
            <span style={{ width: `${barShare(task, biggest)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cost per task: the biggest tasks by tokens and one row for the rest, with each one's share of the cap. */
export function TaskCost({ data }: { data: UsageResponse }) {
  const { t, phone } = useUsageView();
  if (data.top_tasks.length === 0) return null;
  return (
    <section className="usage-card cost-card" aria-labelledby="cost-title">
      <div className="card-head">
        <h2 id="cost-title">{t("costTitle")}</h2>
        {!phone && <span className="card-note">{t("costNote")}</span>}
      </div>
      {phone ? <TaskRows data={data} /> : <TaskTable data={data} />}
    </section>
  );
}
