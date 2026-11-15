### Slice 2 — Tile board page

Source: phone scope (2026-11-15), milestone 2 — see [Slice 1](01-items-api.md).

*Planned.*

**Touches:** `web/**`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `src/api/**`,
`e2e/**`, `playwright.config.ts`, `config/board.example.json`, `README.md`

#### Why

The owner opens one URL on their phone and sees (1) what waits for them, (2) what's in flight
per project and what it belongs to, (3) what finished in the last 12h, without opening GitHub,
plan files or transcripts.

#### Decisions

- React + TypeScript (Vite) served as the Worker's static assets; `App.tsx` is a thin shell.
- One group per project; inside each, one tile per item: colour by type, a priority badge, a
  one-line title, a one-line why and the parent. `waiting_for_me` tiles sort first, in their
  own row at the top of each project and in a global "Waiting for you" strip at the top.
  (The mock supersedes the per-project row on the phone: see *Design*. On desktop each project
  keeps a "Waiting for you · n" section above "In flight".)
- Tap opens a detail drawer: `details_md` rendered (sanitised), links, the event history.
- Colours and type labels come from config, not code; colour is never the only signal (the
  type label is on the tile too).
- The page reads with the read token from the Worker side; the page itself is behind
  Cloudflare Access with a one-time PIN by email (owner, 2026-11-15; no identity provider).
  The browser never holds the write token.
- Until Access is set up the page stays closed: `GET /api/board` and the page refuse every
  request that carries no valid Access identity, so a deployed page never shows items to the
  public (owner, 2026-11-15).
- Phone first: one column under 600 px, readable at 360 px wide, dark and light themes. The
  mock draws the desktop in the light palette and the phone in the dark palette; the page
  follows the device colour scheme and both palettes come from config (see *Design*).
- Any wait over 500 ms shows a loading state; an empty board says so; a failed load says what
  failed and offers Retry. A failed refresh also clears the board and shows the error (the
  mock: "Showing nothing rather than old data").
- Auto-refresh every 60 s while the tab is visible; a refresh button (44 px) refreshes now.
- Fonts: Inter and JetBrains Mono, bundled with the page (the mock loads them from Google
  Fonts, which is canvas furniture; the page makes no third-party request).

#### Design (Agent Progress Board mock, sections Main, Phone, PhoneDrawer, States, added 2026-11-15)

Four artboards (desktop board with drawer, phone board dark, phone drawer, three states). The
mock agrees with the plan on groups, tiles, strip, drawer, type label on every tile and the
three states; it adds the details below and changes two plan lines (listed at the end). Files:
`docs/design/Main.dc.html`, `Phone.dc.html`, `PhoneDrawer.dc.html`, `States.dc.html`; the
sample items and colour maps are in the script block of each. All projects and items in the
mock are made up. The phone drawer's background (a faded "Progress" title and three grey boxes)
is a simplified illustration of the board behind the sheet, not UI. Font stack: Inter, then
`system-ui`; mono: JetBrains Mono.

Light palette (desktop): page `#F5F6F8`, text `#14171C`, muted `#5B6370`, card `#FFFFFF`,
hairline `#E3E6EB`, link `#1D4ED8` (hover `#1E3A8A`). Dark palette (phone): page `#0E1014`,
text `#E8EAEE`, muted `#9AA3B2`, card `#171A21`, hairline `#262B35`, link `#9DBDFF` (hover
`#C7D8FF`). Every control is at least 44 px.

- **Header (desktop).** Max width 1280, padding 32 / 32 / 64, 28 gap. `h1` "Progress" 26 px,
  700. Under it, 13 px muted: "Open work plus everything finished in the last 12 hours ·
  updated 13:48 · refreshes every 60 s" (the hours come from the window config; the time is the
  last successful fetch, local time HH:mm). On the right: a legend of one pill per type in the
  order Needs you, Slice, Problem, Bug, Unplanned (12 px, 600, 4 / 10 padding, type bg and fg,
  a 7 px dot), then the refresh button: 44 x 44, radius 10, 1 px hairline, white, a 18 px
  circular-arrow icon (inline SVG, stroke 2), `aria-label` "Refresh now".
