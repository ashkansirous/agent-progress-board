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
  note: string;
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

const WAITING_TYPE = "waiting_for_me";
const LATEST_EVENT = 0;

/** The MCP tool call that puts one item on the board: ask_human for a waiting item, else report_progress. */
export function callFor(item: SeedItem): ToolCall {
  const shared = {
    key: item.key,
    project: item.project,
    title: item.title,
    why: item.why,
    parent: item.parent,
    parent_key: item.parentKey,
    priority: item.priority,
    details_md: item.details.join("\n\n"),
    links: item.links,
    source: "seed",
    note: item.events[LATEST_EVENT]?.note,
  };
  if (item.type === WAITING_TYPE) return { name: "ask_human", arguments: shared };
  const work = { agent: item.agent, model: item.model, environment: item.environment, steps: item.steps };
  return { name: "report_progress", arguments: { ...shared, type: item.type, status: item.status, ...work } };
}

export function seedCalls(items: SeedItem[] = SEED_ITEMS): ToolCall[] {
  return items.map(callFor);
}
