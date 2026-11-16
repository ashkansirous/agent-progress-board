### Slice 11 — Slice parts: progress bar on the slice, click through to the active part

Source: the owner at the desk, 2026-11-16 ("Each slice has multiple parts, say A to E. An agent
finished sub A. An agent picks slice X sub B. Then the status of slice X is in flight, and 20% of
it is done that should be shown in a progress bar under it ... From the main page, where we have
the slices, we should be able to click and follow to the sub task that is currently active").

*Built 2026-11-16, parts A and B, merged as PR #66 (01ab3f6, skip-CI batch); deployed 2026-11-16 (deployment created 18:25:23Z after PR #68 merged without the marker; `wrangler d1 migrations list DB --remote` at about 18:32Z: none to apply, so migration 0005 is applied, seen); not yet verified on the deployed board.* Needs [Slice 10](10-task-steps.md). The design mock arrived on 2026-11-16 (in
`docs/design/`); part B (the page) is planned against it (see *Design* below). The view tabs and
the tab bar are [Slice 8](08-usage-reports.md)'s and the Active work page is
[Slice 10](10-task-steps.md)'s; this slice reuses both.

**Touches:** `migrations/0005_parts.sql`, `src/domain/parts.ts`, `src/domain/item.ts`,
`src/domain/docSync.ts`, `src/domain/upsert.ts`, `src/application/board.ts`,
`src/application/ports.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`,
`src/mcp/tools.ts`, `src/api/boardDto.ts`, `src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`, `src/api/board.ts`, `src/domain/steps.ts`,
`src/domain/stepTypes.ts`, `src/domain/stale.ts`, `scripts/seed.ts`, `scripts/seed-data.ts`

**Migrations:** 0005

#### Why

A slice is often several parts built one after another, sometimes by different agents. Today the
board knows a slice as one tile with one status. The owner wants to see how much of it is done
and to get from the slice to the part someone is working on.

#### Decisions (owner, 2026-11-16)

- **Parts are the lettered groups in the slice's work list** (A, B, C and so on). A part is done
  when all its checkboxes are ticked.
- **The slice's bar is parts done over parts in the slice.** One of five done is 20%. The part
  in progress adds nothing until it is done.
- **A slice with a part in progress shows as in flight.**
- **From the slice, one click leads to the part that is active now**, on the active work page
  from Slice 10, with its steps.

#### Decided at the desk (not the owner's choices)

- **A real link between items.** Today `parent` is only a text shown on the tile. Items get a
  `parent_key` that names another item's key. The text field stays as it is.
- A part is an item with the key `<project>/slice-<N>/part-<letter>` and the new type `part`
  (types come from config; `part` is added to the example config). Parts get no tile of their
  own on the board page: they show under their slice and, when someone works on one, on the
  active work page.
- **The plan documents say which parts exist and which are done; live reports say which is
  active.** `sync_snapshot` items may carry a `parts` list (letter, title, done). A live
  `report_progress` on a part's key carries the steps from Slice 10. The two merge on the key,
  the same way slices do today ([Slice 4](04-doc-sync.md)).
- A slice whose documents show no lettered groups has no bar; nothing is guessed.
- A part that left the documents is closed by the next snapshot, like a slice that left the
  table.
- Migration 0005, or the next free number from `parallel-check` when it is built.
- **Decided at the claim (2026-11-16, premise check):** the Active work view has no address for
  one expanded card today (`web/src/route.ts` knows `#/`, `#/active`, `#/usage` and
  `#/open/<key>`). B3 adds `#/active/<key>`: the Active work view with that item's card
  expanded, the card following the address the same way the drawer follows `#/open/<key>`. A key
  with no card on the page shows the page with nothing expanded.
- The "working now" and stale tests for a part reuse `isWorkingNow` and `isHeartbeatExpired`;
  no new copy of either rule.
