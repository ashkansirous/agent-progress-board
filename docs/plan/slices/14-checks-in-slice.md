### Slice 14 — Untested checks live inside their slice, and problems get their own list

*Planned.* Part A (server) can be built now. Part B (the page) is designed (see *Design* below) and
is built after the owner has reviewed the plan PR.

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
- **"N checks with no open slice" is a dashed card under Planned; the quiet summary includes the
  check count** (owner, 2026-11-17, step 2 of the request for Slices 13 to 15).

#### Decided at the desk

- **A new item type `check`**, with `parent_key` naming its slice, handled like `part`: no card of
  its own, listed in the slice's drawer, counted on the slice card. The doc sync sends checks inside
  the slice they belong to (the snapshot shape gains `checks: [{key, title}]` per slice, next to
  `parts`); close-missing closes a check that left the file, as it does for parts.
- **A check line with no slice** (an unverified block whose slice is not in the snapshot) goes
  under a project-level "Checks with no open slice" entry, counted in the header total, never as a
  card. (The mock draws it as a dashed card under Planned: see *Design*, B2.)
- **Board groups returned by `/api/board`**, per project: `needs_you`, `working_now` (in progress
  with a live heartbeat, `isWorkingNow`), `planned` (slices open, in progress or blocked, each with
  its parts and checks; a blocked slice is shown as "Parked"), `problems` (types `bug` and `problem`
  not done), `done` (the count of items finished or gone stale in the last 12 hours, plus the newest
  five of them with their time and a `stale` flag; the page keeps them collapsed), and a `summary`
  line's numbers (needs you, working, planned, problems, checks not tried). The grouping rule is one
  function in `src/domain/` with tests; the page does not regroup.
- **A bug or problem can name its slice.** `parent_key` is accepted on `bug` and `problem` too and
  names the slice planned for it; the board returns the slice's number or null, which the page shows
  as "Slice 12 planned" or "No slice yet" (from the mock).
- **The slice's number and its title come as two values** ("Slice 12", "App crashes on start"), as
  the card shows them (from the mock). The implementer reads `src/domain/docSync.ts` for where the
  number lives today; if the snapshot carries only one string, the doc sync splits it and a test
  holds the split.
- **Existing check cards on the live board** close by themselves on the first doc sync after this
  ships (they leave the snapshot as slices). The config repo's slice clears what is left.

#### Design (BoardV2 mock, sections BoardV2, BoardV2Dark, PhoneV2, PhoneV2Light, PhoneV2Drawer, added 2026-11-17)

Source: `docs/design/` ([README](../../design/README.md) sections table). The same five frames as
[Slice 13](13-session-cards.md) *Design* (one component, light and dark, desktop and phone); the
mock agrees with the plan: checks are counts, never cards, and problems have their own list. Colour
names are the `CONFIG.theme` keys at line 246 (values in [Slice 15](15-project-blocks.md)
*Design*). Line numbers are lines of `BoardV2.dc.html`.

- **B1 Planned slice card** (lines 112 to 137, data `ex.planned` lines 257 to 259). Under "Planned ·
  {count}" (12px, 700, upper case, 0.06em, `muted`; the count is slices only). Grid
  `repeat(auto-fill, minmax(280px, 1fr))`, gap 12px. Card: background `sliceBg`, border 1px
  `sliceBd`, radius 12px, padding 14px 16px, gap 8px (from the mock: planned slices keep the blue
  slice tint). Row 1, 11px: the number "Slice 12" (700, upper case, 0.05em, `sliceFg`) and at the right
  a status pill (600, padding 1px 8px, radius 999px, background `card`, text `sub`, border 1px
  `sliceBd`) with "In progress", "Planned" or "Parked". Title 15px, 600. A parts bar (decorative,
  `aria-hidden`): one segment per part, gap 3px, each `flex: 1`, 16px high, radius 4px, the part
  letter inside (10px, 700, centred), border 1px. Done part: background `sliceFg`, letter `card`,
  border `sliceFg`. Active part: background `card`, letter `sliceFg`, border `sliceFg`. Later part:
  transparent, letter `muted`, border `sliceBd`. Then a row, 12px, `sub`: at the left the line "Now:
  part C, fix the start-up race" or "Not started" or "Parked after part A" (600) and at the right "2
  of 5 parts". Then a row with a phone icon (13px, outline, stroke `muted`; a rectangle 12 by 20 with
  a small line at the bottom), 12px, `muted`: "3 checks not tried on a device" or "All checks
  tried". A "Parked" card is drawn at 70% opacity. The whole card opens the drawer.
