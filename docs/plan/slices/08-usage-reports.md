### Slice 8 — Usage reports: tokens per model, cap readings, usage page

Source: the owner at the desk, 2026-11-16 ("I want to have an understanding of how my weekly cap
is being consumed ... every few minutes, the agents would report to the dashboard, how much token
they are consuming via which model and also report which task, which action").

*Planned.* Part A (server) can be built now. The design mock arrived on 2026-11-16 (in
`docs/design/`); part B (the page) is planned against it (see *Design* below).

**Touches:** `migrations/0003_usage.sql`, `src/domain/usage.ts`, `src/domain/cap.ts`,
`src/application/usage.ts`, `src/application/ports.ts`, `src/infrastructure/d1Repository.ts`,
`src/mcp/schemas.ts`, `src/mcp/tools.ts`, `src/api/router.ts`, `src/api/usageDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`

#### Why

The owner's agents run on several models, and each model uses up the subscription's weekly cap
at a different rate. Today nothing shows which model, agent or task used how much. The coding
tool already records, for every message, the model and four token counts (fresh input, written
to cache, read from cache, output), with one record file per helper agent (checked 2026-11-16 on
the owner's machine). So a client can send exact numbers; no agent has to count.

This slice stores those numbers and the cap readings and shows them. Working out what 1% of the
cap costs is [Slice 9](09-cap-cost-estimate.md).

#### Decisions (owner, 2026-11-16)

- **A script sends the numbers, not the agents.** The client reads the tool's own records and
  sends totals about every five minutes while work runs, and once when an agent stops. The
  client is planned in the owner's private config repo; this repo gives it tools and the guide.
- **The four token kinds are stored separately** (fresh input, cache write, cache read, output),
  per model. One example message had 4 fresh, 1,025 cache write, 94,256 cache read and 56 output
  tokens, so adding them together would hide what matters.
- **Totals so far, not differences.** A usage report carries the running totals of one agent on
  one model, with the time of the newest record it counted. Sending the same report twice
  changes nothing, a lost report is healed by the next one, and the use between any two times is
  a subtraction. This keeps the rule "one upsert keyed by a stable key" (`CLAUDE.md`).
- **Each report says what the tokens were for:** the item key of the task (a slice or a slice
  part), the agent's kind (for example a reviewer), and the step it was on when known. Helpers
  an agent starts report under the same task with their own model.
- **Cap readings are a separate report:** the time it was taken, the subscription plan's name,
  and for each window the client can read (the weekly one, any shorter one, any per-model one)
  the percentage used, with decimals, and the reset time when known.
- **The plan name is recorded on every cap reading.** The owner may move to a smaller plan and
  back; 1% of one plan is not 1% of another. Plan names are data from the client, never written
  in this repo.
- **A reset is an event, not a week.** Resets happen weekly, and the provider sometimes offers
  an extra reset mid-week or may move the start of the week. The board does not care how long a
  window lasts. It cares about the percentage going up inside one window, and on which plan.
- **Stale readings never pull the number down.** Readings are ordered by the time they were
  taken. Inside one window a reading lower than one already stored is dropped as stale. A lower
  reading starts a new window when its reset time differs from the stored one, or, when no reset
  time came with it, when it falls to the low mark (config, default 2%) from above it. So 98% to
  1% is a reset, and 60% to 55% is a stale reading.
- **Cost is never reset.** What a task has used stays with the task across resets and plan
  changes.
- **Private data.** Token numbers, model names, plan names and task keys live only in the
  owner's database behind the same gates as items. Examples in this repo use made-up values.
- **Design:** the owner makes a mock for the usage page first; the page is built to match it
  (the mock wins over this file). (Done 2026-11-16: the mock is in `docs/design/`; see
  *Design*.)

#### Decided at the desk (not the owner's choices)

- Two new MCP tools, both write-token only: `report_usage` and `report_cap`. The page reads
  through one new read route that calls the same application functions, behind the same Access
  check as `/api/board`.
- Two new tables in migration 0003: usage samples (agent key, model, time, the four running
  totals, task key, agent kind, step) and cap readings (time taken, plan, window kind, percent,
  reset time, source, accepted or dropped with the reason and, for a drop, the stored percent
  it lost to: the mock's tooltip shows it). Both append-only.
- The agent key is `<project>/session-<id>` for a main session and
  `<project>/session-<id>/agent-<id>` for a helper, in line with the keys in `docs/clients.md`.
- A running total that goes down for the same agent and model is stored as a restart (the
  difference counts from zero), never as negative use.
- Old samples are thinned by the existing cron: after the keep-time in config (default 30 days)
  only one sample an hour is kept per agent and model. The free-tier row limits from Slice 1
  decide the default; write the measured row counts into this file while building.
- **Added for the mock (2026-11-16):** the read route takes a time range (`24h`, `window`,
  `30d`; default `window`, the current weekly window) and a plan (default: the plan of the
  newest accepted reading), and returns the list of plans seen in cap readings for the picker.
  The page sends its own UTC offset so the days in the chart are the viewer's days.
- **Series colours come from config**, like the type colours: `config/board.example.json`
  gets a `usage.series` list of light and dark colour pairs (example values in *Design*). The
  server gives each model the next pair in the order it was first reported and keeps that
  assignment; model names are never written in the repo.
- **Shared page pieces owned by this slice** (it is the first to add a second view): the view
  tabs (desktop) and the bottom tab bar (phone), the view switching, and the header pattern.
  Slices 9, 10 and 11 reuse them. This slice builds the bar with the tabs Board and Usage;
  [Slice 10](10-task-steps.md) adds the Active work tab and its count.

#### Design (Agent Progress Board mock, Usage.dc.html, PhoneUsage.dc.html, Main.dc.html, Phone.dc.html, PhoneActive.dc.html, added 2026-11-16)

Two artboards for this slice (Usage and cost, desktop 1440x1900 light; Phone usage 390x844
dark), plus the view switcher drawn on every artboard. The mock agrees with the plan on what to
show and adds the time-range switch, the plan picker and the day buckets. Files:
`docs/design/Usage.dc.html` (sections: h1 "Usage" line 29, h2 "Weekly cap over this window"
line 66, h2 "Tokens per day, by model" line 74, h2 "Cost per task" line 122),
`docs/design/PhoneUsage.dc.html` (h1 line 21, h2 "Cost per task" line 37). All numbers, the
plan name "[PLAN NAME]" and the model names "model-large", "model-mid", "model-small" are
placeholders for run-time data (the canvas note says so); the page never contains them. Fonts as
in [Slice 2](02-tile-board.md) *Design*. The desktop page has no dark version drawn: it takes the
phone's dark values by role (card `#171A21`, hairline `#262B35`, text `#E8EAEE`, muted `#9AA3B2`,
page `#0E1014`, track `#262B35`).

- **View tabs (B1, shared, desktop; all desktop artboards).** `nav` "Views", flex, 4 gap, 4
  padding, bg `#E9ECF0`, radius 12, left aligned, above the header. Tab: link, min height 40,
  padding 0 / 16, radius 9, text `#3B424D` 500. Current tab: bg `#FFFFFF`, text `#14171C`, 600,
  shadow `0 1px 2px rgba(20,23,28,0.08)`, `aria-current="page"`. Labels: "Board", "Active work",
  "Usage". The Active work tab carries a count pill after the label (12 px, 600, padding 0 / 7,
  radius 999, bg `#14171C`, text white, 8 gap), filled by Slice 10. Dark: not drawn; the pill
  and the tab bg invert like the phone bar.
- **Bottom tab bar (B1, shared, phone; Phone, PhoneActive, PhoneUsage).** `nav` "Views", flex,
  border-top 1 px `#262B35`, bg `#0E1014`, padding 6 / 8 / 16. Three equal links, min height 52,
  icon above label, 3 gap, label 11 px. Current: text `#E8EAEE`, 600, icon stroke 2; others
  `#9AA3B2`, 500, stroke 1.6. Icons are inline SVG, 22 px, 24-unit viewBox, round caps and
  joins: Board = four rounded squares (`rect` 7x7, radius 1.5, at 3/14); Active work = the line
  `M3 12h4l3-8 4 16 3-8h4`; Usage = bars `M4 20V10M10 20V4M16 20v-7M22 20H2`. The count pill on
  Active work: 10 px, 700, padding 0 / 5, radius 999, bg `#E8EAEE`, text `#0E1014`.
- **Page frame (B2, desktop).** Max width 1180, padding 32 / 32 / 64, 24 gap, page bg `#F5F6F8`,
  text `#14171C`. Header row, wraps, space between, bottom aligned: `h1` "Usage" 26 px, 700,
  -0.02 em; under it 13 px muted: "Tokens your agents reported, the cap readings, and what each
  model costs of the cap · updated 13:48" (the time is the last successful fetch, HH:mm).
- **Time-range switch (B2).** Group "Time range": 2 gap, 3 padding, bg `#E9ECF0`, radius 10.
  Three buttons, min height 38, padding 0 / 12, radius 8: "24 h", "This window", "30 days". The
  pressed one (`aria-pressed="true"`): bg white, 600, same shadow as the tabs; others
  transparent, `#3B424D`. Default "This window".
- **Plan picker (B2).** Label "Plan" 13 px muted, then a `select`, min height 44, padding 0 / 12,
  radius 10, 1 px `#E3E6EB`, white, 600. Options are the plan names from the data (the mock
  shows "[PLAN NAME]"). Only readings and usage on the chosen plan count.
- **Cap tiles (B2).** `section` "Cap now", grid `repeat(auto-fit, minmax(240px, 1fr))`, 14 gap.
  Tile: white, 1 px `#E3E6EB`, radius 14, padding 18 / 20, 6 gap: label 13 px muted, value 40
  px, 700, -0.02 em, tabular, line 1.1; a bar (8 px, radius 4, track `#E9ECF0`, fill `#14171C`,
  width = percent); a 13 px muted line. Tile 1 "Weekly cap used" "34.2%", line "Resets Tue 17
  Nov, 08:00 · reading taken 13:46". Tile 2 "Shorter window used" "41%", line "Resets in 2 h
  10 min". A whole percent shows no decimal; otherwise one decimal. The third tile ("Cap growth
  the board can't explain", no bar) is [Slice 9](09-cap-cost-estimate.md)'s. If no shorter
  window was reported its tile is left out (not drawn); per-model windows are stored but not
  shown (the mock shows none).
- **Cap line (B3, desktop, `svg` viewBox 1000x280, full width, in a white card, radius 14,
  padding 20 / 24, 12 gap).** `h2` "Weekly cap over this window" 16 px, 700, with 13 px muted
  beside it: "Each dot is an accepted reading. A reading older and lower than one already stored
  is dropped and never pulls the line down." Plot x 48 to 976, y 20 (100%) to 240 (0%);
  gridlines at 0, 25, 50, 75, 100 %, 1 px `#E9ECF0`, labels 12 px muted, right aligned at x 38;
  day labels 12 px muted at y 266 ("Tue 10", "Wed 11" ...). Line `#14171C`, 2 px, round joins and
  caps, starting at the reset at 0%. Accepted readings: dots r 5, fill `#14171C`, 2 px white
  stroke, tooltip "{pct}% at reading". The reset: a vertical dashed line (`#14171C`, 1.5 px,
  dash 4 4) from 100% to 0% with the label "Reset · Tue 08:00" (12 px, 600) 8 px right of it, at
  the top. A dropped reading: a hollow dot (r 5, white fill, 2 px `#5B6370` stroke, dash 2 2)
  at its own time and value, tooltip "{pct}%, older than a stored {stored}% reading: dropped",
  with the label "Dropped: stale reading ({pct}%)" (12 px muted) beside it. The last point is
  labelled "{pct}% now" (13 px, 700, right aligned, above the point). Alt text (the `svg`
  `aria-label`): "Weekly cap used rose from 0% at the reset on {day} {time} to {pct}% now.
  {n} stale reading on {day} was dropped." Several resets in the range each get a dashed
  line (not drawn; same style). The chart is the weekly window only.
- **Tokens per day (B3, desktop, white card as above).** `h2` "Tokens per day, by model", a
  legend at the right: 12 px swatch (radius 3) and the model name in JetBrains Mono 12 px, 16
  gap. `svg` viewBox 1000x300: stacked bars, one a day, width 55.3, y axis 0 to a rounded top
  (labels "0", "2.5 M", "5 M" ... right aligned at x 38, gridlines `#E9ECF0`), day labels 12 px
  muted at y 286; the stack goes bottom up in model order; segments are separated by 2 px; the
  top segment has a 4 px top radius; the day total sits above each bar, 12 px `#14171C`
  ("5.1 M"); each segment has a tooltip "{day} · {model}: {n} M tokens"; model names are also
  written at the right of the last bar (12 px). Alt text names the biggest model and points to
  the table. Series colours (light, from config): `#2a78d6`, `#eb6834`, `#1baf7a`; dark (drawn
  on the phone only, same roles): `#3987e5`, `#d95926`, `#199e70`. For the "24 h" range the
  buckets are hours (not drawn; same chart with hour labels).
- **Token kinds table (B3, under the chart).** Caption "Token kinds this window, millions"
  (12 px, 600, uppercase, 0.06 em, muted). Columns "Model" (swatch 10 px radius 2 and the name,
  mono 12 px, 500), "Fresh input", "Cache write", "Cache read", "Output", "Total" (600,
  `#14171C`). Numbers 13 px tabular, two decimals, the total one decimal; right aligned; row
  hairline `#F0F2F5`; header hairline `#E3E6EB`. Scrolls sideways when narrow.
- **Cost per task (B3 here; "Of the cap" column is Slice 9).** Card (flex 999 1 560 px) with
  `h2` "Cost per task" and 13 px muted "Kept across resets and plan changes". Table: "Task",
  "Project", "Tokens" (right, "7.1 M"), then Slice 9's "Of the cap" (200 px wide). Row padding 9 /
  12, task 500, project muted. The task is the task's title (a part reads "Slice 9 · Part C ·
  Notification channel"). The route returns the top six tasks by tokens plus one row
  "Everything else" with the project count ("3 projects"); the six is config. A key with no
  item shows its key.
- **Phone usage (B2, B3; PhoneUsage).** Dark. Header padding 20 / 16 / 12, `h1` 22 px, 700; 12
  px muted "This window · [PLAN NAME]". The time-range switch and the plan picker are not drawn
  on the phone; they carry over from the desktop (switch below the header, picker beside it,
  both 44 px). Cards: bg `#171A21`, 1 px `#262B35`, radius 14, padding 14, 12 gap. Weekly cap
  card: label 12 px muted, value 34 px, 700, bar 8 px (track `#262B35`, fill `#E8EAEE`), 12 px
  muted line "Resets Tue 08:00 · shorter window 41% · 8% of growth not explained". Cost per task
  card: `h2` 14 px, 700; three rows (task and project muted, percent 600 at the right) each over
  a 6 px bar (track `#232833`, fill `#C7CDD8`). The cap line, the token chart and the token
  table are not drawn on the phone; they carry over from the desktop at one column (the
  charts scale by their viewBox) and the table scrolls sideways.
- **States (B2).** Loading after 500 ms, empty and failed are drawn only for the board
  (`States.dc.html`). For Usage they are not drawn: the same three cards carry over (loading
  skeleton, check-mark empty, red-triangle failed with "Retry" 44 px), with copy for "usage" in
  place of "board". Empty copy applies when no usage and no reading exist in the range.
- **New strings (both locales; string table):** "Usage", "Active work" (tab; used by Slice 10),
  "Board" (tab), "Tokens your agents reported, the cap readings, and what each model costs of
  the cap", "Time range", "24 h", "This window", "30 days", "Plan", "Weekly cap used", "Shorter
  window used", "Resets {day}, {time}", "reading taken {time}", "Resets in {h} h {m} min",
  "Weekly cap over this window", the dot caption, "Reset · {day} {time}", "Dropped: stale
  reading ({pct}%)", "{pct}% now", "{pct}% at reading", the dropped tooltip, the alt texts,
  "Tokens per day, by model", "Token kinds this window, millions", "Model", "Fresh input",
  "Cache write", "Cache read", "Output", "Total", "Cost per task", "Kept across resets and plan
  changes", "Task", "Project", "Tokens", "Everything else", "{n} projects", "This window ·
  {plan}", "Resets {day} {time} · shorter window {pct}% · {n}% of growth not explained" (the
  last part comes from Slice 9), and the three usage state texts.

**Changed to match the mock (2026-11-16):**
- The page has three view tabs (Board, Active work, Usage), and on the phone a bottom tab bar;
  the old B2 "a way to move between views" is these (Main.dc.html line 22, Phone.dc.html line 67).
- A time-range switch ("24 h", "This window", "30 days") and a plan picker are added; the route
  takes both (Usage.dc.html header). Old text had neither.
- The charts are two: the weekly cap line with the reset marked and a dropped reading shown
  (so A5 must return dropped readings with the stored value they lost to), and tokens per day
  by model as stacked bars with a table of the four token kinds. The old B3 "tokens over time"
  is the per-day bars.
- Cost per task and per agent kind are drawn in percent of the cap, not tokens: the tokens
  column stays on the task table, the agent-kind list has no tokens (it is Slice 9).
- Series colours are config (light and dark pair per series).

#### Work

**A. Server (no design needed)**

- [ ] **A1.** Migration 0003 with the two tables and their indexes (by time, by task key).
- [ ] **A2.** `src/domain/usage.ts`: the use between two times from running totals, per model
      and kind, including the restart case. Pure, with tests.
- [ ] **A3.** `src/domain/cap.ts`: the reading rules above (order by time taken, drop stale,
      detect a reset, split into windows, plan changes). Pure, with tests for: 98 to 1 with a
      new reset time, 60 to 55 with the same reset time, a late-arriving older reading, a reset
      with no reset time, a plan change mid-window.
- [ ] **A4.** `report_usage` and `report_cap` tools with schemas and limits, calling the
      application layer; the repository port and its D1 code.
- [ ] **A5.** The read route for the page (Usage.dc.html), for a time range (`24h`, `window`,
      `30d`), a plan and the viewer's UTC offset: tokens per day (per hour for `24h`) per
      model; totals per model and per token kind; the top tasks by tokens (title, project,
      key; six by config, plus an "everything else" row with its project count); tokens per
      agent kind; the accepted cap readings with the windows they fall in (weekly and the
      shorter one: percent, reset time, time taken); the dropped readings with the stored
      percent each lost to; the plans seen; the series colour index of each model (from config,
      in first-reported order); and the time of the answer. All behind the Access check.
- [ ] **A5b.** `config/board.example.json`: `usage.series` (example: light `#2a78d6`,
      `#eb6834`, `#1baf7a`; dark `#3987e5`, `#d95926`, `#199e70`), `usage.topTasks` (6). The
      page reads both from the route, never from code.
- [ ] **A6.** `docs/clients.md`: both tools, the keys, "totals so far", what to send and how
      often, the fail-open rule again. README line.
- [ ] **A7.** Thinning of old samples in the cron, with a test.

**B. Usage page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it. (Done: the
      mock is in `docs/design/`, refreshed 2026-11-16.)
- [ ] **B2.** The shared view switcher and the usage view shell: view tabs (desktop,
      Main.dc.html line 22 / Usage.dc.html line 17) and the bottom tab bar (phone,
      PhoneUsage.dc.html `nav`), with Board and Usage tabs now (Slice 10 adds Active work);
      header, time-range switch, plan picker, the two cap tiles (Usage.dc.html section "Cap
      now"; PhoneUsage.dc.html section "Weekly cap"); a loading state for any wait over 500 ms,
      empty and failed states (carried over from `States.dc.html`, see *Design*).
- [ ] **B3.** The charts and tables: the cap line with the reset marked and a dropped reading
      shown (section "Weekly cap over this window"), tokens per day by model with the token
      kinds table (section "Tokens per day, by model"), the cost-per-task table with its Task,
      Project and Tokens columns (section "Cost per task"; the "Of the cap" column and the
      agent-kind list come with Slice 9); the phone's two cards (PhoneUsage.dc.html).
- [ ] **B4.** Browser tests against a faked read route, phone and desktop sizes: range switch
      and plan picker change the request; a dropped reading is drawn hollow with its label;
      the chart has a table equivalent.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green, with the cases named in A2 and A3.
- Sending the same `report_usage` twice leaves one sample's worth of use; a `report_cap` with a
  lower percentage and the same reset time is stored as dropped and does not change the page.
- On the deployed board: a real client run shows tokens for at least two models under the right
  task, and the weekly percentage with its reset time. Any check that writes to the live board
  removes its own rows in the same run (`plan.md`, *Outstanding work*).
- The page matches Usage.dc.html and PhoneUsage.dc.html in the values listed in *Design*; no
  model, plan or project name from the mock appears in `web/` or `e2e/` fixtures beyond the
  made-up placeholders.
- `npm run test:e2e` green for part B.
