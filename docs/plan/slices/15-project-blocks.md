### Slice 15 — One collapsible block per project, done work always folded

*Planned.* The page is designed (see *Design* below) and is built after the owner has reviewed the
plan PR, and after part A of [Slice 13](13-session-cards.md) and [Slice 14](14-checks-in-slice.md)
(it shows their groups).

**Touches:** `web/**`, `e2e/**`, `docs/design/**`, `README.md`, `docs/plan/slices/15-project-blocks.md`

**Migrations:** none.

#### Why

The owner, 2026-11-17: "The grouping is also useless. there should be a way to close the board per
project, and the work already done should be collapsed at all time. the idea is to give me more
visibility on what is happening and allowing me to dig in for more information." Read the same day:
the page groups by project with "Waiting for you", "In flight" and "Done" sections, and has no
collapse anywhere (`web/src`).

#### Decisions (owner, 2026-11-17, "agree to all")

- **Each project is one block that can be collapsed**, and the page remembers it per project.
- **A quiet project takes one line**: "nothing running · 2 planned · 1 needs you". (The mock
  supersedes the order of the words and adds the pieces: the header line is "{needs you} · {working
  or nothing running} · {planned} · {problems} · {checks not tried}", see *Design*, C3 and
  [Slice 14](14-checks-in-slice.md) B5.)
