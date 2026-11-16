### Slice 9 — What 1% of the cap costs, per model

Source: the owner at the desk, 2026-11-16 ("the dashboard should be able to guess the consumption
rate ... 1 agent is using [one model], and it uses 2 million tokens, then the weekly usage goes
up 5% ... each 400k token would then cost 1% of my plan").

*In progress (wave 2026-11-16), draft PR.* Needs [Slice 8](08-usage-reports.md) part A (merged, PR #53). The design mock arrived on 2026-11-16
(in `docs/design/`); part B (the numbers on the usage page) is planned against it (see
*Design* below). The view tabs, the tab bar and the usage page shell belong to Slice 8; this
slice only adds to that page.

**Touches:** `src/domain/capCost.ts`, `src/domain/cap.ts`, `src/domain/usage.ts`, `src/application/ports.ts`, `src/application/usage.ts`, `src/api/usageDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`. It reads the `environment` that
[Slice 8](08-usage-reports.md) adds to usage samples and items.

#### Why

Knowing the tokens is half the answer. The owner wants to know how much of the plan each model
eats: "this many tokens of this model cost 1% of the week", and from that what each task, agent
kind and step cost in percent.

#### Decisions (owner, 2026-11-16)

- **Best fit over many time windows, not an exact solve.** The owner's idea (three models, three
  points in time, three equations) is right in spirit. The unknowns are more than one per model,
  because the four token kinds are charged differently, so a few readings would give wild
  answers. The board collects many stretches of time and finds the weights that fit them best.
- **A "how sure" label** next to every estimate, which improves as data grows.
- **Only the growth of the percentage matters, and the plan.** A stretch of time counts only
  when it lies inside one cap window on one plan, with an accepted cap reading at each end. A
  stretch that contains a reset or a plan change is left out, so a reset can never produce a
  negative cost. How long a window lasts plays no part.
- **Weights are worked out per plan.** Moving to another plan starts that plan's own estimate;
  coming back picks the old one up again.
- **Cost is never reset.** A task's cost in percent is its tokens times the weights, added up
  over its whole life, across resets.
- **The estimate measures the environment (owner, 2026-11-16, third request, decision 2).**
  "The Slice 9 fit gets a multiplier per environment, with the main machine as 1×. Show it with
  its own how-sure label, as on Usage.dc.html, "Where the usage comes from" ("Cloud VM: 0.98×
  laptop"). Add tests: one where cloud use counts fully (about 1×), and one where it is free
  (about 0×, no negative value). Cost per task and per agent kind includes this multiplier."
  Which environment is the main machine comes from `usage.baseEnvironment` in config, else the
  environment with the most tokens (see [Slice 8](08-usage-reports.md) *Decided at the desk*);
  the "Cloud VM" and "laptop" in the mock are sample data. Work: A2b, A3.
- **Unexplained use stays unexplained; the board shows when (owner, 2026-11-16, decision 3, the
  no-way branch).** The route returns the stretches with the most unexplained growth (time,
  points, how much the reports explained) for "When the unexplained growth happened". Work: A3b,
  B2. What the official docs say about reading that use is in Slice 8's research section.

#### Decided at the desk (not the owner's choices)

- The fit never gives a negative weight (a model cannot give cap back).
- **Start coarse, get finer.** With few stretches of time the board fits one weight per model
  (all tokens together) and says so. When there are enough stretches (at least three times the
  number of unknowns, in config) it fits a weight per model and token kind. The label names
  which of the two is shown.
- **Use the board cannot see** (the chat app, a phone, another machine without the client) also
  raises the cap. The fit keeps a leftover figure per stretch; the page shows the share of cap
  growth it could not explain, so a bad fit is visible instead of being blamed on a model.
- A stretch is used only when it is at least as long as the reporting interval and the cap rose
  by a measurable amount; several short stretches in a row are joined. Usage samples are lined
  up with cap readings by the nearest sample at or before the reading.
- The fit runs in the Worker when the usage route is read, as a pure function in `src/domain`.
  If it takes too long on real data, store the result in the cron instead and write the timing
  into this file.
- **Added for the mock (2026-11-16):**
  - The "how sure" label has two drawn values, "Fairly sure" and "Rough guess". The label comes
    from the number of stretches and the size of the leftover; the limits are in config
    (`capCost.sure`). Fewer stretches than the config minimum (`capCost.minStretches`) in the
    whole plan shows the "estimate not ready" card (StatesNew.dc.html).
  - Each estimate also says what it is based on: the mode (one weight for all tokens, or a
    weight per token kind), the number of stretches, in the coarse mode the number at which it
    gets finer (three times the unknowns: 12 for one model with four kinds), and, in the fine
    mode when one or two kinds carry most of the weight (share in config), which kinds weigh
    the most (the mock supersedes the last part: the table shows every kind's weight).
  - The comparison base on the page ("Measured in") defaults to the model with the most tokens
    per 1%; the owner can pick another. The "1 token = N× base" numbers come from the same fit.
  - An environment is estimated only when it has at least the config minimum of stretches with
    its use in them (`capCost.environmentMinStretches`); until then it counts as 1× and the
    page says "Not enough data yet". Two stretches must differ in their mix of environments for
    the multiplier to be told apart; a plan that never mixes them shows "Not enough data yet".
  - The share of cap growth the board could not explain is given as a share of the growth and
    as points ("8%", "2.8 of the 34.2 points"), and the same points are the "Not explained" row
    of the agent-kind list.
  - Cost per agent kind is given in percent of the cap (points), next to the per-task figure.
  - Number format on the page: below one million written in full with separators ("700,000"),
    from one million as "N million" with at most one decimal ("1.4 million", "19 million"). The
    mock's tables show two decimals under ten million ("1.74 million", "1.40 million") and the
    phone's kind cells "1.74 M"; those are the table formats, the sentence format is the one
    above.

#### Design (Agent Progress Board mock, Usage.dc.html, PhoneUsage.dc.html, StatesNew.dc.html, added 2026-11-16, refreshed 2026-11-16)

Artboards: desktop usage 1440x2950 (the sections below the token chart), phone usage 390x2420
and the "estimate not ready" card of `StatesNew.dc.html` (line 19). [Slice 8](08-usage-reports.md)
builds the page frame, tiles, filters and tab bars and has their values. The mock agrees with
the plan (a per-model estimate, a label, an unexplained share, cost per task and per agent
kind in percent) and changes the shape: the per-model cards became a table with a log-scale
comparison and a kind table, the basis line became the stretch count and a merged row, and a
"Where the usage comes from" section and an unexplained-stretch list were added. All names and
numbers are placeholders; the page never carries a model, plan or environment name from the
repo. Dark desktop values: `docs/design/canvas.json` `notes.dark` (listed in Slice 8).

- **Unexplained tile (B2, Usage.dc.html "Cap now" third tile, lines 58-62).** Same tile as
  Slice 8's: label "Cap growth the board can’t explain" (curly apostrophe), value "8%" (40 px,
  700), no bar, 13 px muted "2.8 of the 34.2 points. Use no client reports: Claude chat on
  desktop or phone, Claude Design, or a machine without the client." On the phone it is the end
  of the cap card's line: "8% of growth not explained" (PhoneUsage.dc.html line 32).
- **"What 1% of the week costs" section (B2; Usage.dc.html line 109).** White card (1 px
  `#E3E6EB`, radius 14, padding 20 / 24, 22 gap). `h2` "What 1% of the week costs on {plan}" 16
  px, 700, with 13 px muted under it: "Every report carries four counts per agent and model:
  fresh input, cache write, cache read and output. Each is weighed on its own. Best fit over
  stretches inside one window on this plan; stretches with a reset or a plan change are left
  out." Three blocks follow, each with an `h3` 15 px, 700, in one table style: 13 px, tabular,
  header 500 `#5B6370` with a 1 px `#E3E6EB` line, rows padding 10 / 12 with a 1 px `#F0F2F5`
  line, numbers right aligned, the model cell a 10 px swatch (radius 2) and the name (mono 12
  px, 500), the table scrolls sideways when narrow.
- **Block 1, "Tokens that use 1% of the week" (B2; line 115).** Columns: "Model", "Fresh
  input", "Cache write", "Cache read", "Output", "All kinds, this window’s mix" (600), "How
  sure". Mock numbers: 174,000 / 140,000 / 1.74 million / 35,000 / 700,000. A model fitted
  per token kind has all four numbers. A model still on one weight has one merged cell over the
  four kind columns (colspan 4, centred, 12 px muted `#5B6370`, bg `#F7F8FA`): "One weight for
  every kind until 12 stretches (19 million each)", and the mix column shows "19 million". The
  last cell: the pill and under it "{n} stretches" (12 px muted, 2 above). **Pill** (replaces the
  old pie icon; the mock draws none): inline-block, padding 2 / 9, radius 999, 12 px, 600, no
  wrap. "Fairly sure": bg `#DDF3E9`, text `#0B6B4B`. "Rough guess": bg `#FDEBD8`, text
  `#9A3F00`. Dark (phone): sure bg `#123628` text `#7FD8B4`; rough bg `#3D2610` text `#FFB672`.
- **Block 2, "What one token is worth, compared" (B2; line 118).** `h3` and, at the right, "Measured
  in" 13 px muted with a `select` (min height 44, padding 0 / 12, radius 10, 1 px `#E3E6EB`,
  white, 600; options "{model} tokens", one per model; the default is the model with the most
  tokens per 1%, the cheapest token, which the mock shows as its "1× (base)": a decision at the
  desk). Under it 13 px muted, made from the numbers: "One model-mid token uses as much of the
  week as 13.6 model-small tokens; one model-large token as much as 27. Log scale." Legend (12
  px `#3B424D`, 16 gap): 14 px icons, circle = Fresh input, square = Cache write, diamond = Cache
  read, triangle = Output (all `#3B424D`), a 2 px vertical bar `#14171C` = "All kinds, this
  window’s mix". Chart `svg` viewBox 1000x250: log scale 1× at x 130, 10× at 410, 100× at 690,
  1000× at 970, vertical gridlines `#E9ECF0` from y 30 to 198, labels 12 px muted at y 216 ("1×",
  "10×", "100×", "1000×"); one row per model 56 apart (y 48, 104, 160): the model name at x 0
  (mono 12 px `#14171C`), a hairline `#F0F2F5` from x 130 to 970, the markers in the model's
  series colour with a 2 px white stroke (circle r 6, square 12 px radius 1.5, diamond, triangle
  14 px) each with an 11 px muted label ("Fresh 109×", "Cache write 136×", "Cache read 10.9×",
  "Output 544×") and a tooltip "{model} {kind}: {n}×"; the all-kinds mark is a 2 px `#14171C`
  vertical line, 24 px high. The base model's row is one dot at 1× and "every kind = 1× (base)"
  (12 px muted). Alt text: "What one token is worth in {base} tokens, by model and token kind,
  on a log scale from 1 to 1000 times. The table below has the values." Under the chart a table
  (the values, "All kinds" in 600), with the same merged cell for a model on one weight: "1× for
  every kind (the comparison base, one weight so far)" for the base, or the one value for any
  other model on one weight.