- **Added for the mock (2026-11-16):**
  - A part has a third live state, stale: its steps report stopped. The slice's tile and drawer
    show it ("Part B · Implementing (stale)", "Stale · Implementing"); it leaves the Active work
    page and the drawer offers no follow button for it.
  - A slice with no active part but parts left reads "Next: part {letter}" on its tile; with all
    parts done "All parts done".
  - The step word on the tile and in the drawer ("Reviewing", "Second review") is the active
    part's current step label from Slice 10 (A4 returns it per part).
  - For a part, the Active work card's parent text is its slice's "Slice N · title" (from
    `parent_key`), and the card's title is "Part {letter} · {part title}".
  - ~~The mock's click leads from the drawer only~~ (the first mock pass; the refreshed mock
    supersedes this): the click is on the tile ("Follow part {letter}", a link under the tile)
    and in the drawer ("Follow part {letter} on Active work"); the tile itself opens the
    drawer as today. The Active work page opens with that part's card expanded.

#### Design (Agent Progress Board mock, Main.dc.html, Phone.dc.html, PhoneDrawer.dc.html, Active.dc.html, added 2026-11-16, refreshed 2026-11-16)

Artboards: desktop board with the Slice 4 drawer open (Main.dc.html, tile parts block line 76,
tile follow link line 93, drawer h3 "Parts" line 128, drawer button line 141), the phone board
(Phone.dc.html, tile bar line 54) and the phone detail drawer (PhoneDrawer.dc.html, h3 "Parts"
line 44, button line 47); the Active work page they lead to is [Slice 10](10-task-steps.md)'s.
The mock agrees with the plan (a bar of parts done over parts, in flight while a part runs,
one click to the active part from the tile and from the drawer) and adds the step word, the
parts list with states and "Next" / "Later". All names are made-up samples. The desktop dark
theme is in `docs/design/canvas.json` `notes.dark` (listed in
[Slice 8](08-usage-reports.md) *Design*).

