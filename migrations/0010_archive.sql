-- Slice 50: an item can be archived (hidden from the board, list_open and every count, kept for 30 days, then purged
-- by the daily cron). `archived_at` is the UTC ISO time of the archive, NULL for every live item. Adding a nullable
-- column needs no table rebuild.
ALTER TABLE items ADD COLUMN archived_at TEXT;

-- The purge reads only archived rows older than a cutoff; the partial index holds just the archived ones, and the
-- query repeats `archived_at IS NOT NULL` so the planner can use it.
CREATE INDEX idx_items_archived_at ON items (archived_at) WHERE archived_at IS NOT NULL;
