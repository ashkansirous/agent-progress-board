### Slice 8 — Usage reports: tokens per model, cap readings, usage page

Source: the owner at the desk, 2026-11-16 ("I want to have an understanding of how my weekly cap
is being consumed ... every few minutes, the agents would report to the dashboard, how much token
they are consuming via which model and also report which task, which action").

*Built 2026-11-16 (wave of that day), merged as PR #53 (ebc074a), deployed by the pipeline run on 6bbae7f (deployment created 2026-11-16T16:24:39Z).* Parts A and B are built. The design mock arrived on 2026-11-16 (in
`docs/design/`); part B (the page) is planned against it (see *Design* below).

**Touches:** `migrations/0003_usage.sql`, `src/domain/usage.ts`, `src/domain/cap.ts`,
`src/application/usage.ts`, `src/application/ports.ts`, `src/infrastructure/d1Repository.ts`,
`src/domain/item.ts`, `src/domain/upsert.ts`, `src/mcp/schemas.ts`, `src/mcp/tools.ts`,
`src/api/router.ts`, `src/api/usageDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`, `src/index.ts`, `src/mcp/handler.ts`, `src/env.ts`,
`.gitignore`

Touches widened at the claim (2026-11-16, premise check against `origin/main`): the thinning
(A7) runs from `scheduled` in `src/index.ts`; tools may register in `src/mcp/handler.ts`;
`src/env.ts` only if a binding type changes; `.gitignore` gets `tmp/` (the open small item in
`plan.md`, *Outstanding work*, which goes with the next code PR).

**Migrations:** 0003

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
- **Environment is part of every report (owner, 2026-11-16, third request, decision 1).** "I now
  also run agents on Claude cloud VMs, and I don't assume that use is free. report_usage and
  report_progress carry an environment value from the client, for example "laptop" or
  "cloud-vm". It is free text from config and never hard-coded. Store it on usage samples and
  items."
- **Sources the board can't see (owner, 2026-11-16, decision 3).** Claude Design, Claude chat
  on desktop and phone, and other machines also use the cap. "First check the official
  Anthropic docs for any way to read their usage. Write what you find, with links, into Slice
  8. Don't assume an answer." If there is no way: they stay in "not explained", as the mock
  shows, and the usage route returns the stretches with the most unexplained growth (time,
  points, how much the reports explained), for "When the unexplained growth happened" (the
  server item A3b and the page item B2 are in [Slice 9](09-cap-cost-estimate.md), because they
  need its fit). If there is a way: write it up as a
  new planned slice and stop; don't build it. What the docs say is in the section *Sources the
  board cannot see* below; this file builds only the no-way branch for now.
- **Private data.** Token numbers, model names, plan names, environment names and task keys
  live only in the owner's database behind the same gates as items. Examples in this repo use
  made-up values.
- **Design:** the owner makes a mock for the usage page first; the page is built to match it
  (the mock wins over this file). (Done 2026-11-16: the mock is in `docs/design/`; see
  *Design*.)

#### Decided at the desk (not the owner's choices)

- Two new MCP tools, both write-token only: `report_usage` and `report_cap`. The page reads
  through one new read route that calls the same application functions, behind the same Access
  check as `/api/board`.
- Two new tables in migration 0003: usage samples (agent key, model, time, the four running
  totals, task key, agent kind, step, environment) and cap readings (time taken, plan, window kind, percent,
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
  `30d`; default `window`, the current weekly window), a plan (default: the plan of the
  newest accepted reading) and an environment filter (default: all), and returns the list of plans seen in cap readings for the picker.
  The page sends its own UTC offset so the days in the chart are the viewer's days.
