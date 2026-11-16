import { HowSure } from "../../src/domain/capCost";
import { useUsageView } from "./usageView";

/** "Fairly sure" or "Rough guess": the word carries the meaning, the colour is the config palette's. */
export function HowSurePill({ howSure }: { howSure: HowSure }) {
  const { t } = useUsageView();
  const sure = howSure === HowSure.Sure;
  return <span className={sure ? "pill pill-sure" : "pill pill-rough"}>{t(sure ? "pillSure" : "pillRough")}</span>;
}

/** "Reported" (green) or "Not reported" (grey): whether the board gets reports from a source. */
export function ReportsPill({ reported }: { reported: boolean }) {
  const { t } = useUsageView();
  return <span className={reported ? "pill pill-sure" : "pill pill-none"}>{t(reported ? "pillReported" : "pillNotReported")}</span>;
}