- **Header (phone).** Padding 20 / 16 / 12. `h1` 22 px, 700; under it, 12 px muted:
  "Updated 13:48 · last 12 h". Refresh button 44 x 44, background `#171A21`, border `#262B35`.
- **Waiting strip (desktop).** One white card, radius 16, 20 padding, 1 px hairline. Heading
  "Waiting for you" 16 px 700 `#7A3200`, then 13 px `#8A4A12`: "3 items across 2 projects".
  Tiles in a grid, `auto-fill minmax(280px, 1fr)`, 12 gap. Tile: button, bg `#FDEBD8`, border
  `#F0C9A0`, radius 12, padding 14 / 16, min height 44. Row 1: project name (12 px, 600) and the
  priority badge pushed right. Then title (15 px, 600), why (13 px muted), and a 12 px
  `#8A4A12` line "Asked 25 min ago · Slice 4 · Tag search" (asked age, then the parent).
- **Waiting strip (phone).** Heading "Waiting for you · 3", 14 px 700 `#FFB672`, 16 px side
  margin. Cards scroll sideways, 260 px wide, 10 gap, bg `#2A1C0E`, border `#5A3712`, radius 12,
  padding 12 / 14: project (12 px, 600, `#D9B48E`) with the priority badge (1 px `#D9B48E`
  border) at the right, title 15 px 600 white, why 12 px `#D9B48E`. No parent or age line.
- **Project group.** Header: project name (desktop 19 px, 700; phone 17 px, 700) and a muted
  summary under a hairline: desktop "1 waiting for you · 3 open · 1 done in 12 h" (the waiting
  part only when there are waiting items; "open" counts items in flight), phone
  "1 waiting · 3 open · 1 done". Sections, in order: desktop "Waiting for you · n" (only if
  any), "In flight · n", "Done in the last 12 h · n" (only if any). Section label: 12 px
  (phone 11 px), 600, uppercase, 0.06 em, muted. The phone project group shows "In flight" and
  "Done" only, because its waiting items are in the strip above (the mock supersedes the
  plan's per-project waiting row on the phone). Order of projects: the config order (the mock
  shows Recipe Box, Garden Planner, Home Lab).
- **Tile.** Grid `auto-fill minmax(280px, 1fr)`, 12 gap (phone: one column, 10 gap). Button,
  radius 12, padding 14 / 16 (phone 12 / 14), bg and border from the type colours, left-aligned.
  Row 1: type label (11 px, 700, uppercase, 0.05 em, type fg, with a 6 px dot) and the priority
  badge at the right. Then title (15 px, 600, `#14171C`), why (13 px, muted), and a last row:
  "↳ <parent>" (12 px muted, one line, ellipsis) and at the right the status label (12 px,
  600) with a 7 px dot: Open = hollow dot, muted; In progress = filled `#1D4ED8`; Blocked =
  filled `#B42318`; Done = filled `#0B6B4B`, label "Done 2 h ago"; Stale = hollow dot,
  label "Stale · No heartbeat for 3 h".
- **Done tile.** Same tile at opacity 0.78.
- **Stale tile (Slice 7).** bg `#F5F6F8`, 1 px dashed border `#9AA3B2`, title `#5B6370`,
  status label muted. Sits in "In flight".
- **Priority badge.** JetBrains Mono 11 px, radius 6, padding 1 / 6, 1 px border. Light: P0
  bg `#14171C`, text white; P1 white bg, `#14171C` text and border; P2 white bg, `#5B6370`
  text, `#C9CED6` border; P3 white bg, `#5B6370` text, `#E3E6EB` border. Dark: P0 bg `#E8EAEE`,
  text `#0E1014`; P1 transparent, `#E8EAEE` text and border; P2 transparent, `#9AA3B2` text,
  `#4A5262` border (P3 in dark is not drawn: transparent, `#9AA3B2` text, `#262B35` border).