- **Block 3, "Token kinds within each model, compared with fresh input" (B2; line 130).** 13
  px muted under the `h3`: "A cache read costs a tenth of a fresh input token; output costs
  five times as much." This sentence is made from the fitted numbers (the mock's 0.10 and 5.0),
  never fixed copy; when models differ it names the first model's ratios and the table
  carries the rest, and with no model fitted per kind it is left out. Table: "Model", "Fresh
  input", "Cache write", "Cache read", "Output"; numbers "1.0×", "1.2×", "0.10×", "5.0×" (below
  1: two decimals; otherwise one); a model not fitted per kind: merged cell "Not split by kind
  yet".
- **"Estimate not ready" (B2; StatesNew.dc.html line 19, fifth card).** Replaces the whole "What
  1% of the week costs" section when the plan has fewer stretches than `capCost.minStretches`
  (config): 44 px clock icon (circle r 9 and `M12 7v5l3 2`, stroke `#9A3F00`, 1.6), "Not enough
  data for an estimate yet" 18 px, 700, and "Only {n} stretches so far inside one window on
  {plan}. Tokens and cap readings still show above." (max width 300, `#5B6370`). Wherever an
  "Of the cap" figure would be shown, the page shows a muted dash (a decision at the desk; the
  mock does not draw it).
