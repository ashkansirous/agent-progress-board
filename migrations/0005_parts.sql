-- Slice 11: a slice part is an item of the new type 'part', and an item can name another item's key
-- (a part names its slice) in `parent_key`. The text column `parent` stays as it is.
--
-- SQLite cannot change a CHECK constraint, so the items table is rebuilt with 'part' allowed.
-- The history table has a foreign key to items, and dropping a parent that rows still point at fails
-- even with the check deferred (the counter is not cleared by the new table taking the name), so
-- events is rebuilt around it: its rows wait in a table with no key while items is replaced.
--
-- Atomic: D1 applies a migration file in one transaction and rolls it back on an error (wrangler
-- d1 migrations apply), so a failed run leaves the old tables and rows as they were, events_keep and
-- items_new are gone again and a retry starts clean. test/migration0005.test.ts runs it over a
-- populated database, and a run that fails at its last statement, and compares every row.
-- `PRAGMA defer_foreign_keys` (documented for schema changes in D1) holds the key check to the end
-- of the transaction, when every key is back.
PRAGMA defer_foreign_keys = on;

CREATE TABLE events_keep AS SELECT id, item_key, at, status, source, note FROM events;

CREATE TABLE items_new (
  key TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  parent TEXT,
  type TEXT NOT NULL CHECK (type IN ('slice', 'problem', 'waiting_for_me', 'bug', 'unplanned', 'part')),
  priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'stale')),
  title TEXT NOT NULL,
  why TEXT,
  details_md TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  heartbeat_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT,
  in_doc_sync INTEGER NOT NULL DEFAULT 0 CHECK (in_doc_sync IN (0, 1)),
  doc_status TEXT CHECK (doc_status IN ('open', 'in_progress', 'blocked', 'done', 'stale')),
  doc_status_at TEXT,
  live_status_at TEXT,
  environment TEXT,
  steps TEXT,
  agent TEXT,
  model TEXT,
  parent_key TEXT
);

INSERT INTO items_new (key, project, parent, type, priority, status, title, why, details_md, links, source,
  heartbeat_at, created_at, updated_at, done_at, in_doc_sync, doc_status, doc_status_at, live_status_at,
  environment, steps, agent, model)
SELECT key, project, parent, type, priority, status, title, why, details_md, links, source,
  heartbeat_at, created_at, updated_at, done_at, in_doc_sync, doc_status, doc_status_at, live_status_at,
  environment, steps, agent, model
FROM items;

DROP TABLE events;
DROP TABLE items;
ALTER TABLE items_new RENAME TO items;

CREATE INDEX idx_items_project ON items (project);
CREATE INDEX idx_items_status ON items (status);
CREATE INDEX idx_items_done_at ON items (done_at);
CREATE INDEX idx_items_doc_sync ON items (project, in_doc_sync);
-- Partial index: only parts and other linked items have a parent_key.
CREATE INDEX idx_items_parent_key ON items (parent_key) WHERE parent_key IS NOT NULL;

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL REFERENCES items (key),
  at TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT,
  note TEXT
);

INSERT INTO events (id, item_key, at, status, source, note)
SELECT id, item_key, at, status, source, note FROM events_keep;

DROP TABLE events_keep;

CREATE INDEX idx_events_item ON events (item_key, at);