- **Type colours (light).** Needs you bg `#FDEBD8` fg `#9A3F00` border `#F0C9A0`; Slice
  `#E6EEFC` / `#1D4ED8` / `#BFD0F5`; Problem `#EFE7FB` / `#6B2FBF` / `#D6C4F2`; Bug `#FCE4E4` /
  `#B42318` / `#F3BDBA`; Unplanned `#DDF3F0` / `#0B6B60` / `#A9DDD5`. **Dark** (drawn):
  Slice `#1C2B4A` / `#9DBDFF` / `#2E4473`; Problem `#2C1F45` / `#C9A7FF` / `#46336B`;
  Unplanned `#123631` / `#6FD8C9` / `#1F5249`; Needs you `#2A1C0E` / `#FFB672` / `#5A3712`.
  Bug dark is not drawn: `#3B1A1A` / `#FF9B94` / `#6B2A2A`. Status colours dark: In progress
  `#9DBDFF`, Blocked `#FF9B94`, Open `#9AA3B2`. These maps become the defaults in
  `config/board.example.json` (labels too: "Needs you", "Slice", "Problem", "Bug",
  "Unplanned"); the page reads them from config, never from code.
- **Detail panel, desktop.** Opens over the board: a scrim `rgba(20,23,28,0.32)` (click closes)
  and a panel on the right, 460 px wide, white, left shadow, padding 28, 20 gap, scrolls. Top
  row: type pill (12 px, 600, 3 / 10 padding, type bg, fg and dot), priority badge (11 px, 2 / 7
  padding) and a 44 px close button (16 px X icon) at the right. Title 22 px 700, why 14 px muted.
  A definition list (96 px label column, 13 px): Status (600, status colour), Project, Parent,
  Key (mono 12 px). Then "Details" (label style as section labels) in a `#F5F6F8` box, radius
  10, padding 14 / 16, 14 px paragraphs (the rendered `details_md`); "Links" (one link per
  line, 14 px, 500, the link label as text); "History", a list, newest first, each row a 52 px
  mono time column (12 px muted, HH:mm) and a status (600) over its note (muted).
- **Detail drawer, phone.** A bottom sheet, 700 px tall on the 844 px screen, `#171A21`, top
  radius 20, 1 px top border `#262B35`, padding 10 / 20 / 24, 16 gap; over a 55 % black scrim.
  A 40 x 4 grab handle (`#4A5262`) centred. Then the same top row (close button bg `#0E1014`),
  title 21 px 700, why 15 px muted `#9AA3B2`, a definition list (80 px label column) with
  Status, Project, Parent, Key, the details in a `#0E1014` box (radius 10, padding 12 / 14), the
  links in one row (14 px, 500, 16 gap, no "Links" heading) and "History" (11 px label; each row
  a 48 px time column, then **status** and "· note" in muted on one line). No "Details" heading
  on the phone.
- **Loading.** After 500 ms: a white card (radius 16, padding 24) of grey blocks: a 140 x 22
  heading bar `#E9ECF0`, an 84 px strip `#FBEFE2`, a 110 x 16 bar `#E9ECF0`, two 96 px tiles
  `#F0F2F5`, and the line "Loading the board…" (13 px muted). Nothing shows before 500 ms.
- **Empty.** Centred: a 44 px green check-in-circle icon (stroke `#0B6B4B`, 1.6), "Nothing
  open" (18 px, 700), and "No open items and nothing finished in the last 12 hours. Agents
  add items here as they report." (max 280 px, muted).
- **Failed load.** Centred: a 44 px red warning-triangle icon (stroke `#B42318`), "Couldn’t
  load the board" (18 px, 700), "The board API answered 503 (service unavailable). Showing
  nothing rather than old data." (max 300 px, muted; the status code and its plain-words reason
  come from the response) and a "Retry" button: min height 44, padding 0 / 22, radius 10, bg
  `#14171C`, white text 600.
- **Canvas furniture, not built:** the `support.js` script, the Google Fonts link, the "Desktop
  board (tap a tile)" artboard title, the seeded times (13:48, "25 min ago") and the 14 sample
  items. The sample items are good seed data (Work item below).
