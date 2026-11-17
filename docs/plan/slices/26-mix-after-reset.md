### Slice 26 — The "all kinds" cost figure stays steady across a weekly reset

*Built 2026-11-17, merged as PR #115 (7e4d149); work item 1 (live before/after comparison) not done, see Not yet verified.*

*Planned with a recorded default (starter session, 2026-11-17, after the owner's "what the fuck is the question ...
what the fuck do you need from me?" on bare "Waiting on you" cards): the choice below has an obvious answer, so it is
not asked.* Found by the feedback loop of night 2026-11-17-1826 ([note](../notes/2026-11-17-1826-feedback-loop.md)).

**Decision (default, owner may overrule):** while the current window is younger than 24 hours, "All kinds" is
weighted by the last full window's mix, and the row says so ("last week's mix until this week has a day of use");
after 24 hours it uses the current window's mix as now. Reason: it keeps the figure steady across a reset, needs no
new data, and still shows the current mix once there is enough of it.

**Why:** on 2026-11-17 the owner saw the usage page's figures drop right after a weekly cap reset and thought the
reset had wiped history. The session that answered read the live D1: no token rows were lost and the reset was
Claude's own. It named one figure that does start over at a reset: in the
"Tokens that use 1% of the week" table, **"All kinds, this window's mix"** is weighted by the current window's mix
(`src/api/usageDto.ts:63`), and an hour after a reset that mix is an hour of use. The fit itself never crosses a reset
(`buildStretches` in `src/domain/capCost.ts:124-133`). The session ended on a question ("which number dropped?")
instead of running the read-only comparison itself.

**Work:**

- [ ] Run the comparison read-only: the "all kinds" figure from the readings before the reset against the one after,
  on the live data. This needs no owner answer and any session may do it first (the feedback loop did not: the figure
  is computed inside the Worker per read, behind Access, and the loop had no time left to recompute it locally).
  Verify: this file records both numbers.
- [x] Apply the decision above (whether or not the comparison shows a jump; a young window always has a thin mix).
  Verify (what the tests check): `chooseMixWindow` domain tests pick the last full window at one hour and the current
  one at 30 hours and at exactly a day, and measure age from the reset time when the first reading came late; a route
  test (`test/capCostRoute.test.ts`) shows the young figure equal to the last full window's (400,000 tokens per 1%) and
  the 30-hour one on the current mix, the same under an environment filter; the row's note text is shown on the page
  (e2e). A model's "x base" multiple is a dash while it and the base use different windows' mixes. The live
  before/after comparison (item above) is still unmet.

**Touches:** `src/domain/capCost.ts`, `src/application/usage.ts`, `src/api/usageDto.ts`, `web/src/**`, `test/**`, `e2e/**`, `docs/plan/slices/26-mix-after-reset.md`

**Migrations:** none

**Built (2026-11-17):** `chooseMixWindow` in `src/domain/capCost.ts` (pure, tested in `test/capCost.test.ts`); `modelDto`
in `src/application/usage.ts` weights "all kinds" by the last full weekly window's use while the plan's newest weekly
window is under `YOUNG_WINDOW_HOURS` (24) old and an earlier full one exists (a window that lasted under 24 hours is a
stub and is skipped), and says so as `mix_source` (`current` | `last_full`) on each model; only rows that used last
week's mix show `mixLastWeek` (en, de) under the figure (desktop table, compare table, phone row), and the chart tooltip
names it. Route tests in `test/capCostRoute.test.ts` (1 hour old: `last_full`; 30 hours: `current`; different kinds per
window); e2e note in `e2e/usage.spec.ts`. A model with no use in the last window falls back to its current mix, as before.

**Not yet verified:** work item 1, the live before/after figure. A read-only `wrangler d1 execute --remote` SELECT works
(checked), but the figure is a fit computed inside the Worker per read, so comparing it before and after the reset
needs a data export replayed through `readUsage`; not done in this build. No device runs.

**Changed while building:** the window start is the earlier of the first reading and the reset minus 7 days
(`windowStartMs`), so a late first reading does not make a window look young; a "full" window lasted 24 hours or more
and stub windows are skipped; the note sits per row ("last week's mix", en and de) and the header text is neutral;
`multipleOf` in `web/src/capCostFormat.ts` shows a dash when a model and the base used different windows' mixes.

**Checks:** lint, typecheck, `npm test` (488), e2e (261 passed, 3 skipped). No device run: web page only, covered by e2e.

*From review:* applied pr-115-high.md #1-6 and #8, pr-115-medium.md #1, #2 (confirmed not a bug by a two-environment
test), #3 and #8.
- Skipped #7 (`reviews/pr-115-high.md`): "The 24 h threshold is a hard-coded constant" - the slice Decision fixes 24 hours; a named domain constant is enough.
- Skipped #4 (`reviews/pr-115-medium.md`): "last-window mix used whenever totalOf(last) > 0 even for 5 tokens" - no failure path shown; a model with last-window use is the Decision's case.
- Skipped #5 (`reviews/pr-115-medium.md`): "columnMixLast used only in tooltip" - low wording, the header is neutral after fix 1.
- Skipped #6 (`reviews/pr-115-medium.md`): "hand-written ISO string comparator" - style.
- Skipped #7 (`reviews/pr-115-medium.md`): "lastWindowDeltas scans history even when fit === null" - low efficiency.
- Skipped #1 (`reviews/pr-115-check-medium.md`): "one model without last-week use blanks every all-kinds multiple" - low, a dash is the safe side; follow-up.
- Skipped #2 (`reviews/pr-115-check-medium.md`): "a note rendered slightly later would pass vacuously" - low e2e strength; follow-up.
- The review files are in `D:/agent-progress-board-worktrees/reviews` (outside the repo); the check needs `--root D:/agent-progress-board-worktrees`.

#### For CLAUDE.md (lifted 2026-11-17)

- "All kinds" weighting while the current weekly window is under 24 hours old uses the last full window's mix, chosen only by
  `chooseMixWindow` in `src/domain/capCost.ts`; `mix_source` is derived at read, never stored, and the page never picks
  the window (Slice 26: docs/plan/slices/26-mix-after-reset.md).

#### Not yet verified

- Live before/after figure across a weekly reset (work item 1): needs a data export replayed through `readUsage`.
- The page on the live board after the first weekly reset since this merged.
