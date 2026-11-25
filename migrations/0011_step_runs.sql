-- Slice 54: one row of measured facts per finished step (and agent): the models it used with their tokens by kind,
-- the peak context and the compactions seen, with the step's times and where they came from. Statistics (totals,
-- medians) are worked out when read (src/domain/stepRuns.ts), never stored. No foreign key to items: the archive
-- purge (Slice 50) leaves these rows, and the cron deletes them after 180 days (STEP_RUN_KEEP_DAYS).
CREATE TABLE step_runs (
  item_key TEXT NOT NULL,
  step_id TEXT NOT NULL,
  -- The agent that owned the step; '' for the main thread.
  agent_id TEXT NOT NULL DEFAULT '',
  -- The session id of the plugin that computed the row: one writer per row by construction (Decision 10), so two sessions
  -- reporting the same step keep two rows and never compare their numbers.
  writer TEXT NOT NULL DEFAULT '',
  -- The process the step belongs to (Slice 55); NULL until then.
  process_key TEXT,
  -- JSON list of { model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens }.
  models TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  started_source TEXT NOT NULL,
  ended_source TEXT NOT NULL,
  peak_context INTEGER NOT NULL CHECK (peak_context >= 0),
  compactions INTEGER NOT NULL CHECK (compactions >= 0),
  -- The writer's counter, raised only when the row's numbers change: a report replaces the row only when its seq is greater,
  -- so a stale report that arrives last never overwrites a newer one.
  seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0),
  reported_at TEXT NOT NULL,
  PRIMARY KEY (item_key, step_id, agent_id, writer)
);

CREATE INDEX idx_step_runs_ended ON step_runs (ended_at);
