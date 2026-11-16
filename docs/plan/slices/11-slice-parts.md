### Slice 11 — Slice parts: progress bar on the slice, click through to the active part

Source: the owner at the desk, 2026-11-16 ("Each slice has multiple parts, say A to E. An agent
finished sub A. An agent picks slice X sub B. Then the status of slice X is in flight, and 20% of
it is done that should be shown in a progress bar under it ... From the main page, where we have
the slices, we should be able to click and follow to the sub task that is currently active").

*Planned.* Needs [Slice 10](10-task-steps.md). The design mock arrived on 2026-11-16 (in
`docs/design/`); part B (the page) is planned against it (see *Design* below). The view tabs and
the tab bar are [Slice 8](08-usage-reports.md)'s and the Active work page is
[Slice 10](10-task-steps.md)'s; this slice reuses both.

**Touches:** `migrations/0005_parts.sql`, `src/domain/parts.ts`, `src/domain/item.ts`,
`src/domain/docSync.ts`, `src/domain/upsert.ts`, `src/application/board.ts`,
`src/application/ports.ts`, `src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`,
`src/mcp/tools.ts`, `src/api/boardDto.ts`, `src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`

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
  - The mock's click leads from the drawer only ("Follow part {letter} on Active work"); the
    tile opens the drawer as today. The Active work page opens with that part's card expanded.

#### Design (Agent Progress Board mock, Main.dc.html, Phone.dc.html, Active.dc.html, added 2026-11-16)

Artboards: desktop board with the Slice 4 drawer open (Main.dc.html, h3 "Parts" line 117) and
the phone board (Phone.dc.html, tile bar line 56); the Active work page they lead to is
[Slice 10](10-task-steps.md)'s. The mock agrees with the plan (a bar of parts done over parts,
in flight while a part runs, one click to the active part) and adds the step word, the parts
list with states and "Next" / "Later". The phone detail drawer with parts is not drawn
(PhoneDrawer.dc.html did not change). All names are made-up samples.

- **Bar on a slice tile (B2, desktop; Main.dc.html line 75).** Between the why text and the
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
- **Parts list in the drawer (B2; Main.dc.html section h3 "Parts", line 117).** After the
  Key row, before "Details". Heading "Parts" (12 px, 600, uppercase, 0.06 em, muted) and the
  label (13 px, 600, tabular) at the right; below it a bar (8 px, radius 4, track `#E9ECF0`, fill
  the type's fg, width = percent); then the list, 2 gap. Row: grid 28 / 1fr / auto, 10 gap,
  padding 8 / 10, radius 8; a 24 px circle with the letter (12 px, 700), the part title (14
  px), and the state at the right (12 px, 600). Done: circle `#0B6B4B`, white letter, title
  `#5B6370`, "Done" `#0B6B4B`. Active: row bg `#E6EEFC`, circle white, letter and border
  `#1D4ED8`, title `#14171C`, "Active · {step}" `#1D4ED8`. Stale: row bg `#F5F6F8`, circle
  white, letter `#5B6370`, border `#9AA3B2`, title `#14171C`, "Stale · {step}" `#5B6370`.
  Pending: circle white, letter `#5B6370`, border `#C9CED6`, title `#5B6370`, "Next" for the
  first pending part and "Later" for the rest.
- **Follow button (B3; Main.dc.html line 131).** Only when a part is active (not stale). Link
  styled as a button: min height 44, padding 0 / 16, radius 10, bg `#14171C`, white text, 600, 8
  gap, left aligned, below the list: "Follow part {L} on Active work" and a 16 px arrow icon
  (`M5 12h14M13 6l6 6-6 6`, stroke 2, white). It goes to the Active work view with that part's
  card expanded.
- **Way back (B3).** The "Back to {parent} on the board" link on the part's Active work card
  (Slice 10), which opens the board with the slice's drawer.
- **Not drawn.** The phone drawer with parts (carries over: the same section inside the sheet,
  one column, button 44 px, dark values by role from `PhoneDrawer.dc.html` and the phone tile
  bar); the dark desktop palette (phone values by role); a part's own tile (none, by the
  decision); the type label and colours for `part` (the mock's Active cards show "Part" in the
  slice's colours: `part` in `config/board.example.json` copies the slice's pairs).
- **New strings (both locales):** "{done} of {total} parts · {pct}%", "Part {L} · {step}", "
  (stale)", "Next: part {L}", "All parts done", "Parts", "Done", "Active · {step}", "Stale ·
  {step}", "Next", "Later", "Follow part {L} on Active work", "Part".

**Changed to match the mock (2026-11-16):**
- The click from a slice goes from the drawer, not the tile (old B3 said "tile or drawer"
  (the mock supersedes this)); the tile opens the drawer as today.
- The tile shows the active part and its step as words above the bar, not only a bar; a
  slice with no active part shows "Next: part {L}".
- Parts have a stale state; the drawer lists all parts with Done / Active / Stale / Next /
  Later.
- The way back is the link on Slice 10's card, not a new control on the board.

#### Work

**A. Server (no design needed)**

- [ ] **A1.** Migration and domain: `parent_key`, the `part` type, slice progress as parts done
      over parts. Pure, with tests for 1 of 5, no parts, all done, a part removed.
- [ ] **A2.** `sync_snapshot` accepts `parts` per slice and upserts them as items with
      `parent_key`; the document owns a part's title and done state.
- [ ] **A3.** `report_progress` accepts `parent_key`; a part in progress makes its slice read as
      in flight on the board without changing the slice's stored status.
- [ ] **A4.** `/api/board` returns, for each slice, its parts (letter, title, done, active or
      stale, and the current step label of the active or stale one) and the worked-out
      progress, and the key of the active part when there is one. For a part's entry on the
      active work page it returns the slice's "Slice N · title" as the parent text.
- [ ] **A4b.** `config/board.example.json`: the `part` type with the slice's colour pairs, light
      and dark, and the label "Part".
- [ ] **A5.** `docs/clients.md`: parts in the snapshot, part keys, `parent_key`. README line.

**B. Page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it. (Done: the
      mock is in `docs/design/`, refreshed 2026-11-16.)
- [ ] **B2.** The parts bar with the part now and "{done} of {total} parts · {pct}%" on the
      slice tile, desktop (Main.dc.html line 75) and phone (Phone.dc.html line 54); the Parts
      section in the detail drawer with its bar and rows (Main.dc.html h3 "Parts", line 117).
      None when the slice has no lettered parts.
- [ ] **B3.** The "Follow part {L} on Active work" button in the drawer (Main.dc.html line
      131) to Slice 10's Active work view with that card expanded, and the way back (the link
      on that card). Only for an active part, not a stale one.
- [ ] **B4.** Browser tests against a faked `/api/board`, phone and desktop sizes: five parts
      with one done and one active (bar 20%, "Part B · Reviewing"), a stale part, all done, no
      parts (no bar), the follow button present only for an active part, the click lands on the
      expanded card.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1.
- A snapshot with a five-part slice, part A done, then a live report on part B: the slice reads
  as in flight at 20% with B as its active part.
- On the deployed board, after a real document sync and a real agent run: a slice shows its bar,
  and the click lands on the part the agent holds.
- The tile bar, the drawer list and the button match Main.dc.html and Phone.dc.html in the
  values listed in *Design*.
- `npm run test:e2e` green for part B.
