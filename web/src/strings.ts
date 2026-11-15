/** Every word the page shows. English is the source; each other locale must have every key. */
const en = {
  title: "Progress",
  subtitleOpen: "Open work plus everything finished in the last {n} hours",
  subtitleUpdated: "updated {time} · refreshes every 60 s",
  phoneUpdated: "Updated {time} · last {n} h",
  refreshNow: "Refresh now",
  close: "Close",
  itemDetails: "Item details",
  waitingForYou: "Waiting for you",
  waitingForYouN: "Waiting for you · {n}",
  acrossProjects: "{items} across {projects}",
  itemOne: "{n} item",
  itemMany: "{n} items",
  projectOne: "{n} project",
  projectMany: "{n} projects",
  inFlightN: "In flight · {n}",
  doneN: "Done in the last {hours} h · {n}",
  summaryWaiting: "{n} waiting for you",
  summaryWaitingShort: "{n} waiting",
  summaryOpen: "{n} open",
  summaryDone: "{n} done in {hours} h",
  summaryDoneShort: "{n} done",
  askedAge: "Asked {age} · {parent}",
  askedOnly: "Asked {age}",
  doneAge: "Done {age}",
  staleNote: "Stale · {note}",
  noHeartbeat: "No heartbeat for {n} h",
  statusOpen: "Open",
  statusInProgress: "In progress",
  statusBlocked: "Blocked",
  statusDone: "Done",
  statusStale: "Stale",
  details: "Details",
  links: "Links",
  history: "History",
  fieldStatus: "Status",
  fieldProject: "Project",
  fieldParent: "Parent",
  fieldKey: "Key",
  minAgo: "{n} min ago",
  hourAgo: "{n} h ago",
  dayAgo: "{n} d ago",
  loading: "Loading the board…",
  emptyTitle: "Nothing open",
  emptyBody: "No open items and nothing finished in the last {n} hours. Agents add items here as they report.",
  failedTitle: "Couldn’t load the board",
  failedApi: "The board API answered {code} ({reason}). Showing nothing rather than old data.",
  failedNetwork: "The board API could not be reached. Showing nothing rather than old data.",
  retry: "Retry",
  reason401: "sign-in required",
  reason403: "access refused",
  reason404: "not found",
  reason500: "server error",
  reason502: "bad gateway",
  reason503: "service unavailable",
  reason504: "gateway timeout",
  reasonOther: "unexpected answer",
} as const;

export type StringKey = keyof typeof en;
type Table = Record<StringKey, string>;

const de: Table = {
  title: "Fortschritt",
  subtitleOpen: "Offene Arbeit und alles, was in den letzten {n} Stunden fertig wurde",
  subtitleUpdated: "aktualisiert {time} · lädt alle 60 s neu",
  phoneUpdated: "Aktualisiert {time} · letzte {n} h",
  refreshNow: "Jetzt aktualisieren",
  close: "Schließen",
  itemDetails: "Details zum Eintrag",
  waitingForYou: "Wartet auf dich",
  waitingForYouN: "Wartet auf dich · {n}",
  acrossProjects: "{items} in {projects}",
  itemOne: "{n} Eintrag",
  itemMany: "{n} Einträge",
  projectOne: "{n} Projekt",
  projectMany: "{n} Projekten",
  inFlightN: "In Arbeit · {n}",
  doneN: "Fertig in den letzten {hours} h · {n}",
  summaryWaiting: "{n} warten auf dich",
  summaryWaitingShort: "{n} wartet",
  summaryOpen: "{n} offen",
  summaryDone: "{n} fertig in {hours} h",
  summaryDoneShort: "{n} fertig",
  askedAge: "Gefragt {age} · {parent}",
  askedOnly: "Gefragt {age}",
  doneAge: "Fertig {age}",
  staleNote: "Veraltet · {note}",
  noHeartbeat: "Seit {n} h kein Lebenszeichen",
  statusOpen: "Offen",
  statusInProgress: "In Arbeit",
  statusBlocked: "Blockiert",
  statusDone: "Fertig",
  statusStale: "Veraltet",
  details: "Details",
  links: "Links",
  history: "Verlauf",
  fieldStatus: "Status",
  fieldProject: "Projekt",
  fieldParent: "Übergeordnet",
  fieldKey: "Schlüssel",
  minAgo: "vor {n} Min.",
  hourAgo: "vor {n} h",
  dayAgo: "vor {n} T.",
  loading: "Die Übersicht wird geladen…",
  emptyTitle: "Nichts offen",
  emptyBody: "Keine offenen Einträge und in den letzten {n} Stunden nichts fertig. Agenten tragen hier ein, was sie melden.",
  failedTitle: "Die Übersicht ließ sich nicht laden",
  failedApi: "Die Board-API antwortete {code} ({reason}). Es wird nichts statt alter Daten gezeigt.",
  failedNetwork: "Die Board-API war nicht erreichbar. Es wird nichts statt alter Daten gezeigt.",
  retry: "Erneut versuchen",
  reason401: "Anmeldung nötig",
  reason403: "Zugriff verweigert",
  reason404: "nicht gefunden",
  reason500: "Serverfehler",
  reason502: "fehlerhaftes Gateway",
  reason503: "Dienst nicht verfügbar",
  reason504: "Gateway-Zeitüberschreitung",
  reasonOther: "unerwartete Antwort",
};

export const LOCALES: Record<string, Table> = { en, de };
export const DEFAULT_LOCALE = "en";

export type Params = Record<string, string | number>;
export type Translate = (key: StringKey, params?: Params) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

/** The best locale for a browser language tag such as "de-DE"; English when none matches. */
export function pickLocale(language: string | undefined): string {
  const base = (language ?? "").toLowerCase().split("-")[0] ?? "";
  return base in LOCALES ? base : DEFAULT_LOCALE;
}

export function translator(locale: string): Translate {
  const table = LOCALES[locale] ?? en;
  return (key, params = {}) =>
    table[key].replace(PLACEHOLDER, (whole, name: string) => String(params[name] ?? whole));
}