- **"Where the usage comes from" (B2; Usage.dc.html line 137).** White card, 18 gap. `h2` 16 px,
  700, with 13 px muted: "Each report names the environment it ran in. The fit gives each
  environment its own multiplier, so cloud VM use is measured, not assumed free. Apps with no
  reports land in “not explained”." Table (13 px, tabular, the style above): "Source", "Runs
  on", "Reports", "Tokens" (right), "Of the cap" (right, 600, `#14171C`), "Cost per token vs
  {base}" ({base} is the base environment's label). Row padding 10 / 12, source 600, "Runs on"
  and last cell `#3B424D`. "Reports" is a pill like the how-sure pill: "Reported" (green as
  "Fairly sure") or "Not reported" (bg `#F0F2F5`, text `#3B424D`). Rows: one per environment
  with reports, in the order first reported: "Claude Code" | the environment label | Reported |
  tokens ("24.1 M") | percent of the cap ("19.6%") | for the base "The base: 1×", for another
  "{m}× {base} · {label}, {n} stretches" (mock: "0.98× laptop · fairly sure, 18 stretches"),
  or "Not enough data yet" when it has too few stretches; then three fixed rows "Claude Design"
  | "Cloud", "Claude chat" | "Desktop and phone", "Anything else" | "Other machines, other
  apps", each Not reported, "—" tokens, "in “not explained”" in the cap column and "—"; last
  row "Not explained" (700) | "Cap growth that no report accounts for" (spans three columns) |
  "2.8%" (700) | "8% of this window’s growth". The table ignores the environment filter (it
  compares them). The fixed rows and the source name "Claude Code" are page copy, not data (the
  tool whose records the client reads is Claude Code, see Slice 8 *Why*); the rows for sources
  the board cannot see follow what Slice 8's research section finds.
