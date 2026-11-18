-- Slice 34: the cron's stale query (EXPIRED_ROWS in src/infrastructure/d1Repository.ts) filters on the live
-- statuses and a heartbeat older than a cutoff. With the status first and the heartbeat second, it seeks both
-- statuses by range instead of reading every row of those statuses (and, before, every item) twice per run.
-- The old idx_items_status stays: other queries use it, and this index would serve a status-only lookup too.
CREATE INDEX idx_items_status_heartbeat ON items (status, heartbeat_at);

-- The cron's waiting-card close (WAITING_ROWS) reads only open waiting_for_me cards older than a cutoff. The partial
-- index holds just those, and its WHERE is written the same in the query so the planner can use it.
CREATE INDEX idx_items_waiting_open ON items (heartbeat_at) WHERE type = 'waiting_for_me' AND status != 'done';
