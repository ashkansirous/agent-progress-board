### Slice 14 — Untested checks live inside their slice, and problems get their own list

*Built 2026-11-17 (wave 2026-11-17), merged as PR #78 (4865104); not yet verified on the deployed
board.* Parts A (server) and B (the page) are both built. The plan PR with the design (#73) is
merged. Migration 0007 rebuilds `items` and `events` for type `check`. 437 unit and 213 e2e tests
pass. Browser run (headless, `vite --mode e2e`, the real grouping over the seeds): 8 of 8 PASS
after one fix (item 4, the slice drawer kept the old parts view, failed on the first run);
evidence `reviews/wave9-s14-browser/results.md`.

**Touches:** `src/domain/item.ts`, `src/domain/docSync.ts`, `src/domain/parts.ts`, `src/domain/checks.ts` (new),
`src/domain/boardGroups.ts` (new: the grouping function), `src/domain/upsert.ts`, `src/domain/steps.ts`,
`src/application/board.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/api/board.ts`, `src/api/boardDto.ts`, `src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `web/**`,
`e2e/**`, `scripts/seed-data.ts`, `migrations/0007_checks.sql` (new), `docs/plan/slices/14-checks-in-slice.md`

**Migrations:** 0007 (widened at build time, wave 2026-11-17: `items.type` has a CHECK constraint
listing the allowed types in `migrations/0001_items.sql` and `0005_parts.sql`, so `check` needs a
table rebuild like 0005, keeping the 0006 columns and rebuilding `events` the same way).

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

#### Decided at build time (wave 2026-11-17, owner via the coordinator)

- Open items that are none of Needs you, Working now, Planned or Problems (an unplanned item nobody
  holds) go to an `other` list, drawn as plain tiles under "Other open items", so nothing is hidden.
- A stale item that is not a session card and not a slice stays where it was found: a stale slice shows
  under Planned with the "Planned" pill, any other stale item in `other`.
- A slice that an agent holds with a steps list is in `working_now` and in `planned`.
- A check always names its slice in `parent_key`. In a snapshot a loose check is a top-level `check`
  item with the `parent_key` of its (closed or absent) slice; a slice sending no `checks` leaves its
  stored ones alone, `checks: []` closes them.
- Key and parent validation is one pure function, `itemProblem(item, parent, project)` in
  `src/domain/checks.ts`, run on an item's final state (stored row merged with the report or snapshot
  entry): a parent in another project, a check with no slice parent, a check key not starting with
  its slice's key + "/", a check whose parent is no slice, checks on a non-slice, over 100 checks.
  `sync_snapshot` skips an item or nested check with a problem (and its parts and checks), saves the
  rest, still closes what left (a skipped key is not closed) and returns `skipped: [{key, reason}]`;
  `report_progress` refuses with the reason. `planItem` takes the snapshot's type, so a key stored as a
  slice or bug that is now sent as a check becomes a check. A key stored under another project still
  refuses the whole sync (unchanged). (review `reviews/pr-78-check-medium.md` #1, #2, #3, #4, #9)
- The "N checks with no open slice" card opens a drawer under the address key `loose-checks:<project>`.
- The Slice 11 "Follow part" link stays under a slice card (outside the card button).
- A working card's drawer lists the parts and checks of the slice its `parent_key` names.
- Migration 0007 rebuilds `items` and `events` like 0005 (the `type` CHECK allows `check`).
- Client-visible runtime change: `sync_snapshot` skips bad items and returns `skipped: [{key, reason}]`;
  a check's key must start with its slice's key + "/"; a slice sending `checks: []` closes its
  checks, a slice with no `checks` field keeps them.

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

- [x] `ItemType.Check`; schema and upsert accept it only with a `parent_key`; `docs/clients.md`
  shows a snapshot with parts and checks on a made-up project.
- [x] Doc sync accepts `checks` per slice and closes missing ones; tests for add, keep, close and a
  check with no slice.
- [x] `parent_key` is accepted on `bug` and `problem` and names the slice planned for it; tests for
  a bug with a slice, a problem without, and a key that names no slice.
- [x] The grouping function and its tests: a quiet project (no work now, two planned slices, one
  needs you) gives the numbers for "1 needs you · nothing running · 2 planned"; a blocked slice is
  in `planned` and flagged parked; `done` holds the 12-hour count and the newest five, a stale
  session card among them with `stale: true`; the summary numbers are needs you, working, planned,
  problems, checks not tried.
- [x] `/api/board` returns the groups and the counts (checks per slice, checks per project, checks
  with no open slice), the slice number and title as two values, and for each problem the slice it
  names.
- [x] Seed data: the mock's made-up projects (`PROJECTS`, `BoardV2.dc.html` lines 248 to 282):
  `example-app` with Slices 12 (in progress, parts A to E with A and B done and C active, 3 checks),
  13 (planned, four parts, 5 checks) and 11 (parked, three parts, 0 checks), 22 checks with no open
  slice, one bug naming Slice 12, one problem naming none, 12 done in the last 12 hours; `notes-site`
  with Slices 4 and 5 and 3 done; `tools` with nothing but a question.

**B. Page (design in `docs/design/`, see *Design* above)**

- [x] Slice cards as B1: tint, status pill, parts bar with letters, the "Now:" line, "N of M parts",
  the check count line, "Parked" at 70% opacity.
- [x] The dashed "N checks with no open slice" card under Planned as B2.
- [x] The "Problems and bugs" list as B3, with the slice chip.
- [x] The drawer lists the parts and the checks as B4, for a slice and for a working card.
- [x] The project summary line as B5 and the Done button and list as B6.
- [x] Both themes, English and German strings.
- [x] E2E: a project with 30 checks shows them as counts, not cards; the loose-checks card and the
  slice card count agree with the summary line.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- On the deployed board after a real doc sync: this repo shows no card per check, and the header
  total equals the count line in `plan.md`.
- The owner compares the deployed page with `BoardV2.dc.html` (Planned, Problems and bugs, Done) and
  the drawer in `BoardV2Dark.dc.html`.

#### From review

- review read: `reviews/pr-78-high.md` findings 8/8, all applied (#5, the `parent_key` validation, was applied narrowed, then replaced by the single `itemProblem` design below).
- Medium pass: 10 findings, 7 applied. Check pass: 9 findings, #1 to #4 and #9 fixed by the one validation design `itemProblem` in `src/domain/checks.ts` (two strikes on key and parent validation led to it, see *Decided at build time*). The rest are the lines below.
- `reviews/pr-78-check-2-medium.md` findings 7/7: #3 fixed, the rest are Follow-ups. `reviews/pr-78-check-3-medium.md` 7/7 and `reviews/pr-78-check-4-medium.md` 7/7: all Follow-ups, no code reopened.
- Skipped #3 (`../agent-progress-board-worktrees/reviews/pr-78-medium.md`): "Open checks of a done/out-of-window slice listed as loose" - decided at the desk: a check whose slice is not open goes under "Checks with no open slice"; that is the design.
- Skipped #4 (`../agent-progress-board-worktrees/reviews/pr-78-medium.md`): "Question/waiting ordering duplicated in web/src/model.ts (sentinel defined twice)" - low, no failure path.
- Skipped #9 (`../agent-progress-board-worktrees/reviews/pr-78-medium.md`): "Builds full itemDto for every check just to filter needs_you; extra CPU on each 5s poll" - low, no failure path.
- Skipped #5 (`../agent-progress-board-worktrees/reviews/pr-78-check-medium.md`): "A check whose open slice is missing from the listing (project filter) counts as loose ("no open slice"); header count wrong." - low; follow-up: a filtered listing should count such checks under their slice.
- Skipped #6 (`../agent-progress-board-worktrees/reviews/pr-78-check-medium.md`): "A check with an open question appears in needs_you but parentSliceOf handles only Part/Bug/Problem, so parent_slice is null." - low, no failure path that changes a count the owner reads wrongly beyond a label.
- Skipped #7 (`../agent-progress-board-worktrees/reviews/pr-78-check-medium.md`): "BOARD_WHERE lists parts/checks of an open slice but a done bug outside the window loses its slice number in the chip." - low, no failure path that changes a count the owner reads wrongly beyond a label.
- Skipped #8 (`../agent-progress-board-worktrees/reviews/pr-78-check-medium.md`): "Table rebuild drops events; if the production D1 runner does not apply the file atomically, a mid-failure loses event history. Confirm on real D1." - low, unconfirmed; same rebuild pattern as the shipped 0005.
- Fixed #3 (`../agent-progress-board-worktrees/reviews/pr-78-check-2-medium.md`): "A nested check/part skipped by screenSnapshot (bad key prefix, duplicate) is not added to `listed`, so closeTargets closes the existing stored row with that key." - every skipped key and every member of a skipped item is now listed.

#### Follow-ups

Second check pass, no code reopened (`../agent-progress-board-worktrees/reviews/pr-78-check-2-medium.md`):

- #1: "planItem overwrites stored type with the snapshot's type on every sync ... but the sync_snapshot schema (src/mcp/schemas.ts) still says type is used only when the key is new." - the type overwrite is intended per the earlier fix; correct the schema's description.
- #2: "Rows ordered by created_at DESC, key; checks of one sync share created_at so they sort by lexical key (check-10 before check-2), and a check added later jumps to the top. Doc order is not stored."
- #4: "topLevelProblem validates a check's parent via topLevel.get(parentKey) from the snapshot first, even if that sibling is later skipped or has another type; the check can be saved under a parent that is not saved as a slice."
- #5: "syncSnapshot no longer runs validateSnapshot on the expanded set; duplicate part letters or colliding keys are skipped quietly instead of rejecting the snapshot."
- #6: "Checks of finished slices all go into one project-wide loose list with no slice number or title, so the owner cannot tell which slice each unverified check belongs to." - this is the "Checks with no open slice" design.
- #7: "Page still regroups phone questions and the waiting strip itself (questionItems/waitingItems in model.ts), duplicating the needs_you rule in boardGroups.ts ... question-holding checks get no parent_slice."

Third check pass, converged, no code reopened (`../agent-progress-board-worktrees/reviews/pr-78-check-3-medium.md`):

- #1: "src/infrastructure/d1Repository.ts:56, low, other. BOARD_WHERE rider `type IN ('part','check')` loads done checks of listed slices; checksBySlice drops done checks, so up to 100 unused rows per slice on every poll."
- #2: "src/api/board.ts:189, medium, correctness. Check items holding an open question are appended to `items` after maps are built; they count toward working_count, the items-by-key map, phone questionItems and Active page, which were not told checks can be there. The `items` doc comment ("Check items are not in items") is false."
- #3: "web/src/route.ts:38, low, correctness. Loose-checks drawer uses the item address under prefix `loose-checks:`; item keys are free strings and the prefix is not reserved, so a key `loose-checks:x` can never be opened."
- #4: "src/domain/boardGroups.ts:163, medium, correctness. Checks whose slice is done/closed or never synced are counted as "loose checks" for the project, inflating checks_not_tried; the two cases are indistinguishable."
- #5: "src/domain/docSync.ts:200, medium, correctness. planItem now overwrites stored `type` on every doc sync; a live `bug`/`problem` (or part/check) sharing a key with a doc slice is silently retyped, bypassing reportProgress type-conflict handling."
- #6: "src/domain/checks.ts:75, low, correctness. checksBySlice counts every non-done check including stale and blocked, so dead live-reported checks keep showing as "not tried"."
- #7: "src/domain/docSync.ts:254, medium, correctness. isKeptChild keeps any child of a slice that sent no `parts`, so a doc-synced bug/problem with parent_key = slice that the document dropped is never closed."

Fourth check pass, converged, all page findings, no code reopened (`../agent-progress-board-worktrees/reviews/pr-78-check-4-medium.md`):

- #1: "web/src/ChecksView.tsx:62, medium, stale part loses stalled step and looks like working part (same active class, only word "Stale")."
- #2: "web/src/ChecksView.tsx:49, low, part list dropped aria-current=step; done/pending state only visual, no Next/Later words."
- #3: "web/src/strings.ts:261, low, dead strings (partActive, partActivePhone, partStale, partLater, partsHeading, partNextWord) and firstPendingKey used only by test."
- #4: "e2e/planning.spec.ts:49, low, tautology expect(3 + 5 + LOOSE_COUNT).toBe(30) cannot fail; card counts not tied to constants."
- #5: "web/src/ChecksView.tsx:45, low, part label "letter · title" built in code not t(); ul aria-label repeats h3 text."
- #6: "web/src/PartsView.tsx:59, low, PartsSection thin wrapper; own/not-own heading choice duplicated across PartChecklist and SliceChecks."
- #7: "web/src/planning.css:358, low, .check-state defaults to done green; stale shows blue, any new state word shows green."

#### For CLAUDE.md (lifted 2026-11-17)

- The board's grouping rule is one function, `groupBoard` in `src/domain/boardGroups.ts`; the page never regroups (Slice 14: docs/plan/slices/14-checks-in-slice.md).
- Item validation (key prefix, parent in the same project, check needs a slice parent, at most 100 checks) is one function, `itemProblem` in `src/domain/checks.ts`, used by `sync_snapshot` (skips the item, returns `skipped`) and `report_progress` (refuses); never add a second copy (Slice 14: docs/plan/slices/14-checks-in-slice.md).

#### For README.md (lifted 2026-11-17)

- Checks ("not tried on a device" lines) live inside their slice, never as cards; problems and bugs have their own list.

#### Not yet verified

- On the deployed board after a real doc sync: no card per check, and the header total equals the count line in `plan.md` (needs the config repo's client to send `checks`).
- Migration 0007 applied on the live D1 (it goes live only with a release; merges carry the skip-CI marker).
- The owner compares the deployed page with `BoardV2.dc.html` and `BoardV2Dark.dc.html`.