- **"When the unexplained growth happened" (B2; line 148).** `h3` 15 px, 700, 13 px muted
  "Stretches where the cap rose more than the reports explain. Times you were in chat or Claude
  Design will show up here.", then a list (no bullets, 4 above): per row grid `200px 110px 1fr`,
  12 gap, padding 10 / 0, 1 px `#F0F2F5` top line, 13 px: the time span "Sat 14, 10:05–12:40"
  (600, tabular), "+1.6 points" (600), and a 13 px `#3B424D` text, either "No agent reported in
  this stretch" or "Agents reported {n} points of it". Three rows in the mock, the largest
  unexplained growth first (the number is config, `capCost.unexplainedStretches`, default 3).
  Empty (no unexplained stretch) is not drawn; the list is left out.
- **Cost per task, "Of the cap" column (B2; Usage.dc.html line 163).** Last column, 200 px
  wide, header 600 `#14171C`: a bar (6 px, radius 3, track `#F0F2F5`, fill `#3B424D`, at most
  120 px, right aligned, width relative to the biggest row) and the percent (600, min width 44,
  one decimal: "8.6%"). The figure counts each environment's tokens times that environment's
  multiplier. Phone (PhoneUsage.dc.html line 68): percent at the right of the row and a 6 px
  bar under it (track `#232833`, fill `#C7CDD8`).
