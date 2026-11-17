/**
 * Made-up demo board: three projects, 15 items covering every type and status, including a stale
 * and three done items. Plain data and pure functions, so the seed CLI and the E2E fixture share it.
 * Types, statuses and priorities are the MCP wire values (see README), kept as plain strings so
 * node can run this file without a TypeScript transform.
 */

export interface SeedLink {
  label: string;
  url: string;
}

export interface SeedEvent {
  /** Clock time "HH:mm" on the demo day (the E2E fixture only). */
  at: string;
  status: string;
  /** null is a plain status change (a history row with no note). */
  note: string | null;
}

export interface SeedItem {
  key: string;
  project: string;
  type: string;
  priority: string;
  status: string;
  title: string;
  why: string;
  parent: string;
  /** Paragraphs of details_md. */
  details: string[];
  links: SeedLink[];
  events: SeedEvent[];
  /** Waiting items: how long ago it was asked (the E2E fixture only). */
  askedMinutesAgo?: number;
  /** Done items: how long ago it finished (the E2E fixture only). */
  doneMinutesAgo?: number;
  /** Stale items: hours since the last heartbeat (the E2E fixture only). */
  heartbeatHoursAgo?: number;
  /** A task an agent works on (Slice 10): its kind, model, where it runs and its steps. */
  agent?: string;
  model?: string;
  environment?: string;
  steps?: { label: string; state: string; note?: string }[];
  /** The key of the item this one belongs to: a part names its slice (Slice 11). */
  parentKey?: string;
  /** A session card's open question, what happens after the answer, and the minutes since it began (Slice 13). */
  needsYou?: string;
  afterAnswer?: string;
  /** Minutes since the last report, for a session card (the E2E fixture only). */
  heartbeatMinutesAgo?: number;
  /** Minutes since the card was created, for "Started N min ago" (the E2E fixture only). */
  createdMinutesAgo?: number;
}

export interface ToolCall {
  name: "report_progress" | "ask_human";
  arguments: Record<string, unknown>;
}

const EXAMPLE = "https://example.com";

function link(label: string, path: string): SeedLink {
  return { label, url: `${EXAMPLE}/${path}` };
}

