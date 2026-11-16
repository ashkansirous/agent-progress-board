import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const MIGRATION = "0005_parts.sql";
const ITEMS_BEFORE = ["0001_items.sql", "0002_doc_sync.sql", "0004_steps.sql"];
const USAGE_MIGRATION = "0003_usage.sql";

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

/** The items and events tables as migration 0004 left them (the other tables have no key to either). */
async function rebuildAt0004(): Promise<void> {
  await run(["DROP TABLE events", "DROP TABLE items"]);
  for (const name of ITEMS_BEFORE.slice(0, 2)) await run(queriesOf(name));
  await run(queriesOf(USAGE_MIGRATION).filter((query) => query.replace(COMMENT_LINE, "").trimStart().startsWith("ALTER TABLE items")));
  await run(queriesOf("0004_steps.sql"));
}

const ITEM_COLUMNS = `key, project, parent, type, priority, status, title, why, details_md, links, source,
  heartbeat_at, created_at, updated_at, done_at, in_doc_sync, doc_status, doc_status_at, live_status_at,
  environment, steps, agent, model`;

function seedItem(key: string, type: string, status: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO items (${ITEM_COLUMNS}) VALUES (?1, 'demo-app', 'Plan', ?2, 'P1', ?3, ?4, 'why', '# details',
      '[{"label":"PR","url":"https://example.com/1"}]', 'doc-sync', '2026-11-15T10:00:00.000Z', '2026-11-15T09:00:00.000Z',
      '2026-11-15T10:00:00.000Z', NULL, 1, 'open', '2026-11-15T09:00:00.000Z', NULL, 'prod', '[]', 'Reviewer', 'model-x')`,
  ).bind(key, type, status, `Title of ${key}`);
}

function seedEvent(key: string, at: string, status: string): D1PreparedStatement {
  return env.DB.prepare("INSERT INTO events (item_key, at, status, source, note) VALUES (?1, ?2, ?3, 'doc-sync', 'note')").bind(key, at, status);
}

describe("migration 0005 over a populated 0004 database", () => {
  it("keeps every item and every event with its id, allows the part type, and resumes event ids", async () => {
    await rebuildAt0004();
    await run(["INSERT INTO items (key, project, type, priority, status, title, heartbeat_at, created_at, updated_at) VALUES ('t/part', 't', 'part', 'P2', 'open', 'x', 'a', 'a', 'a')"]).then(
      () => Promise.reject(new Error("0004 must refuse the part type")),
      () => undefined,
    );
    await env.DB.batch([
      seedItem("demo-app/slice-1", "slice", "open"),
      seedItem("demo-app/slice-2", "slice", "done"),
      seedItem("demo-app/bug-1", "bug", "in_progress"),
      seedEvent("demo-app/slice-1", "2026-11-15T09:00:00.000Z", "open"),
      seedEvent("demo-app/slice-1", "2026-11-15T10:00:00.000Z", "in_progress"),
      seedEvent("demo-app/slice-2", "2026-11-15T11:00:00.000Z", "done"),
      seedEvent("demo-app/bug-1", "2026-11-15T12:00:00.000Z", "in_progress"),
    ]);
    const itemsBefore = (await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY key`).all()).results;
    const eventsBefore = (await env.DB.prepare("SELECT id, item_key, at, status, source, note FROM events ORDER BY id").all()).results;
    expect(itemsBefore).toHaveLength(3);
    expect(eventsBefore).toHaveLength(4);

    await expect(run([...queriesOf(MIGRATION), "INSERT INTO no_such_table VALUES (1)"])).rejects.toThrow();
    const leftovers = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE name IN ('events_keep', 'items_new')").all()).results;
    expect(leftovers).toEqual([]);
    expect((await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY key`).all()).results).toEqual(itemsBefore);
    expect((await env.DB.prepare("SELECT id, item_key, at, status, source, note FROM events ORDER BY id").all()).results).toEqual(eventsBefore);

    await run(queriesOf(MIGRATION));

    const itemsAfter = (await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY key`).all()).results;
    const eventsAfter = (await env.DB.prepare("SELECT id, item_key, at, status, source, note FROM events ORDER BY id").all()).results;
    expect(itemsAfter).toEqual(itemsBefore);
    expect(eventsAfter).toEqual(eventsBefore);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO items (key, project, type, priority, status, title, heartbeat_at, created_at, updated_at, parent_key) VALUES ('demo-app/slice-1/part-A', 'demo-app', 'part', 'P2', 'open', 'x', 'a', 'a', 'a', 'demo-app/slice-1')",
      ),
      seedEvent("demo-app/slice-1/part-A", "2026-11-15T13:00:00.000Z", "open"),
    ]);
    const last = await env.DB.prepare("SELECT MAX(id) AS id FROM events").first<{ id: number }>();
    expect(last?.id).toBe(5);
    const violations = (await env.DB.prepare("PRAGMA foreign_key_check").all()).results;
    expect(violations).toEqual([]);
  });
});