- **Inside a project, in this order:** Needs you (the agent's question and what happens after),
  Working now (goal, steps with the current one marked, last activity), Planned (slices with their
  parts, progress bar and check count), Problems and bugs, Done (always folded, opens on click).
- **Every card opens the full detail** in the drawer: purpose, what was done, steps, history,
  links.
- **The page is designed in Claude Design first**; this slice builds exactly what the mock shows
  (the mock trumps this file where they differ, `docs/design/README.md`).
- **A project with a question opens on load, and can be folded afterwards; a count row sits by the
  page title** (owner, 2026-11-17, step 2 of the request for Slices 13 to 15).

#### Decided at the desk

- The collapsed state is a per-viewer convenience kept in `localStorage`, read and written inside
  `try`/`catch`; the page renders expanded projects when storage fails. A project with something
  under "Needs you" opens expanded on load whatever was stored, so a question is never hidden.
  (Not in the mock: the mock keeps the state in memory only. The rule is the mock's own, "a project
  with a question opens on load; after that it folds like any other", plus the storage.)
- **The default for a project with no stored state** (from the mock, `renderVals` line 346 to 348):
  folded when it has no working card and no question ("quiet", the sample `notes-site`), open
  otherwise. Done is folded on every load and is not stored.
- The Active work page (`#/active`) stays and shows only "Working now" across projects. (Not in the
  mock: the mock only draws its tab.)
- The phone layout follows the mock's phone artboards; the waiting strip at the top becomes the
  "Needs you" cards of all projects.
- **The phone view tabs are the same bar as on the desktop, at the top of the page** (from the mock:
  `PhoneV2.dc.html` lines 21 to 25). The bottom tab bar of the earlier phone artboards (Slice 10,
  Slice 8) is superseded on the Board page. The mock draws only the Board page, so the Active work
  and Usage pages on the phone keep the bar their own artboards show until the owner says otherwise.

#### Design (BoardV2 mock, sections BoardV2, BoardV2Dark, PhoneV2, PhoneV2Light, PhoneV2Drawer, StatesV2, added 2026-11-17)

Source: `docs/design/` ([README](../../design/README.md) sections table), six artboards: `BoardV2` (desktop
light, 1440 by 2100, `notes-site` folded), `BoardV2Dark` (desktop dark, Done opened on `example-app`,
drawer open on the working card), `PhoneV2` (phone dark, 390 wide), `PhoneV2Light` (phone light, Done
opened), `PhoneV2Drawer` (phone card detail, full screen) and `StatesV2` (loading, empty, failed,
light). The mock agrees with the plan on the block, the order of the groups and the folded Done; it
adds the choices marked "from the mock". The five board artboards are one component (a theme and a
`phone` switch), so every value below holds on all of them unless said otherwise. Line numbers are
lines of `BoardV2.dc.html`. The card contents are in [Slice 13](13-session-cards.md) *Design*
(Needs you, Working now, drawer) and [Slice 14](14-checks-in-slice.md) *Design* (Planned, Problems
and bugs, Done rows, parts and checks).

- **C0 Theme keys** (`CONFIG.theme`, line 246 of each file; the page reads them from its theme
  config, never as literals). Light / dark:
  `ground` #F5F6F8 / #0E1014; `card` #FFFFFF / #171A21; `border` #E3E6EB / #262B35; `text` #14171C /
  #E8EAEE; `muted` #5B6370 / #9AA3B2; `sub` #3B424D / #C7CDD8; `track` #E9ECF0 / #262B35; `needBg`
  #FDEBD8 / #2A1C0E; `needBd` #F0C9A0 / #5A3712; `needFg` #9A3F00 / #FFB672; `sliceBg` #E6EEFC /
  #1C2B4A; `sliceBd` #BFD0F5 / #2E4473; `sliceFg` #1D4ED8 / #9DBDFF; `bugBg` #FCE4E4 / #3F1A1A;
  `bugBd` #F3BDBA / #5E2A28; `bugFg` #B42318 / #FF9B94; `probBg` #EFE7FB / #2C1F45; `probBd` #D6C4F2
  / #46336B; `probFg` #6B2FBF / #C9A7FF; `nowBg` #1D4ED8 / #9DBDFF; `nowFg` #FFFFFF / #0E1014;
  `doneFg` #0B6B4B / #7FD8B4; `chip` #F0F2F5 / #232833; `tabBg` #E9ECF0 / #171A21; `tabOn` #FFFFFF /
  #2E3440; `scrim` rgba(20,23,28,0.32) / rgba(0,0,0,0.55); `shadow` -12px 0 32px rgba(20,23,28,0.12)
  / -12px 0 32px rgba(0,0,0,0.5); `link` #1D4ED8 / #9DBDFF; `btnBg` #14171C / #E8EAEE; `btnFg`
  #FFFFFF / #0E1014. Links in the page use `link`; hover `sub`.
- **C1 View tabs** (lines 21 to 25). A bar: background `tabBg`, radius 12px, padding 4px, gap 4px,
  aligned left. Three links "Board", "Active work", "Usage": min-height 40px, padding 0 14px, radius
  9px. The current one (`aria-current="page"`): background `tabOn`, text `text`, weight 600; the
  others text `sub`, weight 500. Not in the mock: a count on "Active work" (Slice 10 asked for one
  on the older artboards; it stays).
- **C2 Title and count row** (lines 27 to 37). Page padding 32px 32px 64px on desktop (14px sides,
  16px top, 40px bottom on the phone, 390px wide), max width 1240px, gap 22px. Left: h1 "Board" (26px,
  700, letter-spacing -0.02em) and under it, 13px, `muted`: "3 projects · updated 13:48 · refreshes
  every 60 s" (the real project count, update time and `REFRESH_EVERY_MS` in `web/src/hooks.ts`).
  At the right (wraps below on the phone): three pills, 13px, 600, padding 4px 10px, radius 999px: "2
  need you" on `needBg` with `needFg`; "3 working" and "2 problems" on `chip` with `sub`. The numbers
  are the totals over all projects (from the mock: the count row). A count of 0 is not drawn in the
  mock; decided here: the pill stays and reads "0 …".
- **C3 Project block** (lines 54 to 172). A section: background `card`, border 1px `border`, radius
  16px. The header is one button, the whole width, min-height 64px, padding 14px 18px, `aria-expanded`:
  a chevron (18px, 2px stroke in `text`, points right when folded, turns 90 degrees when open), the
  name (19px, 700, letter-spacing -0.01em), the summary line (13px, 400; `needFg` when the project
  has a question, otherwise `muted`) and at the right "Fold" when open or "Open" when folded (12px,
  500, `muted`). Summary order and wording: [Slice 14](14-checks-in-slice.md) B5. The body (shown
  when open): border-top 1px `border`, padding 4px 18px 18px, gap 20px, in this order: Needs you,
  Working now, Planned, Problems and bugs, Done. A group with nothing in it is not drawn.
- **C3 Group headings** (lines 71, 89, 114, 141): 12px, 700, upper case, 0.06em; "Needs you · {n}" in
  `needFg`, the others in `muted`: "Working now · {n}", "Planned · {n}", "Problems and bugs · {n}".
- **C4 Done** (lines 155 to 166). A button, aligned left, min-height 44px, padding 0 14px 0 10px,
  border 1px `border`, radius 10px, background transparent: a chevron (16px, `sub`) and "12 done in the
  last 12 hours" (13px, 600, `doneFg`); `aria-expanded`. Closed by default. Open: a list, gap 4px, each
  row a button, min-height 44px, radius 10px, padding 8px 12px, 13px: title (500) and the time at
  the right (12px, `muted`); a stale row is dashed on `chip` with `muted` text; a "Show all 12" row in
  `link` colour when the count is above the list ([Slice 14](14-checks-in-slice.md) B6). Every row
  opens the drawer.
- **C5 Top "Needs you" on the phone** (`PhoneV2.dc.html`, lines 39 to 51): above the projects, the
  heading "Needs you · {total}" and the question cards of all projects ([Slice 13](13-session-cards.md)
  B1). The project blocks then carry the line "Its question is at the top of the page." A project with a
  question is open on load.
- **C6 Drawer shell** (lines 175 to 242): [Slice 13](13-session-cards.md) B2. Every card, question,
  working, slice, problem and Done row opens it. Desktop: side panel 480px with `scrim`; phone: full
  screen.
- **C7 States** (`StatesV2.dc.html`, light only). Loading (shown after 500 ms): a bar 84px high, radius
  10px, background #FBEFE2 (a light tint of `needBg`; not a theme key) standing for the question
  area, then two skeleton blocks (border 1px `border`, radius 14px, padding 14px, gap 10px): a title
  bar 55% wide, 18px, radius 10px, `track`, and two tiles 64px high, radius 10px, `chip`, side by
  side; below them "Loading the board…" (13px, `muted`). Empty: an icon (44px, a circle with a tick,
  stroke `doneFg` 1.6px), "Nothing open in any project" (18px, 700) and "No questions, no running
  work, no planned slices and no problems. Projects show here once an agent or the doc sync
  reports." (`muted`, max width 300px), centred. Failed: an icon (44px, a triangle with an
  exclamation mark, stroke `bugFg` 1.6px), "Couldn’t load the board" (18px, 700), "The board API
  answered 503 (service unavailable). Showing nothing rather than old data." (`muted`, max width
  300px; the 503 is the real status) and a button "Retry" (min-height 44px, padding 0 22px, radius
  10px, background `btnBg`, text `btnFg`, 600). Not drawn in the mock: the states in dark (decided
  here: the same layout with the theme keys; the bar for the question area uses `needBg`).