export const SEED_ITEMS: SeedItem[] = [
  {
    key: "recipe-box/ask-migration", project: "recipe-box", type: "waiting_for_me", priority: "P1", status: "open",
    title: "Approve the tags migration", why: "Drops the old tags column; needs your OK first", parent: "Slice 4 · Tag search",
    details: [
      "The migration rewrites tags into a join table and drops the old column. It cannot be undone without the backup.",
      "Reply in the session or mark this done once approved.",
    ],
    links: [link("Pull request #41", "recipe-box/pull/41"), link("Migration file", "recipe-box/migration")],
    events: [{ at: "13:23", status: "open", note: "Asked by the wave runner" }], askedMinutesAgo: 25,
  },
  {
    key: "garden-planner/ask-console", project: "garden-planner", type: "waiting_for_me", priority: "P0", status: "open",
    title: "Sign in to the store console", why: "Release upload needs a fresh session", parent: "Release 1.4.2",
    details: ["The release build is signed and waiting. The upload step stopped at the sign-in page."],
    links: [link("Release checklist", "garden-planner/release")],
    events: [{ at: "12:41", status: "open", note: "Upload step paused" }], askedMinutesAgo: 67,
  },
  {
    key: "garden-planner/ask-icon", project: "garden-planner", type: "waiting_for_me", priority: "P2", status: "open",
    title: "Pick the new app icon", why: "Three options attached to the issue", parent: "Slice 11 · Store listing",
    details: ["Three icon options are attached. Any one unblocks the store listing slice."],
    links: [link("Issue #77", "garden-planner/issues/77")],
    events: [{ at: "10:52", status: "open", note: "Asked during planning" }], askedMinutesAgo: 176,
  },
  {
    key: "recipe-box/slice-4", project: "recipe-box", type: "slice", priority: "P1", status: "in_progress",
    title: "Slice 4 · Tag search", why: "Find recipes by ingredient or tag", parent: "Plan · Search",
    details: ["Search box, tag chips and a join table for tags.", "3 of 5 work items done; waiting on the migration approval."],
    links: [link("Slice file", "recipe-box/slice-4"), link("Pull request #41", "recipe-box/pull/41")],
    events: [
      { at: "13:23", status: "in_progress", note: "Asked you to approve the migration" },
      { at: "11:05", status: "in_progress", note: "Session started" },
      { at: "09:12", status: "open", note: "Synced from plan docs" },
    ],
  },
  {
    key: "recipe-box/ci-main", project: "recipe-box", type: "problem", priority: "P0", status: "blocked",
    title: "CI failing on main", why: "Lint step times out after 10 minutes", parent: "Wave 3",
    details: ["Second failure in a row; the fix was retried once.", "Wave 3 is paused until this passes."],
    links: [link("Failed run", "recipe-box/actions/1"), link("Wave log", "recipe-box/wave-3")],
    events: [
      { at: "13:02", status: "blocked", note: "Fix failed twice" },
      { at: "12:30", status: "open", note: "Reported by hook" },
    ],
  },
  {
    key: "recipe-box/resize", project: "recipe-box", type: "unplanned", priority: "P2", status: "open",
    title: "Image uploads skip resizing", why: "Found while testing tag search", parent: "Slice 4 · Tag search",
    details: ["Photos over 4 MB are stored at full size. No slice covers this yet."],
    links: [link("Session notes", "recipe-box/notes")],
    events: [{ at: "12:10", status: "open", note: "Found during a run" }],
  },
  {
    key: "recipe-box/slice-3", project: "recipe-box", type: "slice", priority: "P2", status: "done",
    title: "Slice 3 · Share links", why: "Send a recipe to anyone with a link", parent: "Plan · Sharing",
    details: ["Merged and deployed."], links: [link("Pull request #38", "recipe-box/pull/38")],
    events: [
      { at: "11:44", status: "done", note: "Merged to main" },
      { at: "08:30", status: "in_progress", note: "Session started" },
    ],
    doneMinutesAgo: 124,
  },
  {
    key: "garden-planner/crash-bed", project: "garden-planner", type: "bug", priority: "P1", status: "open",
    title: "Crash opening an empty bed", why: "Null bed view; 14 crashes today", parent: "Release 1.4.1",
    details: ["Crash logs point at the bed view when a bed has no plants."],
    links: [link("Crash report", "garden-planner/crash")],
    events: [{ at: "09:40", status: "open", note: "From crash logs" }],
  },
  {
    key: "garden-planner/slice-9", project: "garden-planner", type: "slice", priority: "P2", status: "in_progress",
    title: "Slice 9 · Frost alerts", why: "Warn the night before a frost", parent: "Plan · Weather",
    details: ["Forecast fetch done; notification channel next."], links: [link("Slice file", "garden-planner/slice-9")],
    events: [
      { at: "13:40", status: "in_progress", note: "Heartbeat" },
      { at: "12:00", status: "in_progress", note: "Session started" },
    ],
    agent: "Implementer", model: "model-mid", environment: "cloud-vm",
    steps: [
      { label: "Implementation", state: "done" },
      { label: "Review 1", state: "done" },
      { label: "Fixing", state: "done" },
      { label: "Review 2", state: "active", note: "Two helper agents count under this step" },
      { label: "Phone test", state: "pending" },
      { label: "Tablet test", state: "pending", note: "Skipped when no tablet code changed" },
      { label: "Merging", state: "pending" },
    ],
  },
  {
    key: "garden-planner/slice-9/part-C", project: "garden-planner", type: "part", priority: "P2", status: "open",
    title: "Notification channel", why: "Channel setup and quiet hours", parent: "Slice 9 · Frost alerts", parentKey: "garden-planner/slice-9",
    details: ["The channel setup and the quiet hours."], links: [link("Slice file", "garden-planner/slice-9")],
    events: [{ at: "09:12", status: "open", note: "Synced from plan docs" }],
  },
  {
    key: "garden-planner/slice-10", project: "garden-planner", type: "slice", priority: "P2", status: "stale",
    title: "Slice 10 · Seed inventory", why: "Track seed packets and expiry", parent: "Plan · Inventory",
    details: ["The session stopped reporting. A new report on this key brings it back."],
    links: [link("Slice file", "garden-planner/slice-10")],
    events: [
      { at: "13:00", status: "stale", note: "Heartbeat expired" },
      { at: "10:48", status: "in_progress", note: "Last heartbeat" },
    ],
    heartbeatHoursAgo: 3,
  },
  {
    key: "garden-planner/slice-8", project: "garden-planner", type: "slice", priority: "P2", status: "done",
    title: "Slice 8 · Watering log", why: "One-tap log per bed", parent: "Plan · Care",
    details: ["Merged and released in 1.4.1."], links: [link("Pull request #70", "garden-planner/pull/70")],
    events: [{ at: "07:50", status: "done", note: "Merged to main" }], doneMinutesAgo: 358,
  },
  {
    key: "garden-planner/flaky-test", project: "garden-planner", type: "problem", priority: "P3", status: "done",
    title: "Flaky emulator test", why: "Retried with a longer boot wait", parent: "Wave 2",
    details: ["Fixed by waiting for the emulator to finish booting."], links: [link("Fix commit", "garden-planner/commit/1")],
    events: [{ at: "04:55", status: "done", note: "Fix merged" }], doneMinutesAgo: 533,
  },
  {
    key: "home-lab/slice-2", project: "home-lab", type: "slice", priority: "P3", status: "open",
    title: "Slice 2 · Backup rotation", why: "Keep 7 daily and 4 weekly backups", parent: "Plan · Backups",
    details: ["Not started."], links: [link("Slice file", "home-lab/slice-2")],
    events: [{ at: "09:12", status: "open", note: "Synced from plan docs" }],
  },
  {
    key: "home-lab/cert", project: "home-lab", type: "unplanned", priority: "P3", status: "open",
    title: "Renew the expiring certificate", why: "Expires in 9 days", parent: "Slice 1 · Reverse proxy",
    details: ["Spotted while checking the proxy config."], links: [link("Session notes", "home-lab/notes")],
    events: [{ at: "08:20", status: "open", note: "Found during a run" }],
  },
];

