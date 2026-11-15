### Slice 7 — Stale detection

Source: phone scope (2026-11-15), milestone 7 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `src/**`, `wrangler.jsonc`, `test/**`, `web/**`, `config/board.example.json`,
`README.md`

#### Why

A crashed session must not leave a tile saying "in progress" forever.

#### Decisions

- Live-event items carry `heartbeat_at`; the reporter refreshes it on every call. An
  `in_progress` or `blocked` live item whose heartbeat is older than the expiry (from config)
  turns `stale`; a new report on the same key brings it back.
- A Workers cron trigger marks stale items (or the list query computes it; pick whichever is
  cheaper against the free-tier limits from Slice 1).
- Doc-sync items never go stale; the next sync refreshes them.
- Stale tiles look distinct on the board (label plus colour).

#### Work

- [ ] Expiry rule and its trigger, with tests.
- [ ] Stale styling on the board.

#### Verification

- Tests green; a killed session's item turns stale within the expiry time and recovers on the
  next report.
