-- Slice 8: usage samples (running token totals), cap readings (raw), series order.
-- Only what was reported is stored; restarts, windows and accepted or dropped are worked out
-- when read (src/domain/usage.ts, src/domain/cap.ts).

-- One sample: the running totals of one agent on one model, up to the newest record counted.
-- A NULL environment counts as the empty string in the identity, so one report stores one row.
CREATE TABLE usage_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key TEXT NOT NULL,
  model TEXT NOT NULL,
  environment TEXT,
  record_at TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  task_key TEXT,
  agent_kind TEXT,
  step TEXT
);

CREATE UNIQUE INDEX idx_usage_samples_identity
  ON usage_samples (agent_key, model, COALESCE(environment, ''), record_at);
CREATE INDEX idx_usage_samples_time ON usage_samples (record_at);
CREATE INDEX idx_usage_samples_task ON usage_samples (task_key);

-- One raw cap reading of one window of one plan.
CREATE TABLE cap_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at TEXT NOT NULL,
  plan TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  percent REAL NOT NULL CHECK (percent >= 0 AND percent <= 100),
  reset_at TEXT,
  source TEXT
);

CREATE UNIQUE INDEX idx_cap_readings_identity ON cap_readings (taken_at, plan, window_kind);
CREATE INDEX idx_cap_readings_time ON cap_readings (taken_at);

-- First time a model, agent kind or environment was reported: fixes its colour index. Never thinned.
CREATE TABLE usage_series (
  kind TEXT NOT NULL CHECK (kind IN ('model', 'agent_kind', 'environment')),
  value TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);

-- Where the work ran, as the client sent it (free text); shared with Slice 10.
ALTER TABLE items ADD COLUMN environment TEXT;