- **Simplified illustrations and canvas furniture:** the three panels of `StatesV2` (their white card,
  their small upper-case headings "Loading (after 500 ms)", "Empty board", "Failed load") only
  frame the three states for the canvas; they are not built. The fonts loaded from Google Fonts are
  canvas furniture: the page keeps its own fonts and makes no third-party request. All names, counts
  and times are made-up sample data (`v2note` in `canvas.json`).
- **Not in the mock** (stays in the slice as written): the `localStorage` memory and its failure
  fallback; the German strings; the Active work page content.
- **New strings (EN and DE):** "Board", "Active work", "Usage" (existing), "{n} projects", "updated
  {time}", "refreshes every {n} s", "{n} need you", "{n} working", "{n} problems", "Fold", "Open",
  "Needs you · {n}", "Working now · {n}", "Planned · {n}", "Problems and bugs · {n}", "Loading the
  board…", "Nothing open in any project", "No questions, no running work, no planned slices and no
  problems. Projects show here once an agent or the doc sync reports.", "Couldn’t load the board", "The
  board API answered {status} ({reason}). Showing nothing rather than old data.", "Retry".

**Plan changed to match the mock (2026-11-17):** status line; the quiet-project line is the mock's
header line (the old words superseded); fold defaults and the rule that a question opens on load but
can be folded; the count row; the phone view tabs are on top (supersedes the bottom bar on the
Board page); the states are the mock's; the work items are rewritten with the artboard for each.

#### Work

- [ ] Import the mock (`import-claude-design`) and write a *Design* section here from it. (Done
  2026-11-17: the mock is in `docs/design/` and the section is above.)
- [ ] Theme keys from C0 in the page's theme config, light and dark.
- [ ] View tabs and the title with the count row (C1, C2), desktop and phone.
- [ ] Project block with header (name, summary line, Fold or Open control) and the five groups in
  the order of C3; defaults and the open-on-load rule for a question.
- [ ] Done folded with its count; opens and closes on click (C4).
- [ ] Phone: the "Needs you" cards of all projects at the top and the project line (C5).
- [ ] Drawer: purpose, what was done, steps, checks, history, links (C6; the contents are in Slices
  13 and 14).
- [ ] Loading, empty and failed states (C7).
- [ ] Desktop and phone, light and dark, German strings.
- [ ] E2E: collapse remembered across reload; a project with a question opens expanded and can then
  be folded; a quiet project is folded by default; done folded by default; the count row shows the
  totals; the three states.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- The owner opens the deployed board on the phone and on the desktop and compares it with the mock
  (`BoardV2`, `BoardV2Dark`, `PhoneV2`, `PhoneV2Light`, `PhoneV2Drawer`, `StatesV2`).
