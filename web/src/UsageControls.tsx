import type { UsageEnvironmentDto } from "../../src/api/usageDto";
import { UsageRange } from "../../src/domain/usage";
import type { StringKey } from "./strings";
import { useUsageView } from "./usageView";

export interface Choice<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T> {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  small?: boolean;
}

/** A group of toggle buttons where exactly one is pressed (the time range, the environment, the split). */
export function Segmented<T extends string | null>({ label, choices, value, onChange, small }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={small ? "segmented segmented-small" : "segmented"}>
      {choices.map((choice) => (
        <button key={choice.value ?? "all"} type="button" aria-pressed={choice.value === value} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

const RANGE_LABELS: Record<UsageRange, StringKey> = {
  [UsageRange.Day]: "range24h",
  [UsageRange.Window]: "rangeWindow",
  [UsageRange.Month]: "range30d",
};

export function RangeSwitch({ value, onChange }: { value: UsageRange; onChange: (value: UsageRange) => void }) {
  const { t } = useUsageView();
  const choices = Object.values(UsageRange).map((range) => ({ value: range, label: t(RANGE_LABELS[range]) }));
  return <Segmented label={t("rangeLabel")} choices={choices} value={value} onChange={onChange} />;
}

interface EnvironmentFilterProps {
  environments: UsageEnvironmentDto[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export function EnvironmentFilter({ environments, value, onChange }: EnvironmentFilterProps) {
  const { t, phone } = useUsageView();
  const all: Choice<string | null> = { value: null, label: t(phone ? "environmentAllShort" : "environmentAll") };
  const choices = [all, ...environments.map((env) => ({ value: env.value, label: env.label }))];
  return <Segmented label={t("environmentLabel")} choices={choices} value={value} onChange={onChange} />;
}

interface PlanPickerProps {
  plans: string[];
  value: string | null;
  onChange: (value: string) => void;
}

export function PlanPicker({ plans, value, onChange }: PlanPickerProps) {
  const { t } = useUsageView();
  if (plans.length === 0) return null;
  return (
    <label className="plan-field">
      {t("planLabel")}
      <select value={value ?? plans[0]} onChange={(event) => onChange(event.target.value)}>
        {plans.map((plan) => (
          <option key={plan} value={plan}>
            {plan}
          </option>
        ))}
      </select>
    </label>
  );
}
