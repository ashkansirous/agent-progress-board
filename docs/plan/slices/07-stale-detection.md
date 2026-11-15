### Slice 7 — Stale detection

Source: phone scope (2026-11-15), milestone 7 — see [Slice 1](01-items-api.md).

*In progress (wave 2026-11-15), draft PR.*

**Touches:** `src/**`, `wrangler.jsonc`, `test/**`, `web/**`, `config/board.example.json`,
`README.md`, `docs/clients.md`

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

#### Design of the expiry rule (coordinator, wave 3, 2026-11-15)

Grounded on `origin/main` before the claim: `heartbeat_at`, the `stale` status (SQL CHECK, domain
enum, MCP schemas), the stale strings and the dashed tile styling already exist; missing are the
expiry in config, the rule, the trigger and its event. No migration.

- **Which items can go stale (decided here, no question to the owner).** An item whose shown
  status is a live one: `status` is `in_progress` or `blocked`, `live_status_at` is set, and
  `doc_status_at` is empty or older than `live_status_at` (the same test doc sync uses for "the
  live status wins"). So an item only the docs ever set never goes stale ("Doc-sync items never
  go stale"), and a plan slice that a session reported as in progress and then died on does,
  which is the case the *Why* names. One pure, unit-tested domain function decides it from a row,
  the expiry and now.
- **One owner of the change: the cron trigger.** A `scheduled` handler calls one application
  function, which calls one new repository method. That method runs one D1 batch: insert the
  event (status `stale`, note "Heartbeat expired", at now) for every row the rule matches, then
  set those rows to `stale` with `updated_at` now. Both statements carry the rule in their own
  `WHERE`, so a report that lands in between is never overwritten. `heartbeat_at` and
  `live_status_at` are left as they are (the tile label counts hours from `heartbeat_at`; doc
  sync keeps treating the status as live).
- **Interrupts.** The cron run fails or is skipped: nothing changed, the next run marks the same
  rows. The cron runs twice: the second finds no row (they are `stale` already), so no second
  event. A report arrives on a stale key: the normal upsert sets the reported status, refreshes
  `heartbeat_at` and writes its event (the recovery event); a test proves it. Docs change the
  status of a stale item: doc sync's existing rule applies.
- **Config.** `staleAfterMinutes` in the board config (default 120, whole minutes, at least 15);
  the cron runs every 15 minutes (`*/15 * * * *`), one trigger, well inside the free plan.
- **Clients.** `docs/clients.md` says a reporter must call at least once per expiry while it
  works, and that any report brings a stale item back.

#### Work

- [ ] Expiry rule and its trigger, with tests; the trigger writes the event ("Heartbeat
      expired") and a new report on the key writes the recovery event.
- [ ] Stale styling on the board, as drawn (dashed border, muted title, "Stale · No heartbeat
      for N h"), light and dark.

#### Verification

- Tests green; a killed session's item turns stale within the expiry time and recovers on the
  next report.