- **Cost per agent kind (B2; Usage.dc.html line 179).** Card (flex 1 1 340 px) beside the task
  card: `h2` "Cost per agent kind" 16 px, 700; list, 12 gap, per row: name 13 px 500, then at
  the right the tokens (13 px muted, tabular, "15.6 M"), then the percent (600, min width 44),
  and a bar under it (8 px, radius 4, track `#F0F2F5`, fill `#3B424D`, width relative to the
  biggest). Rows in the mock: Implementer, Reviewer, Fixer, Tester, Planner (agent kinds come
  from the data, never from code) and "Not explained" with the text "not reported" in place of
  tokens and fill `#C9CED6`. Footnote 12 px muted: "Work a helper agent does counts under
  the agent that started it." Same multiplier as above. The phone does not draw this card
  (carries over from the desktop at one column, the phone's task-row pattern).
- **Phone "What 1% of the week costs" (B2; PhoneUsage.dc.html line 44).** Card (bg `#171A21`,
  radius 14, padding 14, 6 gap): `h2` 14 px, 700; 12 px muted "Four kinds weighed on their own;
  “× small” is what one token is worth in {base} tokens." (the base name is data). List of
  rows (padding 10 / 0, 1 px `#262B35` top line, 8 gap): first line the swatch (10 px, radius 2),
  the name (mono 12 px) and at the right the pill (11 px, 600, padding 1 / 8, dark colours);
  then 13 px "1% ≈ **700,000** tokens · 1 token = **27×** small"; then a two-column grid (6 gap)
  of four cells (bg `#0E1014`, radius 8, padding 6 / 8): label 11 px muted ("Fresh", "Cache
  write", "Cache read", "Output"), the number 13 px, 600, tabular ("174,000", "1.74 M"), and
  "109× small" 11 px `#C7CDD8`. A model on one weight: "1% ≈ **19 million** tokens · the
  comparison base (1×)" (any other: its multiple), and 12 px muted "One weight for every kind
  until 12 stretches (7 so far)". The phone shows no stretch count under the pill (carry over:
  the count is in the coarse line only).
- **Phone "Kinds compared with fresh input" (B2; line 49).** Card: `h2` 14 px, 700; a 4-column
  grid (6 gap) of cells (bg `#0E1014`, radius 8, padding 8 / 4, centred): label 11 px muted, the
  value in bold ("1×", "1.25×", "0.1×", "5×"); under it 12 px muted "Same for model-large and
  model-mid; model-small is not split by kind yet." (made from data). The phone drops trailing
  zeros (the desktop table keeps one or two decimals); both round the same value.
- **Phone "Where the usage comes from" (B2; line 59).** Card, `h2` 14 px, 700; list, rows padding
  8 / 0 with a 1 px `#262B35` top line, grid `1fr auto`, 2 / 8 gap: line 1 the source and
  environment ("Claude Code · laptop", 600) and the percent (700, right); line 2 12 px muted
  "Reported · the base, 1×" or "Reported · 0.98× laptop · fairly sure" and the tokens (12 px
  muted, right). Last row "Not explained" (600) and "2.8%" (700), then a 12 px muted line over
  both columns: "No reports from Claude Design, chat on desktop or phone, or other machines.
  Biggest stretch: Sat 14, 10:05–12:40, +1.6 points." The phone does not draw the three
  fixed "Not reported" rows or the stretch list; they carry over from the desktop at one column.
- **Not drawn.** A plan with no readings (carries over: the "estimate not ready" card with
  the matching count, or Slice 8's empty state when there is no usage at all); a third "how
  sure" step (the page has the two drawn); the phone's multiplier "not enough data yet" line
  (carries over from the desktop cell's text).
- **New strings (both locales):** "Cap growth the board can’t explain", "{a} of the {b} points.
  Use no client reports: Claude chat on desktop or phone, Claude Design, or a machine without
  the client.", "What 1% of the week costs on {plan}", "What 1% of the week costs", the
  best-fit caption (the "Every report carries ..." text), "Tokens that use 1% of the week", "All
  kinds, this window’s mix", "How sure", "{n} stretches", "One weight for every kind until {n}
  stretches ({x} each)", "One weight for every kind until {n} stretches ({m} so far)", "1×
  for every kind (the comparison base, one weight so far)", "What one token is worth, compared",
  "Measured in", "{model} tokens", the comparison sentence, "Log scale.", "every kind = 1×
  (base)", "Fresh", "Token kinds within each model, compared with fresh input", the kinds
  sentence, "Not split by kind yet", "1% ≈ {n} tokens · 1 token = {x}× {base}", "the comparison
  base (1×)", "Four kinds weighed on their own; “× {base}” is what one token is worth in {base}
  tokens.", "{n} million", "Fairly sure", "Rough guess", "Not enough data for an estimate yet",
  "Only {n} stretches so far inside one window on {plan}. Tokens and cap readings still show
  above.", "Where the usage comes from", the section caption, "Source", "Runs on", "Reports",
  "Reported", "Not reported", "Of the cap", "Cost per token vs {base}", "The base: 1×", "{m}×
  {base} · {label}, {n} stretches", "Not enough data yet", the three fixed source rows and their
  "Runs on" texts, "in “not explained”", "Not explained", "Cap growth that no report accounts
  for", "{pct} of this window’s growth", "When the unexplained growth happened", its caption,
  "{span}", "+{n} points", "No agent reported in this stretch", "Agents reported {n} points of
  it", "Cost per agent kind", "not reported", "Work a helper agent does counts under the agent
  that started it.", "Biggest stretch: {span}, +{n} points.".

**Changed to match the mock (2026-11-16):**
- The label gains a second line, "what the estimate is based on" (mode, stretches, when it gets
  finer); the old text had only the label. In the refreshed mock this is the stretch count under
  the pill and the merged "One weight for every kind until {n} stretches" row (Usage.dc.html
  line 116); the one-line "Weighted per token kind · 46 stretches · output and cache writes
  weigh the most" basis line is gone (the mock supersedes it), and so is its "which kinds weigh
  the most" part: the table shows every weight.
- The unexplained share is a tile in the cap row and a row of the agent-kind list, not only a
  figure (Usage.dc.html "Cap now", line 179).
- Cost per agent kind gets its own card, with percent and now tokens; it was only "cost per
  task and per agent kind" in one sentence.
- The "Not explained" row and its 8% / 2.8-point pair are server output (A3).
- The per-model cards (number, pill, basis line) are replaced by the table of block 1, the log
  comparison of block 2 and the kind table of block 3 (the mock supersedes the cards).
- The pill loses the pie icon (the word carries the meaning; Usage.dc.html line 116).
- "Not drawn: a model with too few stretches" is now drawn (the merged row), and the whole-page
  "estimate not ready" card is drawn (StatesNew.dc.html); the old "empty-state pattern in
  place of the number" note is removed.
- Owner's third request, decision 2: a multiplier per environment (base 1×) with its own
  how-sure label, shown in "Where the usage comes from"; cost per task and per agent kind
  include it (A2b, A3).
- Owner's third request, decision 3, no-way branch: "When the unexplained growth happened" (A3b,
  B2) and the "Not explained" row.
- The unexplained tile text now reads "Use no client reports: ..." (Usage.dc.html line 61).

#### Work

**A. Server**

- [ ] **A1.** `src/domain/capCost.ts`: build the stretches of time from cap readings and usage
      samples (the rules above); pure, with tests for a reset inside a stretch, a plan change,
      a missing reading, joined short stretches. Each stretch keeps the tokens per environment.
- [ ] **A2.** The non-negative best fit, coarse and fine, with the leftover figure and the
      "how sure" inputs (number of stretches, size of the leftover). Tests with made-up data
      where the true weights are known: one model alone (the owner's 2 million tokens and 5%
      case must give 400,000 tokens per 1%), three models at once, noise, unseen use.
- [ ] **A2b.** The multiplier per environment (owner's decision 2). The base environment is 1×
      (`usage.baseEnvironment`, else the most tokens, see Slice 8). The fit is
      growth = sum over environments of (multiplier x weighted tokens) + leftover, with every
      weight and multiplier at least 0, solved by alternating non-negative least squares
      (weights with multipliers fixed, then multipliers with weights fixed) until the change
      is below a limit in config. An environment with fewer stretches than the minimum (config)
      is not estimated: it counts as 1x and the page says "Not enough data yet". Its own "how
      sure" label and stretch count come from the stretches where that environment had use.
      Two named tests with made-up data: (1) **cloud use counts fully:** the true multiplier is
      1, the fit gives about 1 (within 0.15) and the cost per task of a cloud-only task equals
      that of the same tokens on the base; (2) **cloud use is free:** the true multiplier is
      0, the fit gives about 0 (within 0.1), no weight or multiplier is negative, and a
      cloud-only task costs about 0%. Both with stretches that mix the two environments so the
      multiplier can be told apart.
- [ ] **A3.** The usage route returns, per plan: tokens per 1% for each model (and kind when
      fine), the label (`sure` / `rough`), the stretch count and the number at which it gets
      finer, the per-kind weights relative to fresh input, the unexplained share and its points
      of the cap growth, the multiplier per environment with its label, stretch count and
      tokens and share of the cap, whether the estimate is ready (the plan's stretch count
      against `capCost.minStretches`), and cost in percent per task (top rows as Slice 8's A5,
      with the "everything else" row), per agent kind (with its tokens and a "Not explained"
      row) and per step for a time range; all of them with the multiplier applied. Config
      keys `capCost.sure`, `capCost.minStretches` and the environment minimum in
      `config/board.example.json`. The "which kinds weigh the most" share key is not needed
      (the mock supersedes it).
- [ ] **A3b.** The usage route also returns the stretches with the most unexplained growth for
      "When the unexplained growth happened" (owner's decision 3, no-way branch): per stretch
      the start and end time, the unexplained points (the leftover), the points of cap growth
      and how many of them the reports explained; the largest first, `capCost.unexplainedStretches`
      of them (3), and the largest one's span for the phone's "Biggest stretch" line. Pure
      function in `src/domain/capCost.ts`, with a test using made-up data with a known
      unexplained stretch.
- [ ] **A4.** `docs/clients.md` and README: what the estimate needs from a client (regular cap
      readings with the plan name, the `environment` on every report) and what it cannot see.

**B. On the usage page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Rewrite this part to match the mock once it is in `docs/design/`. (Done: the
      mock is in `docs/design/`, refreshed twice on 2026-11-16.)
- [ ] **B2.** On Slice 8's usage page: the unexplained tile (Usage.dc.html "Cap now", third
      tile), the "What 1% of the week costs on {plan}" section with its three blocks (line
      109) or the "estimate not ready" card, "Where the usage comes from" (line 137) with the
      sources table, "When the unexplained growth happened" (line 148), the "Of the cap"
      column of the task table (line 163), the "Cost per agent kind" card (line 179), and on
      the phone the 1% list, the kinds card, the sources list and the percent per task
      (PhoneUsage.dc.html lines 44, 49, 59 and 68). Loading, empty and failed come from Slice
      8's page.
- [ ] **B3.** Browser tests against a faked route, phone and desktop sizes: both pill labels,
      a model on one weight (merged row) and one fitted per kind, the comparison select
      changing the numbers, the "estimate not ready" card, the sources table with the base row
      and a measured row, the stretch list, the "Not explained" rows, number format.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1, A2, A2b and A3b.
- With a faked week that contains a reset from 99% to 0%, no weight, multiplier or task cost
  is negative, and the task's cost before the reset is still counted after it.
- Both environment tests of A2b pass: about 1x when cloud use counts fully, about 0x (never
  below 0) when it is free.
- On the deployed board after some days of real reports: the estimate for a model that ran alone
  for a stretch matches a hand calculation from the page's own numbers.
- The page matches Usage.dc.html, PhoneUsage.dc.html and StatesNew.dc.html in the values listed
  in *Design*; no model, plan or environment name from the mock is in `web/` or `e2e/`
  fixtures beyond made-up placeholders.
