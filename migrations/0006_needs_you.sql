-- Slice 13: "needs you" is a state of any item, not a second item. `needs_you` is the agent's own
-- question, `after_answer` what it will do next, `needs_you_at` when the question was first asked
-- (the page shows "waiting N min"). All three are NULL when no question is open. Adding nullable
-- columns needs no table rebuild.
ALTER TABLE items ADD COLUMN needs_you TEXT;
ALTER TABLE items ADD COLUMN after_answer TEXT;
ALTER TABLE items ADD COLUMN needs_you_at TEXT;
