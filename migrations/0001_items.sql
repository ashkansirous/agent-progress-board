-- Slice 1: the items board and its append-only event history.
CREATE TABLE items (
  key TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  parent TEXT,
  type TEXT NOT NULL CHECK (type IN ('slice', 'problem', 'waiting_for_me', 'bug', 'unplanned')),
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
  done_at TEXT
);

CREATE INDEX idx_items_project ON items (project);
CREATE INDEX idx_items_status ON items (status);
CREATE INDEX idx_items_done_at ON items (done_at);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL REFERENCES items (key),
  at TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT,
  note TEXT
);

CREATE INDEX idx_events_item ON events (item_key, at);