const SESSION = "session";
const ASKED = "needs_you: ";
const ANSWERED = "answered";
export const CRASH_QUESTION = "Which iPhone should I read the crash log from: the iPhone 8 or the iPad?";
export const BACKUP_QUESTION = "Should I delete the 40 old backups in the backups folder, or move them to the archive drive?";

/**
 * Made-up session cards (Slice 13, the BoardV2 mock's data): `example-app` with two working cards
 * (one with a goal and five steps, one a wave on a cloud VM), one with no goal yet, one with a
 * question and one stale without a question; `tools` with only a question; `notes-site` with a
 * plain planned slice and no session card. A separate set, so the 15-item demo board keeps its counts.
 */
export const SESSION_SEED_ITEMS: SeedItem[] = [
  {
    key: "example-app/session-9c1e", project: "example-app", type: "unplanned", priority: "P2", status: "in_progress",
    title: "Read the crash log on the iPhone 8", why: "For Slice 12: app crashes on start", parent: "session 9c1e",
    details: ["Connected the iPhone 8 over USB\nFound 3 crash logs from release 2.3.1, all at start-up"],
    links: [link("Pull request #88", "example-app/pull/88"), link("Slice file", "example-app/slice-12")],
    events: [
      { at: "13:46", status: "in_progress", note: "Reading the logs" },
      { at: "10:05", status: "in_progress", note: null },
      { at: "09:52", status: "done", note: null },
      { at: "09:38", status: "in_progress", note: ANSWERED },
      { at: "09:31", status: "in_progress", note: `${ASKED}${CRASH_QUESTION}` },
      { at: "09:20", status: "in_progress", note: null },
    ],
    agent: SESSION, environment: "laptop", heartbeatMinutesAgo: 2, createdMinutesAgo: 268, parentKey: "example-app/slice-12",
    steps: [
      { label: "Connect the phone", state: "done" }, { label: "Read the logs", state: "active" },
      { label: "Analyse", state: "pending" }, { label: "Conclude", state: "pending" }, { label: "Plan or fix", state: "pending" },
    ],
  },
  {
    key: "example-app/wave-3", project: "example-app", type: "unplanned", priority: "P2", status: "in_progress",
    title: "Build Slices 9 and 10 overnight", why: "For the night run, wave 3", parent: "wave 3",
    details: ["Built and reviewed Slice 9"], links: [link("Wave log", "example-app/wave-3")],
    events: [{ at: "13:44", status: "in_progress", note: "Building Slice 10" }, { at: "03:10", status: "in_progress", note: null }],
    agent: SESSION, environment: "cloud-vm", heartbeatMinutesAgo: 4, createdMinutesAgo: 640,
    steps: [
      { label: "Build Slice 9", state: "done" }, { label: "Review Slice 9", state: "done" }, { label: "Build Slice 10", state: "active" },
      { label: "Review Slice 10", state: "pending" }, { label: "Merge", state: "pending" },
    ],
  },
  {
    key: "example-app/session-a71b", project: "example-app", type: "unplanned", priority: "P2", status: "in_progress",
    title: "main · example-app", why: "", parent: "session a71b",
    details: [], links: [], events: [{ at: "13:46", status: "in_progress", note: null }],
    agent: SESSION, environment: "cloud-vm", heartbeatMinutesAgo: 1, createdMinutesAgo: 2,
  },
  {
    key: "example-app/session-4f2a", project: "example-app", type: "unplanned", priority: "P2", status: "in_progress",
    title: "Find the device with the crash", why: "For Slice 12: app crashes on start", parent: "session 4f2a",
    details: ["Found two devices with the app installed\nBoth have crash logs from today"],
    links: [link("Slice file", "example-app/slice-12")],
    events: [
      { at: "13:42", status: "in_progress", note: `${ASKED}${CRASH_QUESTION}` },
      { at: "13:30", status: "in_progress", note: null },
    ],
    agent: SESSION, environment: "laptop", heartbeatMinutesAgo: 6, createdMinutesAgo: 18, askedMinutesAgo: 6,
    needsYou: CRASH_QUESTION,
    afterAnswer: "I read the log and write the cause into Slice 12.",
    steps: [
      { label: "Find a device with the crash", state: "done" }, { label: "Ask which device", state: "active" },
      { label: "Read the log", state: "pending" }, { label: "Write the cause", state: "pending" },
    ],
  },
  {
    key: "example-app/session-7b3d", project: "example-app", type: "unplanned", priority: "P2", status: "stale",
    title: "Update the store screenshots", why: "For the release 2.3.2 store listing", parent: "session 7b3d",
    details: ["Took 4 of 6 screenshots"], links: [link("Slice file", "example-app/slice-12")],
    events: [
      { at: "09:10", status: "stale", note: "Heartbeat expired" },
      { at: "08:55", status: "in_progress", note: "Heartbeat" },
      { at: "08:41", status: "in_progress", note: null },
      { at: "08:40", status: "done", note: null },
      { at: "08:30", status: "in_progress", note: null },
    ],
    agent: SESSION, environment: "cloud-vm", heartbeatMinutesAgo: 293, createdMinutesAgo: 318,
    steps: [
      { label: "Take the screenshots", state: "active" }, { label: "Add captions", state: "pending" }, { label: "Upload", state: "pending" },
    ],
  },
  {
    key: "tools/session-51e0", project: "tools", type: "unplanned", priority: "P2", status: "in_progress",
    title: "List old backups", why: "For the cleanup slice of tools", parent: "session 51e0",
    details: ["Listed 40 backups older than a year, 18 GB in all"], links: [link("Slice file", "tools/cleanup")],
    events: [
      { at: "13:06", status: "in_progress", note: `${ASKED}${BACKUP_QUESTION}` },
      { at: "12:51", status: "in_progress", note: null },
    ],
    agent: SESSION, environment: "laptop", heartbeatMinutesAgo: 42, createdMinutesAgo: 57, askedMinutesAgo: 42,
    needsYou: BACKUP_QUESTION,
    afterAnswer: "I free the space and close the cleanup slice.",
    steps: [
      { label: "List old backups", state: "done" }, { label: "Ask what to do with them", state: "active" },
      { label: "Delete or move", state: "pending" }, { label: "Close the slice", state: "pending" },
    ],
  },
  {
    key: "notes-site/slice-4", project: "notes-site", type: "slice", priority: "P2", status: "open",
    title: "Slice 4 · Search page", why: "Find a note by words", parent: "Plan · Search",
    details: ["Not started."], links: [link("Slice file", "notes-site/slice-4")],
    events: [{ at: "09:12", status: "open", note: "Synced from plan docs" }],
  },
];

