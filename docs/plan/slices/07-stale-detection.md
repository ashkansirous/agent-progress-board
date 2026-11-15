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
  cheaper against the free-tier limits from Slice 1). (The mock supersedes the "or": its
  history shows a "Stale · Heartbeat expired" event, so the change to `stale` writes a real
  event, which only the cron trigger can do.)
- Doc-sync items never go stale; the next sync refreshes them.
- Stale tiles look distinct on the board (label plus colour).

#### Design (Agent Progress Board mock, Main.dc.html, added 2026-11-15)

One artboard shows it (the desktop board: the Slice 10 tile and its drawer); the mock agrees with the
plan (dashed, muted, label) and fixes the look. Full values are in
[Slice 2](02-tile-board.md) *Design*.

- **Tile.** bg `#F5F6F8`, 1 px dashed border `#9AA3B2`, title `#5B6370`, opacity 1, in the "In
  flight" section. Status label (12 px, 600, muted, hollow 7 px dot): "Stale · No heartbeat for
  3 h", the hours from `heartbeat_at` to now, rounded down. In dark: bg `#171A21`, border
  `#4A5262` (not drawn; the dashed border and muted title carry over).
- **Drawer.** Status row reads "Stale" in muted. History: newest event "Stale · Heartbeat
  expired" at the time the cron marked it, then the last heartbeat ("In progress · Last
  heartbeat"). Details text: "The session stopped reporting. A new report on this key brings
  it back." (that sentence is the item's own `details_md`, sample data, not UI copy).
- New strings: "Stale", "Stale · {note}", "No heartbeat for {n} h" (in the Slice 2 table).

**Plan changed to match the mock (2026-11-15):** the cron trigger is the only option and writes
an event note "Heartbeat expired" with status `stale` (Main.dc.html, slice-10 history); the
stale label carries the hours.

#### Work

- [ ] Expiry rule and its trigger, with tests; the trigger writes the event ("Heartbeat
      expired") and a new report on the key writes the recovery event.
- [ ] Stale styling on the board, as drawn (dashed border, muted title, "Stale · No heartbeat
      for N h"), light and dark.

#### Verification

- Tests green; a killed session's item turns stale within the expiry time and recovers on the
  next report.
