-- Slice 41: a card is a task with an outcome. `outcome` is the one-line result the task delivers
-- (for example "Code merged to main"); NULL for items reported before this slice. Adding a nullable
-- column needs no table rebuild.
ALTER TABLE items ADD COLUMN outcome TEXT;
