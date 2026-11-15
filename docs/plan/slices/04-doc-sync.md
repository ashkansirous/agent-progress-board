### Slice 4 — Doc sync: snapshot endpoint

Source: phone scope (2026-11-15), milestone 4 and *The hard part* — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `src/**`, `test/**`, `README.md`

#### Why

The board must be true even when no agent remembered to report. Repo plan docs are the state;
live events only add motion. The parser that reads a repo's plan docs is a client (built in
the owner's private config repo); this slice is the server side it calls.

#### Decisions

- `PUT /projects/:project/snapshot` takes the full set of doc-sync items for one project
  (source `doc-sync`). Doc-sync items of that project missing from the snapshot become `done`
  (the slice left the open table). Items from other sources are never closed by a snapshot.
- Merge on one key: when a doc-sync item and a live item share a key, doc sync wins on
  title, why, parent and links; the live status wins when its `updated_at` is newer.
- Idempotent: the same snapshot twice changes nothing (callers retry).
- Shares the upsert domain function with `PUT /items/:key` (`CLAUDE.md`, *One upsert contract*).

#### Work

- [ ] Snapshot endpoint with tests for close-missing, the live-vs-doc merge and idempotency.
- [ ] README: the snapshot contract and the merge rule.

#### Verification

- Tests green.
- With the client: a repo with no live events shows its open slices and unverified checks after
  one sync; a second sync changes nothing; a slice removed from the repo's table turns done.
