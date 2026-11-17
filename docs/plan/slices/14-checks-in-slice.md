### Slice 14 — Untested checks live inside their slice, and problems get their own list

*Planned.* Part A (server) can be built now. Part B (the page) waits for the Claude Design mock
named in the [design brief](../notes/2026-11-17-design-brief.md).

**Touches:** `src/domain/item.ts`, `src/domain/docSync.ts`, `src/domain/parts.ts`, `src/domain/checks.ts` (new),
`src/application/board.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/api/boardDto.ts`, `src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `web/**`,
`e2e/**`, `scripts/seed-data.ts`, `docs/plan/slices/14-checks-in-slice.md`

**Migrations:** none (a new item type is a value, not a column).

#### Why

The owner, 2026-11-17: "the board is useless! it is filled with junk ... right now, nothing is
happening in this repo/project, but it has 30 in flight actions". Read the same day from the live
board: all 30 open items of this repo, and about 35 of 42 in the config repo, were lines of
`docs/plan/unverified.md`, each sent by the doc sync as an open `slice` item ("German locale on the
page.", "Dark desktop values."). The real planned slices sat among them with nothing to tell them
apart, and "In flight" counts every item that is not done and not waiting (`web/src/model.ts`). No
client reports bugs or problems, though the types exist.

#### Decisions (owner, 2026-11-17, "agree to all")

- **"Not yet tried on a device" lines are not cards.** Each one is listed inside the slice it
  belongs to; the slice card shows the count ("3 checks not tried on a device"); the project header
  shows the total.
- **Problems and bugs get their own list per project**, reported by agents on the spot, until they
  are planned into a slice or fixed.
- **"In flight" means work someone is doing now**, not every open item. Planned slices are
  "Planned".

#### Decided at the desk

- **A new item type `check`**, with `parent_key` naming its slice, handled like `part`: no card of
  its own, listed in the slice's drawer, counted on the slice card. The doc sync sends checks inside
  the slice they belong to (the snapshot shape gains `checks: [{key, title}]` per slice, next to
  `parts`); close-missing closes a check that left the file, as it does for parts.
- **A check line with no slice** (an unverified block whose slice is not in the snapshot) goes
  under a project-level "Checks with no open slice" entry, counted in the header total, never as a
  card.
- **Board groups returned by `/api/board`**, per project: `needs_you`, `working_now` (in progress
  with a live heartbeat, `isWorkingNow`), `planned` (slices open or in progress, each with its
  parts and checks), `problems` (types `bug` and `problem` not done), `done` (count plus items, the
  page keeps them collapsed), and a `summary` line's numbers. The grouping rule is one function in
  `src/domain/` with tests; the page does not regroup.
- **Existing check cards on the live board** close by themselves on the first doc sync after this
  ships (they leave the snapshot as slices). The config repo's slice clears what is left.

#### Work

**A. Server**

- [ ] `ItemType.Check`; schema and upsert accept it only with a `parent_key`; `docs/clients.md`
  shows a snapshot with parts and checks on a made-up project.
- [ ] Doc sync accepts `checks` per slice and closes missing ones; tests for add, keep, close and a
  check with no slice.
- [ ] The grouping function and its tests: a quiet project (no work now, two planned slices, one
  needs you) gives the numbers for "nothing running · 2 planned · 1 needs you".
- [ ] `/api/board` returns the groups and the counts (checks per slice, checks per project).
- [ ] Seed data: two planned slices with parts and checks, one problem, one bug, three done.

**B. Page (after the design mock is imported into `docs/design/`)**

- [ ] Slice cards show the parts bar and the check count; the drawer lists the checks.
- [ ] The "Problems and bugs" list as the mock shows it.
- [ ] E2E: a project with 30 checks shows them as counts, not cards.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- On the deployed board after a real doc sync: this repo shows no card per check, and the header
  total equals the count line in `plan.md`.
