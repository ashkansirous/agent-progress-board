### Slice 10 — Task steps and the active work page

Source: the owner at the desk, 2026-11-16 ("in another page, we'll have the active work, which is
the tasks that agents are working on ... if the agent is done with implementation, 1 of 7 is done
14% of the task is done and the progress bar should show that ... with an option to expand and see
the work steps, what is done and what is active and what is next").

*Planned.* Part A (server) can be built now. The design mock arrived on 2026-11-16 (in
`docs/design/`); part B (the page) is planned against it (see *Design* below). The view tabs
and the phone tab bar belong to [Slice 8](08-usage-reports.md) (the first to add a second view);
this slice adds the Active work tab and its count to them. If this slice is built first, it
builds the tabs itself, with Board and Active work, from the values in Slice 8's *Design*.

**Touches:** `migrations/0004_steps.sql`, `src/domain/steps.ts`, `src/domain/item.ts`,
`src/domain/upsert.ts`, `src/application/board.ts`, `src/application/ports.ts`,
`src/infrastructure/d1Repository.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/api/boardDto.ts`, `src/config.ts`, `config/board.example.json`, `test/**`,
`docs/clients.md`, `README.md`, `web/**`, `e2e/**`, `docs/design/**`

#### Why

A tile says "in progress" and nothing more. The owner wants to see, for each piece of work an
agent holds, how far it is and what it is doing now.

#### Decisions (owner, 2026-11-16)

- **A task carries its own list of steps.** The board has no built-in list. The owner's example
  (implementation, review 1, fixing, review 2, two device tests, merging) was an example, not a
  default. Each kind of agent has its own usual list on the client side, and each task trims it
  to what it really needs: no phone test when no phone code changed.
- **Steps are equal for now.** Progress is steps done over steps in the list: 1 of 7 is 14%.
- **The list can change while the task runs.** The client sends the whole list each time; the
  newest list wins.
- **What a helper agent does counts under the step of the agent that started it.** Helpers do
  not add steps of their own to the task.
- **An active work page** lists every task an agent is working on now, across projects, each
  with its bar, the step it is on in words (for example "Reviewing"), and a way to open the full
  list: done, active, next.
- **Design:** the owner makes a mock for the active work page and the bars first; the page is
  built to match it (the mock wins over this file). (Done 2026-11-16; see *Design*.)

#### Decided at the desk (not the owner's choices)

- `report_progress` gets three optional fields: `steps` (an ordered list, each with a label and
  one of done, active or pending; at most 30), `agent` (the agent's kind, free text) and
  `model`. No new tool. An item without `steps` behaves as today.
- A step label is free text from the client, shown as sent; the board holds no step names and
  no copy for them.
- "Working on now" means: status in progress, a steps list or an agent set, and a heartbeat
  that is not stale (the rule from [Slice 7](07-stale-detection.md)). A stale task leaves the
  active page and shows as stale on the board, as today.
- A task that is marked done shows 100% whatever its list says; the list is kept for the
  history.
- The active page reads the same `/api/board` data, with the new fields added to each item; no
  second read route.
- Migration 0004 adds the columns to `items`. If [Slice 8](08-usage-reports.md) has not merged
  first, take the next free number from `parallel-check` instead.
- **Added for the mock (2026-11-16):**
  - Each step may carry a short `note` (0 to 120 characters, shown under the label, as sent;
    the mock: "Two helper agents count under this step", "No tablet test: no tablet code
    changed"). Free text from the client like the label.
  - The list order is the order sent. The page names the steps after the active one "Next" (the
    first) and "Later" (the rest); that is page copy, not data.
  - `/api/board` carries, for every item, the time of its last report (`heartbeat_at`, already
    stored by Slice 7) so the card can say "Last report 1 min ago", and the board response
    carries the number of working tasks for the tab's count (the same rule as the page).
  - The page orders cards by newest report first (the mock: 1, 2, then 4 minutes ago).
  - A task with no active step reads "Starting" as its current step.
  - The card's parent line is the item's `parent` text (until
    [Slice 11](11-slice-parts.md) gives a part its slice's title as parent); the link "Back to
    {parent} on the board" opens the board with that item's drawer.

#### Design (Agent Progress Board mock, Active.dc.html, PhoneActive.dc.html, added 2026-11-16)

Two artboards (desktop active work 1440x1100 light, phone active work 390x844 dark) with three
sample cards each (two parts and a bug; the phone card list is cut to two). The mock agrees with
the plan (one card per working task, bar, current step in words, a way to open the full list)
and adds the one-segment-per-step bar, the notes, "Later", "Last report" and the tab count. Files
`docs/design/Active.dc.html` (h1 "Active work" line 28, card h2 line 45) and
`docs/design/PhoneActive.dc.html` (h1 line 20). The projects, items, agents ("Implementer",
"Reviewer", "Fixer") and models ("model-mid", "model-large", "model-small") are made-up samples;
the page shows what the data says. Colours: light palette and dark palette as in
[Slice 2](02-tile-board.md) *Design*. The view tabs and the phone bottom bar are specified in
[Slice 8](08-usage-reports.md) *Design*; this slice fills the count in the Active work tab (the
number of cards).

- **Page frame (B2, desktop).** Max width 1080, padding 32 / 32 / 64, 24 gap. `h1` "Active
  work" 26 px, 700, -0.02 em; under it 13 px muted: "Tasks an agent is working on now, across
  projects · updated 13:48 · a task that stops reporting turns stale and leaves this page" (the
  time is the last successful fetch, HH:mm).
- **Card (B2, desktop).** List item: white, 1 px border `#E3E6EB` (a bug: its type border
  `#F3BDBA`; the border takes the type's border colour from config), radius 14, padding 18 /
  20, 12 gap, 14 gap between cards. Row 1 (12 px muted, wraps, 8 gap): project name (600,
  `#14171C`), "·", the type label (700, uppercase, 0.05 em, the type's fg: `#1D4ED8` for Part,
  `#B42318` for Bug), "·", the parent text, and at the right "Last report {age}" ("1 min ago").
  Row 2, two columns that wrap: left (grows, min 320) `h2` title 18 px, 700, -0.01 em, then
  chips: agent kind (12 px, padding 2 / 8, radius 6, bg `#F0F2F5`, `#3B424D`) and model
  (JetBrains Mono 11 px, padding 3 / 8, same colours); right (min 300): the current step 15 px,
  600, `#1D4ED8` and at the right "{done} of {total} steps · {pct}%" (13 px, `#3B424D`,
  tabular; percent rounded), then the bar: one segment per step, 10 px high, 3 gap, radius 3,
  equal width: done `#1D4ED8`, active `#9DBDFF`, pending `#E3E6EB`. Bar is `aria-hidden`; the
  text carries the numbers.
- **Toggle and list (B2).** Button, min height 44, padding 0 / 14 / 0 / 10, radius 10, 1 px
  `#E3E6EB`, white, 13 px, 600, with a 16 px chevron (stroke 2, `M9 6l6 6-6 6`) that turns 90
  degrees when open; `aria-expanded`. Labels: "Show all {n} steps", "Hide steps". Open: a list
  under a 1 px `#E3E6EB` line, 12 padding top, 2 gap; row grid 28 / 1fr / auto, 10 gap, padding
  8 / 10, radius 8; a 24 px circle with the step number (12 px, 700) , the label (14 px) with the
  note under it (12 px muted), and the state word at the right (12 px, 600). Done: circle
  `#0B6B4B` with white number, label `#5B6370`, "Done" `#0B6B4B`. Active ("Now"): row bg
  `#E6EEFC`, circle white with `#1D4ED8` number and border, label 600 `#14171C`, "Now" `#1D4ED8`.
  Pending: circle white, `#5B6370` number, border `#C9CED6`, label `#5B6370`, "Next" for the
  first pending step and "Later" for the others. Under the list the link "Back to {parent} on
  the board" (13 px, 600, link colour). The first card is open in the mock; the page starts
  all closed except when arriving from Slice 11's "Follow part" (then that card is open).
- **Phone (B2; PhoneActive.dc.html).** Dark. Header padding 20 / 16 / 12: `h1` 22 px, 700; 12
  px muted "3 tasks running · updated 13:48". Cards: bg `#171A21`, 1 px `#262B35`, radius 14,
  padding 14, 8 gap, 10 between. Lines: project (12 px, 600, `#E8EAEE`) "·" type label (700,
  uppercase, `#9DBDFF`); title 16 px, 700; chips (agent 12 px; model mono 11 px; bg `#232833`,
  `#C7CDD8`); step now 14 px, 600, `#9DBDFF` with "{done} of {total} steps · {pct}%" 12 px
  `#C7CDD8` at the right; the bar 8 px high (done `#9DBDFF`, active `#3B5A94`, pending
  `#262B35`); the toggle (min 44, radius 10, 1 px `#262B35`, bg `#0E1014`); rows (grid 26 /
  1fr / auto, padding 6 / 8; circle 22 px, 11 px number): done circle `#2E8F6A`, "Done"
  `#7FD8B4`, label `#9AA3B2`; active row bg `#1C2B4A`, circle `#171A21` with `#9DBDFF` number
  and border, label `#E8EAEE`, "Now" `#9DBDFF`; pending circle `#171A21`, number `#9AA3B2`,
  border `#4A5262`, "Next" / "Later" `#9AA3B2`. Not drawn on the phone: "Last report", the
  parent text, step notes and the "Back to ... on the board" link; they carry over from the
  desktop card (12 px muted lines, the link as a 44 px row under the list).
- **Dark desktop** is not drawn: the phone's values by role.
- **Empty and failed (B2).** Not drawn. Carry over `States.dc.html` (check-mark empty card,
  red-triangle failed card with "Retry"); copy for this page is new ("Nothing is running" style,
  written for the string table). Loading after 500 ms: the skeleton pattern of `States.dc.html`
  with card-shaped blocks.
- **Tab count (B2).** The Active work tab shows the number of cards; with zero the pill is
  left out (not drawn; the number is never "0").
- **No steps bar on tiles or in drawers.** The mock draws none for tasks; the only bar on the
  board is the parts bar of Slice 11.
- **New strings (both locales):** "Active work", "Tasks an agent is working on now, across
  projects · updated {time} · a task that stops reporting turns stale and leaves this page",
  "{n} tasks running · updated {time}", "Last report {age}", "{done} of {total} steps · {pct}%",
  "Show all {n} steps", "Hide steps", "Done", "Now", "Next", "Later", "Starting", "Back to
  {parent} on the board", "{n} min ago" style ages, and the empty and failed texts.

**Changed to match the mock (2026-11-16):**
- The old list "done, active, next" is "Done / Now / Next / Later" and the bar has one segment
  per step instead of one continuous fill (Active.dc.html, card block from line 45).
- Steps gain a `note` (A1, A2).
- Old B3 (the same bar and current step on the task's tile and in the drawer) is dropped: the
  mock draws no steps bar on tiles or drawers (the mock supersedes this).
- Cards show "Last report", the parent and a link back to the board; the tab shows a count;
  cards are ordered newest report first.
- "Working on now" stays as decided; a stale task leaves the page (the page subtitle says so).

#### Work

**A. Server (no design needed)**

- [ ] **A1.** Migration and domain: the steps list on an item, its validation (one active step
      at most, labels 1 to 80 characters, an optional note 0 to 120), progress as done over
      total. Pure, with tests for 1 of 7, an empty list, a list that shrinks, a done item, a
      note.
- [ ] **A2.** `report_progress` accepts and stores `steps` (with notes), `agent`, `model`;
      `get_item` and `list_open` return them; `/api/board` carries them with the worked-out
      progress, the time of the last report, and the number of working tasks (the tab count).
- [ ] **A3.** `docs/clients.md`: the fields, "send the whole list each time", how a client
      trims the list, helpers count under their parent's step. README line.

**B. Page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it. (Done: the
      mock is in `docs/design/`, refreshed 2026-11-16.)
- [ ] **B2.** The Active work view (Active.dc.html, PhoneActive.dc.html): the tab with its
      count in Slice 8's tabs and tab bar, the header, one card per working task (project,
      type, parent, last report, title, agent kind, model, current step, "N of M steps · P%",
      the one-segment-per-step bar), the "Show all {n} steps" toggle with the list (Done, Now,
      Next, Later, notes) and the "Back to {parent} on the board" link; a loading state for any
      wait over 500 ms, empty and failed states carried over from `States.dc.html`.
- [ ] **B3.** (Superseded by the mock: no bar or current step on tiles or drawers; Slice 11
      draws the parts bar.) Nothing to build.
- [ ] **B4.** Browser tests against a faked `/api/board`, phone and desktop sizes: three cards,
      toggle open and closed, a bug card with its type border, notes shown, the count, a stale
      task absent, the link back.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1.
- A report with seven steps, one done and one active, reads back as 14% with the active step's
  label; the next report with six steps (one dropped), two done, reads back as 33%.
- On the deployed board: three tasks reported by a real client run, two in one project and one
  in another, all show on the active page with the right step; one whose session is killed
  leaves the page when it turns stale.
- The page matches Active.dc.html and PhoneActive.dc.html in the values listed in *Design*.
- `npm run test:e2e` green for part B.