- **Data the page needs per item.** key, project, type, priority, status, title, why, parent
  (display text), details paragraphs, links (label, url), events (time, status, note), asked age
  (waiting items, from `created_at`), done age (from `done_at`), stale note (from
  `heartbeat_at`). Slice 1 carries these; see the changes below.
- **New strings (both locales; none are in a locale file yet, so the board is built with a
  string table with an English and a second-locale entry for each):** "Progress", "Waiting for
  you", "Waiting for you · {n}", "{n} items across {m} projects", "In flight · {n}", "Done in
  the last 12 h · {n}", "{n} waiting for you", "{n} open", "{n} done in 12 h", "Asked {age} ·
  {parent}", "Done {age}", "Stale · {note}", "No heartbeat for {n} h", "Open", "In progress",
  "Blocked", "Done", "Stale", "Needs you", "Slice", "Problem", "Bug", "Unplanned", "Details",
  "Links", "History", "Status", "Project", "Parent", "Key", "Refresh now", "Close", "Updated
  {time} · last {n} h", "updated {time} · refreshes every 60 s", "Loading the board…", "Nothing
  open", "No open items and nothing finished in the last {n} hours. Agents add items here as
  they report.", "Couldn’t load the board", "The board API answered {code} ({reason}). Showing
  nothing rather than old data.", "Retry", "{n} min ago", "{n} h ago".

**Plan changed to match the mock (2026-11-15):**

- Decisions: per-project waiting row is desktop only; the phone shows waiting items in the
  strip only (Phone.dc.html, the Recipe Box group starts at "In flight").
- Decisions: a failed refresh clears the board and shows the failed-load state (States.dc.html:
  "Showing nothing rather than old data").
- Decisions: refresh button, bundled fonts, palettes from config (Main.dc.html header).
- Work: the board response carries details, links and events for every item, so the drawer
  opens without a wait (Slice 1 gets the matching fields); the seed script uses the mock's 14
  items; E2E covers the stale tile, the done tile and the drawer on both viewports.

#### Work

- [ ] Query context7 for the Cloudflare Vite plugin / Workers static assets setup, Cloudflare
      Access in front of a Worker, and a markdown renderer with sanitising.
- [ ] Board page built to the *Design* subsection: header with refresh button and legend,
      waiting strip, project groups with their sections and summaries, tiles (open, in
      progress, blocked, done, stale), the desktop side panel and the phone bottom sheet, light
      and dark palettes from config, bundled fonts.
- [ ] Loading (after 500 ms), empty and failed-load states with Retry, as drawn.
- [ ] `GET /api/board` for the page (Access-authenticated, reads through the same list
      function as Slice 1). It returns, per item, `details_md`, `links` and the latest 20
      events, the window hours, and the server time, so the drawer opens with no second call.
- [ ] Add the mock's type, priority and status colour maps (light and dark) and labels to
      `config/board.example.json`; the page reads them.
- [ ] Put the page behind Cloudflare Access (by API with a token from the secrets store).
      **Parked, waits for the owner (answered 2026-11-15):** no token with Access edit rights
      exists (the secrets store holds only read-only Cloudflare tokens and the wrangler login
      has no Access scope, both checked 2026-11-15), and only the owner can create one. An
      unattended run builds everything else in this slice, leaves this item open, and records
      the two Verification lines that need Access (the phone check, the refused request through
      Access) under *Not yet verified*; it does not park the whole slice for it.
- [ ] Seed script with three made-up projects (the mock's Recipe Box, Garden Planner and Home
      Lab, 14 items) covering every type and status, including a stale and a done item.
- [ ] Playwright E2E at a 390×844 viewport and at desktop width: groups, ordering, drawer
      (side panel on desktop, bottom sheet on phone), stale and done tiles, empty and error
      states.

#### Verification

- Lint, typecheck, unit and E2E tests green.
- Seeded data from two projects shows correctly on the owner's phone (opened from the
  deployed URL through Access), including the drawer and the waiting strip.
- Opening the page without passing Access is refused.
- Screenshots of the seeded board at 1440 and 390 px match the four artboards: sizes, colours,
  labels and copy as listed in *Design*; a 503 from the API shows the failed-load card with
  Retry; no request leaves for a third-party host.
