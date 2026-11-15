import type { BoardPageConfig } from "../../src/api/boardDto";
import { RefreshIcon } from "./icons";
import { TYPE_ORDER } from "./model";
import { clockTime } from "./time";
import { useView } from "./view";

interface HeaderProps {
  config: BoardPageConfig | null;
  hours: number | null;
  updatedAt: Date | null;
  busy: boolean;
  onRefresh: () => void;
}

function Subtitle({ hours, updatedAt }: Pick<HeaderProps, "hours" | "updatedAt">) {
  const { t, phone } = useView();
  if (hours === null || updatedAt === null) return null;
  const time = clockTime(updatedAt);
  if (phone) return <p className="subtitle">{t("phoneUpdated", { time, n: hours })}</p>;
  return <p className="subtitle">{[t("subtitleOpen", { n: hours }), t("subtitleUpdated", { time })].join(" · ")}</p>;
}

function Legend() {
  const { looks } = useView();
  return (
    <ul className="legend" aria-hidden="true">
      {TYPE_ORDER.map((type) => {
        const look = looks.type(type);
        return (
          <li key={type} className="legend-pill" style={{ background: look.bg, color: look.fg }}>
            <span className="type-dot legend-dot" style={{ background: look.fg }} />
            {look.label}
          </li>
        );
      })}
    </ul>
  );
}

/** Title and last-updated line, the type legend (desktop) and the 44 px refresh button. */
export function Header({ config, hours, updatedAt, busy, onRefresh }: HeaderProps) {
  const { t, phone } = useView();
  return (
    <header className="header">
      <div className="header-text">
        <h1>{t("title")}</h1>
        <Subtitle hours={hours} updatedAt={updatedAt} />
      </div>
      <div className="header-actions">
        {!phone && config && <Legend />}
        <button
          type="button"
          className={busy ? "icon-button refresh busy" : "icon-button refresh"}
          aria-label={t("refreshNow")}
          aria-busy={busy}
          onClick={onRefresh}
        >
          <RefreshIcon size={18} stroke="currentColor" />
        </button>
      </div>
    </header>
  );
}