- **Bar on a slice tile (B2, desktop; Main.dc.html line 76).** Between the why text and the
  parent row, 4 px above, 5 px gap. Row: the part now, 12 px, 600, `#3B424D` at the left; the
  label "{done} of {total} parts · {pct}%" at the right (12 px, tabular), baseline aligned.
  Bar: 6 px high, radius 3, track `#FFFFFF`, fill the type's fg (`#1D4ED8` for a slice), width
  = percent (done parts over parts; the part in progress adds nothing). `aria-hidden`; the
  text carries the numbers. Part-now texts: "Part {L} · {step}" for an active part, with " (stale)"
  appended for a stale one; "Next: part {L}" when none is active; "All parts done". Example:
  "Part B · Reviewing", "1 of 5 parts · 20%". A slice with no lettered parts has no bar and no
  row (the mock's Slice 11 sample: "The slice file has no lettered parts, so no bar is shown").
  Stale tile: the tile's own stale look stays (dashed, muted); the bar keeps its colours.
- **Bar on the phone tile (B2; Phone.dc.html line 54).** Same texts. Row 12 px, `#C7CDD8`
  (label 600 part-now); bar 6 px, radius 3, track `#0E1014`, fill the type's fg (`#9DBDFF`);
  4 gap, 2 above.
- **Parts list in the drawer (B2; Main.dc.html section h3 "Parts", line 128).** After the
  Key row, before "Details". Heading "Parts" (12 px, 600, uppercase, 0.06 em, muted) and the
  label (13 px, 600, tabular) at the right; below it a bar (8 px, radius 4, track `#E9ECF0`, fill
  the type's fg, width = percent); then the list, 2 gap. Row: grid 28 / 1fr / auto, 10 gap,
  padding 8 / 10, radius 8; a 24 px circle with the letter (12 px, 700), the part title (14
  px), and the state at the right (12 px, 600). Done: circle `#0B6B4B`, white letter, title
  `#5B6370`, "Done" `#0B6B4B`. Active: row bg `#E6EEFC`, circle white, letter and border
  `#1D4ED8`, title `#14171C`, "Active · {step} · {n} of {m} steps" `#1D4ED8` (the mock:
  "Active · Review 1 · 1 of 5 steps"). Stale: row bg `#F5F6F8`, circle
  white, letter `#5B6370`, border `#9AA3B2`, title `#14171C`, "Stale · {step}" `#5B6370`.
  Pending: circle white, letter `#5B6370`, border `#C9CED6`, title `#5B6370`, "Next" for the
  first pending part and "Later" for the rest.
- **Follow link on the tile (B3; Main.dc.html line 93, new in the refresh; the old "tile or
  drawer" click, restored).** Only when a part is active (not stale). A link under the tile
  card, outside the tile button (so the tile still opens the drawer): left aligned, min height
  44, margin -8 / 0 / 4 / 8, padding 0 / 8, 6 gap, 13 px, 600, `#14171C`, text "Follow part
  {L}" and a 14 px arrow (`M5 12h14M13 6l6 6-6 6`, stroke 2, `#14171C`). It goes to the Active
  work view with that part's card expanded. Phone tile: not drawn; it carries over as the same
  link in a 44 px row under the tile, text colour `#E8EAEE` by role.
- **Follow button (B3; Main.dc.html line 141).** Only when a part is active (not stale). Link
  styled as a button: min height 44, padding 0 / 16, radius 10, bg `#14171C`, white text, 600, 8
  gap, left aligned, below the list: "Follow part {L} on Active work" and a 16 px arrow icon
  (`M5 12h14M13 6l6 6-6 6`, stroke 2, white). It goes to the Active work view with that part's
  card expanded.
- **Way back (B3).** The "Back to {parent} on the board" link on the part's Active work card
  (Slice 10), which opens the board with the slice's drawer.
- **Parts in the phone drawer (B2, B3; PhoneDrawer.dc.html line 44, new in the refresh).** After
  the Key row, 8 gap. Heading "Parts" (11 px, 600, uppercase, 0.06 em, `#9AA3B2`) and at the
  right the label (12 px, 600); a bar 6 px, radius 3, track `#262B35`, fill `#9DBDFF`, width =
  percent; the list, 1 gap; row grid 26 / 1fr / auto, 8 gap, padding 5 / 8, radius 8; circle 22
  px, letter 11 px, 700, border 1.5; title 13 px; state 11 px, 600. Done: circle `#2E8F6A`,
  white letter, title `#9AA3B2`, "Done" `#7FD8B4`. Active: row bg `#1C2B4A`, circle bg
  `#171A21`, letter and border `#9DBDFF`, title `#E8EAEE`, state "{step} · {n} of {m} steps"
  `#9DBDFF` (no "Active ·" prefix on the phone). Pending: circle `#171A21`, letter `#9AA3B2`,
  border `#4A5262`, title `#9AA3B2`, "Next" / "Later" `#9AA3B2`. Button (line 47): a link, min
  height 44, full width, centred, radius 10, bg `#E8EAEE`, text `#0E1014`, 600, 8 gap, "Follow
  part B on Active work" and a 16 px arrow (stroke `#0E1014`); the sheet's links ("Slice file",
  "Pull request #41") and its "Details and history continue below; the sheet scrolls." line
  are Slice 4's drawer, not this slice. A stale row on the phone is not drawn; it carries over
  from the desktop stale row with the phone's dark values by role (row bg `#171A21`, border
  `#4A5262`, "Stale · {step}" `#9AA3B2`).
- **Not drawn.** A part's own tile (none, by the decision); the type label and colours for
  `part` (the mock's Active cards show "Part" in the slice's colours: `part` in
  `config/board.example.json` copies the slice's pairs); the follow link on the phone tile
  (above); the phone stale row (above). The steps bar that can sit below the parts bar on a
  tile is Slice 10's.
- **New strings (both locales):** "{done} of {total} parts · {pct}%", "Part {L} · {step}", "
  (stale)", "Next: part {L}", "All parts done", "Parts", "Done", "Active · {step} · {n} of {m}
  steps", "{step} · {n} of {m} steps", "Stale · {step}", "Next", "Later", "Follow part {L}",
  "Follow part {L} on Active work", "Part".

**Changed to match the mock (2026-11-16):**
- The click from a slice: the first pass of this plan kept only the drawer, because the mock
  drew only the drawer button (the old B3 said "tile or drawer"). The refreshed mock draws a
  "Follow part {L}" link under the tile as well (Main.dc.html line 93), so both are back; the
  tile itself still opens the drawer as today.
- The phone detail drawer with parts is drawn now (PhoneDrawer.dc.html line 44); the earlier
  "not drawn" note is removed. The active row there reads "{step} · {n} of {m} steps".
- The drawer's active row also carries the part's step count ("Active · Review 1 · 1 of 5
  steps").
- The tile shows the active part and its step as words above the bar, not only a bar; a
  slice with no active part shows "Next: part {L}".
- Parts have a stale state; the drawer lists all parts with Done / Active / Stale / Next /
  Later.
- The way back is the link on Slice 10's card, not a new control on the board.

#### Work

**A. Server (no design needed)**

- [x] **A1.** Migration and domain: `parent_key`, the `part` type, slice progress as parts done
      over parts. Pure, with tests for 1 of 5, no parts, all done, a part removed.
- [x] **A2.** `sync_snapshot` accepts `parts` per slice and upserts them as items with
      `parent_key`; the document owns a part's title and done state.
- [x] **A3.** `report_progress` accepts `parent_key`; a part in progress makes its slice read as
      in flight on the board without changing the slice's stored status.
- [x] **A4.** `/api/board` returns, for each slice, its parts (letter, title, done, active or
      stale, the current step label of the active or stale one and its "{n} of {m} steps") and the worked-out
      progress, and the key of the active part when there is one. For a part's entry on the
      active work page it returns the slice as data (`parent_slice`: key, number, title); the page
      builds "Slice N · title" from its string table (review pass 1, finding 5).
- [x] **A4b.** `config/board.example.json`: the `part` type with the slice's colour pairs, light
      and dark, and the label "Part".
- [x] **A5.** `docs/clients.md`: parts in the snapshot, part keys, `parent_key`. README line.

**B. Page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it. (Done: the
      mock is in `docs/design/`, refreshed twice on 2026-11-16.)
- [x] **B2.** The parts bar with the part now and "{done} of {total} parts · {pct}%" on the
      slice tile, desktop (Main.dc.html line 76) and phone (Phone.dc.html line 54); the Parts
      section in the detail drawer with its bar and rows, desktop (Main.dc.html h3 "Parts",
      line 128) and phone (PhoneDrawer.dc.html h3 "Parts", line 44). None when the slice has
      no lettered parts.
- [x] **B3.** The click from a slice to Slice 10's Active work view with that part's card
      expanded: the "Follow part {L}" link under the tile (Main.dc.html line 93; phone tile
      not drawn, values carried over) and the "Follow part {L} on Active work" button in the
      drawer (Main.dc.html line 141, PhoneDrawer.dc.html line 47); and the way back (the link
      on that card). Only for an active part, not a stale one.
- [x] **B4.** Browser tests against a faked `/api/board`, phone and desktop sizes: five parts
      with one done and one active (bar 20%, "Part B · Reviewing"), a stale part, all done, no
      parts (no bar), the follow link and button present only for an active part, the click
      from the tile and from the drawer lands on the expanded card, the phone drawer list.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1.
- A snapshot with a five-part slice, part A done, then a live report on part B: the slice reads
  as in flight at 20% with B as its active part.
- On the deployed board, after a real document sync and a real agent run: a slice shows its bar,
  and the click lands on the part the agent holds.
- The tile bar, the tile link, the drawer list and the button match Main.dc.html, Phone.dc.html
  and PhoneDrawer.dc.html in the values listed in *Design*.
- `npm run test:e2e` green for part B.

#### Decisions taken at the desk (while building, for the owner to confirm)

- The Active work address is `#/active/<key>`.
- A snapshot with no `parts` field leaves a slice's stored parts alone; an explicit empty list closes them.
- `parent_key` must name an item in the same project.

*Changed while building:*

- Migration 0005 rebuilds `items` and `events` (with `defer_foreign_keys`); `test/migration0005.test.ts` seeds a database at 0004, checks the rollback and every row and event id.
- `.tile` became a wrapper `.tile-box` plus the button, so the follow link sits outside the button. New palette key `partTrack`. A config with no `part` type gets the slice type's colours and the label "Part".
- The Worker returns `parent_slice` as data; the page builds the "Slice N · title" text. The shown status of a slice with an active part is derived at read (`shownStatusOf`), never stored. The seed script has a part.

*From review:* three findings files, all read to their last finding (high 10/10, medium 10/10, check-medium 5/5).

- High (`reviews/pr-66-high.md`): applied 1-6.
- Skipped #7 (`reviews/pr-66-high.md`): "BOARD_WHERE pulls every part of a listed slice into list_open and the board" - low severity; kept as a follow-up.
- Skipped #8 (`reviews/pr-66-high.md`): "FollowLink and FollowButton duplicate the active-part lookup" - low severity, no user-visible failure.
- Skipped #9 (`reviews/pr-66-high.md`): "Usage and task titles read the bare items.title" - low severity; kept as a follow-up.
- Skipped #10 (`reviews/pr-66-high.md`): "A feature branch edits README.md" - work item A5 asks for the README line and no other branch is live.
- Medium (`reviews/pr-66-medium.md`): applied 1, 2, 6. #10 was answered from the D1 limits docs with no value change; the reasoning is in the `MAX_EXPANDED_ITEMS` comment in `src/domain/docSync.ts`.
- Skipped #3 (`reviews/pr-66-medium.md`): "the bar jumps when the doc sync later lists it" - this is the Decision "The plan documents say which parts exist and which are done; live reports say which is active".
- Skipped #4 (`reviews/pr-66-medium.md`): "does not check the parent is a slice or that the item is a part" - low; no failure a user meets.
- Skipped #5 (`reviews/pr-66-medium.md`): "a sync can never clear a stored parent_key" - low; follow-up.
- Skipped #7 (`reviews/pr-66-medium.md`): "no test asserts its query plan" - low; follow-up.
- Skipped #8 (`reviews/pr-66-medium.md`): "Changing the rule in parts.ts leaves the schema rejecting it" - low; no failure a user meets.
- Skipped #9 (`reviews/pr-66-medium.md`): "resets sqlite_sequence to the highest surviving id" - low; no failure a user meets.
- Check pass (`reviews/pr-66-check-medium.md`): none applied; all 5 are follow-ups (below).

*Known behaviour:* a part reported live that the documents do not list shows on Active work but not in its slice's list or bar until a snapshot names it. A part with no steps list has no toggle on Active work.

*Follow-ups (not built):*

- `reviews/pr-66-check-medium.md` 1: a blocked part reads as Next or Later.
- `reviews/pr-66-check-medium.md` 2: `parent_key` cycle, non-slice parent, or key prefix that disagrees with `parent_key`.
- `reviews/pr-66-check-medium.md` 3: a part key built from a max-length slice key may exceed the MCP key schema.
- `reviews/pr-66-check-medium.md` 4: the 1000 expanded-items bound is not in the schema text.
- `reviews/pr-66-check-medium.md` 5: a hash change remounts an Active work card and drops its expand state.
- `reviews/pr-66-high.md` 7 and 9; `reviews/pr-66-medium.md` 5 and 7.

*Checks on the final code:* lint clean, typecheck clean, `npm test` 25 files 342 passed, `npm run test:e2e` 177 passed, 3 skipped. Browser run (local Worker and D1, Access check on, headless): all 5 items pass; desktop 45 of 46 values, phone 41 of 42; the one miss on each is the part circle's 1.5 px border rendering as 1 px at pixel ratio 1.

#### For CLAUDE.md (lifted 2026-11-16)

- Parts come from the documents (`in_doc_sync`); only those count in a slice's list and bar. The rule is in `src/domain/parts.ts` (Slice 11: docs/plan/slices/11-slice-parts.md).
- The shown status of a slice with an active part is derived at read (`shownStatusOf`), never stored (Slice 11: docs/plan/slices/11-slice-parts.md).
- The Worker returns `parent_slice` as data; the page builds the text (Slice 11: docs/plan/slices/11-slice-parts.md).

#### Not yet verified

- On the deployed board after a real document sync and a real agent run, a slice shows its bar and the click lands on the part the agent holds (needs the deploy and a client that sends parts).
- The follow link row on the phone tile (44 px row, text #E8EAEE) was not measured in the browser run.
- The 1.5 px circle border on a screen with pixel ratio 2 or more.
