### Slice 9 — What 1% of the cap costs, per model

Source: the owner at the desk, 2026-11-16 ("the dashboard should be able to guess the consumption
rate ... 1 agent is using [one model], and it uses 2 million tokens, then the weekly usage goes
up 5% ... each 400k token would then cost 1% of my plan").

*Planned.* Needs [Slice 8](08-usage-reports.md) part A. The design mock arrived on 2026-11-16
(in `docs/design/`); part B (the numbers on the usage page) is planned against it (see
*Design* below). The view tabs, the tab bar and the usage page shell belong to Slice 8; this
slice only adds to that page.

**Touches:** `src/domain/capCost.ts`, `src/application/usage.ts`, `src/api/usageDto.ts`,
`src/config.ts`, `config/board.example.json`, `test/**`, `docs/clients.md`, `README.md`,
`web/**`, `e2e/**`, `docs/design/**`

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
    (`capCost.sure`). Fewer stretches than the config minimum is not drawn (see *Design*).
  - Each estimate also says what it is based on: the mode (one weight for all tokens, or a
    weight per token kind), the number of stretches, in the coarse mode the number at which it
    gets finer (three times the unknowns: 12 for one model with four kinds), and, in the fine
    mode when one or two kinds carry most of the weight (share in config), which kinds weigh
    the most.
  - The share of cap growth the board could not explain is given as a share of the growth and
    as points ("8%", "2.8 of the 34.2 points"), and the same points are the "Not explained" row
    of the agent-kind list.
  - Cost per agent kind is given in percent of the cap (points), next to the per-task figure.
  - Number format on the page: below one million written in full with separators ("700,000"),
    from one million as "N million" with at most one decimal ("1.4 million", "19 million").

#### Design (Agent Progress Board mock, Usage.dc.html, PhoneUsage.dc.html, added 2026-11-16)

Two artboards (desktop usage 1440x1900, phone usage 390x844) show this slice's parts on the page
that [Slice 8](08-usage-reports.md) builds; its *Design* has the page frame, tokens, tiles and
tab bars. The mock agrees with the plan (a per-model estimate, a label, an unexplained share,
cost per task and per agent kind in percent) and adds the basis line and the dropped-stale
reading (Slice 8's chart). All names and numbers in it are placeholders; the page never carries
a model or plan name from the repo.

- **Unexplained tile (B2, Usage.dc.html "Cap now" third tile).** Same tile as Slice 8's: label
  "Cap growth the board can’t explain" (curly apostrophe), value "8%" (40 px, 700), no bar, 13
  px muted "2.8 of the 34.2 points. Use the board can’t see: the chat app, a phone, or a
  machine without the client." On the phone it is the end of the cap card's line: "8% of growth
  not explained" (PhoneUsage.dc.html line 30).
- **"What 1% of the week costs" (B2; Usage.dc.html section line 104).** `h2` "What 1% of the
  week costs on {plan}" 16 px, 700, with 13 px muted beside it: "Best fit over many stretches of
  time inside one window on this plan. Stretches with a reset or a plan change are left out."
  Grid `repeat(auto-fit, minmax(260px, 1fr))`, 14 gap, one card per model: white, 1 px
  `#E3E6EB`, radius 14, padding 18 / 20, 8 gap. In the card: series swatch 12 px (radius 3) and
  the model name (JetBrains Mono 13 px, 500); "1% of the week is about" 13 px muted; the number
  30 px, 700, -0.02 em, tabular, with "tokens" 15 px, 500, muted; a pill; the basis line 12
  px muted.
- **"How sure" pill (B2).** Inline, radius 999, padding 3 / 10 (phone 1 / 8), 12 px (phone
  11), 600, with a 12 px circle icon that is filled like a pie: three quarters for "Fairly sure",
  about a third (0.3) for "Rough guess" (the icon repeats the word, colour is not the only
  signal). Light: sure bg `#DDF3E9` text `#0B6B4B`; rough bg `#FDEBD8` text `#9A3F00`. Dark
  (phone): sure bg `#123628` text `#7FD8B4`; rough bg `#3D2610` text `#FFB672`.
- **Basis line (B2).** Examples in the mock: "Weighted per token kind · 46 stretches · output
  and cache writes weigh the most"; "Weighted per token kind · 41 stretches"; "One weight for
  all tokens · 7 stretches · gets finer at 12". Parts: mode ("Weighted per token kind" or "One
  weight for all tokens"), "{n} stretches", then either "gets finer at {n}" (coarse) or "{kinds}
  weigh the most" (fine, only when a few kinds dominate). The phone does not draw this line.
- **Phone list (PhoneUsage.dc.html line 33).** In one card (bg `#171A21`, radius 14, padding 14
  / 14 / 4): `h2` "What 1% of the week costs" 14 px, 700; per model a row, padding 10 / 0,
  hairline `#262B35`: swatch 10 px and name (mono 12 px) at the left, the number right (16 px,
  700), under it "tokens per 1%" 12 px muted and the pill (11 px) at the right.
- **Cost per task, "Of the cap" column (B2; Usage.dc.html line 122).** Last column, 200 px
  wide, header 600 `#14171C`: a bar (6 px, radius 3, track `#F0F2F5`, fill `#3B424D`, at most
  120 px, right aligned, width relative to the biggest row) and the percent (600, min width 44,
  one decimal: "8.6%"). Phone (PhoneUsage.dc.html line 37): percent at the right of the row
  and a 6 px bar under it (track `#232833`, fill `#C7CDD8`).
- **Cost per agent kind (B2; Usage.dc.html line 146).** Card (flex 1 1 340 px) beside the task
  card: `h2` "Cost per agent kind" 16 px, 700; list, 12 gap: name 13 px 500, percent 600 at the
  right, bar 8 px (radius 4, track `#F0F2F5`, fill `#3B424D`, width relative to the biggest).
  Rows in the mock: Implementer, Reviewer, Fixer, Tester, Planner (agent kinds come from the
  data, never from code) and "Not explained" with fill `#C9CED6`. Footnote 12 px muted: "Work
  a helper agent does counts under the agent that started it." The phone does not draw this
  card (carries over from the desktop at one column).
- **Not drawn:** a model with too few stretches for any number, and a plan with no readings.
  What carries over: the card keeps its place and the model name, and shows the empty-state
  pattern from `States.dc.html` (a muted icon and one muted line) in place of the number; the
  wording is new copy for the string table, which the owner sees in the PR. A third "how sure"
  step is not drawn either; the page has the two drawn. The dark desktop page is not drawn: the
  phone's values by role (see Slice 8).
- **New strings (both locales):** "Cap growth the board can’t explain", "{a} of the {b} points.
  Use the board can’t see: the chat app, a phone, or a machine without the client.", "What 1%
  of the week costs on {plan}", "What 1% of the week costs", the best-fit caption, "1% of the
  week is about", "tokens", "tokens per 1%", "{n} million", "Fairly sure", "Rough guess",
  "Weighted per token kind", "One weight for all tokens", "{n} stretches", "gets finer at {n}",
  "{kinds} weigh the most", "Of the cap", "Cost per agent kind", "Not explained", "Work a
  helper agent does counts under the agent that started it."

**Changed to match the mock (2026-11-16):**
- The label gains a second line, "what the estimate is based on" (mode, stretches, when it gets
  finer); the old text had only the label (Usage.dc.html line 104 block).
- The unexplained share is a tile in the cap row and a row of the agent-kind list, not only a
  figure (Usage.dc.html "Cap now", line 146).
- Cost per agent kind gets its own card, with percent; it was only "cost per task and per agent
  kind" in one sentence.
- The "Not explained" row and its 8% / 2.8-point pair are server output (A3).

#### Work

**A. Server**

- [ ] **A1.** `src/domain/capCost.ts`: build the stretches of time from cap readings and usage
      samples (the rules above); pure, with tests for a reset inside a stretch, a plan change,
      a missing reading, joined short stretches.
- [ ] **A2.** The non-negative best fit, coarse and fine, with the leftover figure and the
      "how sure" inputs (number of stretches, size of the leftover). Tests with made-up data
      where the true weights are known: one model alone (the owner's 2 million tokens and 5%
      case must give 400,000 tokens per 1%), three models at once, noise, unseen use.
- [ ] **A3.** The usage route returns, per plan: tokens per 1% for each model (and kind when
      fine), the label (`sure` / `rough`), the basis (mode, number of stretches, the number at
      which it gets finer, the heaviest kinds when they dominate), the unexplained share and
      its points of the cap growth, and cost in percent per task (top rows as Slice 8's A5,
      with the "everything else" row), per agent kind (with a "Not explained" row) and per step
      for a time range. Config keys `capCost.sure` and the dominance share in
      `config/board.example.json`.
- [ ] **A4.** `docs/clients.md` and README: what the estimate needs from a client (regular cap
      readings with the plan name) and what it cannot see.

**B. On the usage page (planned against the mock, 2026-11-16; values in *Design*)**

- [x] **B1.** Rewrite this part to match the mock once it is in `docs/design/`. (Done: the
      mock is in `docs/design/`, refreshed 2026-11-16.)
- [ ] **B2.** On Slice 8's usage page: the unexplained tile (Usage.dc.html "Cap now", third
      tile), the "What 1% of the week costs on {plan}" cards with number, pill and basis line
      (line 104), the "Of the cap" column of the task table (line 122), the "Cost per agent
      kind" card (line 146), and on the phone the 1% list and the percent per task
      (PhoneUsage.dc.html lines 33 and 37). Loading, empty and failed come from Slice 8's page.
- [ ] **B3.** Browser tests against a faked route, phone and desktop sizes: both pill labels,
      both basis variants, the "Not explained" row, number format.

#### Verification

- `npm run lint`, `npm run typecheck`, `npm test` green with the cases in A1 and A2.
- With a faked week that contains a reset from 99% to 0%, no weight and no task cost is
  negative, and the task's cost before the reset is still counted after it.
- On the deployed board after some days of real reports: the estimate for a model that ran alone
  for a stretch matches a hand calculation from the page's own numbers.
