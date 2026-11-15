-- Slice 4: what the docs said and when, so a snapshot can merge with live reports.
ALTER TABLE items ADD COLUMN in_doc_sync INTEGER NOT NULL DEFAULT 0 CHECK (in_doc_sync IN (0, 1));
ALTER TABLE items ADD COLUMN doc_status TEXT CHECK (doc_status IN ('open', 'in_progress', 'blocked', 'done', 'stale'));
ALTER TABLE items ADD COLUMN doc_status_at TEXT;
ALTER TABLE items ADD COLUMN live_status_at TEXT;

UPDATE items SET live_status_at = updated_at;

CREATE INDEX idx_items_doc_sync ON items (project, in_doc_sync);