- **`environment` is free text and is never hard-coded** (owner's rule). Two config keys, both
  optional, tell the board what to do with it: `usage.baseEnvironment` names the environment
  that counts as the main machine (the 1x base of [Slice 9](09-cap-cost-estimate.md)'s
  multiplier), as the client sends it (made-up example "laptop"); `usage.environmentLabels` maps
  a sent value to the text the page shows (example `{"laptop": "Laptop", "cloud-vm": "Cloud
  VM"}`; without an entry the page shows the value as sent). When `baseEnvironment` is not set,
  the base is the environment with the most reported tokens on the plan, so nothing in the repo
  or in code names the owner's machines. A report with no `environment` is stored with null and
  counts as the base environment (so an old client changes nothing). The owner can overrule
  this choice (it is not in the request).
- **Column home for `environment` on items.** This slice adds the column to `items` and the
  tool field to `report_progress` (the field only), because the two tools take it together;
  [Slice 10](10-task-steps.md) builds on it. If Slice 10 is built first, it adds the column in
  its migration and this migration leaves it out.
- **Where the unexplained stretches come from.** They need the fit's per-stretch leftover, so
  the stretch list and its page part are in [Slice 9](09-cap-cost-estimate.md); this slice's
  route and research section only frame them.
- **Series colours come from config**, like the type colours: `config/board.example.json`
  gets a `usage.series` list of light and dark colour pairs (example values in *Design*). The
  server gives each model the next pair in the order it was first reported and keeps that
  assignment; model names are never written in the repo.
- **Shared page pieces owned by this slice** (it is the first to add a second view): the view
  tabs (desktop) and the bottom tab bar (phone), the view switching, and the header pattern.
  Slices 9, 10 and 11 reuse them. This slice builds the bar with the tabs Board and Usage;
  [Slice 10](10-task-steps.md) adds the Active work tab and its count.

#### Stored state: the design to build (wave coordinator, 2026-11-16, at the claim)

The premise check found that the lines above leave the stored state open (what makes a report
"the same", where a restart and a window live, what a late reading does). The builder builds
this design and invents none. Where it differs from *Decided at the desk* above, this section
wins; none of it changes an owner decision.

- **One owner per fact: the tables hold only what was reported; everything else is worked out
  when read**, by the pure functions in `src/domain/usage.ts` and `src/domain/cap.ts`. Nothing
  derived (a restart offset, a window, accepted or dropped) is stored, so a retry, a late report
  or a Worker restart cannot leave it wrong.
- **Usage samples.** A sample is identified by agent key, model, environment (null counts as
  the empty string) and the time of the newest record it counted. A unique index on those four
  and `INSERT OR IGNORE`: the same report sent twice stores one row; a second report with the
  same identity and other totals is ignored (the first stays). Rows are never updated.
- **Use between two times** is worked out from the samples of one agent, model and environment
  in time order: each sample adds its totals minus the previous sample's; when any of the four
  totals is lower than in the previous sample, that sample is a restart and all four count from
  zero. No offset is stored. A report that arrives late simply takes its place in the order.
- **Cap readings.** The table stores the raw reading only: time taken, plan, window kind,
  percent, reset time, source. It has **no** accepted/dropped columns (this replaces the
  "accepted or dropped with the reason" columns above). Identity: time taken, plan, window
  kind; unique index, `INSERT OR IGNORE`. `src/domain/cap.ts` takes the readings of one plan
  and window kind in order of time taken and returns the windows, each reading's verdict
  (accepted, or dropped with the reason and the percent it lost to) by the owner's rules. The
  read route calls it on every request, over the readings of the asked range and never fewer
  than the keep-time's days, so a late older reading re-orders by itself. The "stored as
  dropped" line in *Verification* is checked on what the route returns.
- **Two window rules added after review pass 1** (`reviews/pr-53-high.md` findings 3 and 4;
  the wave coordinator's choice, the owner's rules above stay as they are): (a) a window whose
  known reset time has passed is over, so a reading taken at or after the current window's
  reset time starts a new window whatever its percent (a quiet week that resets from 5% to a
  first reading of 6% is still a reset); (b) "its reset time differs" needs both reset times
  known: when the current window has none, a lower reading that carries one is judged by the
  low mark only, and the first accepted reading that carries a reset time gives it to the
  window.
- **How the two sample queries stay small** (after review pass 2, `reviews/pr-53-medium.md`
  findings 1 to 4; both passes raised these queries, so this is the one design for them):
  (a) every stored time (`record_at`, `taken_at`, reset times) is normalised to UTC ISO
  (`toISOString`) in the application layer before the write, so text order is time order and
  the hour is the first 13 characters; (b) the read query returns the samples in the range,
  and a baseline (the newest sample before the range start) **only for series that have a
  sample in the range**, looked up one series at a time through the identity index; a series
  with no sample in the range has no use in it and is not read; (c) thinning looks only at a
  band of samples between the cutoff minus 3 days and the cutoff, since earlier runs have
  already thinned what is older (a cron that was down for more than 3 days leaves that stretch
  unthinned, which costs rows, never correctness); (d) thinning also keeps the last sample
  before the task key or the agent kind of a series changes, so what a task used is the same
  before and after thinning, not only the total.
- **Series order.** A small table `usage_series` (kind: model, agent kind or environment;
  value; first seen) gets an `INSERT OR IGNORE` row with every usage report. The colour index
  of a value is its place in that table by first seen, then by value. Thinning never touches it.
- **Thinning (A7).** After the keep-time, per agent, model and environment, the cron keeps the
  last sample of each hour, and also every restart sample and the sample just before it, so the
  use worked out afterwards is the same as before. Deleting twice deletes nothing more. Cap
  readings are not thinned in this slice.
- **Config keys** (all optional, in `usage`): `lowMarkPercent` (default 2), `keepDays` (default
  30), next to `series`, `topTasks`, `baseEnvironment`, `environmentLabels`.
- **Range `window` with no accepted weekly reading:** the token parts cover the last 7 days and
  the cap parts are empty (the page shows its empty cap state).
- Both tools still answer through the application layer; the unexplained stretches stay in
  [Slice 9](09-cap-cost-estimate.md).

#### Sources the board cannot see: what the official docs say (checked 2026-11-16)

Verdict: **no official way was found** for a personal subscription to read how much the chat
apps, Claude Design, cloud sessions or another machine used. So the owner's "no way" branch
applies: those sources stay in "not explained", and the usage route returns the stretches with
the most unexplained growth ([Slice 9](09-cap-cost-estimate.md)). No new slice is planned from
this. Official pages only were read, by a research pass on 2026-11-16; quotes are from the pages.

- **Usage per source, by API or export: no.** The Claude Code Analytics API page says of
  subscription sign-ins: "their usage is attributed to their claude.ai organization, and this API
  doesn't return it."
  (<https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api>). The data
  export page lists "conversation data and the user data for your account" and does not say
  whether usage numbers are included
  (<https://support.claude.com/en/articles/9450526-how-can-i-export-my-claude-data>).
- **Admin and analytics APIs: not for a personal plan.** "The Admin API isn't available to
  organizations on the claude.ai Team plan or to individual Claude Console accounts." (same
  Analytics API page). An Enterprise analytics API lists the sources chat, Claude Code, Cowork
  and Claude Design; its page does not state that a personal plan can use it
  (<https://platform.claude.com/docs/en/api/admin/analytics>).
- **The cap percentage: documented only as input to a local status line.** The fields
  `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage` are given
  to the status line script of a running session; the page does not say which sources they count
  (<https://code.claude.com/docs/en/statusline>). No documented web API returns them.
- **The settings page: no breakdown described.** "You can see your next reset time in Settings >
  Usage." (<https://support.claude.com/en/articles/11049741>). The coding tool's own usage
  screen covers local sessions only: "usage from other devices or claude.ai is not included."
  (<https://code.claude.com/docs/en/costs>).
- **Cloud sessions count against the same limits: yes.** "It counts toward your plan's usage
  limits alongside the rest of your Claude and Claude Code usage."
  (<https://code.claude.com/docs/en/claude-code-on-the-web>). Chat and the local tool share
  limits too: "all activity in both tools counts against the same limits."
  (<https://support.claude.com/en/articles/11145838>). So the documents expect a cloud
  multiplier near 1×; the board still measures it (owner's decision 2).
- **Claude Design: not found.** No official page that was opened says whether Claude Design
  counts against the same limits. No Design help page was opened; one support link answered
  "not found" (<https://support.claude.com/en/articles/11014257>).
- **Telemetry export in cloud sessions** is set through the cloud environment, not files on the
  owner's machine, and the page does not say whether a personal plan can use it
  (<https://code.claude.com/docs/en/monitoring-usage>). It reports tokens, not the cap.

#### Design (Agent Progress Board mock, Usage.dc.html, PhoneUsage.dc.html, StatesNew.dc.html, Main.dc.html, Phone.dc.html, PhoneActive.dc.html, added 2026-11-16, refreshed 2026-11-16)

Artboards for this slice: Usage and cap cost (desktop 1440x2950 light), Phone usage (390x2420
full scroll, dark), Active work and usage states (`StatesNew.dc.html`, 1280x1000), plus the view
switcher drawn on every artboard. The mock agrees with the plan on what to show; it adds the
time-range switch, the plan picker, the environment filter, the split switch and the day
buckets. Files: `docs/design/Usage.dc.html` (h1 "Usage" line 29, h2 "Weekly cap over this
window" line 67, h2 "Tokens per day, by model" line 75, h2 "Cost per task" line 156),
`docs/design/PhoneUsage.dc.html` (h1 line 21, h2 "Weekly cap over this window" line 35, h2
"Tokens per day" line 39, h2 "Cost per task" line 68), `docs/design/StatesNew.dc.html` (the
Usage cards, line 19). All numbers, the plan name "[PLAN NAME]", the model names
"model-large", "model-mid", "model-small" and the environment names "Laptop", "Cloud VM" are
placeholders for run-time data (the canvas note says so); the page never contains them, and
never decides which environment is the main machine (see *Decided at the desk*). Fonts as in
[Slice 2](02-tile-board.md) *Design*. The desktop dark theme is not an artboard but is given by
rule in `docs/design/canvas.json`, `notes.dark`: ground `#F5F6F8` to `#0E1014`, card `#FFFFFF`
to `#171A21`, border `#E3E6EB` to `#262B35`, text `#14171C` to `#E8EAEE`, muted `#5B6370` to
`#9AA3B2`, track `#E9ECF0` to `#262B35`; type tints and text are the dark pairs in
Phone.dc.html; series colours `#2a78d6` to `#3987e5`, `#eb6834` to `#d95926`, `#1baf7a` to
`#199e70`.

- **View tabs (B1, shared, desktop; all desktop artboards).** `nav` "Views", flex, 4 gap, 4
  padding, bg `#E9ECF0`, radius 12, left aligned, above the header. Tab: link, min height 40,
  padding 0 / 16, radius 9, text `#3B424D` 500. Current tab: bg `#FFFFFF`, text `#14171C`, 600,
  shadow `0 1px 2px rgba(20,23,28,0.08)`, `aria-current="page"`. Labels: "Board", "Active work",
  "Usage". The Active work tab carries a count pill after the label (12 px, 600, padding 0 / 7,
  radius 999, bg `#14171C`, text white, 8 gap), filled by Slice 10.
- **Bottom tab bar (B1, shared, phone; Phone, PhoneActive, PhoneUsage).** `nav` "Views", sticky
  at the bottom, flex, border-top 1 px `#262B35`, bg `#0E1014`, padding 6 / 8 / 16. Three equal
  links, min height 52, icon above label, 3 gap, label 11 px. Current: text `#E8EAEE`, 600,
  icon stroke 2; others `#9AA3B2`, 500, stroke 1.6. Icons are inline SVG, 22 px, 24-unit viewBox,
  round caps and joins: Board = four rounded squares (`rect` 7x7, radius 1.5, at 3/14); Active
  work = the line `M3 12h4l3-8 4 16 3-8h4`; Usage = bars `M4 20V10M10 20V4M16 20v-7M22 20H2`.
  The count pill on Active work: 10 px, 700, padding 0 / 5, radius 999, bg `#E8EAEE`, text
  `#0E1014`.
- **Page frame (B2, desktop).** Max width 1180, padding 32 / 32 / 64, 24 gap, page bg `#F5F6F8`,
  text `#14171C`. Header row, wraps, space between, bottom aligned: `h1` "Usage" 26 px, 700,
  -0.02 em; under it 13 px muted: "Tokens your agents reported, the cap readings, and what each
  model costs of the cap · updated 13:48" (the time is the last successful fetch, HH:mm). At the
  right, one row, 12 gap, wraps: time-range switch, environment filter, plan picker.
- **Time-range switch (B2).** Group "Time range": 2 gap, 3 padding, bg `#E9ECF0`, radius 10.
  Three buttons, min height 38, padding 0 / 12, radius 8: "24 h", "This window", "30 days". The
  pressed one (`aria-pressed="true"`): bg white, 600, same shadow as the tabs; others
  transparent, `#3B424D`. Default "This window".
- **Environment filter (B2; new in the refresh, Usage.dc.html line 38).** Group "Environment",
  same style as the range switch (min height 38). Buttons: "All environments" (pressed by
  default), then one per environment seen in the data (the mock: "Laptop", "Cloud VM"), each
  shown as sent by the client or as the label from config (see *Decided at the desk*). Choosing
  one limits the token numbers, charts and tables to it; the cap tiles and the cap line are
  the account's and do not change. Phone (PhoneUsage.dc.html line 25): under the range switch,
  equal buttons "All" then one per environment (min height 36, 12 px, same track and pressed
  colours as the phone range switch).
- **Plan picker (B2).** Label "Plan" 13 px muted, then a `select`, min height 44, padding 0 / 12,
  radius 10, 1 px `#E3E6EB`, white, 600. Options are the plan names from the data (the mock
  shows "[PLAN NAME]"). Only readings and usage on the chosen plan count.
- **Cap tiles (B2).** `section` "Cap now", grid `repeat(auto-fit, minmax(240px, 1fr))`, 14 gap.
  Tile: white, 1 px `#E3E6EB`, radius 14, padding 18 / 20, 6 gap: label 13 px muted, value 40
  px, 700, -0.02 em, tabular, line 1.1; a bar (8 px, radius 4, track `#E9ECF0`, fill `#14171C`,
  width = percent); a 13 px muted line. Tile 1 "Weekly cap used" "34.2%", line "Resets Tue 17
  Nov, 08:00 · reading taken 13:46". Tile 2 "Shorter window used" "41%", line "Resets in 2 h
  10 min". A whole percent shows no decimal; otherwise one decimal. The third tile ("Cap growth
  the board can’t explain", no bar) is [Slice 9](09-cap-cost-estimate.md)'s. If no shorter
  window was reported its tile is left out (not drawn; the grid fills the row); per-model windows
  are stored but not shown (the mock shows none).
- **Cap line (B3, desktop, `svg` viewBox 1000x280, full width, in a white card, radius 14,
  padding 20 / 24, 12 gap).** `h2` "Weekly cap over this window" 16 px, 700, with 13 px muted
  beside it: "Same days as the token chart below; resets are marked on both. Each dot is an
  accepted reading. A reading older and lower than one already stored is dropped and never pulls
  the line down." Plot x 48 to 976, y 20 (100%) to 240 (0%); gridlines at 0, 25, 50, 75, 100 %,
  1 px `#E9ECF0`, labels 12 px muted, right aligned at x 38; day labels 12 px muted at y 266
  ("Tue 10", "Wed 11" ...). Line `#14171C`, 2 px, round joins and caps, starting at the reset at
  0%. Accepted readings: dots r 5, fill `#14171C`, 2 px white stroke, tooltip "{pct}% at
  reading". The reset: a vertical dashed line (`#14171C`, 1.5 px, dash 4 4) from 100% to 0% with
  the label "Reset · Tue 08:00" (12 px, 600) 8 px right of it, at the top. A dropped reading: a
  hollow dot (r 5, white fill, 2 px `#5B6370` stroke, dash 2 2) at its own time and value,
  tooltip "{pct}%, older than a stored {stored}% reading: dropped", with the label "Dropped:
  stale reading ({pct}%)" (12 px muted) beside it. The last point is labelled "{pct}% now" (13
  px, 700, right aligned, above the point). Alt text (the `svg` `aria-label`): "Weekly cap used
  rose from 0% at the reset on {day} {time} to {pct}% now. {n} stale reading on {day} was
  dropped." Several resets in the range each get a dashed line (not drawn; same style). The
  chart is the weekly window only.
- **Cap line, phone (B3; PhoneUsage.dc.html line 35, new in the refresh).** Dark card (bg
  `#171A21`, 1 px `#262B35`, radius 14, padding 14, 10 gap), `h2` "Weekly cap over this window"
  14 px, 700. `svg` viewBox 358x150: plot x 34 to 350, y 10 (50%) to 126 (0%), gridlines at 0,
  25, 50 % (`#262B35`, labels 11 px `#9AA3B2` at x 28); one-letter day labels 11 px at y 144;
  reset line dashed `#E8EAEE` 1.5 px, dash 3 3, label "Reset" 11 px, 600; line `#E8EAEE` 2 px;
  dots r 4, fill `#E8EAEE`, stroke `#171A21` 2; dropped reading: hollow dot r 4, fill `#171A21`,
  1.5 px `#9AA3B2` stroke dash 2 2, label "dropped" 10 px `#9AA3B2`. No "now" label and no
  tooltips on the phone. The mock's y axis stops at 50% because its sample stays below it; the
  axis top is the next quarter above the highest accepted reading (a decision at the desk, the
  mock shows one case).
- **Tokens per day (B3, desktop, white card as above).** `h2` "Tokens per day, by model", then the
  split switch, then the legend at the right (12 px swatch, radius 3, and the name in JetBrains
  Mono 12 px, 16 gap). **Split switch (Usage.dc.html line 76):** group "Split tokens by", 2 gap,
  3 padding, bg `#E9ECF0`, radius 10; four buttons, min height 34, padding 0 / 12, radius 8, 13
  px: "Model" (pressed by default), "Token kind", "Agent kind", "Environment"; the pressed one is
  white, 600, with the tab shadow. The split decides what the segments, legend, tooltips and alt
  text name; the heading follows ("Tokens per day, by model", "... by token kind", "... by agent
  kind", "... by environment"). `svg` viewBox 1000x300: stacked bars, one a day, width 55.3, y
  axis 0 to a rounded top (labels "0", "2.5 M", "5 M" ... right aligned at x 38, gridlines
  `#E9ECF0`), day labels 12 px muted at y 286; the stack goes bottom up in series order;
  segments are separated by 2 px; the top segment has a 4 px top radius; the day total sits
  above each bar, 12 px `#14171C` ("5.1 M"); each segment has a tooltip "{day} · {series}: {n}
  M tokens"; series names are also written at the right of the last bar (12 px). The reset is a
  dashed line at the left edge (`#14171C`, 1.5 px, dash 4 4) labelled "Reset" (12 px, 600). Alt
  text names the biggest series and points to the table. Series colours (light, from config):
  `#2a78d6`, `#eb6834`, `#1baf7a`; dark: `#3987e5`, `#d95926`, `#199e70`. For the "24 h" range
  the buckets are hours (not drawn; same chart with hour labels).
- **Tokens per day, phone (B3; PhoneUsage.dc.html line 39).** Card as above, `h2` "Tokens per
  day" 14 px, 700. Split switch under it: four equal buttons "Model", "Kind", "Agent", "Env"
  (min height 36, 12 px, track `#232833`, pressed `#3A4150` with white 600, others `#C7CDD8`
  500). Legend: swatch 10 px (radius 2), name 11 px mono, 12 gap, wraps. `svg` viewBox 358x170:
  bars 24.8 wide, plot x 34 to 350, y 10 to 146, labels "0", "5 M", "10 M" (11 px `#9AA3B2`),
  one-letter day labels at y 164, top segment radius 3, no day totals, no tooltips, reset
  dashed line at the left (`#E8EAEE`, 1.5 px, dash 3 3, no label). The token kinds table is not
  drawn on the phone; it carries over at one column and scrolls sideways.
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
  item shows its key. Phone (PhoneUsage.dc.html line 68): card with `h2` "Cost per task" 14 px,
  700; four rows, each the short title ("Slice 9 · Part C": slice and part, no project) at the
  left and the percent at the right (13 px, 600) over a 6 px bar (track `#232833`, fill
  `#C7CDD8`); no tokens, no project and no "Everything else" row drawn (they carry over from the
  desktop table's rows, same pattern).
- **Phone usage frame (B2; PhoneUsage).** Dark, bg `#0E1014`. Header padding 20 / 16 / 12, 10
  gap: a row with `h1` "Usage" 22 px, 700 and, at the right, "Plan" 12 px muted with a `select`
  (min height 44, padding 0 / 10, radius 10, 1 px `#262B35`, bg `#171A21`, 13 px, 600); under it
  the time-range switch and the environment group (36 px). Body padding 0 / 16 / 16, 12 gap;
  cards bg `#171A21`, 1 px `#262B35`, radius 14, padding 14. Cap card (6 gap): label 12 px
  muted, value 34 px, 700, bar 8 px (track `#262B35`, fill `#E8EAEE`), 12 px muted line "Resets
  Tue 08:00 · shorter window 41% · 8% of growth not explained". Card order: cap, cap line,
  tokens per day, "What 1% of the week costs", "Kinds compared with fresh input", "Where the
  usage comes from" (these three are Slice 9's), cost per task, then the tab bar.
- **States (B2; StatesNew.dc.html line 19, the three Usage cards; new in the refresh).** Each
  card is white, 1 px `#E3E6EB`, radius 16, padding 24, 14 gap, with a 12 px, 600, uppercase
  caption that is a mock label, not page copy. Loading after 500 ms: three skeleton tiles (80 px
  high, radius 10, `#F0F2F5`), one block 150 px and one 110 px, then "Loading usage…" 13 px
  muted. Empty: a 44 px bars icon (`M4 20V10M10 20V4M16 20v-7M22 20H2`, stroke `#5B6370`, 1.6),
  "No usage reported yet" 18 px, 700, and "Tokens and cap readings appear once a client sends
  its first report." (max width 300, `#5B6370`). Failed: a 44 px red triangle (`#B42318`),
  "Couldn’t load usage" 18 px, 700, "The usage API answered 503 (service unavailable)." (the
  real status and its text) and "Retry" (min height 44, radius 10, bg `#14171C`, white, 600,
  padding 0 / 22). Empty applies when no usage and no reading exist in the range. The "estimate
  not ready" card is [Slice 9](09-cap-cost-estimate.md)'s. The phone versions are not drawn;
  they carry over at one column with the dark values by role.
- **New strings (both locales; string table):** "Usage", "Active work" (tab; used by Slice 10),
  "Board" (tab), "Tokens your agents reported, the cap readings, and what each model costs of
  the cap", "Time range", "24 h", "This window", "30 days", "Environment", "All environments",
  "All", "Plan", "Weekly cap used", "Shorter window used", "Resets {day}, {time}", "reading taken
  {time}", "Resets in {h} h {m} min", "Weekly cap over this window", the cap-line caption, "Reset
  · {day} {time}", "Reset", "Dropped: stale reading ({pct}%)", "dropped", "{pct}% now", "{pct}% at
  reading", the dropped tooltip, the alt texts, "Tokens per day, by model" and its three
  siblings, "Tokens per day", "Split tokens by", "Model", "Token kind", "Agent kind",
  "Environment", "Kind", "Agent", "Env", "Token kinds this window, millions", "Fresh input",
  "Cache write", "Cache read", "Output", "Total", "Cost per task", "Kept across resets and plan
  changes", "Task", "Project", "Tokens", "Everything else", "{n} projects", "Resets {day} {time}
  · shorter window {pct}% · {n}% of growth not explained" (the last part comes from Slice 9),
  "Loading usage…", "No usage reported yet", "Tokens and cap readings appear once a client sends
  its first report.", "Couldn’t load usage", "The usage API answered {status} ({text}).",
  "Retry".

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
  column stays on the task table; the agent-kind list (Slice 9) shows tokens too.
- Series colours are config (light and dark pair per series).
- Owner's third request, decision 1 (the mock agrees): `report_usage` and `report_progress`
  carry `environment`, stored on usage samples and on items (A1, A4); the page gets an
  environment filter and "Environment" as the fourth split (Usage.dc.html lines 38 and 80).
- The token chart gets a split switch and a reset line (Usage.dc.html line 76); A5 returns the
  four splits.
- The phone page now draws the cap line, the per-day chart and four task rows (PhoneUsage.dc.html);
  the earlier "not drawn on the phone" note is removed.
- Loading, empty and failed for Usage are drawn (StatesNew.dc.html); the earlier "carry over
  from States.dc.html" note is replaced by the drawn values.
- The desktop dark theme has values in `canvas.json` `notes.dark`; the earlier "no dark
  version, take the phone's" note is replaced by them.

#### Work

**A. Server (no design needed)**

- [x] **A1.** Migration 0003 with the two tables and their indexes (by time, by task key), an
      `environment` text column on usage samples and a nullable `environment` column on `items`
      (this slice adds it for both tools; [Slice 10](10-task-steps.md) reuses it, and adds it
      in its own migration only if it is built first, in which case this migration leaves it
      out).
- [x] **A2.** `src/domain/usage.ts`: the use between two times from running totals, per model
      and kind, including the restart case. Pure, with tests.
- [x] **A3.** `src/domain/cap.ts`: the reading rules above (order by time taken, drop stale,
      detect a reset, split into windows, plan changes). Pure, with tests for: 98 to 1 with a
      new reset time, 60 to 55 with the same reset time, a late-arriving older reading, a reset
      with no reset time, a plan change mid-window.
- [x] **A4.** `report_usage` and `report_cap` tools with schemas and limits, calling the
      application layer; the repository port and its D1 code. `report_usage` and
      `report_progress` (the `environment` field only; the rest of that tool is Slice 10) accept
      an optional `environment` (free text, 1 to 40 characters, as sent by the client, never
      checked against a list in code); the key of a usage sample includes it so one agent key in
      two environments never merges; a report with none stores null.
- [x] **A5.** The read route for the page (Usage.dc.html), for a time range (`24h`, `window`,
      `30d`), a plan, an optional environment and the viewer's UTC offset: tokens per day (per
      hour for `24h`) split four ways (per model, per token kind, per agent kind, per
      environment); totals per model and per token kind; the top tasks by tokens (title,
      project, key; six by config, plus an "everything else" row with its project count);
      tokens per agent kind; tokens and number of reports per environment; the accepted cap
      readings with the windows they fall in (weekly and the shorter one: percent, reset time,
      time taken); the dropped readings with the stored percent each lost to; the plans seen;
      the environments seen (value, and its label from config); the series colour index of each
      model, kind, agent kind and environment (from config, in first-reported order); and the
      time of the answer. All behind the Access check. The cap tiles and the cap line ignore
      the environment.
- [x] **A5b.** `config/board.example.json`: `usage.series` (example: light `#2a78d6`,
      `#eb6834`, `#1baf7a`; dark `#3987e5`, `#d95926`, `#199e70`), `usage.topTasks` (6),
      `usage.baseEnvironment` and `usage.environmentLabels` (see *Decided at the desk*; made-up
      example values). The page reads all of them from the route, never from code.
- [x] **A6.** `docs/clients.md`: both tools, the keys, "totals so far", what to send and how
      often, `environment`, the fail-open rule again. README line.
- [x] **A7.** Thinning of old samples in the cron, with a test.

**B. Usage page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Copy the mock into `docs/design/` and rewrite this part to match it. (Done: the
      mock is in `docs/design/`, refreshed twice on 2026-11-16.)
- [x] **B2.** The shared view switcher and the usage view shell: view tabs (desktop,
      Usage.dc.html line 21) and the bottom tab bar (phone, PhoneUsage.dc.html `nav`), with
      Board and Usage tabs now (Slice 10 adds Active work); header, time-range switch,
      environment filter, plan picker, the two cap tiles (Usage.dc.html section "Cap now";
      PhoneUsage.dc.html first card); a loading state for any wait over 500 ms, empty and
      failed states (StatesNew.dc.html).
- [x] **B3.** The charts and tables: the cap line with the reset marked and a dropped reading
      shown (section "Weekly cap over this window", phone line 35), tokens per day with the
      split switch and the token kinds table (section "Tokens per day, by model", phone line
      39), the cost-per-task table with its Task, Project and Tokens columns (section "Cost
      per task"; the "Of the cap" column and the agent-kind list come with Slice 9); the
      phone cards.
- [x] **B4.** Browser tests against a faked read route, phone and desktop sizes: range switch,
      environment filter and plan picker change the request; the split switch changes the
      legend and table; a dropped reading is drawn hollow with its label; the chart has a
      table equivalent; loading, empty and failed states.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green, with the cases named in A2 and A3.
- Sending the same `report_usage` twice leaves one sample's worth of use; a `report_cap` with a
  lower percentage and the same reset time is stored as dropped and does not change the page.
- The same agent key reported from two environments is two samples, never one; a report with no
  `environment` is stored with null and counts as the base environment (see *Decided at the
  desk*).
- On the deployed board: a real client run shows tokens for at least two models under the right
  task, and the weekly percentage with its reset time. Any check that writes to the live board
  removes its own rows in the same run (`plan.md`, *Outstanding work*).
- The page matches Usage.dc.html and PhoneUsage.dc.html in the values listed in *Design*; no
  model, plan, environment or project name from the mock appears in `web/` or `e2e/` fixtures
  beyond the made-up placeholders.
- `npm run test:e2e` green for part B.

#### Built (2026-11-16, PR #53)

Checks green on the final code (the fixer's run): `npm run lint`, `npm run typecheck`, `npm test` 207 passed,
`npm run test:e2e` 86 passed. A separate run-checks pass was still running when this was written; its result is not
recorded here.

*Measured thinning* (asked for in *Decided at the desk*): one agent and model reporting every 5 minutes for 40 days is
11,520 rows. With `keepDays` 30 and daily thinning it runs at 8,883 rows: 8,640 inside the keep time, 240 hourly rows for
the 10 older days, the restart rows and the oldest row. That is 288 rows per series per day inside the keep time and 24
after it. A 30-day page load reads about 8.6k rows per series.

*Decided while building* (where the slice was silent):

- A sample belongs to the plan of the newest cap reading at or before it; before the first reading it takes the first
  reading's plan; with no readings every plan counts.
- `window_kind` is free text; the route shows `weekly` and `short`.
- The task list follows the range and leaves out tokens with no task key. A task key with no item takes its project
  from the part before the first `/`.
- `/api/usage` returns the palettes and a colour index per series.
- Eight new palette keys in config: `segmentBg`, `segmentText`, `segmentPressedBg`, `segmentPressedText`, `shadow`,
  `track`, `barFill`, `rowLine`.
- Hash routing: the page is `#/usage`.
- Phone task rows show tokens with a bar against the biggest task and no "Everything else" row (as the mock).
- A hidden screen-reader table sits beside the chart.
- The EXPLAIN test asserts that both queries use `idx_usage_samples_time` / `idx_usage_samples_identity`.
- The thinning band is 3 days.

*Changed while building:* nothing else to the plan beyond the list above.

*From review:* findings files read in full: `reviews/pr-53-high.md` (10 findings), `reviews/pr-53-medium.md` (8),
`reviews/pr-53-check-medium.md` (2).

- pr-53-high: applied #1, #2, #3, #4, #5, #6, #10.
- Skipped #7 (`reviews/pr-53-high.md`): "readUsage is about 40 lines and does the whole job" - code shape only, no wrong
  result or extra cost beyond the round trips.
- Recorded #8 (`reviews/pr-53-high.md`): "no counts are recorded" - answered by the measured row counts above.
- Skipped #9 (`reviews/pr-53-high.md`): "A range spanning a DST change buckets samples" - low; kept as a follow-up below.
- pr-53-medium: applied #1, #2, #3, #4, #7.
- Skipped #5 (`reviews/pr-53-medium.md`): "idx_usage_samples_task is used by no query" - work item A1 asks for the
  task-key index.
- Skipped #6 (`reviews/pr-53-medium.md`): "The final ORDER BY over the UNION ALL has no index" - low, no failure path
  today; kept as a follow-up below.
- Skipped #8 (`reviews/pr-53-medium.md`): "SERIES_WINDOW orders by record_at, id" - low, no failure path today; kept as a
  follow-up below.
- pr-53-check-medium: no confirmed defects; its two unconfirmed lows are follow-ups below.

#### Follow-ups (open, not built)

- DST: one UTC offset applied over a 30-day range (`reviews/pr-53-high.md` #9).
- The final ORDER BY over the UNION ALL needs a temp sort and `usageDeltas` re-sorts in JS (`reviews/pr-53-medium.md` #6).
- `SERIES_WINDOW` orders by `record_at, id` while `deltasOfSeries` sorts by `record_at` only; ties are impossible today
  (`reviews/pr-53-medium.md` #8).
- No bound on `record_at` or a window start, so a far-past date makes `bucketKeys` loop once per hour on a request
  (`reviews/pr-53-check-medium.md` #1).
- `splitByBucket` uses `buckets.indexOf` per delta, O(deltas x buckets), CPU only (`reviews/pr-53-check-medium.md` #2).

#### For CLAUDE.md (lifted 2026-11-16)

- Usage state is derived at read: the tables hold only what was reported; windows, verdicts and restarts come from
  `src/domain/cap.ts` and `src/domain/usage.ts`; never store a derived value (Slice 8:
  docs/plan/slices/08-usage-reports.md).
- Every stored time is normalised to UTC ISO in the application layer; `SAMPLES_FROM` and `THIN_ROWS` rely on it and
  `test/usageTools.test.ts` asserts their query plans (Slice 8: docs/plan/slices/08-usage-reports.md).

#### For README.md (lifted 2026-11-16)

None: the README diff in this worktree already describes the usage page and the two tools.

#### Not yet verified

- The deployed-board check in *Verification*: a real client run shows tokens for two models and the weekly percent
  (waits for the deploy and the client in the owner's config repo).
- Migration 0003 applied by the pipeline. Seen 2026-11-16: `wrangler d1 migrations list DB --remote` between 17:10Z and 17:13Z lists only 0004 as unapplied; the pipeline deploy of 6bbae7f at 16:24Z applied it.
- Thinning from the live cron.
- The page on the owner's phone through Access, against the mock.