const MOCK_PLAN_NOTE = "Synced from plan docs";

interface PlanOver {
  priority?: string;
  why?: string;
  parent?: string;
  parentKey?: string;
  doneMinutesAgo?: number;
  agent?: string;
  model?: string;
  heartbeatMinutesAgo?: number;
  steps?: SeedItem["steps"];
  events?: SeedEvent[];
}

/** A made-up item of the planning set with plain defaults: only what the board shows is given. */
function planItem(key: string, type: string, status: string, title: string, over: PlanOver = {}): SeedItem {
  const project = key.split("/")[0]!;
  const { priority = "P2", why = "", parent = "Plan", events, ...rest } = over;
  return {
    key, project, type, priority, status, title, why, parent, details: [], links: [],
    events: events ?? [{ at: "09:12", status, note: MOCK_PLAN_NOTE }], ...rest,
  };
}

const SLICE_12 = "example-app/slice-12";
const SLICE_13 = "example-app/slice-13";
const SLICE_11 = "example-app/slice-11";
const CLOSED_SLICE = "example-app/slice-3";

const SLICE_12_PARTS = [
  ["A", "Reproduce on a device"], ["B", "Add crash reporting"], ["C", "Fix the start-up race"],
  ["D", "Test on iOS 16 and 17"], ["E", "Release 2.3.2"],
] as const;
const SLICE_13_PARTS = [["A", "Cache the notes"], ["B", "Queue the edits"], ["C", "Sync on reconnect"], ["D", "Release"]] as const;
const SLICE_11_PARTS = [["A", "Share sheet on iOS"], ["B", "Share sheet on Android"], ["C", "Release"]] as const;
const SLICE_12_CHECKS = ["Cold start on the iPhone 8 with no network", "Start after an update from 2.3.0", "Start with 500 saved notes"];
const SLICE_13_CHECKS = [
  "Open a note with the plane mode on", "Edit a note offline and reconnect", "Delete a note offline",
  "Offline with a full disk", "Switch networks while syncing",
];
const NOTES_SITE_CHECKS = ["Search a word in a long note", "Search with no results"];
const RSS_CHECKS = ["Open the feed in a reader", "Feed after a new note"];
const MOCK_DONE = [
  ["Slice 10 · part B merged", 248], ["Wave 2 finished: Slices 7 and 8", 393], ["Fix for the flaky login test merged", 526],
  ["session 2c9d finished its turn: tidy the README", 600], ["Release 2.3.1 uploaded to the store", 640],
  ["Dependency update merged", 655], ["Changelog written", 670], ["Wave 1 finished: Slices 5 and 6", 690],
  ["Icon set replaced", 700], ["Lint rules tightened", 705], ["Slice 9 · part A merged", 715],
] as const;

