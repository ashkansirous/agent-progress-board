### Slice 4 — Doc sync: `sync_snapshot` tool

Source: phone scope (2026-11-15), milestone 4 and *The hard part* — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `src/**`, `test/**`, `README.md`, `docs/clients.md`

#### Why

The board must be true even when no agent remembered to report. Repo plan docs are the state;
live events only add motion. The parser that reads a repo's plan docs is a client (built in
the repo that wants it); this slice is the MCP tool it calls.

#### Decisions

- MCP tool `sync_snapshot(project, items[])` takes the full set of doc-sync items for one
  project (source `doc-sync`). Doc-sync items of that project missing from the snapshot become
  `done` (the slice left the open table). Items from other sources are never closed by a
  snapshot.
- Merge on one key: when a doc-sync item and a live item share a key, doc sync wins on title,
  why, parent and links; the live status wins when its `updated_at` is newer.
- Each snapshot item carries `parent` as display text (for example "Plan · Search"), as the
  board mock shows it (the mock supersedes a parent key; see Slice 1).
- Idempotent: the same snapshot twice changes nothing (callers retry).
- Shares the upsert in the application layer with `report_progress` (`CLAUDE.md`, *One contract*).

#### Work

- [ ] `sync_snapshot` with tests for close-missing, the live-vs-doc merge and idempotency.
- [ ] `docs/clients.md`: the snapshot tool and the merge rule.

#### Verification

- Tests green.
- With a client: a repo with no live events shows its open slices and unverified checks after
  one sync; a second sync changes nothing; a slice removed from the repo's table turns done.