- **B1 Sample data note:** "Slice 11, Share sheet, Parked" has parts A done, B and C later and 0
  checks; it shows "All checks tried". "Slice 13, Offline mode" has four later parts and 5 checks.
- **B2 "N checks with no open slice"** (lines 129 to 134): the last cell of the Planned grid, a
  dashed card: transparent, border 1px dashed `border`, radius 12px, padding 14px 16px, content
  centred vertically. Line 1, 14px, 600: "22 checks with no open slice". Line 2, 12px, `muted`: "Not
  tried on a device; their slices are already closed". The Planned section shows when there is a
  planned slice or such checks. In the mock the card does nothing when tapped. Decided here, not in
  the mock: it opens the drawer with the list of those check lines (a "Checks not tried on a device"
  list as in B4).
- **B3 Problems and bugs** (lines 139 to 153, data `ex.problems` lines 263 to 264). Under "Problems and
  bugs · {count}" (same heading style). Same grid as Planned. Card: radius 12px, padding 14px 16px,
  gap 6px; a bug uses `bugBg`, border `bugBd`, kind colour `bugFg`; a problem uses `probBg`, `probBd`,
  `probFg`. Line 1: the kind, "Bug" or "Problem" (11px, 700, upper case, 0.05em). Line 2: what is
  wrong, 15px, 600 ("App crashes on start on iOS 16"). Line 3: where it was found, 12px, `sub`
  ("Found in the crash log of release 2.3.1, iPhone 8"; it is the item's `why`). Last: a slice
  chip, 12px, 600, padding 2px 9px, radius 999px, aligned left. With a slice: "Slice 12 planned",
  background `card`, text `text`, a solid 1px border in the kind colour. Without: "No slice yet",
  transparent, text in the kind colour, dashed 1px border in the kind colour. The card opens the
  drawer (kicker "Bug", `bugBg`/`bugFg`; meta "Reported by session 9c1e · Slice 12 is planned for it";
  links "Slice 12", "Crash log").
- **B4 Drawer: parts and checks** (lines 208 to 227). After "Steps" (a working card) or "Done so far"
  (a slice): a heading and a checklist of the parts: "Parts · 2 of 5 done" on a slice and "Slice 12
  parts · 2 of 5 done" on a working card. Row: grid `22px 1fr auto`, gap 10px, 14px; an 18px box
  (radius 4px, 1.5px stroke). Done part: box filled `doneFg` with a white tick, label `muted`, state
  "Done" (`doneFg`, 12px, 600). Active part: empty box, `sliceFg` stroke, state "Working now" (`sliceFg`).
  Later part: empty box, `muted` stroke, no state word. Label "A · Reproduce on a device". Then the
  checks: "Checks not tried on a device · 3" on a slice and "Slice 12 checks not tried on a device · 3"
  on a working card; rows of an empty 18px box (`muted` stroke) and the line ("Cold start on the
  iPhone 8 with no network"). Neither list is shown when empty.
- **B4 Slice drawer** (`s12`, line 298): kicker "Slice 12" on `sliceBg`/`sliceFg`; title "App crashes
  on start"; purpose "In progress · 2 of 5 parts done"; meta "From the plan docs · synced 13:40";
  "Done so far", parts, checks, "Links" ("Slice file", "Pull request #86"), History ("Mon 16
  Planned", "Tue 17 08:10 Part A done", "Tue 17 09:02 Part B done", "Tue 17 10:05 Part C started").
- **B5 Project summary line** (`renderVals`, lines 350 to 357): the pieces in this order, joined by
  " · ": "{n} needs you" (only when above 0), "{n} working" or "nothing running", "{n} planned" (only
  above 0), "{n} problems" (only above 0), "{n} checks not tried" (checks of all planned slices plus
  the checks with no open slice; only above 0). It is on every project header, folded or open
  (Slice 15). From the mock: the check count is part of it, and the needs-you piece comes first.
  Example: "1 needs you · 3 working · 3 planned · 2 problems · 30 checks not tried". The mock writes
  the words without singular forms ("1 needs you"); the page's string table handles plurals and
  German.
- **B6 Done list** (lines 155 to 166; Slice 15 owns the fold): the button "12 done in the last 12
  hours" (13px, 600, `doneFg`); rows are the newest five (title 13px 500, time 12px `muted` at the
  right); a link-coloured row "Show all 12" when the count is above the list. In the mock that row
  does nothing; decided here, not in the mock: it adds the remaining items of the same 12 hours to
  the list. A stale session row is dashed on `chip` with `muted` text (Slice 13, B4).
- **Simplified illustrations:** none is a labelling bubble. Slice numbers, titles, counts (22
  checks, 12 done) and times are made-up sample data. Model, project and session names are made up.
- **Not in the mock** (stays in the slice as written): the doc-sync snapshot shape with `checks`; the
  grouping function; the doc sync closing a check that left the file; a slice with parts but no
  active part ("Now:" line for it); the slice number and title split in the doc sync; the loose-check
  list in the drawer (decided above).
- **New strings (EN and DE):** "Planned", "Problems and bugs", "In progress", "Parked", "Not
  started", "Parked after part {x}", "Now: part {x}, {title}", "{n} of {m} parts", "{n} checks not
  tried on a device", "All checks tried", "{n} checks with no open slice", "Not tried on a device;
  their slices are already closed", "Bug", "Problem", "Slice {n} planned", "No slice yet", "Parts ·
  {n} of {m} done", "Slice {n} parts · {a} of {b} done", "Checks not tried on a device · {n}", "Slice
  {n} checks not tried on a device · {n}", "Working now" (state word), "Done", "{n} done in the last
  12 hours", "Show all {n}", "{n} needs you", "{n} working", "nothing running", "{n} planned", "{n}
  problems", "{n} checks not tried".

**Plan changed to match the mock (2026-11-17):** status line; "N checks with no open slice" and the
check count in the summary are now decisions; the planned group takes blocked slices as "Parked"
(the mock draws "Parked"); `done` is a 12-hour count plus the newest five, with stale session cards
(the mock's "12 done in the last 12 hours" and stale row); the summary numbers are needs you,
working, planned, problems, checks not tried, in the mock's order (the old example "nothing running
· 2 planned · 1 needs you" is superseded in order, its numbers stay); a bug or problem can name its
slice (the mock's "Slice 12 planned" / "No slice yet"); the slice number and title come separately;
seed data is the mock's; part B work items are rewritten.

#### Work

**A. Server**

- [ ] `ItemType.Check`; schema and upsert accept it only with a `parent_key`; `docs/clients.md`
  shows a snapshot with parts and checks on a made-up project.
- [ ] Doc sync accepts `checks` per slice and closes missing ones; tests for add, keep, close and a
  check with no slice.
- [ ] `parent_key` is accepted on `bug` and `problem` and names the slice planned for it; tests for
  a bug with a slice, a problem without, and a key that names no slice.
- [ ] The grouping function and its tests: a quiet project (no work now, two planned slices, one
  needs you) gives the numbers for "1 needs you · nothing running · 2 planned"; a blocked slice is
  in `planned` and flagged parked; `done` holds the 12-hour count and the newest five, a stale
  session card among them with `stale: true`; the summary numbers are needs you, working, planned,
  problems, checks not tried.
- [ ] `/api/board` returns the groups and the counts (checks per slice, checks per project, checks
  with no open slice), the slice number and title as two values, and for each problem the slice it
  names.
- [ ] Seed data: the mock's made-up projects (`PROJECTS`, `BoardV2.dc.html` lines 248 to 282):
  `example-app` with Slices 12 (in progress, parts A to E with A and B done and C active, 3 checks),
  13 (planned, four parts, 5 checks) and 11 (parked, three parts, 0 checks), 22 checks with no open
  slice, one bug naming Slice 12, one problem naming none, 12 done in the last 12 hours; `notes-site`
  with Slices 4 and 5 and 3 done; `tools` with nothing but a question.

**B. Page (design in `docs/design/`, see *Design* above)**

- [ ] Slice cards as B1: tint, status pill, parts bar with letters, the "Now:" line, "N of M parts",
  the check count line, "Parked" at 70% opacity.
- [ ] The dashed "N checks with no open slice" card under Planned as B2.
- [ ] The "Problems and bugs" list as B3, with the slice chip.
- [ ] The drawer lists the parts and the checks as B4, for a slice and for a working card.
- [ ] The project summary line as B5 and the Done button and list as B6.
- [ ] Both themes, English and German strings.
- [ ] E2E: a project with 30 checks shows them as counts, not cards; the loose-checks card and the
  slice card count agree with the summary line.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- On the deployed board after a real doc sync: this repo shows no card per check, and the header
  total equals the count line in `plan.md`.
- The owner compares the deployed page with `BoardV2.dc.html` (Planned, Problems and bugs, Done) and
  the drawer in `BoardV2Dark.dc.html`.
