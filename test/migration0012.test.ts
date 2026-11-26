import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const MIGRATION = "0012_findings.sql";
const BEFORE = ["0001_items.sql", "0002_doc_sync.sql"];
const USAGE_MIGRATION = "0003_usage.sql";
const AFTER_USAGE = [
  "0004_steps.sql",
  "0005_parts.sql",
  "0006_needs_you.sql",
  "0007_checks.sql",
  "0008_heartbeat_index.sql",
  "0009_outcome.sql",
  "0010_archive.sql",
];

function queriesOf(name: string): string[] {
  const found = env.TEST_MIGRATIONS.find((migration) => migration.name === name);
  if (!found) throw new Error(`no migration ${name}`);
  return found.queries;
}

const COMMENT_LINE = /^\s*--.*$/gm;

/** Runs the statements as one batch (one transaction); a chunk of comments only is not a statement. */
async function run(queries: string[]): Promise<void> {
  const statements = queries.filter((query) => query.replace(COMMENT_LINE, "").trim() !== "");
  if (statements.length === 0) throw new Error("no statements to run");
  await env.DB.batch(statements.map((query) => env.DB.prepare(query)));
}

/** The items and events tables as migration 0011 left them (0011 only adds step_runs) (the other tables have no key to either). */
async function rebuildAt0011(): Promise<void> {
  await run(["DROP TABLE events", "DROP TABLE items"]);
  for (const name of BEFORE) await run(queriesOf(name));
  await run(queriesOf(USAGE_MIGRATION).filter((query) => query.replace(COMMENT_LINE, "").trimStart().startsWith("ALTER TABLE items")));
  for (const name of AFTER_USAGE) await run(queriesOf(name));
}

const ITEM_COLUMNS = `key, project, parent, type, priority, status, title, why, details_md, links, source,
  heartbeat_at, created_at, updated_at, done_at, in_doc_sync, doc_status, doc_status_at, live_status_at,
  environment, steps, agent, model, parent_key, needs_you, after_answer, needs_you_at, outcome, archived_at`;

function seedItem(key: string, type: string, status: string, question: string | null): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO items (${ITEM_COLUMNS}) VALUES (?1, 'demo-app', 'Plan', ?2, 'P1', ?3, ?4, 'why', '# details',
      '[{"label":"PR","url":"https://example.com/1"}]', 'doc-sync', '2026-11-15T10:00:00.000Z', '2026-11-15T09:00:00.000Z',
      '2026-11-15T10:00:00.000Z', NULL, 1, 'open', '2026-11-15T09:00:00.000Z', NULL, 'prod', '[]', 'Reviewer', 'model-x',
      'demo-app/slice-1', ?5, ?6, ?7, 'Code merged', ?8)`,
  ).bind(key, type, status, `Title of ${key}`, question, question ? "then I read it" : null, question ? "2026-11-15T09:30:00.000Z" : null, key.endsWith("/old-gone") ? "2026-11-16T00:00:00.000Z" : null);
}

function seedEvent(key: string, at: string, status: string): D1PreparedStatement {
  return env.DB.prepare("INSERT INTO events (item_key, at, status, source, note) VALUES (?1, ?2, ?3, 'doc-sync', 'note')").bind(key, at, status);
}

const FINDING_INSERT =
  "INSERT INTO items (key, project, type, priority, status, title, heartbeat_at, created_at, updated_at, parent_key) VALUES ('demo-app/optimiser-1', 'demo-app', 'finding', 'P2', 'open', 'x', 'a', 'a', 'a', 'demo-app/slice-1')";

describe("migration 0012 over a populated 0011 database", () => {
  it("keeps every item and event with its id and question, allows the finding type, and resumes event ids", async () => {
    await rebuildAt0011();
    await run([FINDING_INSERT]).then(
      () => Promise.reject(new Error("0011 must refuse the finding type")),
      () => undefined,
    );
    await env.DB.batch([
      seedItem("demo-app/slice-1", "slice", "open", null),
      seedItem("demo-app/slice-2", "slice", "done", null),
      seedItem("demo-app/session-1", "unplanned", "in_progress", "Which phone?"),
      seedItem("demo-app/old-gone", "unplanned", "done", null),
      seedEvent("demo-app/slice-1", "2026-11-15T09:00:00.000Z", "open"),
      seedEvent("demo-app/slice-1", "2026-11-15T10:00:00.000Z", "in_progress"),
      seedEvent("demo-app/slice-2", "2026-11-15T11:00:00.000Z", "done"),
      seedEvent("demo-app/session-1", "2026-11-15T12:00:00.000Z", "in_progress"),
    ]);
    const itemsBefore = (await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY key`).all()).results;
    const eventsBefore = (await env.DB.prepare("SELECT id, item_key, at, status, source, note FROM events ORDER BY id").all()).results;
    expect(itemsBefore).toHaveLength(4);
    expect(eventsBefore).toHaveLength(4);

    await expect(run([...queriesOf(MIGRATION), "INSERT INTO no_such_table VALUES (1)"])).rejects.toThrow();
    const leftovers = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE name IN ('events_keep', 'items_new')").all()).results;
    expect(leftovers).toEqual([]);
    expect((await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY key`).all()).results).toEqual(itemsBefore);

    await run(queriesOf(MIGRATION));

    expect((await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY key`).all()).results).toEqual(itemsBefore);
    expect((await env.DB.prepare("SELECT id, item_key, at, status, source, note FROM events ORDER BY id").all()).results).toEqual(eventsBefore);

    await env.DB.batch([env.DB.prepare(FINDING_INSERT), seedEvent("demo-app/optimiser-1", "2026-11-15T13:00:00.000Z", "open")]);
    const last = await env.DB.prepare("SELECT MAX(id) AS id FROM events").first<{ id: number }>();
    expect(last?.id).toBe(5);
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});
