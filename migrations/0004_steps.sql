-- Slice 10: the steps list of a task (JSON, the whole list as the client sent it), the kind of
-- agent holding it and its model. `environment` came with migration 0003 (Slice 8).
ALTER TABLE items ADD COLUMN steps TEXT;
ALTER TABLE items ADD COLUMN agent TEXT;
ALTER TABLE items ADD COLUMN model TEXT;