function partsOf(slice: string, list: readonly (readonly [string, string])[], states: Record<string, PlanOver>): SeedItem[] {
  return list.map(([letter, title]) => {
    const over = states[letter] ?? {};
    const status = over.agent ? "in_progress" : (over.doneMinutesAgo ? "done" : "open");
    return planItem(`${slice}/part-${letter}`, "part", status, title, { parentKey: slice, ...over });
  });
}

function checksOf(slice: string, lines: readonly string[]): SeedItem[] {
  return lines.map((line, i) => planItem(`${slice}/check-${i + 1}`, "check", "open", line, { parentKey: slice }));
}

const CRASH_STEPS = [
  { label: "Implementation", state: "active" }, { label: "Review 1", state: "pending" }, { label: "Merging", state: "pending" },
];

/**
 * The BoardV2 mock's planning data (Slice 14): `example-app` with Slice 12 (in progress, parts A to E,
 * A and B done, C active, 3 checks), Slice 13 (planned, 4 parts, 5 checks) and Slice 11 (parked, 3
 * parts), 22 checks whose slice is closed, a bug that names Slice 12, a problem that names none and
 * 11 finished items (the session set adds the stopped card, 12 in all); `notes-site` with Slice 5 (Slice 4
 * is in the session set) and 3 done. A separate set again, so the 15-item demo board keeps its counts.
 */
export const PLANNING_SEED_ITEMS: SeedItem[] = [
  planItem(SLICE_12, "slice", "in_progress", "Slice 12 · App crashes on start", { priority: "P1" }),
  ...partsOf(SLICE_12, SLICE_12_PARTS, {
    A: { doneMinutesAgo: 300 }, B: { doneMinutesAgo: 200 },
    C: { agent: "Implementer", model: "model-mid", heartbeatMinutesAgo: 3, steps: CRASH_STEPS },
  }),
  ...checksOf(SLICE_12, SLICE_12_CHECKS),
  planItem(SLICE_13, "slice", "open", "Slice 13 · Offline mode"),
  ...partsOf(SLICE_13, SLICE_13_PARTS, {}),
  ...checksOf(SLICE_13, SLICE_13_CHECKS),
  planItem(SLICE_11, "slice", "blocked", "Slice 11 · Share sheet"),
  ...partsOf(SLICE_11, SLICE_11_PARTS, { A: { doneMinutesAgo: 400 } }),
  ...Array.from({ length: 22 }, (_, i) => planItem(`${CLOSED_SLICE}/check-${i + 1}`, "check", "open", `Closed-slice check ${i + 1}`, { parentKey: CLOSED_SLICE })),
  planItem("example-app/crash-ios16", "bug", "open", "App crashes on start on iOS 16", {
    priority: "P1", why: "Found in the crash log of release 2.3.1, iPhone 8", parentKey: SLICE_12, parent: "Release 2.3.1",
  }),
  planItem("example-app/lint-timeout", "problem", "open", "Build fails on main: the lint step times out", {
    why: "Found by wave 3 on the night run", parent: "Wave 3",
  }),
  ...MOCK_DONE.map(([title, minutes], i) => planItem(`example-app/done-${i + 1}`, "unplanned", "done", title, { doneMinutesAgo: minutes })),
  planItem("notes-site/slice-5", "slice", "open", "Slice 5 · RSS feed"),
  ...partsOf("notes-site/slice-5", [["A", "Feed builder"], ["B", "Feed link"]], {}),
  ...checksOf("notes-site/slice-5", RSS_CHECKS),
  ...checksOf("notes-site/slice-4", NOTES_SITE_CHECKS),
  ...partsOf("notes-site/slice-4", [["A", "Search index"], ["B", "Search box"], ["C", "Release"]], {}),
  planItem("notes-site/slice-3", "slice", "done", "Slice 3 · Tags merged", { doneMinutesAgo: 698 }),
  planItem("notes-site/done-2", "unplanned", "done", "Sitemap added", { doneMinutesAgo: 600 }),
  planItem("notes-site/done-3", "unplanned", "done", "Footer links fixed", { doneMinutesAgo: 500 }),
];

const WAITING_TYPE = "waiting_for_me";
const LATEST_EVENT = 0;

/** The latest event's note, except the question marker: the server writes that one itself. */
function agentNote(item: SeedItem): string | undefined {
  const note = item.events[LATEST_EVENT]?.note ?? undefined;
  return note?.startsWith(ASKED) ? undefined : note;
}

/** The MCP tool call that puts one item on the board: ask_human for a waiting item, else report_progress. */
export function callFor(item: SeedItem): ToolCall {
  const shared = {
    key: item.key,
    project: item.project,
    title: item.title,
    why: item.why || undefined,
    parent: item.parent,
    parent_key: item.parentKey,
    priority: item.priority,
    details_md: item.details.join("\n\n") || undefined,
    links: item.links,
    source: "seed",
    note: agentNote(item),
  };
  if (item.type === WAITING_TYPE) return { name: "ask_human", arguments: shared };
  const work = { agent: item.agent, model: item.model, environment: item.environment, steps: item.steps };
  const question = { needs_you: item.needsYou, after_answer: item.afterAnswer };
  return { name: "report_progress", arguments: { ...shared, type: item.type, status: item.status, ...work, ...question } };
}

/** The seed script's calls: the demo board plus the session cards (Slice 13) and the planning set (Slice 14). */
export function seedCalls(items: SeedItem[] = [...SEED_ITEMS, ...SESSION_SEED_ITEMS, ...PLANNING_SEED_ITEMS]): ToolCall[] {
  return items.map(callFor);
}
